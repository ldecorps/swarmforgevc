#!/usr/bin/env bb
;; TDD runner for expedite_lib.bb (BL-567) — no swarm, no tmux, no mailboxes,
;; no real clock (every now-ms is explicit). Mirrors
;; push_sweep_lib_test_runner.bb's assert-battery shape.
;;
;; The cases that matter most are the ones a careless implementation passes by
;; accident: 10 (a stale socket FILE is not liveness), 14 (a teardown whose exit
;; code lied), 16 (a failed restart must not retract a done ticket), and the
;; bound of 3 with its spec-defect reading.

(ns expedite-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── argument parsing ──────────────────────────────────────────────────────
;; Moved here from the CLI by the cleaner pass. The latent defect these cover:
;; a value-taking flag whose value gets read as a positional.

(assert= "args: root and ticket are the two positionals"
         {:project-root "/repo" :ticket "BL-567"}
         (select-keys (expedite-lib/parse-args ["/repo" "BL-567"]) [:project-root :ticket]))
(assert= "args: a value-taking flag's VALUE is never a positional"
         {:project-root "/repo" :ticket "BL-567"}
         (select-keys (expedite-lib/parse-args ["--bounce-bound" "5" "/repo" "BL-567"])
                      [:project-root :ticket]))
(assert= "args: and its value is read"
         5 (:bounce-bound (expedite-lib/parse-args ["/repo" "BL-567" "--bounce-bound" "5"])))
(assert= "args: two value-taking flags interleaved with positionals"
         {:project-root "/repo" :ticket "BL-567" :bounce-bound 4 :stage-timeout-ms 900}
         (select-keys (expedite-lib/parse-args
                       ["--stage-timeout-ms" "900" "/repo" "--bounce-bound" "4" "BL-567"])
                      [:project-root :ticket :bounce-bound :stage-timeout-ms]))
(assert= "args: boolean flags are never positionals"
         {:project-root "/repo" :ticket "BL-567"}
         (select-keys (expedite-lib/parse-args ["--dry-run" "/repo" "--override" "BL-567" "--no-restart"])
                      [:project-root :ticket]))
(assert-true "args: --override is read" (:override? (expedite-lib/parse-args ["/r" "BL-1" "--override"])))
(assert-true "args: --no-restart is read" (:no-restart? (expedite-lib/parse-args ["/r" "BL-1" "--no-restart"])))
(assert-true "args: --dry-run is read" (:dry-run? (expedite-lib/parse-args ["/r" "BL-1" "--dry-run"])))
(assert-false "args: absent booleans are false" (:override? (expedite-lib/parse-args ["/r" "BL-1"])))
;; Asserted on flag-value DIRECTLY, not on :bounce-bound. The mutation sweep
;; caught the earlier version as vacuous: it asserted :bounce-bound was nil, but
;; the nil came from `parse-long "--dry-run"`, not from the guard. Deleting the
;; guard changed nothing observable, so the test could not fail.
(assert= "args: flag-value refuses a following FLAG as a value (the guard itself)"
         nil (expedite-lib/flag-value ["/r" "BL-1" "--bounce-bound" "--dry-run"] "--bounce-bound"))
(assert= "args: flag-value returns a real value when there is one"
         "7" (expedite-lib/flag-value ["/r" "BL-1" "--bounce-bound" "7"] "--bounce-bound"))
(assert= "args: and the parsed bound is nil in the missing-value case"
         nil (:bounce-bound (expedite-lib/parse-args ["/r" "BL-1" "--bounce-bound" "--dry-run"])))
(assert-true "args: and that next flag is still honoured"
             (:dry-run? (expedite-lib/parse-args ["/r" "BL-1" "--bounce-bound" "--dry-run"])))
(assert= "args: a non-numeric value parses to nil rather than throwing"
         nil (:bounce-bound (expedite-lib/parse-args ["/r" "BL-1" "--bounce-bound" "abc"])))
(assert= "args: no argv at all yields nil positionals, never an exception"
         {:project-root nil :ticket nil}
         (select-keys (expedite-lib/parse-args []) [:project-root :ticket]))
(assert= "args: value-flags is the single source of truth for both the strip and the reads"
         #{"--bounce-bound" "--stage-timeout-ms"} expedite-lib/value-flags)

;; ── stage verdict vocabulary ──────────────────────────────────────────────
;; Added by QA after a REAL run: a real documenter session returned `forward` —
;; its documented no-op outcome — and the driver, which knew only pass/bounce,
;; failed the whole run on a legitimate verdict. Invisible to 53 CLI assertions
;; and 21/21 acceptance because the fixture runner only ever emitted pass/bounce:
;; the seam encoded the driver author's assumption, not the roles' vocabulary.

(assert= "verdict: pass advances" :advance (expedite-lib/classify-verdict "pass"))
(assert= "verdict: forward advances - the documenter's real no-op outcome"
         :advance (expedite-lib/classify-verdict "forward"))
(assert= "verdict: approved advances" :advance (expedite-lib/classify-verdict "approved"))
(assert= "verdict: bounce bounces" :bounce (expedite-lib/classify-verdict "bounce"))
(assert= "verdict: send-back bounces" :bounce (expedite-lib/classify-verdict "send-back"))
(assert= "verdict: case is normalised" :advance (expedite-lib/classify-verdict "FORWARD"))
(assert= "verdict: a keyword is accepted as well as a string"
         :advance (expedite-lib/classify-verdict :pass))
;; Fails CLOSED. An unrecognised verdict must stop the run loudly, never be guessed
;; into :advance - guessing would silently skip a gate.
(assert= "verdict: an unknown verdict FAILS rather than being guessed as advance"
         :fail (expedite-lib/classify-verdict "probably-fine"))
(assert= "verdict: nil fails" :fail (expedite-lib/classify-verdict nil))
(assert= "verdict: empty string fails" :fail (expedite-lib/classify-verdict ""))

;; ── stage chain ───────────────────────────────────────────────────────────

(assert= "stages: absent roles manifest -> full standard chain"
         expedite-lib/default-stages (expedite-lib/stages-for {}))
(assert= "stages: a roles manifest narrows the chain"
         ["coder" "cleaner" "QA"] (expedite-lib/stages-for {:roles ["cleaner"]}))
(assert= "stages: coder and QA survive a manifest that omits them (BL-317)"
         ["coder" "architect" "QA"] (expedite-lib/stages-for {:roles ["architect"]}))
(assert= "next-stage: mid-chain" "cleaner" (expedite-lib/next-stage expedite-lib/default-stages "coder"))
(assert= "next-stage: last stage has no successor" nil
         (expedite-lib/next-stage expedite-lib/default-stages "QA"))
(assert= "next-stage: unknown stage is nil, never a wrap-around" nil
         (expedite-lib/next-stage expedite-lib/default-stages "nope"))

;; ── liveness (09/10/14) ───────────────────────────────────────────────────

(assert= "liveness: nothing alive -> stopped"
         {:stopped? true :alive []}
         (expedite-lib/liveness-verdict {:tmux-servers-answering 0 :role-agents 0}))

;; Scenario 10, the measured false positive. This is the case the ticket's own
;; interlock got wrong: kill_all_swarm.sh leaves the socket FILE behind, so a
;; glob-based check would refuse on a perfectly clean slate.
(assert-true "10: a socket FILE with no server answering reads as stopped"
             (:stopped? (expedite-lib/liveness-verdict
                         {:tmux-servers-answering 0 :role-agents 0 :socket-files 1})))
(assert-true "10: and it does not need the override to proceed"
             (and (:start? (expedite-lib/start-decision
                            {:tmux-servers-answering 0 :role-agents 0 :socket-files 1} {}))
                  (not (:override-used? (expedite-lib/start-decision
                                         {:tmux-servers-answering 0 :role-agents 0 :socket-files 1} {})))))

(assert= "09: a server that answers is live and is named"
         {:stopped? false :alive ["tmux-server"]}
         (expedite-lib/liveness-verdict {:tmux-servers-answering 1 :role-agents 0}))
(assert= "09: handoffd alone is enough to be live"
         ["handoffd"] (:alive (expedite-lib/liveness-verdict {:handoffd true})))

;; BL-637: the two survivors of a "clean slate" teardown. The ticket's interlock
;; named only handoffd, so these had to be added to liveness.
(assert= "liveness: babysitterd alone is live (it nudges agents)"
         ["babysitterd"] (:alive (expedite-lib/liveness-verdict {:babysitterd true})))
(assert= "liveness: the Operator alone is live (it recovers a swarm it finds down)"
         ["operator"] (:alive (expedite-lib/liveness-verdict {:operator true})))
(assert= "liveness: role agents alone are live"
         ["role-agents"] (:alive (expedite-lib/liveness-verdict {:role-agents 2})))

(assert= "09: refuses a live swarm and names what is alive"
         {:start? false :reason :swarm-live :override-used? false :alive ["tmux-server" "handoffd"]}
         (expedite-lib/start-decision {:tmux-servers-answering 1 :handoffd true} {}))
(assert= "11: the override proceeds but is always reported"
         {:start? true :reason :override :override-used? true :alive ["tmux-server"]}
         (expedite-lib/start-decision {:tmux-servers-answering 1} {:override? true}))

;; Fails CLOSED: an empty probe is not evidence of a stopped swarm, but neither
;; may it invent survivors. Nothing observed alive -> stopped is correct here;
;; the CLI's job is to always populate the probe.
(assert-true "liveness: an all-zero probe is stopped (the CLI must always probe)"
             (:stopped? (expedite-lib/liveness-verdict {})))

;; Scenario 14 — the exit code lied.
(assert= "14: teardown exit 0 with survivors is NOT clean, and the lie is flagged"
         {:clean? false :alive ["babysitterd" "operator"] :exit-code-lied? true}
         (expedite-lib/teardown-verdict {:exit-code 0} {:babysitterd true :operator true}))
(assert= "14: a genuinely clean teardown is clean and nothing is flagged"
         {:clean? true :alive [] :exit-code-lied? false}
         (expedite-lib/teardown-verdict {:exit-code 0} {}))
(assert-false "14: a non-zero teardown with survivors is not a LIE, just a failure"
              (:exit-code-lied? (expedite-lib/teardown-verdict {:exit-code 1} {:babysitterd true})))

;; ── park (12/13) ──────────────────────────────────────────────────────────

(assert= "12: parks every other active ticket to hold/, never paused/"
         {:park ["BL-590"] :destination "hold" :nothing-to-park? false}
         (expedite-lib/park-plan {:active-tickets ["BL-590" "BL-567"] :run-ticket "BL-567"}))
(assert= "12: the run's own ticket is never parked"
         [] (:park (expedite-lib/park-plan {:active-tickets ["BL-567"] :run-ticket "BL-567"})))
(assert= "12: the destination is hold/ and nothing else" "hold" expedite-lib/park-dir)
(assert-true "12: an empty active/ is a no-op, not an error"
             (:nothing-to-park? (expedite-lib/park-plan {:active-tickets [] :run-ticket "BL-567"})))

(assert-true "13: a bare stop invocation is safe"
             (expedite-lib/stop-invocation-ok? ["./stop-swarm.sh"]))
(assert-false "13: --sweep-inbox would archive the parcels a parked ticket needs"
              (expedite-lib/stop-invocation-ok? ["./stop-swarm.sh" "--sweep-inbox"]))
(assert-false "13: --reset-worktrees would revert role worktrees"
              (expedite-lib/stop-invocation-ok? ["./stop-swarm.sh" "--reset-worktrees"]))
(assert-false "13: --full is both and is equally forbidden"
              (expedite-lib/stop-invocation-ok? ["./stop-swarm.sh" "--full"]))

;; ── bounces (05/05b/05c) ──────────────────────────────────────────────────

(assert= "05c: the default bound is 3, per the operator ruling" 3 expedite-lib/default-bounce-bound)
(assert= "05c: no request -> default, not raised, not explicit"
         {:bound 3 :default 3 :raised? false :explicit? false} (expedite-lib/bound-in-force nil))
(assert= "05c: a raise is flagged raised AND explicit so it can never be silent"
         {:bound 8 :default 3 :raised? true :explicit? true} (expedite-lib/bound-in-force 8))
(assert= "05c: an explicit LOWER bound is explicit but not a raise"
         {:bound 1 :default 3 :raised? false :explicit? true} (expedite-lib/bound-in-force 1))

(assert= "05: first failure retries as round 1"
         {:action :retry :stage "architect" :round 1 :bound 3}
         (expedite-lib/bounce-decision {:stage "architect" :bounces []}))
(assert= "05: two prior bounces still retry as round 3"
         {:action :retry :stage "architect" :round 3 :bound 3}
         (expedite-lib/bounce-decision {:stage "architect" :bounces [{} {}]}))
(assert= "05: the third bounce exhausts — BL-590 would have stopped here"
         {:action :exhausted :stage "architect" :rounds 3 :bound 3}
         (expedite-lib/bounce-decision {:stage "architect" :bounces [{} {} {}]}))
(assert= "05: an explicitly raised bound is honoured"
         :retry (:action (expedite-lib/bounce-decision {:stage "architect" :bounces [{} {} {}] :bound 5})))

(assert= "repeated-class: the class seen more than once"
         "identity" (expedite-lib/repeated-class [{:class "identity"} {:class "other"} {:class "identity"}]))
(assert= "repeated-class: three distinct classes repeat nothing"
         nil (expedite-lib/repeated-class [{:class "a"} {:class "b"} {:class "c"}]))
(assert= "repeated-class: classless bounces repeat nothing"
         nil (expedite-lib/repeated-class [{} {} {}]))
;; Added after the mutation sweep: nothing pinned WHICH repeated class is named
;; when two classes both repeat, so flipping the sort to pick the RAREST survived.
;; Naming the less frequent class would point the specifier at the wrong concern.
(assert= "repeated-class: names the MOST frequent repeat, not merely a repeat"
         "b" (expedite-lib/repeated-class
              [{:class "a"} {:class "a"} {:class "b"} {:class "b"} {:class "b"}]))
(assert= "repeated-class: order of appearance does not override frequency"
         "b" (expedite-lib/repeated-class
              [{:class "b"} {:class "a"} {:class "b"} {:class "a"} {:class "b"}]))

;; Scenario 05b. Three rounds on one concern is BL-633's signature, so this is a
;; SPEC defect routed to the specifier — and explicitly NOT the coder's fault.
(let [r (expedite-lib/exhaustion-report
         {:stage "architect"
          :bounces [{:class "resume-identity"} {:class "resume-identity"} {:class "resume-identity"}]})]
  (assert= "05b: a repeated class is a probable SPEC defect" :probable-spec-defect (:verdict r))
  (assert= "05b: it names the repeated class" "resume-identity" (:repeated-class r))
  (assert= "05b: it routes to the specifier" "specifier" (:route-to r))
  (assert= "05b: it does NOT blame a stage" nil (:blame-stage r))
  (assert= "05b: it names the gate" "architect" (:gate r)))

;; Honest refinement: three unrelated defects are not evidence of a mis-specified
;; ticket, so this must not claim one.
(let [r (expedite-lib/exhaustion-report
         {:stage "QA" :bounces [{:class "unit"} {:class "acceptance"} {:class "integration"}]})]
  (assert= "05b: three unrelated classes are diffuse, not a spec defect" :diffuse-failure (:verdict r))
  (assert= "05b: and nothing is routed on that weaker evidence" nil (:route-to r))
  (assert= "05b: and still nothing is blamed on a stage" nil (:blame-stage r)))

;; ── machinery independence (02/03) ────────────────────────────────────────

(assert-true "02: a mailbox path is forbidden"
             (expedite-lib/forbidden-path? "/repo/.swarmforge/handoffs/coder/inbox/new/x.handoff"))
(assert-false "02: a prompts path is DATA and allowed"
              (expedite-lib/forbidden-path? "/repo/.swarmforge/prompts/coder.md"))
(assert-false "02: a launch settings path is DATA and allowed"
              (expedite-lib/forbidden-path? "/repo/.swarmforge/launch/coder.claude-settings.json"))
(assert-false "02: backlog and specs are DATA and allowed"
              (or (expedite-lib/forbidden-path? "backlog/active/BL-567.yaml")
                  (expedite-lib/forbidden-path? "specs/features/x.feature")))

(assert-true "03: tmux is forbidden" (expedite-lib/forbidden-command? ["tmux" "list-sessions"]))
(assert-true "03: an absolute path to tmux does not slip past"
             (expedite-lib/forbidden-command? ["/usr/bin/tmux" "kill-server"]))
(assert-true "03: a forbidden tool as a later argument is still caught"
             (expedite-lib/forbidden-command? ["bash" "-c" "rotate_to_role.sh"]))
(assert-true "03: handoffd is forbidden" (expedite-lib/forbidden-command? ["bb" "handoffd.bb"]))
(assert-false "03: git is allowed" (expedite-lib/forbidden-command? ["git" "status"]))
(assert-false "03: the claude CLI is allowed" (expedite-lib/forbidden-command? ["claude" "-p" "go"]))

(assert= "02: a clean instrumentation record yields no findings"
         [] (expedite-lib/machinery-findings
             [{:kind :open :target "backlog/active/BL-567.yaml"}
              {:kind :exec :target ["git" "commit"]}]))
(assert= "02: a mailbox open is reported as a breach"
         1 (count (expedite-lib/machinery-findings
                   [{:kind :open :target ".swarmforge/handoffs/x"}])))
(assert= "02: a tmux exec is reported as a breach"
         1 (count (expedite-lib/machinery-findings [{:kind :exec :target ["tmux" "new"]}])))
(assert= "02: an unknown event kind is not silently treated as a breach"
         [] (expedite-lib/machinery-findings [{:kind :chdir :target "/tmp"}]))

;; ── restart (16/17/18) ────────────────────────────────────────────────────

;; Scenario 16 — the whole point of the asymmetry.
(let [r (expedite-lib/run-result {:ticket :done :restart :failed})]
  (assert= "16: a failed restart does NOT retract the done ticket" :done (:ticket r))
  (assert-true "16: the ticket half is still reported OK" (:ticket-ok? r))
  (assert-false "16: the restart half is reported failed" (:restart-ok? r))
  (assert= "16: the failing half is named so nobody confuses the two" :restart (:failed-half r))
  (assert= "16: overall exit is non-zero on the restart alone" 1 (:exit-code r)))

(let [r (expedite-lib/run-result {:ticket :done :restart :ok})]
  (assert= "16: both halves fine -> exit 0" 0 (:exit-code r))
  (assert= "16: and no half is named as failing" nil (:failed-half r)))

(let [r (expedite-lib/run-result {:ticket :failed :restart :ok})]
  (assert= "16: a failed TICKET is named as the ticket half" :ticket (:failed-half r))
  (assert= "16: and exits non-zero" 1 (:exit-code r)))

(assert= "16: a restart not attempted is reported as such, not as success"
         :not-attempted (:restart (expedite-lib/run-result {:ticket :done})))

(assert= "17: a matching live set yields an EMPTY delta, never a health claim"
         {} (expedite-lib/live-set-delta
             {:tmux-servers 1 :handoffd 1 :handoffd-supervisor 1 :role-agents 8}))
(assert= "17: a short live set reports only what differs"
         {:role-agents {:expected 8 :observed 3}}
         (expedite-lib/live-set-delta
          {:tmux-servers 1 :handoffd 1 :handoffd-supervisor 1 :role-agents 3}))
(assert= "17: a missing key counts as observed zero rather than being skipped"
         {:expected 1 :observed 0}
         (:handoffd (expedite-lib/live-set-delta {:tmux-servers 1 :handoffd-supervisor 1 :role-agents 8})))

(let [r (expedite-lib/parked-report [{:ticket "BL-590" :holding "coder rework 01562217be"}])]
  (assert= "18: the parked ticket is named" ["BL-590"] (:still-held r))
  (assert= "18: and nothing was promoted" [] (:promoted r)))

;; ── stage timeout (15) ────────────────────────────────────────────────────

(assert= "15: inside budget is not an overrun"
         {:overrun? false :elapsed-ms 1000 :timeout-ms 5000}
         (expedite-lib/stage-timeout-verdict {:started-at-ms 0 :now-ms 1000 :timeout-ms 5000}))
(assert-true "15: exactly at the budget IS an overrun (>= not >)"
             (:overrun? (expedite-lib/stage-timeout-verdict {:started-at-ms 0 :now-ms 5000 :timeout-ms 5000})))
(assert-true "15: past the budget is an overrun"
             (:overrun? (expedite-lib/stage-timeout-verdict {:started-at-ms 0 :now-ms 9999 :timeout-ms 5000})))
(assert= "15: the default budget applies when none is given"
         expedite-lib/default-stage-timeout-ms
         (:timeout-ms (expedite-lib/stage-timeout-verdict {:started-at-ms 0 :now-ms 1})))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (println (str "expedite_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
