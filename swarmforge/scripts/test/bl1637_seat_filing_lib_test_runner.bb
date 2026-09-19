#!/usr/bin/env bb
;; TDD runner for BL-1637 (forward_evidence_lib.bb's seat-aware additions).
;; seat-owned-file? is tested purely with real temp handoff files (its own
;; header reads are IO, but no roles.tsv/env fixture is needed). The
;; env-dependent functions (sent-dirs-for-seat, sent-handoff-names-ticket-
;; since?) read SWARMFORGE_ROLE via System/getenv, which cannot be
;; overridden in-process - each of those is driven via a real bb SUBPROCESS
;; with :extra-env, the same pattern
;; bl1360_ceremony_handoff_property_runner.bb already uses for role-scoped
;; bb behavior. The full done_with_current_task.bb integration (the four
;; outline rows, end to end) is BL-1637's own acceptance feature's job, not
;; this runner's - this runner covers the library the gate calls, at the
;; library's own level.
(ns bl1637-seat-filing-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path script-dir "forward_evidence_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg v]
  (assert= msg true (boolean v)))

;; ── seat-owned-file? (pure-ish: real temp files, no roles.tsv/env) ───────

(defn mk-handoff-file! [dir name headers]
  (fs/create-dirs dir)
  (let [path (fs/path dir name)
        lines (map (fn [[k v]] (str k ": " v)) headers)]
    (spit (str path) (str (str/join "\n" lines) "\n\nbody\n"))
    (str path)))

(let [tmp (fs/create-temp-dir {:prefix "bl1637-owned-"})]
  (let [no-seat-header (mk-handoff-file! tmp "a.handoff" {"from" "coder" "to" "cleaner" "priority" "50" "type" "git_handoff"})
        matching (mk-handoff-file! tmp "b.handoff" {"from" "coder" "from_seat" "coder@2" "to" "cleaner" "priority" "50" "type" "git_handoff"})
        mismatched (mk-handoff-file! tmp "c.handoff" {"from" "coder" "from_seat" "coder@3" "to" "cleaner" "priority" "50" "type" "git_handoff"})]
    (assert-true "a file with no from_seat header counts (pre-fix history)"
                 (#'forward-evidence-lib/seat-owned-file? "coder@2" no-seat-header))
    (assert-true "a file whose from_seat matches this seat counts"
                 (#'forward-evidence-lib/seat-owned-file? "coder@2" matching))
    (assert= "a file whose from_seat names a DIFFERENT seat does not count"
             false
             (boolean (#'forward-evidence-lib/seat-owned-file? "coder@2" mismatched)))
    (fs/delete-tree tmp)))

;; ── sent-dirs-for-seat, via a real bb subprocess (env/roles.tsv IO) ──────

(defn mailbox-dirs! [wt]
  (doseq [state ["outbox" "sent"]]
    (fs/create-dirs (fs/path wt ".swarmforge" "handoffs" state))))

(defn build-seat-fixture! []
  (let [root (fs/create-temp-dir {:prefix "bl1637-seatdirs-"})
        coder-wt (fs/path root "coder")
        coder2-wt (fs/path root "coder2")
        architect-wt (fs/path root "architect")]
    (fs/create-dirs (fs/path root ".swarmforge"))
    (doseq [wt [coder-wt coder2-wt architect-wt]]
      (fs/create-dirs (fs/path wt ".swarmforge"))
      (mailbox-dirs! wt))
    (let [roles-line (str "coder\tcoder\t" coder-wt "\tswarmforge-coder\tCoder\tclaude\ttask\n"
                          "coder@2\tcoder2\t" coder2-wt "\tswarmforge-coder2\tCoder@2\tclaude\ttask\n"
                          "architect\tarchitect\t" architect-wt "\tswarmforge-architect\tArchitect\tclaude\ttask\n")]
      (doseq [wt [root coder-wt coder2-wt architect-wt]]
        (spit (str (fs/path wt ".swarmforge" "roles.tsv")) roles-line)))
    {:root root :coder-wt coder-wt :coder2-wt coder2-wt :architect-wt architect-wt}))

(defn run-seat-dirs-subprocess [role wt]
  (let [program (str "(load-file \"" script-dir "/forward_evidence_lib.bb\")"
                     "(println (clojure.string/join \"|\" (map str (forward-evidence-lib/sent-dirs-for-seat))))")
        result (process/sh {:dir (str wt) :extra-env {"SWARMFORGE_ROLE" role}} "bb" "-e" program)]
    (when-not (zero? (:exit result))
      (throw (ex-info "subprocess failed" {:err (:err result) :out (:out result)})))
    (str/split (str/trim (:out result)) #"\|")))

(let [{:keys [root coder2-wt architect-wt]} (build-seat-fixture!)]
  (try
    (let [seat-dirs (run-seat-dirs-subprocess "coder@2" coder2-wt)]
      (assert= "coder@2 scans exactly 4 dirs (its own sent+outbox, plus its stage's sent+outbox)"
               4
               (count seat-dirs))
      (assert-true "coder@2's own sent dir is among the 4"
                   (some #(str/ends-with? % "coder2/.swarmforge/handoffs/sent") seat-dirs))
      (assert-true "the coder STAGE's sent dir is among the 4"
                   (some #(and (str/ends-with? % "/coder/.swarmforge/handoffs/sent")
                               (not (str/includes? % "coder2")))
                         seat-dirs)))
    (let [bare-dirs (run-seat-dirs-subprocess "architect" architect-wt)]
      (assert= "a bare seat (architect, no '@' row) scans exactly its own 2 dirs"
               2
               (count bare-dirs)))
    (finally
      (fs/delete-tree root))))

;; ── sent-handoff-names-ticket-since? seat-ownership filtering (integration,
;;    via a real bb subprocess) ────────────────────────────────────────────
;;
;; The two subprocess suites above cover sent-dirs-for-seat's directory set
;; and seat-owned-file?'s own pure predicate separately, but neither drives
;; them TOGETHER through sent-handoff-names-ticket-since? - the public
;; function forward-completion-decision's caller (and BL-1637's own
;; declared invariant) actually calls. Confirmed by hand-mutation before
;; writing this: removing the `(filter (partial seat-owned-file? me) ...)`
;; call from sent-handoff-names-ticket-since? left both the bb runner above
;; and the BL-1637 property test (extension/test/
;; bl1637SeatForwardEvidenceInvariant.property.test.js, which never stamps
;; from_seat on its fixture files) green - the composition was untested.
;; These two cases isolate the filter the way "Overlapping self-exclusion
;; guards each need an ISOLATING test" (hardender.prompt) requires: one
;; fixture where the filter is the only thing that could exclude the
;; match (a DIFFERENT seat's forward in the stage's shared dir), one where
;; it is the only thing that could admit it (this seat's own, stamped,
;; forward in that same shared dir).

(defn build-three-seat-fixture! []
  (let [root (fs/create-temp-dir {:prefix "bl1637-evidence-"})
        coder-wt (fs/path root "coder")
        coder2-wt (fs/path root "coder2")
        coder3-wt (fs/path root "coder3")]
    (fs/create-dirs (fs/path root ".swarmforge"))
    (doseq [wt [coder-wt coder2-wt coder3-wt]]
      (fs/create-dirs (fs/path wt ".swarmforge"))
      (mailbox-dirs! wt))
    (let [roles-line (str "coder\tcoder\t" coder-wt "\tswarmforge-coder\tCoder\tclaude\ttask\n"
                          "coder@2\tcoder2\t" coder2-wt "\tswarmforge-coder2\tCoder@2\tclaude\ttask\n"
                          "coder@3\tcoder3\t" coder3-wt "\tswarmforge-coder3\tCoder@3\tclaude\ttask\n")]
      (doseq [wt [root coder-wt coder2-wt coder3-wt]]
        (spit (str (fs/path wt ".swarmforge" "roles.tsv")) roles-line)))
    {:root root :coder-wt coder-wt :coder2-wt coder2-wt :coder3-wt coder3-wt}))

(defn run-evidence-subprocess [role wt ticket since-iso]
  (let [program (str "(load-file \"" script-dir "/forward_evidence_lib.bb\")"
                     "(println (boolean (forward-evidence-lib/sent-handoff-names-ticket-since? \"" ticket "\" \"" since-iso "\")))")
        result (process/sh {:dir (str wt) :extra-env {"SWARMFORGE_ROLE" role}} "bb" "-e" program)]
    (when-not (zero? (:exit result))
      (throw (ex-info "subprocess failed" {:err (:err result) :out (:out result)})))
    (= "true" (str/trim (:out result)))))

(let [{:keys [root coder-wt coder2-wt]} (build-three-seat-fixture!)
      ticket "BL-9191"
      since-iso "2020-01-01T00:00:00.000000000Z"
      after-since "2030-01-01T00:00:00.000000000Z"]
  (try
    ;; A matching ticket, timed after since-iso, sitting in the STAGE's
    ;; shared sent dir but stamped for a DIFFERENT seat (coder@3, never
    ;; coder@2) - the dir-membership check alone would count it (it is a
    ;; genuine stage-dir hit); only seat-owned-file? excludes it.
    (mk-handoff-file! (fs/path coder-wt ".swarmforge" "handoffs" "sent") "mismatched.handoff"
                       {"from" "coder" "from_seat" "coder@3" "to" "cleaner" "priority" "50"
                        "type" "git_handoff" "task" (str ticket "-some-slug") "commit" "9999999999"
                        "created_at" after-since})
    (assert= "a matching-ticket forward in the stage's shared dir, stamped for a DIFFERENT seat, is NOT evidence for this seat"
             false
             (run-evidence-subprocess "coder@2" coder2-wt ticket since-iso))
    (fs/delete-tree (fs/path coder-wt ".swarmforge" "handoffs" "sent" "mismatched.handoff"))
    ;; Same shape, this seat's own from_seat this time - seat-owned-file?
    ;; must not also exclude a genuine match; the composition should admit
    ;; it exactly as it would with no from_seat header at all (pre-fix
    ;; history, already covered above).
    (mk-handoff-file! (fs/path coder-wt ".swarmforge" "handoffs" "sent") "matching.handoff"
                       {"from" "coder" "from_seat" "coder@2" "to" "cleaner" "priority" "50"
                        "type" "git_handoff" "task" (str ticket "-some-slug") "commit" "9999999999"
                        "created_at" after-since})
    (assert= "a matching-ticket forward in the stage's shared dir, stamped for THIS seat, IS evidence for this seat"
             true
             (run-evidence-subprocess "coder@2" coder2-wt ticket since-iso))
    (finally
      (fs/delete-tree root))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: bl1637_seat_filing_lib"))
