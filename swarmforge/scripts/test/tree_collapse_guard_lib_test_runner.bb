#!/usr/bin/env bb
;; TDD runner for tree_collapse_guard_lib.bb (BL-1205) - the send-time gate
;; that refuses a git_handoff whose merge into a recipient's branch would
;; mass-delete that branch's tracked files. Truth-table coverage of
;; mass-deletion? lives in the property runner (bl1205_tree_collapse_guard_
;; property_runner.bb); this file covers blocked?, refusal-message, and
;; findings-for-git-handoff's real-git-fixture shapes matching the
;; feature's scenarios.

(ns tree-collapse-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tree_collapse_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── blocked? ──────────────────────────────────────────────────────────────

(assert-true "non-empty findings -> blocked"
             (tree-collapse-guard-lib/blocked? {:findings [{:recipient "cleaner"}]}))
(assert-false "empty findings -> not blocked"
              (tree-collapse-guard-lib/blocked? {:findings []}))

;; ── refusal-message: names the recipient, the count, and both totals ──────

(let [msg (tree-collapse-guard-lib/refusal-message
           {:findings [{:recipient "hardender" :branch "swarmforge-hardender"
                        :before 9773 :after 93 :removed 9680}]})]
  (assert-includes "refusal names the recipient" msg "hardender")
  (assert-includes "refusal names the branch" msg "swarmforge-hardender")
  (assert-includes "refusal names the removed count" msg "9680")
  (assert-includes "refusal names the before total" msg "9773")
  (assert-includes "refusal names the after total" msg "93"))

(let [msg (tree-collapse-guard-lib/refusal-message
           {:findings [{:recipient "a" :branch "ba" :before 1000 :after 10 :removed 990}
                       {:recipient "b" :branch "bb" :before 500 :after 5 :removed 495}]})]
  (assert-includes "multi-recipient refusal names first" msg "a")
  (assert-includes "multi-recipient refusal names second" msg "b"))

;; ── findings-for-git-handoff: real git fixture ────────────────────────────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1205-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (fs/create-dirs (fs/path ~root-sym ".swarmforge"))
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- write-roles! [root]
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "coder\tcoder-wt\t.\tsender-branch\tCoder\tclaude\ttask\n"
             "cleaner\tcleaner-wt\t.\trecipient-branch\tCleaner\tclaude\tbatch\n")))

(defn- seed-files! [root n]
  (doseq [i (range n)]
    (spit (str (fs/path root (str "f" i ".txt"))) (str "f" i "\n")))
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" "seed"))

;; scenario 01: mass deletion -> refused, with a finding
(with-fixture [root]
  (write-roles! root)
  (seed-files! root 200)
  (sh! root "git" "branch" "recipient-branch")
  (sh! root "git" "checkout" "-q" "-b" "sender-branch")
  (doseq [i (range 190)] (fs/delete-if-exists (fs/path root (str "f" i ".txt"))))
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" "mass delete")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (tree-collapse-guard-lib/findings-for-git-handoff
                {:root root :recipients ["cleaner"] :commit commit})]
    (assert-true "scenario 01: blocked" (tree-collapse-guard-lib/blocked? result))
    (assert= "scenario 01: exactly one finding" 1 (count (:findings result)))
    (assert= "scenario 01: finding names cleaner" "cleaner" (:recipient (first (:findings result))))
    (assert= "scenario 01: removed count" 190 (:removed (first (:findings result))))))

;; scenario 02: a handful of deletions -> allowed
(with-fixture [root]
  (write-roles! root)
  (seed-files! root 200)
  (sh! root "git" "branch" "recipient-branch")
  (sh! root "git" "checkout" "-q" "-b" "sender-branch")
  (doseq [i (range 3)] (fs/delete-if-exists (fs/path root (str "f" i ".txt"))))
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" "ordinary delete")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (tree-collapse-guard-lib/findings-for-git-handoff
                {:root root :recipients ["cleaner"] :commit commit})]
    (assert-false "scenario 02: not blocked" (tree-collapse-guard-lib/blocked? result))
    (assert= "scenario 02: no findings" [] (:findings result))))

;; scenario 03: multiple recipients, one of which is the QA edge - checked
;; the same way as any other, no ticket id involved
(with-fixture [root]
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "coder\tcoder-wt\t.\tsender-branch\tCoder\tclaude\ttask\n"
             "hardender\thardender-wt\t.\thardender-branch\tHardener\tclaude\tbatch\n"
             "QA\tQA-wt\t.\tqa-branch\tQa\tclaude\ttask\n"))
  (seed-files! root 200)
  (sh! root "git" "branch" "hardender-branch")
  (sh! root "git" "branch" "qa-branch")
  (sh! root "git" "checkout" "-q" "-b" "sender-branch")
  (doseq [i (range 190)] (fs/delete-if-exists (fs/path root (str "f" i ".txt"))))
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" "mass delete")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result-hardener (tree-collapse-guard-lib/findings-for-git-handoff
                         {:root root :recipients ["hardender"] :commit commit})
        result-qa (tree-collapse-guard-lib/findings-for-git-handoff
                   {:root root :recipients ["QA"] :commit commit})]
    (assert-true "scenario 03: hardener hop (no QA involved) still refused"
                 (tree-collapse-guard-lib/blocked? result-hardener))
    (assert-true "scenario 03: QA hop also refused, same mechanism"
                 (tree-collapse-guard-lib/blocked? result-qa))))

;; scenario 04: recipient's branch cannot be read -> warns, allows
(with-fixture [root]
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "coder\tcoder-wt\t.\tsender-branch\tCoder\tclaude\ttask\n"
             "cleaner\tcleaner-wt\t.\tnonexistent-branch\tCleaner\tclaude\tbatch\n"))
  (seed-files! root 5)
  (sh! root "git" "checkout" "-q" "-b" "sender-branch")
  (spit (str (fs/path root "g.txt")) "g\n")
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" "more")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (tree-collapse-guard-lib/findings-for-git-handoff
                {:root root :recipients ["cleaner"] :commit commit})]
    (assert-false "scenario 04: not blocked" (tree-collapse-guard-lib/blocked? result))
    (assert= "scenario 04: exactly one warning" 1 (count (:warnings result)))
    (assert-includes "scenario 04: warning names the unreadable branch" (first (:warnings result)) "nonexistent-branch")))

;; no recipients at all (defensive - the caller never invokes this shape in
;; practice, since swarm_handoff.bb only calls this when recipients is
;; non-empty, but the pure reduce over an empty seq must still be inert)
(with-fixture [root]
  (write-roles! root)
  (seed-files! root 5)
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (tree-collapse-guard-lib/findings-for-git-handoff
                {:root root :recipients [] :commit commit})]
    (assert-false "no recipients: not blocked" (tree-collapse-guard-lib/blocked? result))
    (assert= "no recipients: no warnings" [] (:warnings result))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: tree_collapse_guard_lib.bb"))
