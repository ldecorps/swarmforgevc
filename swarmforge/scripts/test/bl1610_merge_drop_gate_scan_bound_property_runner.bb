#!/usr/bin/env bb
;; BL-1610 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over merge_drop_guard_lib.bb's scan-bound
;; behavior (findings-between's 4-arity form), encoding both declared
;; invariants. Real-git-fixture cases, not a random loop: these invariants
;; are about git ancestry/graph structure, the same shape
;; bl1576_merge_drop_guard_property_runner.bb's own invariant 1 and 3
;; already take (a random walk over commit graphs would not usefully
;; exercise the specific ancestry relationships each clause names).
;;
;;   invariant 1 - "Every merge a finding names is reachable from the
;;      forwarded commit and from neither the received commit nor the
;;      sender's own HEAD at the moment it dequeued the received parcel:
;;      a merge the sender did not make after receipt - including one an
;;      upstream role made that arrives through the received commit's own
;;      ancestry - never produces a finding, excused or not": two cases -
;;        (a) a merge reachable from RECEIVED's own ancestry (an upstream
;;            role's, made before the sender ever received the parcel),
;;            built on a branch deliberately NOT a descendant of `head`,
;;            proving `received` alone (not head dominating it by
;;            accident) is what excludes it - the documenter's real
;;            2026-09-17 shape (6e5087cd43);
;;        (b) a merge reachable from HEAD (the sender's own work made
;;            BEFORE it dequeued the parcel) is excluded even though it
;;            postdates `received` in plain commit order - the original
;;            2026-09-16 shape (BL-1606's six historical merges).
;;
;;   invariant 2 - "A finding never names a [blocking] path whose blob at
;;      the forwarded commit equals its blob at the received commit": a
;;      merge the sender genuinely made since receipt drops hunks on a
;;      path, but the forward later restores that path to the received
;;      blob - the finding is still reported (for a caller that wants it)
;;      but never blocks.
;;
;; Non-vacuity proven by hand: reverting merge_drop_guard_lib.bb to its
;; pre-BL-1610-amendment state (bad08ffacb, `bound = head` discarding
;; received) fails case (a) with a spurious finding on the sibling's own
;; merge; reverting excused-by-blob-identity? to always return false fails
;; the invariant-2 case by making blocked? true. Both restored before
;; landing.

(ns bl1610-merge-drop-gate-scan-bound-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "merge_drop_guard_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- write! [root path content] (spit (str (fs/path root path)) content))
(defn- commit! [root message] (sh! root "git" "add" "-A") (sh! root "git" "commit" "-q" "-m" message))
(defn- head [root] (:out (sh! root "git" "rev-parse" "HEAD")))

(defn- init-fixture! [root]
  (sh! root "git" "init" "-q" "-b" "main" ".")
  (sh! root "git" "config" "user.email" "t@t")
  (sh! root "git" "config" "user.name" "t")
  (sh! root "git" "config" "commit.gpgsign" "false"))

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

;; Builds a one-sided merge (parents [sender-sha received-sha], content =
;; sender verbatim - drops the received side's uncontested hunk) on top of
;; a fresh divergence from `from-sha` on `path`. Leaves the merge checked
;; out on `refs/heads/<branch>`. Each case below uses its own fresh temp
;; dir (no cross-case collision), so base-lines/received-content/
;; sender-content are reused verbatim, exactly as
;; merge_drop_guard_lib_test_runner.bb's own fixtures already do."
(defn- build-one-sided-merge [root from-sha branch label path]
  (sh! root "git" "checkout" "-q" "-B" branch from-sha)
  (write! root path (lines-str base-lines))
  (commit! root (str label " base"))
  (let [base-sha (head root)]
    (sh! root "git" "checkout" "-q" "-b" (str label "-received") base-sha)
    (write! root path received-content)
    (commit! root (str label " received side"))
    (let [received-sha (head root)]
      (sh! root "git" "checkout" "-q" branch)
      (write! root path sender-content)
      (commit! root (str label " sender side"))
      (let [sender-sha (head root)]
        (write! root path sender-content)
        (sh! root "git" "add" "-A")
        (let [tree-sha (:out (sh! root "git" "write-tree"))
              merge-sha (:out (sh! root "git" "commit-tree" tree-sha "-p" sender-sha "-p" received-sha
                                    "-m" (str label " one-sided merge")))]
          (sh! root "git" "update-ref" (str "refs/heads/" branch) merge-sha)
          (sh! root "git" "checkout" "-q" branch)
          {:merge-sha merge-sha})))))

;; ── invariant 1(a): a merge in RECEIVED's own ancestry, not reachable
;;    from head, is never named - the documenter's real 2026-09-17 shape.

(let [root (str (fs/create-temp-dir {:prefix "bl1610-invariant1a-"}))]
  (try
    (init-fixture! root)
    (write! root "seed.txt" "seed\n")
    (commit! root "seed base")
    (let [base-sha (head root)
          {sibling-drop-sha :merge-sha} (build-one-sided-merge root base-sha "sibling" "sib" "shared.txt")]
      ;; the sender's own further work, continuing from the sibling's drop.
      (write! root "other.txt" "sender's own work after receipt\n")
      (commit! root "sender plain commit after receipt")
      (let [forwarded-sha (head root)]
        ;; head: a divergent line off the SAME base, never a descendant of
        ;; the sibling's drop - the exact shape a head-only bound misses.
        (sh! root "git" "checkout" "-q" "-B" "coder-head" base-sha)
        (write! root "unrelated.txt" "an unrelated head, off base\n")
        (commit! root "head never descends from the sibling's drop")
        (let [head-sha (head root)]
          (when (zero? (:exit (sh! root "git" "merge-base" "--is-ancestor" sibling-drop-sha head-sha)))
            (fail! "FAIL invariant 1(a) fixture: head must not dominate the sibling's own drop"))
          (let [result (merge-drop-guard-lib/findings-between root sibling-drop-sha forwarded-sha head-sha)]
            (when (seq result)
              (fail! (str "FAIL invariant 1(a): a merge in received's own ancestry was named: " (pr-str result))))))))
    (finally (fs/delete-tree root))))

;; ── invariant 1(b): a merge reachable from HEAD (the sender's own work
;;    made BEFORE it dequeued) is never named - the original 2026-09-16
;;    shape (BL-1606's historical merges).

(let [root (str (fs/create-temp-dir {:prefix "bl1610-invariant1b-"}))]
  (try
    (init-fixture! root)
    (write! root "seed.txt" "seed\n")
    (commit! root "seed base")
    (let [main-sha (head root)
          {historical-sha :merge-sha} (build-one-sided-merge root main-sha "coder" "hist" "shared.txt")]
      ;; head is stamped at the historical merge itself - everything up to
      ;; and including it is "before dequeue".
      (let [head-sha historical-sha]
        (write! root "other.txt" "coder's own further work after dequeue\n")
        (commit! root "coder plain commit after dequeue")
        (let [forwarded-sha (head root)
              result (merge-drop-guard-lib/findings-between root main-sha forwarded-sha head-sha)]
          (when (seq result)
            (fail! (str "FAIL invariant 1(b): a merge reachable from head was named: " (pr-str result)))))))
    (finally (fs/delete-tree root))))

;; ── invariant 2: a finding whose path's blob at forwarded equals its
;;    blob at received is excused - reported, but never blocking.

(let [root (str (fs/create-temp-dir {:prefix "bl1610-invariant2-"}))]
  (try
    (init-fixture! root)
    ;; shared.txt exists at the RECEIVED commit itself (main-sha), exactly
    ;; as the acceptance fixture's own P_PATH does - the blob-identity
    ;; check compares received's blob against forwarded's, so received
    ;; needs a real blob at this path to compare against.
    (write! root "shared.txt" "seed\n")
    (commit! root "seed base")
    (let [main-sha (head root)
          received-blob (:out (sh! root "git" "show" (str main-sha ":shared.txt")))
          {_since-sha :merge-sha} (build-one-sided-merge root main-sha "coder" "since" "shared.txt")]
      ;; the forward restores the dropped path to exactly the received blob
      ;; (main-sha's own, pre-divergence content) - the forward carries no
      ;; version of the path that differs from what was received.
      (write! root "shared.txt" (str received-blob "\n"))
      (commit! root "forward restores the dropped path to the received blob")
      (let [forwarded-sha (head root)
            result (merge-drop-guard-lib/findings-between root main-sha forwarded-sha)]
        (when (empty? result)
          (fail! "FAIL invariant 2 fixture: expected a reported (excused) finding, got none"))
        (when (merge-drop-guard-lib/blocked? {:findings result})
          (fail! (str "FAIL invariant 2: a blob-identical path still blocked: " (pr-str result))))))
    (finally (fs/delete-tree root))))

(println "merge_drop_guard_lib scan-bound property: 3 real-git-fixture cases")
(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
