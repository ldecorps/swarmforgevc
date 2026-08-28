#!/usr/bin/env bb
;; TDD runner for task_scope_gate_lib.bb (BL-1192) - the send-time gate
;; that refuses a git_handoff whose cited commit's diff vs origin/main
;; carries a path positively belonging to a DIFFERENT ticket than the
;; task's own.

(ns task-scope-gate-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "task_scope_gate_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── ticket-id-for-path: positive identification, scoped shapes only ──────

(assert= "backlog yaml basename names its own id"
         "BL-1174" (task-scope-gate-lib/ticket-id-for-path "backlog/active/BL-1174-something.yaml"))
(assert= "feature file basename names its own id"
         "BL-1185" (task-scope-gate-lib/ticket-id-for-path "specs/features/BL-1185-something.feature"))
(assert= "docs/how-to basename names its own id"
         "BL-1174" (task-scope-gate-lib/ticket-id-for-path "docs/how-to/BL-1174-something.md"))
(assert= "a functional code path is never positively identified"
         nil (task-scope-gate-lib/ticket-id-for-path "extension/src/tools/foo.ts"))
(assert= "a docs path outside how-to is never positively identified"
         nil (task-scope-gate-lib/ticket-id-for-path "docs/reference/BL-1174-something.md"))

;; ── foreign-scope-findings: pure decision ────────────────────────────────

(assert= "no task ticket id -> no findings (caller's own fail-open)"
         [] (task-scope-gate-lib/foreign-scope-findings nil ["backlog/active/BL-1185-x.yaml"]))

(assert= "a foreign backlog yaml is a finding"
         [{:path "backlog/active/BL-1185-x.yaml" :ticket-id "BL-1185"}]
         (task-scope-gate-lib/foreign-scope-findings "BL-1174" ["backlog/active/BL-1185-x.yaml"]))

(assert= "the task's OWN backlog yaml is never a finding"
         [] (task-scope-gate-lib/foreign-scope-findings "BL-1174" ["backlog/active/BL-1174-x.yaml"]))

(assert= "the task's own evidence file is never a finding, even though its own basename names its own id"
         [] (task-scope-gate-lib/foreign-scope-findings "BL-1174" ["backlog/evidence/BL-1174-cleaner-pass.md"]))

(assert= "ANOTHER ticket's evidence file IS a finding - evidence for a different ticket is entanglement, not paperwork"
         [{:path "backlog/evidence/BL-1185-cleaner-pass.md" :ticket-id "BL-1185"}]
         (task-scope-gate-lib/foreign-scope-findings "BL-1174" ["backlog/evidence/BL-1185-cleaner-pass.md"]))

(assert= "a functional code path never becomes a finding, however many are in the diff"
         [] (task-scope-gate-lib/foreign-scope-findings "BL-1174" ["extension/src/a.ts" "extension/src/b.ts"]))

(assert= "a mix: only the positively-identified foreign path is a finding"
         [{:path "backlog/active/BL-1185-x.yaml" :ticket-id "BL-1185"}]
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1174" ["extension/src/a.ts" "backlog/active/BL-1174-x.yaml" "backlog/active/BL-1185-x.yaml"]))

;; ── blocked? ──────────────────────────────────────────────────────────────

(assert-true "non-empty findings -> blocked"
             (task-scope-gate-lib/blocked? {:findings [{:path "a" :ticket-id "BL-1"}]}))
(assert-false "empty findings -> not blocked"
              (task-scope-gate-lib/blocked? {:findings []}))
(assert-false "nil findings -> not blocked"
              (task-scope-gate-lib/blocked? {:findings nil}))

;; ── refusal-message ───────────────────────────────────────────────────────

(let [msg (task-scope-gate-lib/refusal-message
           {:task-name "BL-1174-fixture"
            :findings [{:path "backlog/active/BL-1185-x.yaml" :ticket-id "BL-1185"}]})]
  (assert-includes "refusal names the task" msg "BL-1174-fixture")
  (assert-includes "refusal names the foreign ticket" msg "BL-1185")
  (assert-includes "refusal names the conflicting path" msg "backlog/active/BL-1185-x.yaml")
  (assert-includes "refusal names the task's own ticket id" msg "BL-1174"))

(let [msg (task-scope-gate-lib/refusal-message
           {:task-name "BL-1174-fixture"
            :findings [{:path "a.yaml" :ticket-id "BL-1185"}
                       {:path "b.yaml" :ticket-id "BL-1173"}]})]
  (assert-includes "multi-path refusal names both foreign tickets" msg "BL-1185")
  (assert-includes "multi-path refusal names both foreign tickets (2)" msg "BL-1173"))

;; ── findings-for-git-handoff: real git fixture ────────────────────────────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1192-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- mark-origin-main-here! [root]
  (let [sha (:out (sh! root "git" "rev-parse" "HEAD"))]
    (sh! root "git" "update-ref" "refs/remotes/origin/main" sha)))

;; Records a completed handoff for task-name citing commit - the durable
;; boundary last-handoff-commit reads back (salvage-lib/latest-item-handoffs).
;; A single-role roles.tsv (root doubles as that role's own worktree) is
;; enough; only the archive shape and header fields matter to the reader.
(defn- record-handoff! [root task-name commit]
  (let [roles-tsv (fs/path root ".swarmforge" "roles.tsv")]
    (when-not (fs/exists? roles-tsv)
      (fs/create-dirs (fs/parent roles-tsv))
      (spit (str roles-tsv) (str/join "\t" ["cleaner" "cleaner" (str root) "session" "Cleaner" "claude" "task"]) )
      (spit (str roles-tsv) "\n" :append true))
    (let [completed-dir (fs/path root ".swarmforge" "handoffs" "inbox" "completed")]
      (fs/create-dirs completed-dir)
      (spit (str (fs/path completed-dir (str "00_" (System/nanoTime) "_from_coder_to_cleaner_for_cleaner.handoff")))
            (str "task: " task-name "\ncommit: " commit "\nto: cleaner\nfrom: coder\n")))))

;; scenario 01 (qa_e2e_procedure step 2): a commit entangling two tickets
;; is refused, naming the foreign ticket and the conflicting path.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-1174-x.yaml" "id: BL-1174\n" "BL-1174-fixture: own ticket work")
  (commit! root "backlog/active/BL-1185-x.yaml" "id: BL-1185\n" "BL-1174-fixture: entangled - also touches BL-1185's yaml")
  (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
        result (task-scope-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-1174-fixture" :commit canonical})]
    (assert-true "scenario 01: blocked" (task-scope-gate-lib/blocked? result))
    (assert= "scenario 01: one finding" 1 (count (:findings result)))
    (assert= "scenario 01: finding names BL-1185" "BL-1185" (:ticket-id (first (:findings result))))
    (let [msg (task-scope-gate-lib/refusal-message {:task-name "BL-1174-fixture" :findings (:findings result)})]
      (assert-includes "scenario 01: refusal names BL-1185" msg "BL-1185")
      (assert-includes "scenario 01: refusal names the path" msg "backlog/active/BL-1185-x.yaml"))))

;; scenario 02 (qa_e2e_procedure step 3): rebuilding tip-pure (only the
;; task's own ticket touched) is accepted.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-1174-x.yaml" "id: BL-1174\n" "BL-1174-fixture: own ticket work only")
  (commit! root "extension/src/foo.ts" "export {};\n" "BL-1174-fixture: functional change")
  (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
        result (task-scope-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-1174-fixture" :commit canonical})]
    (assert-false "scenario 02: not blocked (tip-pure)" (task-scope-gate-lib/blocked? result))
    (assert= "scenario 02: no findings" [] (:findings result))))

;; own evidence file for the named task is never a finding, even against a
;; real diff.
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/evidence/BL-1174-cleaner-pass.md" "notes\n" "BL-1174-fixture: own evidence")
  (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
        result (task-scope-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-1174-fixture" :commit canonical})]
    (assert-false "own evidence: not blocked" (task-scope-gate-lib/blocked? result))))

;; scenario 03/04 (fail-open): the cited commit does not resolve at all ->
;; warn, allow, never block.
(with-fixture [root]
  (let [result (task-scope-gate-lib/findings-for-git-handoff
                {:root root :task-name "BL-1174-fixture" :commit "0000000000000000000000000000000000000000"})]
    (assert-false "unreadable commit: not blocked" (task-scope-gate-lib/blocked? result))
    (assert-true "unreadable commit: a warning is present" (some? (:warning result)))
    (assert-includes "unreadable commit: warning names the task" (:warning result) "BL-1174-fixture")))

;; BL-1192 architect bounce D1: a batch role's sibling-ticket commits
;; interleaved in the SAME turn (each tagged with THEIR OWN ticket id) must
;; contribute nothing, even though they sit in the first-parent chain since
;; this task's own last handoff - this is the empirically-verified fix for
;; the false-positive avalanche (BL-1192-architect-bounce-20260828.md).
(with-fixture [root]
  (commit! root "backlog/active/BL-1174-own.yaml" "id: BL-1174\n" "BL-1174-fixture: coder's own first commit")
  (let [first-commit (:out (sh! root "git" "rev-parse" "HEAD"))]
    (record-handoff! root "BL-1174-fixture" first-commit)
    ;; A sibling ticket's own commit, processed in the same batch turn -
    ;; tagged with ITS OWN id, never BL-1174's.
    (commit! root "backlog/active/BL-1185-sibling.yaml" "id: BL-1185\n" "BL-1185-fixture: unrelated sibling ticket in the same batch turn")
    ;; This task's own follow-up commit, further down the same branch.
    (commit! root "backlog/evidence/BL-1174-cleaner-pass.md" "notes\n" "BL-1174-fixture: cleaner pass evidence")
    (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
          result (task-scope-gate-lib/findings-for-git-handoff
                  {:root root :task-name "BL-1174-fixture" :commit canonical})]
      (assert-false "batch sibling excluded: not blocked" (task-scope-gate-lib/blocked? result))
      (assert= "batch sibling excluded: no findings" [] (:findings result)))))

;; The positive case in the same shape: a commit genuinely tagged for THIS
;; task that ALSO touches a foreign ticket's path is still caught in full -
;; the narrower scope must not lose the gate's actual purpose.
(with-fixture [root]
  (commit! root "backlog/active/BL-1174-own.yaml" "id: BL-1174\n" "BL-1174-fixture: coder's own first commit")
  (let [first-commit (:out (sh! root "git" "rev-parse" "HEAD"))]
    (record-handoff! root "BL-1174-fixture" first-commit)
    (commit! root "backlog/active/BL-1185-sibling.yaml" "id: BL-1185\n" "BL-1185-fixture: unrelated sibling ticket in the same batch turn")
    (commit! root "backlog/active/BL-1185-y.yaml" "id: BL-1185\n" "BL-1174-fixture: accidentally also touches BL-1185")
    (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
          result (task-scope-gate-lib/findings-for-git-handoff
                  {:root root :task-name "BL-1174-fixture" :commit canonical})]
      (assert-true "own-commit entanglement still caught: blocked" (task-scope-gate-lib/blocked? result))
      (assert= "own-commit entanglement still caught: finding" [{:path "backlog/active/BL-1185-y.yaml" :ticket-id "BL-1185"}] (:findings result)))))

;; task name resolving to no ticket id at all -> no findings, no warning
;; (nothing to compare against, the ordinary case, not a fact-read failure).
(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-1185-x.yaml" "id: BL-1185\n" "unrelated commit")
  (let [canonical (:out (sh! root "git" "rev-parse" "HEAD"))
        result (task-scope-gate-lib/findings-for-git-handoff
                {:root root :task-name "no-ticket-id-in-this-name" :commit canonical})]
    (assert-false "no task ticket id: not blocked" (task-scope-gate-lib/blocked? result))
    (assert-true "no task ticket id: no warning" (nil? (:warning result)))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: task_scope_gate_lib.bb"))
