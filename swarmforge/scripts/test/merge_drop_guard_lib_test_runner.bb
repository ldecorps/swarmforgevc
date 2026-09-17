#!/usr/bin/env bb
;; TDD runner for merge_drop_guard_lib.bb (BL-1576) - the send-time gate
;; that refuses a git_handoff whose branch carries a merge that resolved a
;; conflicted path by taking one side verbatim, discarding uncontested
;; hunks the other side made. Truth-table / generative coverage of the
;; pure core (parse-hunks, contested?, lines-lost) lives in the property
;; runner (bl1576_merge_drop_guard_property_runner.bb, the three declared
;; invariants); this file covers the same shapes as the feature's own
;; scenarios, driven directly against a real git fixture (no swarm_handoff
;; shell-out - that end-to-end path is bl1576MergeDropGuardSteps.js's job).

(ns merge-drop-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "merge_drop_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── parse-hunks: pure, string fixtures, no git ──────────────────────────

(let [diff (str "diff --git a/f b/f\n"
                "index 111..222 100644\n"
                "--- a/f\n"
                "+++ b/f\n"
                "@@ -33,6 +32,0 @@\n"
                "-row1\n"
                "-row2\n"
                "-row3\n"
                "-row4\n"
                "-row5\n"
                "-row6\n")
      hunks (merge-drop-guard-lib/parse-hunks diff)]
  (assert= "one hunk parsed" 1 (count hunks))
  (assert= "base-start parsed" 33 (:base-start (first hunks)))
  (assert= "base-count parsed" 6 (:base-count (first hunks)))
  (assert= "removed lines parsed in order" ["row1" "row2" "row3" "row4" "row5" "row6"] (:removed (first hunks)))
  (assert= "no added lines" [] (:added (first hunks))))

(let [diff (str "diff --git a/f b/f\n"
                "index 111..222 100644\n"
                "--- a/f\n"
                "+++ b/f\n"
                "@@ -40,0 +41,2 @@\n"
                "+new-a\n"
                "+new-b\n")
      hunks (merge-drop-guard-lib/parse-hunks diff)]
  (assert= "one insertion hunk parsed" 1 (count hunks))
  (assert= "insertion base-start" 40 (:base-start (first hunks)))
  (assert= "insertion base-count is 0" 0 (:base-count (first hunks)))
  (assert= "added lines parsed" ["new-a" "new-b"] (:added (first hunks))))

(let [diff (str "diff --git a/f b/f\n"
                "index 111..222 100644\n"
                "--- a/f\n"
                "+++ b/f\n"
                "@@ -5 +5 @@\n"
                "-old\n"
                "+new\n"
                "@@ -20,0 +21,1 @@\n"
                "+later\n")
      hunks (merge-drop-guard-lib/parse-hunks diff)]
  (assert= "two hunks parsed" 2 (count hunks))
  (assert= "first hunk default count 1" 1 (:base-count (first hunks)))
  (assert= "first hunk default start 5" 5 (:base-start (first hunks))))

(assert= "empty diff parses to no hunks" [] (merge-drop-guard-lib/parse-hunks ""))
(assert= "nil diff parses to no hunks" [] (merge-drop-guard-lib/parse-hunks nil))

;; ── contested?: the adjacency discriminator ─────────────────────────────

(assert-false "adjacent ranges (33-38 vs 39-39) are never contested"
              (merge-drop-guard-lib/contested? {:base-start 33 :base-count 6} {:base-start 39 :base-count 1}))
(assert-true "overlapping ranges are contested"
             (merge-drop-guard-lib/contested? {:base-start 33 :base-count 6} {:base-start 35 :base-count 2}))
(assert-true "identical single-line ranges are contested"
             (merge-drop-guard-lib/contested? {:base-start 5 :base-count 1} {:base-start 5 :base-count 1}))
(assert-true "two insertions at the same base position are contested"
             (merge-drop-guard-lib/contested? {:base-start 40 :base-count 0} {:base-start 40 :base-count 0}))
(assert-false "an insertion far from a deletion range is not contested"
              (merge-drop-guard-lib/contested? {:base-start 40 :base-count 0} {:base-start 10 :base-count 6}))
(assert-false "far-apart ranges are not contested"
              (merge-drop-guard-lib/contested? {:base-start 1 :base-count 2} {:base-start 100 :base-count 2}))

;; ── uncontested-hunks ────────────────────────────────────────────────────

(let [received [{:base-start 3 :base-count 2 :removed ["a" "b"] :added []}
                {:base-start 13 :base-count 0 :removed [] :added ["x"]}]
      sender [{:base-start 7 :base-count 1 :removed ["c"] :added []}
              {:base-start 3 :base-count 2 :removed ["different"] :added ["rewrite"]}]]
  ;; received's first hunk (3-4) collides with sender's second hunk (3-4) - contested.
  ;; received's second hunk (point 13) collides with nothing - uncontested.
  (let [remaining (merge-drop-guard-lib/uncontested-hunks received sender)]
    (assert= "one hunk survives as uncontested" 1 (count remaining))
    (assert= "the surviving hunk is the insertion at 13" 13 (:base-start (first remaining)))))

;; ── lines-lost: the resurrection/drop discriminator ─────────────────────

(assert= "a + line matching a self-removed line is a resurrection"
         ["row1" "row2"]
         (merge-drop-guard-lib/lines-lost
          {:own-uncontested-hunks [{:removed ["row1" "row2"] :added []}]
           :diff-plus ["row1" "row2"]
           :diff-minus []}))

(assert= "a - line matching a self-added line is a drop"
         ["added-x"]
         (merge-drop-guard-lib/lines-lost
          {:own-uncontested-hunks [{:removed [] :added ["added-x"]}]
           :diff-plus []
           :diff-minus ["added-x"]}))

(assert= "no loss when diff(side,M) is empty"
         []
         (merge-drop-guard-lib/lines-lost
          {:own-uncontested-hunks [{:removed ["row1"] :added ["added-x"]}]
           :diff-plus []
           :diff-minus []}))

(assert= "blank lines never count, on either side of the comparison"
         []
         (merge-drop-guard-lib/lines-lost
          {:own-uncontested-hunks [{:removed [""] :added ["  "]}]
           :diff-plus [""]
           :diff-minus ["  "]}))

(assert= "a + line with no matching self-removal is not a finding"
         []
         (merge-drop-guard-lib/lines-lost
          {:own-uncontested-hunks [{:removed ["row1"] :added []}]
           :diff-plus ["unrelated-new-content"]
           :diff-minus []}))

;; ── real-git-fixture: findings-between and findings-for-git-handoff ─────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1576-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (fs/create-dirs (fs/path ~root-sym ".swarmforge" "handoffs" "inbox" "in_process"))
       (spit (str (fs/path ~root-sym ".swarmforge" "roles.tsv"))
             (str "cleaner\tcleaner-wt\t" ~root-sym "\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n"))
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- write! [root path content]
  (spit (str (fs/path root path)) content))

(defn- commit! [root message]
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- head [root] (:out (sh! root "git" "rev-parse" "HEAD")))

(defn- seed-parcel! [root task-name commit-sha]
  (spit (str (fs/path root ".swarmforge" "handoffs" "inbox" "in_process" "00_received.handoff"))
        (str "id: x\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: coder\n"
             "task: " task-name "\ncommit: " commit-sha "\n"
             "created_at: 2026-09-15T00:00:00Z\n\nbody\n")))

(def base-lines
  ["base-1" "base-2" "recv-remove-a" "recv-remove-b" "base-5" "base-6"
   "send-remove" "base-8" "base-9" "send-insert-anchor" "base-11" "base-12"
   "recv-insert-anchor" "base-14"])

(defn- lines-str [lines] (str (str/join "\n" lines) "\n"))

(def received-content
  (lines-str ["base-1" "base-2" "base-5" "base-6" "send-remove" "base-8" "base-9"
              "send-insert-anchor" "base-11" "base-12" "recv-insert-anchor" "recv-add-x" "base-14"]))

(def sender-content
  (lines-str ["base-1" "base-2" "recv-remove-a" "recv-remove-b" "base-5" "base-6"
              "base-8" "base-9" "send-insert-anchor" "send-add-y" "base-11" "base-12"
              "recv-insert-anchor" "base-14"]))

(def correct-merge-content
  (lines-str ["base-1" "base-2" "base-5" "base-6" "base-8" "base-9"
              "send-insert-anchor" "send-add-y" "base-11" "base-12"
              "recv-insert-anchor" "recv-add-x" "base-14"]))

;; row 1 of the outline: a fully-correct merge (both sides' hunks kept) is
;; never a finding, even though it is constructed by hand (mergeSha built
;; via commit-tree, exactly as the acceptance steps do).
(with-fixture [root]
  (write! root "shared.txt" (lines-str base-lines))
  (commit! root "seed base")
  (let [base-sha (head root)]
    (write! root "shared.txt" received-content)
    (commit! root "BL-1576-fixture: received removes rows, adds recv-add-x")
    (let [received-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "shared.txt" sender-content)
      (commit! root "BL-1576-fixture: sender removes send-remove, adds send-add-y")
      (let [sender-sha (head root)]
        (write! root "shared.txt" correct-merge-content)
        (sh! root "git" "add" "-A")
        (let [tree-sha (:out (sh! root "git" "write-tree"))
              merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                    "-m" "Merge received into sender (kept both)."))]
          (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
          (let [result (merge-drop-guard-lib/findings-between root received-sha merge-sha)]
            (assert= "correct merge: no findings" [] result)))))))

;; row 3 of the outline: taking the sender's side verbatim resurrects the
;; received side's uncontested removal (and drops its insertion too).
(with-fixture [root]
  (write! root "shared.txt" (lines-str base-lines))
  (commit! root "seed base")
  (let [base-sha (head root)]
    (write! root "shared.txt" received-content)
    (commit! root "BL-1576-fixture: received side")
    (let [received-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "shared.txt" sender-content)
      (commit! root "BL-1576-fixture: sender side")
      (let [sender-sha (head root)]
        ;; sender-verbatim: the merge's tree is exactly sender's own tree.
        (let [tree-sha (:out (sh! root "git" "write-tree"))
              merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                    "-m" "Merge received into sender (kept sender verbatim)."))]
          (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
          (let [result (merge-drop-guard-lib/findings-between root received-sha merge-sha)]
            (assert= "sender-verbatim: exactly one finding" 1 (count result))
            (assert= "sender-verbatim: the received side lost content" "received" (:side (first result)))
            (assert= "sender-verbatim: names the merge commit" merge-sha (:merge (first result)))
            (assert= "sender-verbatim: names the path" "shared.txt" (:path (first result)))
            (assert-true "sender-verbatim: at least one line reported lost" (pos? (:lines (first result))))))))))

;; scenario 04: a revert of the received commit on the branch excuses the
;; sender-verbatim finding entirely.
(with-fixture [root]
  (write! root "shared.txt" (lines-str base-lines))
  (commit! root "seed base")
  (let [base-sha (head root)]
    (write! root "shared.txt" received-content)
    (commit! root "BL-1576-fixture: received side")
    (let [received-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "shared.txt" sender-content)
      (commit! root "BL-1576-fixture: sender side")
      (let [sender-sha (head root)
            tree-sha (:out (sh! root "git" "write-tree"))
            merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                  "-m" "Merge received into sender (kept sender verbatim)."))]
        (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
        (sh! root "git" "commit" "--allow-empty" "-q" "-m"
             (str "Revert \"BL-1576-fixture: received side\"\n\nThis reverts commit " received-sha "."))
        (let [forwarded-sha (head root)
              result (merge-drop-guard-lib/findings-between root received-sha forwarded-sha)]
          (assert= "revert on the branch excuses the finding" [] result))))))

;; scenario 06: a forward with no merge at all is silent.
(with-fixture [root]
  (write! root "shared.txt" (lines-str base-lines))
  (commit! root "seed base")
  (write! root "shared.txt" received-content)
  (commit! root "BL-1576-fixture: received side")
  (let [received-sha (head root)]
    (write! root "shared.txt" "unrelated later work\n")
    (commit! root "plain commit on top, no merge")
    (let [forwarded-sha (head root)
          result (merge-drop-guard-lib/findings-between root received-sha forwarded-sha)]
      (assert= "no merge at all: no findings" [] result))))

;; ordering: merge-commits walks oldest-first (the lib's own docstring
;; promise: "a finding names the earliest offending merge when several
;; exist"). Two independent sender-verbatim merges in sequence, the second
;; built as a descendant of the first, must come back in commit order -
;; `git rev-list --merges` alone is reverse-chronological (newest first);
;; only `--reverse` gives the oldest-first order this test pins. Hand-
;; verified as a real gap, not a style nit: dropping `--reverse` from
;; merge-commits passes every other test in this file, the property
;; runner, and the acceptance feature unchanged (2026-09-15 hardener pass).
(with-fixture [root]
  (write! root "a.txt" (lines-str base-lines))
  (write! root "b.txt" "unused\n")
  (commit! root "seed base")
  (let [base-sha (head root)]
    (write! root "a.txt" received-content)
    (commit! root "received side 1")
    (let [received1-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "a.txt" sender-content)
      (commit! root "sender side 1")
      (let [sender1-sha (head root)]
        (write! root "a.txt" sender-content)
        (sh! root "git" "add" "-A")
        (let [tree1-sha (:out (sh! root "git" "write-tree"))
              merge1-sha (:out (sh! root "git" "commit-tree" tree1-sha "-p" sender1-sha "-p" received1-sha
                                     "-m" "merge1 (sender-verbatim)"))]
          (sh! root "git" "update-ref" "refs/heads/main" merge1-sha)
          (sh! root "git" "checkout" "-q" "main")
          (write! root "b.txt" (lines-str base-lines))
          (commit! root "seed b base")
          (let [base2-sha (head root)]
            (write! root "b.txt" received-content)
            (commit! root "received side 2")
            (let [received2-sha (head root)]
              (sh! root "git" "reset" "-q" "--hard" base2-sha)
              (write! root "b.txt" sender-content)
              (commit! root "sender side 2")
              (let [sender2-sha (head root)]
                (write! root "b.txt" sender-content)
                (sh! root "git" "add" "-A")
                (let [tree2-sha (:out (sh! root "git" "write-tree"))
                      merge2-sha (:out (sh! root "git" "commit-tree" tree2-sha "-p" sender2-sha "-p" received2-sha
                                             "-m" "merge2 (sender-verbatim)"))]
                  (sh! root "git" "update-ref" "refs/heads/main" merge2-sha)
                  (let [result (merge-drop-guard-lib/findings-between root received1-sha merge2-sha)]
                    (assert= "two merges: oldest-first ordering"
                             [merge1-sha merge2-sha]
                             (distinct (map :merge result)))))))))))))

;; scenario 02 shape: a genuinely contested hunk (both sides rewrite the
;; same base line) is never a finding, regardless of which rewrite the
;; merge kept.
(with-fixture [root]
  (write! root "one.txt" "shared-line\n")
  (commit! root "seed base")
  (let [base-sha (head root)]
    (write! root "one.txt" "received-rewrite\n")
    (commit! root "BL-1576-fixture: received rewrites the line")
    (let [received-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "one.txt" "sender-rewrite\n")
      (commit! root "BL-1576-fixture: sender rewrites the line")
      (let [sender-sha (head root)
            tree-sha (do (write! root "one.txt" "received-rewrite\n")
                         (sh! root "git" "add" "-A")
                         (:out (sh! root "git" "write-tree")))
            merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                  "-m" "Merge received into sender (picked received's rewrite)."))]
        (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
        (let [result (merge-drop-guard-lib/findings-between root received-sha merge-sha)]
          (assert= "a contested single-line pick is never a finding" [] result))))))

;; findings-for-git-handoff: mailbox-driven wrapper - blocked?/refusal-message
;; and the unreadable-recorded-commit warning path (scenario 05's shape).
(with-fixture [root]
  (write! root "shared.txt" (lines-str base-lines))
  (commit! root "seed base")
  (let [base-sha (head root)]
    (write! root "shared.txt" received-content)
    (commit! root "BL-1576-fixture: received side")
    (let [received-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "shared.txt" sender-content)
      (commit! root "BL-1576-fixture: sender side")
      (let [sender-sha (head root)
            tree-sha (:out (sh! root "git" "write-tree"))
            merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                  "-m" "Merge received into sender (kept sender verbatim)."))]
        (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
        (seed-parcel! root "BL-1576-fixture" received-sha)
        (let [result (merge-drop-guard-lib/findings-for-git-handoff
                      {:root root :sender "cleaner" :task-name "BL-1576-fixture" :canonical merge-sha})]
          (assert-true "findings-for-git-handoff: blocked" (merge-drop-guard-lib/blocked? result))
          (assert= "findings-for-git-handoff: one finding" 1 (count (:findings result)))
          (let [msg (merge-drop-guard-lib/refusal-message
                     {:task-name "BL-1576-fixture" :findings (:findings result)})]
            (assert-includes "refusal names the merge commit" msg merge-sha)
            (assert-includes "refusal names the path" msg "shared.txt")
            (assert-includes "refusal says the received side's hunks were dropped" msg "received side")
            (assert-includes "refusal states a number of lines" msg "line")))))))

;; unreadable recorded commit -> warning, allowed.
(with-fixture [root]
  (write! root "shared.txt" "content\n")
  (commit! root "seed")
  (seed-parcel! root "BL-1576-fixture" "deadbeef00")
  (let [canonical (head root)
        result (merge-drop-guard-lib/findings-for-git-handoff
                {:root root :sender "cleaner" :task-name "BL-1576-fixture" :canonical canonical})]
    (assert-false "unreadable recorded commit: not blocked" (merge-drop-guard-lib/blocked? result))
    (assert-true "unreadable recorded commit: a warning is present" (some? (:warning result)))
    (assert-includes "warning names the ticket" (:warning result) "BL-1576")))

;; no recorded parcel at all -> silent, no warning.
(with-fixture [root]
  (write! root "shared.txt" "content\n")
  (commit! root "seed")
  (let [canonical (head root)
        result (merge-drop-guard-lib/findings-for-git-handoff
                {:root root :sender "cleaner" :task-name "BL-1576-fixture" :canonical canonical})]
    (assert-false "no recorded parcel: not blocked" (merge-drop-guard-lib/blocked? result))
    (assert-true "no recorded parcel: no warning" (nil? (:warning result)))))

;; ── BL-1610 invariant 1: the 4-arity head bound restricts the merge scan
;; to merges reachable from forwarded and not from head, never the 3-arity
;; fallback's whole received..forwarded range. Two independent
;; sender-verbatim merges on two different paths in sequence - M0 (on
;; old.txt) BEFORE head, M1 (on new.txt) AFTER head - reproduce the exact
;; BL-1606 shape: received is an ancestor of both, head sits between them.
(with-fixture [root]
  (write! root "old.txt" (lines-str base-lines))
  (commit! root "seed old base")
  (let [base0-sha (head root)]
    (write! root "old.txt" received-content)
    (commit! root "received side (old.txt)")
    (let [received-old-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base0-sha)
      (write! root "old.txt" sender-content)
      (commit! root "sender side (old.txt)")
      (let [sender-old-sha (head root)
            tree0-sha (:out (sh! root "git" "write-tree"))
            m0-sha (:out (sh! root "git" "commit-tree" tree0-sha "-p" sender-old-sha "-p" received-old-sha
                               "-m" "M0: merge received into sender (old.txt, kept sender verbatim)."))]
        (sh! root "git" "update-ref" "refs/heads/main" m0-sha)
        (sh! root "git" "checkout" "-q" "main")
        ;; head = the sender's own HEAD at the moment it dequeued the
        ;; parcel - M0 already happened before receipt, exactly BL-1610's
        ;; "coder branch carries a one-sided merge from before the parcel".
        (let [head-sha m0-sha]
          (write! root "new.txt" (lines-str base-lines))
          (commit! root "seed new base")
          (let [base1-sha (head root)]
            (write! root "new.txt" received-content)
            (commit! root "received side (new.txt)")
            (let [received-new-sha (head root)]
              (sh! root "git" "reset" "-q" "--hard" base1-sha)
              (write! root "new.txt" sender-content)
              (commit! root "sender side (new.txt)")
              (let [sender-new-sha (head root)
                    tree1-sha (:out (sh! root "git" "write-tree"))
                    ;; M1 - the merge the sender made AFTER receipt.
                    m1-sha (:out (sh! root "git" "commit-tree" tree1-sha "-p" sender-new-sha "-p" received-new-sha
                                       "-m" "M1: merge received into sender (new.txt, kept sender verbatim)."))]
                (sh! root "git" "update-ref" "refs/heads/main" m1-sha)
                (let [unbounded (merge-drop-guard-lib/findings-between root base0-sha m1-sha)
                      bounded (merge-drop-guard-lib/findings-between root base0-sha m1-sha head-sha)]
                  (assert= "no head (3-arity fallback): both M0 and M1 findings"
                           #{"old.txt" "new.txt"} (set (map :path unbounded)))
                  (assert= "head bound (4-arity): only M1's finding, M0 excluded"
                           #{"new.txt"} (set (map :path bounded)))
                  (assert= "head bound: exactly one finding" 1 (count bounded))
                  (assert= "head bound: names M1, not M0" m1-sha (:merge (first bounded))))))))))))

;; ── BL-1610 amendment (specifier a5e59a0f5b, bounce BL-1610-bounce-
;; 20260917.md): the `^received` exclusion, same isolating-fixture
;; discipline as the `^head` test just above. M-upstream is an UPSTREAM
;; role's one-sided merge, made on a line that becomes the RECEIVED
;; commit's own ancestry - never reachable from the sender's own head at
;; dequeue, because the sender's head predates ever receiving the parcel
;; at all (the documenter's real shape: 6e5087cd43 reached the documenter
;; through 4356ab57c1's ancestry, not through anything the documenter did
;; after receipt). `head..forwarded` alone (the pre-amendment 4-arity
;; scan) re-admits it; `forwarded ^head ^received` must not.
(with-fixture [root]
  (write! root "up.txt" (lines-str base-lines))
  (commit! root "seed base (up.txt)")
  (let [base-sha (head root)]
    (write! root "up.txt" sender-content)
    (commit! root "upstream: keep side (up.txt)")
    (let [keep-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "up.txt" received-content)
      (commit! root "upstream: drop side (up.txt)")
      (let [drop-sha (head root)
            keep-tree-sha (:out (sh! root "git" "rev-parse" (str keep-sha "^{tree}")))
            ;; M-upstream: the UPSTREAM role's own one-sided merge, kept
            ;; the keep-side verbatim - drop-side's uncontested hunk lost.
            m-upstream-sha (:out (sh! root "git" "commit-tree" keep-tree-sha "-p" keep-sha "-p" drop-sha
                                      "-m" "M-upstream: an upstream role's one-sided merge (drops drop-side's hunk)."))]
        (sh! root "git" "update-ref" "refs/heads/main" m-upstream-sha)
        (sh! root "git" "checkout" "-q" "main")
        ;; The parcel this test's sender RECEIVES: one small commit past
        ;; M-upstream - its own ancestry, never anything the sender did.
        (write! root "marker.txt" "received marker\n")
        (commit! root "received: one hop past M-upstream")
        (let [received-sha (head root)]
          ;; The sender's own head at dequeue: reset to BEFORE M-upstream
          ;; ever existed, then the sender's own unrelated work - head has
          ;; NO path to M-upstream at all, exactly the real shape.
          (sh! root "git" "reset" "-q" "--hard" base-sha)
          (write! root "sender-own.txt" "sender's own pre-existing work\n")
          (commit! root "sender: own work before ever receiving the parcel")
          (let [head-sha (head root)]
            (sh! root "git" "update-ref" "refs/heads/main" head-sha)
            (sh! root "git" "checkout" "-q" "main")
            ;; forwarded: the sender's own ordinary merge of the received
            ;; parcel into its own head - ordinary auto-merge, disjoint
            ;; paths, no conflict of its own to resolve.
            (sh! root "git" "merge" "-q" "--no-ff" received-sha
                 "-m" "forwarded: sender merges the received parcel into its own head")
            (let [forwarded-sha (head root)
                  unbounded (merge-drop-guard-lib/findings-between root received-sha forwarded-sha)
                  bounded (merge-drop-guard-lib/findings-between root received-sha forwarded-sha head-sha)]
              (assert= "no head (3-arity, unchanged): M-upstream already excluded (ancestor of received)"
                       #{} (set (map :path unbounded)))
              (assert= "head bound (4-arity, amended): M-upstream STILL excluded via ^received"
                       #{} (set (map :path bounded)))
              (assert-false "head bound: M-upstream itself never named"
                            (boolean (some #(= m-upstream-sha (:merge %)) bounded))))))))))

;; ── BL-1610 invariant 2: excused-by-blob-identity? requires BOTH the
;; merge-commit-is-not-forwarded clause AND the blob-identity clause - a
;; mutant weakening the AND to an OR (hand-verified via a bb -e probe,
;; BL-638 fallback: the mutated form marked case C below excused, where
;; the original correctly leaves it blocked) survives every other test in
;; this file, so these three cases pin all four AND-truth-table corners
;; that matter (the merge-is-forwarded corner is already pinned by the
;; sender-verbatim test above).
(with-fixture [root]
  (write! root "shared.txt" (lines-str base-lines))
  (commit! root "seed base")
  (let [base-sha (head root)]
    (write! root "shared.txt" received-content)
    (commit! root "BL-1610-fixture: received side")
    (let [received-sha (head root)]
      (sh! root "git" "reset" "-q" "--hard" base-sha)
      (write! root "shared.txt" sender-content)
      (commit! root "BL-1610-fixture: sender side")
      (let [sender-sha (head root)
            tree-sha (:out (sh! root "git" "write-tree"))
            merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                  "-m" "Merge received into sender (kept sender verbatim)."))]
        (sh! root "git" "update-ref" "refs/heads/main" merge-sha)
        ;; Case A: merge IS forwarded (nothing comes after it) - not
        ;; excused regardless of blob identity (first AND clause false).
        (let [result-a (merge-drop-guard-lib/findings-between root received-sha merge-sha)]
          (assert= "case A (merge is forwarded): one finding" 1 (count result-a))
          (assert-false "case A: not excused" (:excused (first result-a))))
        ;; Case B: something comes after the merge that restores the path
        ;; to exactly what received carried - excused (both clauses true).
        (write! root "shared.txt" received-content)
        (commit! root "restore shared.txt to received's content")
        (let [forwarded-b-sha (head root)
              result-b (merge-drop-guard-lib/findings-between root received-sha forwarded-b-sha)]
          (assert= "case B (restored to received): one finding" 1 (count result-b))
          (assert-true "case B: excused" (:excused (first result-b)))
          (assert-false "case B: not blocked" (merge-drop-guard-lib/blocked?
                                                {:findings result-b})))
        ;; Case C: something comes after the merge, but it does NOT
        ;; restore the path to received's content - first clause true,
        ;; second clause false, so an AND still refuses (an OR would
        ;; wrongly excuse it on the first clause alone).
        (sh! root "git" "reset" "-q" "--hard" merge-sha)
        (write! root "shared.txt" "neither side's content, still not received's\n")
        (commit! root "change shared.txt again, matching neither side")
        (let [forwarded-c-sha (head root)
              result-c (merge-drop-guard-lib/findings-between root received-sha forwarded-c-sha)]
          (assert= "case C (later, still not received): one finding" 1 (count result-c))
          (assert-false "case C: not excused (AND, not OR)" (:excused (first result-c)))
          (assert-true "case C: still blocked" (merge-drop-guard-lib/blocked?
                                                 {:findings result-c})))))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: merge_drop_guard_lib.bb"))
