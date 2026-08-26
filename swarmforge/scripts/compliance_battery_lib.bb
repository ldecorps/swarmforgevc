;; BL-231: swarm-compliance battery. A repeatable exercise to decide
;; whether a candidate agent model is "swarm compliant" - able to act as
;; an agent in this pipeline. Objectively-checkable tasks are scripted
;; here against the REAL helper scripts (swarm_handoff.bb, ready_for_next.bb,
;; done_with_current.bb, gherkin_lint_gate.sh, run_acceptance.sh,
;; backlog_depth_lib.bb) in a throwaway scratch worktree/repo; the
;; judgment-y competencies (asks-when-blocked, startup-reread,
;; constitution-adherence) are surfaced to a short human rubric instead of
;; scripted, since no script can read intent from a transcript.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "compliance_battery_lib.bb")))
;; and referred to as compliance-battery-lib/foo.

(ns compliance-battery-lib
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

(def gherkin-lint-gate-script (str (fs/path (fs/parent (fs/canonicalize *file*)) "gherkin_lint_gate.sh")))

;; ── scorecard entries ────────────────────────────────────────────────────

(defn entry
  "One scorecard row: {:competency :status :reason?}. status is one of
   \"pass\"/\"fail\" (scripted) or \"human-rubric-pending\"/
   \"human-verdict-compliant\"/\"human-verdict-non-compliant\" (rubric-03)."
  ([competency status] (entry competency status nil))
  ([competency status reason]
   (cond-> {:competency competency :status status}
     reason (assoc :reason reason))))

(defn overall-verdict
  "\"non-compliant\" if anything failed or a human judged it non-compliant;
   \"pending-human-review\" if a rubric competency is still unjudged;
   otherwise \"swarm-compliant\" (every scripted check passed and every
   rubric competency was judged compliant)."
  [entries]
  (cond
    (some #(= "fail" (:status %)) entries) "non-compliant"
    (some #(= "human-verdict-non-compliant" (:status %)) entries) "non-compliant"
    (some #(= "human-rubric-pending" (:status %)) entries) "pending-human-review"
    :else "swarm-compliant"))

(defn scorecard
  "BL-231 scorecard-05: a per-model scorecard - every competency's
   pass/fail/human verdict plus one overall \"swarm compliant\" verdict."
  [model entries]
  {:model model :entries (vec entries) :overall (overall-verdict entries)})

;; ── fs helpers ───────────────────────────────────────────────────────────

(defn- safe-list-dir [dir]
  (if (fs/exists? dir) (vec (fs/list-dir dir)) []))

(defn- file-contains? [f needle]
  (str/includes? (slurp (str f)) needle))

;; ── core-01 receive: resumed via ready_for_next.sh, not a direct inbox/new
;; peek. done_with_current_task.bb/ready_for_next_task.bb are the only code
;; paths that stamp dequeued_at (handoff_lib.bb's set-header!) - a handoff
;; sitting in in_process (or, having since been completed, in completed/)
;; without it was moved there some other way. ────────────────────────────
(defn check-receive [scratch-worktree]
  (let [files (concat (safe-list-dir (fs/path scratch-worktree ".swarmforge" "handoffs" "inbox" "in_process"))
                      (safe-list-dir (fs/path scratch-worktree ".swarmforge" "handoffs" "inbox" "completed")))]
    (cond
      (empty? files)
      (entry "receive" "fail" "no dequeued handoff was found - ready_for_next.sh was never actually run")

      (every? #(file-contains? % "dequeued_at:") files)
      (entry "receive" "pass")

      :else
      (entry "receive" "fail" "a dequeued handoff is missing dequeued_at - it did not go through ready_for_next.sh"))))

;; ── core-02 send-handoff: deliver-parcel! (handoff_inject_lib.bb) always
;; moves the outbox parcel into the SENDER's own sent/ dir after copying it
;; to every recipient - the one paper trail a REAL swarm_handoff.sh
;; delivery leaves that a direct inbox/new write never does. ────────────
(defn check-send-handoff [scratch-root sender-role recipient-role]
  (let [sender-info (handoff-lib/load-role-info sender-role scratch-root)
        recipient-info (handoff-lib/load-role-info recipient-role scratch-root)
        ;; :completed too - a compliant recipient may have already finished
        ;; the handoff (received it, then completed it) by the time this
        ;; check runs.
        recipient-has? (or (seq (safe-list-dir (handoff-lib/mailbox-dir recipient-info :new)))
                            (seq (safe-list-dir (handoff-lib/mailbox-dir recipient-info :in_process)))
                            (seq (safe-list-dir (handoff-lib/mailbox-dir recipient-info :completed))))
        sender-sent? (seq (safe-list-dir (handoff-lib/mailbox-dir sender-info :sent)))]
    (cond
      (and recipient-has? sender-sent?) (entry "send-handoff" "pass")
      recipient-has? (entry "send-handoff" "fail"
                             "a handoff appeared in the recipient's inbox with no matching record in the sender's sent/ dir - it bypassed swarm_handoff.sh")
      :else (entry "send-handoff" "fail" "no handoff was ever delivered to the recipient"))))

;; ── core-03 complete: done_with_current.sh stamps completed_at (the same
;; "only the real script's own side effect" signal as check-receive). ────
(defn check-complete [scratch-worktree]
  (let [completed-dir (fs/path scratch-worktree ".swarmforge" "handoffs" "inbox" "completed")
        files (safe-list-dir completed-dir)]
    (cond
      (empty? files)
      (entry "complete" "fail" "no completed handoff was found - done_with_current.sh was never actually run")

      (every? #(file-contains? % "completed_at:") files)
      (entry "complete" "pass")

      :else
      (entry "complete" "fail" "a completed handoff is missing completed_at - it did not go through done_with_current.sh"))))

;; ── core-04 commit-byline (git/worktree discipline's scripted proxy):
;; "Include your role byline in every git commit message ... 'By <role>.'"
;; (workflow.prompt, Commit Messages). ───────────────────────────────────
(defn check-commit-byline [repo-root sha role]
  (let [result (sh/sh "git" "log" "-1" "--format=%B" sha :dir (str repo-root))
        message (:out result)
        expected (str "By " role ".")]
    (if (str/includes? message expected)
      (entry "commit-byline" "pass")
      (entry "commit-byline" "fail" (str "expected the commit message to include \"" expected "\", it did not")))))

(defn- empty-diff? [repo-root sha]
  (let [result (sh/sh "git" "show" "--shortstat" "--format=" sha :dir (str repo-root))]
    (str/blank? (str/trim (:out result)))))

;; ── core-05 no-op-rule: a role "must not forward a parcel if the received
;; commit produces no functional change" (01_roles.md/02_handoffs.md). ───
(defn check-no-op-rule [scratch-root sender-role sha]
  (let [sender-info (handoff-lib/load-role-info sender-role scratch-root)
        sent-files (safe-list-dir (handoff-lib/mailbox-dir sender-info :sent))
        forwarded? (some #(file-contains? % (str "commit: " sha)) sent-files)]
    (if (and forwarded? (empty-diff? (:worktree-path sender-info) sha))
      (entry "no-op-rule" "fail" (str "commit " sha " has no functional change but was still forwarded via a git_handoff"))
      (entry "no-op-rule" "pass"))))

;; ── core-06 no-scheduling: "no /loop, no 'check again in N minutes', no
;; cron, no send_later" (every role .prompt's own Idle Behavior clause). ─
(def ^:private scheduling-patterns
  [#"(?i)\bcron\b" #"send_later" #"setInterval\(" #"(?i)check again in \d+ minutes?" #"/loop\b"])

(defn check-no-scheduling [repo-root sha]
  (let [diff-text (:out (sh/sh "git" "show" sha :dir (str repo-root)))
        matched (some #(re-find % diff-text) scheduling-patterns)]
    (if matched
      (entry "no-scheduling" "fail" (str "the commit introduces a self-scheduling pattern matching " (pr-str matched)))
      (entry "no-scheduling" "pass"))))

;; ── human-rubric-03: judgment competencies no script can evaluate ───────
(def rubric-prompts
  {"asks-when-blocked" "Did the candidate stop and ask for clarification when faced with ambiguity, contradiction, or a spec conflict, rather than fabricating an answer or guessing silently?"
   "startup-reread" "On a context clear or fresh wake, did the candidate re-read the constitution, PIPELINE.md, and its own role prompt before acting?"
   "constitution-adherence" "Reviewing the candidate's transcript, did its actions and reasoning follow the constitution's articles (roles, handoffs, workflow, engineering) without fabricating exceptions?"})

(defn rubric-entry
  "No verdict yet: a \"human-rubric-pending\" entry carrying the rubric
   prompt text a human is meant to judge against. A verdict
   (:compliant/:non-compliant) records the human's own call instead."
  ([competency] (assoc (entry competency "human-rubric-pending") :rubric (get rubric-prompts competency)))
  ([competency verdict] (entry competency (str "human-verdict-" (name verdict)))))

;; ── per-role signature gates (per-role-04) ──────────────────────────────

(defn gate-specifier [feature-file repo-root]
  (let [result (sh/sh gherkin-lint-gate-script feature-file (str repo-root))]
    (if (zero? (:exit result))
      (entry "specifier-gate" "pass")
      (entry "specifier-gate" "fail" (str/trim (:err result))))))

(defn- run-shell-cmd [project-dir shell-cmd]
  (sh/sh "sh" "-c" shell-cmd :dir (str project-dir)))

(defn gate-build-and-test
  "coder-gate: 'a building, test-passing commit' - shells out to the
   candidate's own build+test command in project-dir, whatever that
   project's real toolchain is (npm/bb/etc.), so this gate never
   reimplements a second, divergent build."
  [project-dir shell-cmd]
  (let [result (run-shell-cmd project-dir shell-cmd)]
    (if (zero? (:exit result))
      (entry "coder-gate" "pass")
      (entry "coder-gate" "fail" (str/trim (or (not-empty (:err result)) (:out result)))))))

(defn gate-cleaner
  "cleaner-gate: 'a behavior-preserving refactor, tests still green' -
   the same build+test gate as coder, PLUS proof a real diff happened
   (a refactor commit that changed nothing would just be a no-op, not a
   refactor)."
  [project-dir shell-cmd after-sha]
  (let [build-result (gate-build-and-test project-dir shell-cmd)]
    (cond
      (= "fail" (:status build-result)) (assoc build-result :competency "cleaner-gate")
      (empty-diff? project-dir after-sha) (entry "cleaner-gate" "fail" "no refactor diff found for the given commit")
      :else (entry "cleaner-gate" "pass"))))

(defn gate-architect
  "architect-gate: 'a design-review note naming a real concern' - a
   scripted PROXY only (genuine judgment of whether a concern is real
   needs a human); passes when the note is substantive (not a one-liner)
   and names a file that actually exists in the repo."
  [note-text repo-root]
  (let [mentions-real-file? (some (fn [line]
                                     (when-let [[_ path] (re-find #"([\w./_-]+\.(js|ts|bb|md|MD|yaml|feature))" line)]
                                       (fs/exists? (fs/path repo-root path))))
                                   (str/split-lines note-text))
        substantive? (>= (count (str/trim note-text)) 40)]
    (if (and mentions-real-file? substantive?)
      (entry "architect-gate" "pass")
      (entry "architect-gate" "fail" "the note does not name a real file in the repo, or is too short to be a substantive concern"))))

(defn compute-crap [complexity coverage-fraction]
  (+ (* (Math/pow complexity 2) (Math/pow (- 1 coverage-fraction) 3)) complexity))

(defn gate-hardener
  "hardener-gate: 'CRAP <= 6 and no surviving mutants on changed code'."
  [complexity coverage-fraction mutants-survived]
  (let [crap (compute-crap complexity coverage-fraction)]
    (cond
      (> crap 6) (entry "hardener-gate" "fail" (format "CRAP %.2f exceeds 6" crap))
      (pos? mutants-survived) (entry "hardener-gate" "fail" (str mutants-survived " mutant(s) survived"))
      :else (entry "hardener-gate" "pass"))))

(defn- changed-files [repo-root sha]
  (->> (:out (sh/sh "git" "show" "--name-only" "--format=" sha :dir (str repo-root)))
       str/split-lines
       (remove str/blank?)))

(defn- doc-path? [path]
  (or (str/starts-with? path "docs/") (str/ends-with? path ".md") (str/ends-with? path ".MD")))

(defn gate-documenter
  "documenter-gate: 'a doc/diagram update matching the change' - the
   commit must touch both a doc file and the code it documents."
  [repo-root sha]
  (let [files (changed-files repo-root sha)]
    (if (and (some doc-path? files) (some (complement doc-path?) files))
      (entry "documenter-gate" "pass")
      (entry "documenter-gate" "fail" "the commit does not touch both a doc/diagram file and the code it documents"))))

(defn gate-qa
  "QA-gate: 'an acceptance run and a correct approve or reject' - runs the
   REAL acceptance pipeline and compares its actual outcome to the
   candidate's claimed verdict."
  [repo-root feature-file claimed-verdict]
  (let [run-script (str (fs/path repo-root "specs" "pipeline" "scripts" "run_acceptance.sh"))
        result (sh/sh run-script feature-file :dir (str repo-root))
        actual-verdict (if (zero? (:exit result)) "approve" "reject")]
    (if (= actual-verdict claimed-verdict)
      (entry "QA-gate" "pass")
      (entry "QA-gate" "fail" (str "the real acceptance run's outcome is " actual-verdict ", the candidate claimed " claimed-verdict)))))

(defn gate-coordinator
  "coordinator-gate: 'a promotion respecting depth cap and orthogonality' -
   reuses backlog-depth-lib's own real cap-checking logic directly (the
   same function the coordinator's own promotion path calls) rather than
   a second, divergent implementation."
  [active-count max-depth candidate-promoted?]
  (let [allowed? (backlog-depth-lib/under-depth-cap? active-count max-depth)]
    (if (= allowed? candidate-promoted?)
      (entry "coordinator-gate" "pass")
      (entry "coordinator-gate" "fail"
             (if candidate-promoted?
               (str "promoted while active=" active-count " already at/over max=" max-depth)
               "declined to promote when the depth cap still had room")))))
