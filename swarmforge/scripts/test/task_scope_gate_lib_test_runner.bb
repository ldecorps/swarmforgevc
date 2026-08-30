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

;; BL-1192 architect bounce round 2 D1: a deliberate rebuild off origin/main
;; (BL-1241's own escape hatch for an entangled tip) does not descend from
;; the previously-cited commit by construction. `rev-list base..commit`
;; never ERRORS on a non-descendant base (verified empirically: two-dot
;; range syntax is well-defined for disconnected histories too) - so the
;; observable defect isn't "the rebuild's own commit goes missing", it's
;; that an unbounded base pulls in OLD, unrelated history that happens to
;; be tagged for this same task from a much earlier iteration, which a
;; disconnected abandoned-commit provides no boundary against. This fixture
;; reproduces exactly that: an EARLIER, already-landed BL-1174 commit sits
;; on origin/main's own history, itself entangled with BL-1185 (old,
;; irrelevant to the current rebuild) - walking from a disconnected
;; abandoned commit re-discovers it; walking from origin/main correctly
;; does not, because it IS reachable from origin/main and origin/main is
;; the override's own base (qa_e2e_procedure check 2).
(with-fixture [root]
  ;; An earlier, ALREADY-LANDED BL-1174 commit, itself entangled with
  ;; BL-1185 - old history, nothing to do with the current rebuild, but
  ;; still reachable from origin/main.
  (commit! root "backlog/active/BL-1174-x.yaml" "id: BL-1174\n" "BL-1174-fixture: earlier landed work")
  (commit! root "backlog/active/BL-1185-old.yaml" "id: BL-1185\n" "BL-1174-fixture: earlier landed work, entangled with BL-1185")
  (mark-origin-main-here! root)
  (let [origin-sha (:out (sh! root "git" "rev-parse" "origin/main"))]
    ;; The entangled attempt QA bounced THIS pass, built on a DISCONNECTED
    ;; root (BL-1241's own "extreme case": a collapsed/orphaned branch
    ;; state, not merely a sibling of origin/main).
    (sh! root "git" "checkout" "-q" "--orphan" "disconnected")
    (sh! root "git" "commit" "-q" "--allow-empty" "-m" "disconnected-root")
    (commit! root "backlog/active/BL-1174-x.yaml" "id: BL-1174\n" "BL-1174-fixture: entangled attempt on a disconnected branch")
    (commit! root "backlog/active/BL-1185-x.yaml" "id: BL-1185\n" "BL-1174-fixture: entangled - also touches BL-1185")
    (let [abandoned-commit (:out (sh! root "git" "rev-parse" "HEAD"))
          abandoned-short (subs abandoned-commit 0 10)]
      (record-handoff! root "BL-1174-fixture" abandoned-commit)
      ;; Deliberate rebuild: back to origin/main (the rebuild's real
      ;; parent), so the new tip shares NO history with the abandoned
      ;; commit beyond origin/main itself.
      (sh! root "git" "checkout" "-q" "main")
      (sh! root "git" "reset" "-q" "--hard" origin-sha)
      (commit! root "backlog/active/BL-1174-x.yaml"
               (str "id: BL-1174\nabandoned_commits:\n  - " abandoned-short "\n")
               "BL-1174-fixture: tip-pure rebuild off origin/main, records abandonment")
      (let [rebuilt-commit (:out (sh! root "git" "rev-parse" "HEAD"))
            ancestry-check (sh! root "git" "merge-base" "--is-ancestor" abandoned-commit rebuilt-commit)
            result (task-scope-gate-lib/findings-for-git-handoff
                    {:root root :task-name "BL-1174-fixture" :commit rebuilt-commit})]
        (assert-false "fixture sanity: rebuild does not descend from the abandoned commit"
                      (zero? (:exit ancestry-check)))
        (assert-false "abandoned base -> walk from origin/main, old landed history excluded"
                      (task-scope-gate-lib/blocked? result))
        (assert= "abandoned base -> no findings (old BL-1185 entanglement out of range)" [] (:findings result))))))

;; The converse, same fixture shape but WITHOUT recording the abandonment:
;; the disconnected abandoned commit provides no boundary, so the walk from
;; it reaches all the way back to origin/main's own root and re-discovers
;; the EARLIER landed BL-1174 commit's stale entanglement with BL-1185 -
;; a real false positive on old, irrelevant history, exactly what the
;; override exists to prevent.
(with-fixture [root]
  (commit! root "backlog/active/BL-1174-x.yaml" "id: BL-1174\n" "BL-1174-fixture: earlier landed work")
  (commit! root "backlog/active/BL-1185-old.yaml" "id: BL-1185\n" "BL-1174-fixture: earlier landed work, entangled with BL-1185")
  (mark-origin-main-here! root)
  (let [origin-sha (:out (sh! root "git" "rev-parse" "origin/main"))]
    (sh! root "git" "checkout" "-q" "--orphan" "disconnected")
    (sh! root "git" "commit" "-q" "--allow-empty" "-m" "disconnected-root")
    (commit! root "backlog/active/BL-1174-x.yaml" "id: BL-1174\n" "BL-1174-fixture: entangled attempt on a disconnected branch")
    (commit! root "backlog/active/BL-1185-x.yaml" "id: BL-1185\n" "BL-1174-fixture: entangled - also touches BL-1185")
    (let [abandoned-commit (:out (sh! root "git" "rev-parse" "HEAD"))]
      (record-handoff! root "BL-1174-fixture" abandoned-commit)
      (sh! root "git" "checkout" "-q" "main")
      (sh! root "git" "reset" "-q" "--hard" origin-sha)
      ;; No abandonment recorded this time.
      (commit! root "backlog/active/BL-1174-x.yaml" "id: BL-1174\n" "BL-1174-fixture: unrelated rebuild, abandonment never recorded")
      (let [rebuilt-commit (:out (sh! root "git" "rev-parse" "HEAD"))
            result (task-scope-gate-lib/findings-for-git-handoff
                    {:root root :task-name "BL-1174-fixture" :commit rebuilt-commit})]
        (assert-true "unrecorded abandonment: disconnected base re-discovers old landed entanglement, blocked"
                     (task-scope-gate-lib/blocked? result))
        (assert= "unrecorded abandonment: finding names the OLD BL-1185 entanglement"
                 [{:path "backlog/active/BL-1185-old.yaml" :ticket-id "BL-1185"}]
                 (:findings result))))))

;; ── BL-1276: a ticket's own declared acceptance contract is not foreign ──

(assert= "declared-acceptance-path reads a plain single-line pointer"
         "specs/features/BL-1230-guard.feature"
         (task-scope-gate-lib/declared-acceptance-path
          "id: BL-1246\ntitle: x\nacceptance: specs/features/BL-1230-guard.feature\n"))

(assert= "declared-acceptance-path strips surrounding quotes"
         "specs/features/BL-1230-guard.feature"
         (task-scope-gate-lib/declared-acceptance-path
          "acceptance: \"specs/features/BL-1230-guard.feature\"\n"))

(assert= "a block-scalar acceptance declares no comparable path (BL-922's unreadable form)"
         nil
         (task-scope-gate-lib/declared-acceptance-path "id: BL-1246\nacceptance: |\n  given a thing\n"))

(assert= "no acceptance field declares nothing"
         nil
         (task-scope-gate-lib/declared-acceptance-path "id: BL-1246\ntitle: x\n"))

(assert= "the declared feature file is not foreign"
         []
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1246" ["specs/features/BL-1230-guard.feature"] "specs/features/BL-1230-guard.feature"))

(assert= "EXACTNESS: another path of the same foreign ticket is still foreign"
         [{:path "backlog/active/BL-1230-guard.yaml" :ticket-id "BL-1230"}]
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1246" ["backlog/active/BL-1230-guard.yaml"] "specs/features/BL-1230-guard.feature"))

(assert= "a DIFFERENT foreign feature file is still foreign"
         [{:path "specs/features/BL-1230-guard.feature" :ticket-id "BL-1230"}]
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1246" ["specs/features/BL-1230-guard.feature"] "specs/features/BL-1246-own.feature"))

(assert= "no declaration exempts nothing"
         [{:path "specs/features/BL-1230-guard.feature" :ticket-id "BL-1230"}]
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1246" ["specs/features/BL-1230-guard.feature"] nil))

(assert= "the two-arity call is unchanged from BL-1192's own shape"
         [{:path "specs/features/BL-1230-guard.feature" :ticket-id "BL-1230"}]
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1246" ["specs/features/BL-1230-guard.feature"]))

(assert= "declared-retires-paths reads a list block"
         ["specs/features/BL-1248-switch.feature" "specs/features/BL-9-other.feature"]
         (task-scope-gate-lib/declared-retires-paths
          "id: BL-1251\nretires:\n  - specs/features/BL-1248-switch.feature\n  - specs/features/BL-9-other.feature\nstatus: todo\n"))

(assert= "declared-retires-paths does not end the list block on a blank or comment line between entries"
         ["specs/features/BL-1248-switch.feature" "specs/features/BL-9-other.feature"]
         (task-scope-gate-lib/declared-retires-paths
          (str "id: BL-1251\nretires:\n  - specs/features/BL-1248-switch.feature\n"
               "\n  # a comment explaining the second entry\n"
               "  - specs/features/BL-9-other.feature\nstatus: todo\n")))

(assert= "declared-retires-paths reads an inline single value"
         ["specs/features/BL-1248-switch.feature"]
         (task-scope-gate-lib/declared-retires-paths "retires: specs/features/BL-1248-switch.feature\n"))

(assert= "declared-retires-paths stops at the next top-level field"
         ["specs/features/BL-1248-switch.feature"]
         (task-scope-gate-lib/declared-retires-paths
          "retires:\n  - specs/features/BL-1248-switch.feature\nstatus: todo\n  - not-a-retires-entry\n"))

(assert= "declared-retires-paths is empty when the field is absent"
         []
         (task-scope-gate-lib/declared-retires-paths "id: BL-1\ntitle: x\n"))

(assert= "declared-exempt-paths is ONE accessor over every declaring field"
         ["specs/features/BL-1230-guard.feature" "specs/features/BL-1248-switch.feature"]
         (task-scope-gate-lib/declared-exempt-paths
          "acceptance: specs/features/BL-1230-guard.feature\nretires:\n  - specs/features/BL-1248-switch.feature\n"))

(assert= "a retires: declared feature file is not foreign"
         []
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1251" ["specs/features/BL-1248-switch.feature"] ["specs/features/BL-1248-switch.feature"]))

(assert= "EXACTNESS holds for retires: too - the sibling yaml is still foreign"
         [{:path "backlog/active/BL-1248-switch.yaml" :ticket-id "BL-1248"}]
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1251" ["backlog/active/BL-1248-switch.yaml"] ["specs/features/BL-1248-switch.feature"]))

(assert= "a single declared path may still be passed as a bare string"
         []
         (task-scope-gate-lib/foreign-scope-findings
          "BL-1246" ["specs/features/BL-1230-guard.feature"] "specs/features/BL-1230-guard.feature"))

(assert-includes "an unevaluable exemption is SAID, not silently skipped"
                 (task-scope-gate-lib/refusal-message
                  {:task-name "BL-1246"
                   :findings [{:path "specs/features/BL-1230-guard.feature" :ticket-id "BL-1230"}]
                   :acceptance-unreadable? true})
                 "declared-path exemption could not be evaluated")

(assert-false "a readable declaration adds no such note"
              (str/includes?
               (task-scope-gate-lib/refusal-message
                {:task-name "BL-1246"
                 :findings [{:path "backlog/active/BL-1230-guard.yaml" :ticket-id "BL-1230"}]})
               "could not be evaluated"))


;; ── BL-1295: a revert does not blame the ticket its subject quotes ───────
;;
;; `git revert` writes `Revert "<original subject>"`, so a revert of a
;; ticket's own merge inherits that ticket's id verbatim. A revert of a
;; MERGE undoes everything the merge carried, so its diff names other
;; tickets' paths - and the gate refused the send on the strength of a
;; commit that only REMOVED content. Observed live on BL-1240, blocked at
;; the documenter to QA hop by commit 3825f91cd.

(assert-true "revert-subject?: the shape git revert itself writes"
             (task-scope-gate-lib/revert-subject? "Revert \"BL-1240: the fixture closure resolves each idiom\""))
(assert-true "revert-subject?: a revert of a merge, the shape that caused BL-1240's block"
             (task-scope-gate-lib/revert-subject? "Revert \"Merge documenter BL-1240 0ca3bc03c0 into QA. By QA.\""))
(assert-true "revert-subject?: a revert of a revert is still a revert"
             (task-scope-gate-lib/revert-subject? "Revert \"Revert \\\"BL-1240: something\\\"\""))
(assert-true "revert-subject?: leading whitespace does not hide it"
             (task-scope-gate-lib/revert-subject? "  Revert \"BL-1240: something\""))

;; The quoting is the signal, not the word. A hand-written subject that
;; merely starts with the word must NOT be exempted - exempting too much
;; would let real foreign scope through, which is the failure that matters.
(assert-false "revert-subject?: an ordinary subject that happens to start with the word is not a revert"
              (task-scope-gate-lib/revert-subject? "Revert the bad merge by hand for BL-1240"))
(assert-false "revert-subject?: a ticket-prefixed subject describing a revert is the ticket's own commit"
              (task-scope-gate-lib/revert-subject? "BL-1240: revert the fixture change and redo it"))
(assert-false "revert-subject?: an ordinary subject is not a revert" (task-scope-gate-lib/revert-subject? "BL-1240: do the thing"))
(assert-false "revert-subject?: nil is not a revert" (task-scope-gate-lib/revert-subject? nil))

(assert-true "subject-names-task?: a subject naming the task is still the task's own commit"
             (task-scope-gate-lib/subject-names-task? "BL-1240: do the thing" "BL-1240"))
(assert-false "subject-names-task?: a revert quoting the task's subject is NOT the task's commit"
              (task-scope-gate-lib/subject-names-task? "Revert \"BL-1240: do the thing\"" "BL-1240"))
(assert-false "subject-names-task?: a revert quoting ANOTHER ticket is not this task's either"
              (task-scope-gate-lib/subject-names-task? "Revert \"BL-0999: something else\"" "BL-1240"))
(assert-false "subject-names-task?: another ticket's subject is not this task's commit"
              (task-scope-gate-lib/subject-names-task? "BL-0999: do the thing" "BL-1240"))
;; The two earlier hardenings this predicate already carries must survive.
(assert-false "subject-names-task?: a passing mention after the primary id does not claim the task (BL-1192 shape 2)"
              (task-scope-gate-lib/subject-names-task? "BL-1227: decouple unlanded BL-1240 gate wiring" "BL-1240"))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: task_scope_gate_lib.bb"))
