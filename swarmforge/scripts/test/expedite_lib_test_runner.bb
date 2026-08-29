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
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-nil [msg actual] (assert= msg nil actual))
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

;; ── BL-1023: bookkeep-plan ────────────────────────────────────────────────
(assert= "BL-1023: already active is ready"
         :ready (:action (expedite-lib/bookkeep-plan {:folder "active" :ticket "BL-1023"})))
(assert= "BL-1023: paused adopts into active"
         {:action :adopt :ticket "BL-1023" :folder "paused" :from "paused" :to "active"
          :message "ADOPT run ticket BL-1023 from backlog/paused/ into backlog/active/ so teardown can close it"}
         (expedite-lib/bookkeep-plan {:folder "paused" :ticket "BL-1023"}))
(assert= "BL-1023: hold adopts into active"
         :adopt (:action (expedite-lib/bookkeep-plan {:folder "hold" :ticket "BL-1023"})))
(assert= "BL-1023: missing refuses"
         :refuse (:action (expedite-lib/bookkeep-plan {:folder nil :ticket "BL-1023"})))
(assert-true "BL-1023: refuse message names the ticket"
             (str/includes? (:message (expedite-lib/bookkeep-plan {:folder nil :ticket "BL-1023"}))
                            "BL-1023"))
(assert-true "BL-1023: bookkeep-move-ok? requires :ok? true"
             (expedite-lib/bookkeep-move-ok? {:ok? true}))
(assert-false "BL-1023: nil move result is not ok"
              (expedite-lib/bookkeep-move-ok? nil))
(assert-false "BL-1023: :ok? false is not ok"
              (expedite-lib/bookkeep-move-ok? {:ok? false}))
(assert-false "BL-1023: truthy non-true :ok? is not ok (silent no-op shape)"
              (expedite-lib/bookkeep-move-ok? {:ok? 1}))
(assert-false "BL-1023: string :ok? is not ok"
              (expedite-lib/bookkeep-move-ok? {:ok? "yes"}))


;; BL-1030. These four assertions used to pass PRE-SPLIT vectors - a shape the
;; only call site cannot produce. It wrapped the whole configured command in a
;; one-element vector, so the single element ever tested was the entire command
;; line, and every real invocation carrying a forbidden flag was admitted. Four
;; assertions passed while the flag they name sailed through in production.
;;
;; The fix that makes it un-repeatable is that there is now ONE shape: the
;; predicate takes the configured command LINE, exactly what EXPEDITE_STOP_CMD
;; holds and exactly what `bash -lc` is handed, and does its own tokenizing. A
;; caller cannot pass the wrong shape because there is no other shape to pass.

(assert-true "13: a bare stop invocation is safe"
             (expedite-lib/stop-invocation-ok? "./stop-swarm.sh"))
(assert-false "13: --sweep-inbox would archive the parcels a parked ticket needs"
              (expedite-lib/stop-invocation-ok? "./stop-swarm.sh --sweep-inbox"))
(assert-false "13: --reset-worktrees would revert role worktrees"
              (expedite-lib/stop-invocation-ok? "./stop-swarm.sh --reset-worktrees"))
(assert-false "13: --full is both and is equally forbidden"
              (expedite-lib/stop-invocation-ok? "./stop-swarm.sh --full"))

;; ── BL-1030: the tokenizer ────────────────────────────────────────────────
;; What `bash -lc` would actually produce, or nil when that cannot be known
;; without running it.

(assert= "1030: a bare command is one token"
         ["./stop-swarm.sh"] (expedite-lib/tokenize-command "./stop-swarm.sh"))
(assert= "1030: a flag is its own token, never part of the command"
         ["./stop-swarm.sh" "--sweep-inbox"]
         (expedite-lib/tokenize-command "./stop-swarm.sh --sweep-inbox"))
(assert= "1030: runs of whitespace collapse the way the shell collapses them"
         ["a" "b"] (expedite-lib/tokenize-command "  a \t b  "))
(assert= "1030: a shell operator is its own token, so a flag against one is still a flag"
         ["./stop-swarm.sh" "&" "&" "./stop-swarm.sh" "--full"]
         (expedite-lib/tokenize-command "./stop-swarm.sh && ./stop-swarm.sh --full"))
(assert= "1030: and a trailing separator does not fuse onto the flag before it"
         ["./stop-swarm.sh" "--full" ";"]
         (expedite-lib/tokenize-command "./stop-swarm.sh --full;"))
(assert= "1030: single quotes hold a token together and are not part of it"
         ["./my stop.sh" "--full"] (expedite-lib/tokenize-command "'./my stop.sh' --full"))
(assert= "1030: double quotes do the same"
         ["./my stop.sh"] (expedite-lib/tokenize-command "\"./my stop.sh\""))
(assert= "1030: a backslash escapes the character after it"
         ["./my stop.sh"] (expedite-lib/tokenize-command "./my\\ stop.sh"))
(assert= "1030: an empty quoted string is a real, empty token"
         ["./stop-swarm.sh" ""] (expedite-lib/tokenize-command "./stop-swarm.sh ''"))
(assert-nil "1030: an unterminated single quote cannot be read"
            (expedite-lib/tokenize-command "./stop-swarm.sh '--sweep-inbox"))
(assert-nil "1030: nor can an unterminated double quote"
            (expedite-lib/tokenize-command "./stop-swarm.sh \"--sweep-inbox"))
(assert-nil "1030: nor a line ending in a dangling escape"
            (expedite-lib/tokenize-command "./stop-swarm.sh \\"))
(assert-nil "1030: an expansion's tokens are not knowable without running it"
            (expedite-lib/tokenize-command "./stop-swarm.sh $FLAGS"))
(assert-nil "1030: nor a command substitution's"
            (expedite-lib/tokenize-command "./stop-swarm.sh $(cat flags)"))
(assert-nil "1030: nor a backquoted one"
            (expedite-lib/tokenize-command "./stop-swarm.sh `cat flags`"))
(assert= "1030: but a dollar inside single quotes is a literal, not an expansion"
         ["./stop-swarm.sh" "$FLAGS"] (expedite-lib/tokenize-command "./stop-swarm.sh '$FLAGS'"))

;; ── BL-1030: the verdict, on the caller's own input ───────────────────────

(assert= "1030: the default configured command is admitted"
         {:ok? true} (select-keys (expedite-lib/stop-invocation-verdict "./stop-swarm.sh") [:ok?]))
(assert= "1030: a forbidden flag is refused, and the verdict NAMES it"
         {:ok? false :reason :forbidden-flag :flag "--sweep-inbox"}
         (select-keys (expedite-lib/stop-invocation-verdict "./stop-swarm.sh --sweep-inbox")
                      [:ok? :reason :flag]))
(assert= "1030: a flag buried in a compound command is still found"
         {:ok? false :reason :forbidden-flag :flag "--full"}
         (select-keys (expedite-lib/stop-invocation-verdict "./stop-swarm.sh && ./stop-swarm.sh --full")
                      [:ok? :reason :flag]))
(assert= "1030: a flag before a target path is found, and the path is not the reason"
         {:ok? false :reason :forbidden-flag :flag "--full"}
         (select-keys (expedite-lib/stop-invocation-verdict "./stop-swarm.sh --full /repos/fixture-target")
                      [:ok? :reason :flag]))
(assert-true "1030: a target path that merely SPELLS a flag is not a flag"
             (expedite-lib/stop-invocation-ok? "./stop-swarm.sh /repos/full-sweep-inbox-fix"))
(assert-true "1030: nor is one that ends in a forbidden spelling"
             (expedite-lib/stop-invocation-ok? "./stop-swarm.sh /repos/target--full"))
(assert-true "1030: nor a quoted path containing the spelling and a space"
             (expedite-lib/stop-invocation-ok? "./stop-swarm.sh '/repos/my --full target'"))
(assert= "1030: a command that cannot be read is REFUSED, never admitted"
         {:ok? false :reason :unreadable}
         (select-keys (expedite-lib/stop-invocation-verdict "./stop-swarm.sh '--sweep-inbox")
                      [:ok? :reason]))
(assert= "1030: and the verdict carries the command, so the refusal can name it"
         "./stop-swarm.sh '--sweep-inbox"
         (:command (expedite-lib/stop-invocation-verdict "./stop-swarm.sh '--sweep-inbox")))

;; The reproduction table from the ticket's own `source:` block, run through
;; the predicate in the CALLER'S shape. Before this ticket every line read
;; true; the bare command is the only one that may.
(assert= "1030: the ticket's reproduction table, in the caller's shape"
         {"./stop-swarm.sh" true
          "./stop-swarm.sh --full" false
          "./stop-swarm.sh --sweep-inbox" false
          "./stop-swarm.sh --reset-worktrees" false}
         (into {} (for [c ["./stop-swarm.sh" "./stop-swarm.sh --full"
                           "./stop-swarm.sh --sweep-inbox" "./stop-swarm.sh --reset-worktrees"]]
                    [c (expedite-lib/stop-invocation-ok? c)])))

;; A caller handing over the OLD pre-split shape must be loud, not quietly
;; wrong. Silently stringifying a vector is how one shape became two.
(assert-true "1030: the pre-split shape that hid this defect now throws"
             (try (expedite-lib/stop-invocation-ok? ["./stop-swarm.sh" "--sweep-inbox"])
                  false
                  (catch Exception _ true)))

;; The refusal line the CLI logs comes from the verdict, so the message and the
;; decision cannot drift apart.
(assert-true "1030: a flag refusal's message names the flag"
             (str/includes? (expedite-lib/stop-refusal-message
                             (expedite-lib/stop-invocation-verdict "./stop-swarm.sh --sweep-inbox"))
                            "--sweep-inbox"))
(assert-true "1030: an unreadable refusal's message names the command"
             (str/includes? (expedite-lib/stop-refusal-message
                             (expedite-lib/stop-invocation-verdict "./stop-swarm.sh '--sweep-inbox"))
                            "./stop-swarm.sh '--sweep-inbox"))

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

;; ── BL-1249: restart-hold-verdict — the operator control-pause hold ────────
;; Pure: raw-content is nil for a genuinely absent marker, its exact text
;; otherwise. now-ms is the injected clock (never System/currentTimeMillis
;; here).

(assert= "1249: an absent marker is not held"
         {:held? false :reason :absent}
         (expedite-lib/restart-hold-verdict nil 1000))

(assert= "1249: active with no timer holds"
         {:held? true :reason :active :until-ms nil}
         (expedite-lib/restart-hold-verdict "{\"active\":true}" 1000))

(assert= "1249: active false is not held (explicit inactive)"
         {:held? false :reason :inactive}
         (expedite-lib/restart-hold-verdict "{\"active\":false}" 1000))

(assert= "1249: active true with a FUTURE untilMs holds"
         {:held? true :reason :active :until-ms 5000}
         (expedite-lib/restart-hold-verdict "{\"active\":true,\"untilMs\":5000}" 1000))

(assert= "1249: active true with a PAST untilMs is not held"
         {:held? false :reason :inactive :until-ms 500}
         (expedite-lib/restart-hold-verdict "{\"active\":true,\"untilMs\":500}" 1000))

(assert= "1249: active true with untilMs EXACTLY now is not held (>=, never held at the boundary)"
         {:held? false :reason :inactive :until-ms 1000}
         (expedite-lib/restart-hold-verdict "{\"active\":true,\"untilMs\":1000}" 1000))

(assert-true "1249: unparseable JSON holds (fail-closed on doubt)"
             (:held? (expedite-lib/restart-hold-verdict "not json{{{" 1000)))
(assert= "1249: unparseable JSON reports :malformed, not :active"
         :malformed (:reason (expedite-lib/restart-hold-verdict "not json{{{" 1000)))

(assert-true "1249: a truncated marker (valid prefix cut short) holds, never reads as absent"
             (:held? (expedite-lib/restart-hold-verdict "{\"active\":tr" 1000)))

(assert-true "1249: an empty string (the read-failure fold) holds, never reads as absent"
             (:held? (expedite-lib/restart-hold-verdict "" 1000)))

(assert-true "1249: a non-object JSON value (an array) holds"
             (:held? (expedite-lib/restart-hold-verdict "[1,2,3]" 1000)))

(assert-true "1249: an active marker whose untilMs is not a number holds (malformed, not a crash)"
             (:held? (expedite-lib/restart-hold-verdict "{\"active\":true,\"untilMs\":\"soon\"}" 1000)))
(assert= "1249: ...and reports :malformed"
         :malformed (:reason (expedite-lib/restart-hold-verdict "{\"active\":true,\"untilMs\":\"soon\"}" 1000)))

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

;; BL-1026. The assertion above compares the constant to itself, so it passes
;; for ANY value and says nothing about where the boundary actually falls. The
;; two below drive the boundary through the default the same way the explicit
;; cases above drive it through 5000 - one ms under is not an overrun, exactly
;; the default is. They stay red if the default is ever read as `>` rather than
;; `>=`, or if the no-budget path stops reaching the constant at all.
;;
;; What holds the VALUE (90 minutes) is deliberately not here: pinning it would
;; mint a sixth hand-mirrored copy of the constant. The value is held by the
;; mirror gate below, against the four places that state it in prose.
(assert-false "15 (BL-1026): one ms under the default is not an overrun when no budget is given"
              (:overrun? (expedite-lib/stage-timeout-verdict
                           {:started-at-ms 0 :now-ms (dec expedite-lib/default-stage-timeout-ms)})))
(assert-true "15 (BL-1026): exactly the default IS an overrun when no budget is given (>= not >)"
             (:overrun? (expedite-lib/stage-timeout-verdict
                          {:started-at-ms 0 :now-ms expedite-lib/default-stage-timeout-ms})))
(assert= "15 (BL-1026): an explicit budget under the default is the one reported, not the default"
         {:overrun? true :elapsed-ms 360000 :timeout-ms 360000}
         (expedite-lib/stage-timeout-verdict
           {:started-at-ms 0 :now-ms 360000 :timeout-ms 360000}))

;; ── BL-1026: the stated-budget mirror gate ────────────────────────────────
;; The default is stated in four places OUTSIDE the code - two usage comments
;; and two documents - and nothing gated them, so drift there was silent. These
;; cases hold the pure half: what counts as a statement, and what counts as a
;; disagreement. The gate is run against the REAL four sites at the end.

(assert= "bl1026: a usage comment's `(default N min)` is read as a budget in ms"
         [2700000]
         (expedite-lib/budget-statements "#   --stage-timeout-ms N  per-stage budget (default 45 min)"))

(assert= "bl1026: a doc stating BOTH the ms literal and the minutes yields both, so both are gated"
         [2700000 2700000]
         (expedite-lib/budget-statements
           "| `--stage-timeout-ms` | integer | `2700000` (45 min) | Per-stage wall-clock budget. |"))

(assert= "bl1026: a doc whose ms literal and minutes disagree with EACH OTHER yields both, so the pair cannot hide"
         [5400000 2700000]
         (expedite-lib/budget-statements "| `5400000` (45 min) |"))

(assert= "bl1026: prose with no budget statement yields none (a bare minute count is not a budget)"
         []
         (expedite-lib/budget-statements "the run took 45 minutes and 45 min of that was the coder"))

(assert= "bl1026: every site agreeing with the code produces no findings"
         []
         (expedite-lib/budget-mirror-findings
           [{:site "a" :content "(default 90 min)"}
            {:site "b" :content "| `5400000` (90 min) |"}]
           5400000))

(let [f (expedite-lib/budget-mirror-findings
          [{:site "agrees" :content "(default 90 min)"}
           {:site "drifted" :content "(default 45 min)"}]
          5400000)]
  (assert= "bl1026: exactly one disagreeing site is reported" 1 (count f))
  (assert= "bl1026: and the finding NAMES the site that disagrees" "drifted" (:site (first f)))
  (assert= "bl1026: and reports what it states against what the code says"
           [2700000 5400000] [(:stated-ms (first f)) (:expected-ms (first f))]))

(let [f (expedite-lib/budget-mirror-findings [{:site "silent" :content "no budget here"}] 5400000)]
  (assert= "bl1026: a site that states NO budget is drift too - deleting the mention must not pass"
           [1 "silent" :states-no-budget]
           [(count f) (:site (first f)) (:reason (first f))]))

(let [f (expedite-lib/budget-mirror-findings
          [{:site "near-miss" :content "per-stage budget (default 90 minutes)"}]
          5400000)]
  (assert= "bl1026: a spelling the gate cannot read fails CLOSED - a site it cannot parse is reported, never silently passed"
           [1 :states-no-budget] [(count f) (:reason (first f))]))

(assert-true "bl1026: the report of a finding names the site a human must go fix"
             (str/includes? (expedite-lib/format-budget-mirror-findings
                              (expedite-lib/budget-mirror-findings
                                [{:site "docs/reference/BL-567-expeditor-manual.md" :content "(default 45 min)"}]
                                5400000))
                            "docs/reference/BL-567-expeditor-manual.md"))

;; The real gate, over the real four sites, against the real constant. This is
;; the case that goes red when someone retunes the default and updates three of
;; the four places - the drift this ticket exists to stop.
(let [root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))))
      findings (expedite-lib/budget-mirror-findings
                 (expedite-lib/read-budget-mirrors root)
                 expedite-lib/default-stage-timeout-ms)]
  (assert= "bl1026: every place the expeditor states its default agrees with the code"
           [] findings)
  (assert= "bl1026: and all four stated sites were actually read (a gate over zero sites is vacuous)"
           4 (count (expedite-lib/read-budget-mirrors root))))

;; ── BL-1025: the QA hat's verdict becomes machine-checkable ───────────────
;; An expedite run never advances swarmforge-QA (no live QA worktree with the
;; swarm stopped), so its commits read as "landed outside QA" to Article
;; 4.2's check. The run now records its own QA-hat verdict where the shared
;; predicate can read it. Pure here; the CLI does the writing.

(assert= "bl1025: the store lives under .swarmforge/, machine-local like every other run artifact"
         ".swarmforge/expedite-approvals"
         expedite-lib/expedite-approval-store-dir)

(assert= "bl1025: one file per month, mirroring the bounce store's own layout"
         ".swarmforge/expedite-approvals/2026-08.jsonl"
         (expedite-lib/expedite-approval-store-file "2026-08-22T00:12:00Z"))

(assert= "bl1025: a QA-hat PASS becomes a record naming the sha it advanced"
         {:at "2026-08-22T00:12:00Z" :ticket "BL-1021" :stage "QA" :approval true :verdict "pass" :commit "44ef693d9c"}
         (expedite-lib/qa-hat-verdict-record
          {:stage "QA" :verdict :pass :ticket "BL-1021" :commit "44ef693d9c1234" :at "2026-08-22T00:12:00Z"}))

(assert= "bl1025: a QA-hat BOUNCE is recorded too - a verdict on file that says no is not the same as no verdict"
         "bounce"
         (:verdict (expedite-lib/qa-hat-verdict-record
                    {:stage "QA" :verdict :bounce :ticket "BL-1021" :commit "44ef693d9c1234" :at "2026-08-22T00:12:00Z"})))

;; ── BL-1025 architect bounce D1: the reader must not re-derive the verdict
;;    vocabulary. The record carries the ALREADY-CLASSIFIED decision, so
;;    `advance-verdicts` is spelled in exactly one place and a fourth token
;;    added there needs no second edit anywhere. Every member of the real
;;    vocabulary is driven here, not just the two the first draft covered.

(doseq [v expedite-lib/advance-verdicts]
  (assert= (str "bl1025 D1: every advance verdict (" v ") records approval true")
           true
           (:approval (expedite-lib/qa-hat-verdict-record
                       {:stage "QA" :verdict v :ticket "BL-1021" :commit "44ef693d9c1234" :at "2026-08-22T00:12:00Z"}))))

(doseq [v expedite-lib/bounce-verdicts]
  (assert= (str "bl1025 D1: every bounce verdict (" v ") records approval false")
           false
           (:approval (expedite-lib/qa-hat-verdict-record
                       {:stage "QA" :verdict v :ticket "BL-1021" :commit "44ef693d9c1234" :at "2026-08-22T00:12:00Z"}))))

(assert-true "bl1025 D1: the vocabulary is genuinely plural - a single-token set would make this whole class of drift untestable"
             (< 1 (count expedite-lib/advance-verdicts)))

(assert= "bl1025: the commit is recorded at the 10-hex width every other verdict store uses"
         "44ef693d9c"
         (:commit (expedite-lib/qa-hat-verdict-record
                   {:stage "QA" :verdict :pass :ticket "BL-1021" :commit "44ef693d9c1234567890" :at "2026-08-22T00:12:00Z"})))

(assert-nil "bl1025: no other stage writes an approval - only the QA hat's verdict is an approval"
            (expedite-lib/qa-hat-verdict-record
             {:stage "coder" :verdict :pass :ticket "BL-1021" :commit "44ef693d9c1234" :at "2026-08-22T00:12:00Z"}))

(assert-nil "bl1025: a stage that FAILED records nothing - a run that fell over approved nothing"
            (expedite-lib/qa-hat-verdict-record
             {:stage "QA" :verdict :timed-out :ticket "BL-1021" :commit "44ef693d9c1234" :at "2026-08-22T00:12:00Z"}))

(assert-nil "bl1025: an unresolvable commit records nothing rather than a record naming nothing"
            (expedite-lib/qa-hat-verdict-record
             {:stage "QA" :verdict :pass :ticket "BL-1021" :commit nil :at "2026-08-22T00:12:00Z"}))

(assert-nil "bl1025: a blank commit records nothing either"
            (expedite-lib/qa-hat-verdict-record
             {:stage "QA" :verdict :pass :ticket "BL-1021" :commit "  " :at "2026-08-22T00:12:00Z"}))

;; ── BL-1024: the run names what it leaves for someone else ────────────────
;; The BL-1021 run of 2026-08-21 ended printing "ticket=done restart=failed"
;; and nothing else. Three tickets sat unrestored in hold/, four backlog moves
;; sat STAGED in the shared master checkout, and the pipeline idled with an
;; empty active/ until a human noticed. Both deferrals are deliberate; neither
;; had an owner or a mention. A deferral nobody is told about is a drop.

(def bl1024-parked
  (expedite-lib/outstanding-work
   {:ticket "BL-1021" :parked ["BL-586" "BL-1012" "BL-1017"] :ticket-moved? true}))

(assert= "bl1024: a run that parked tickets reports exactly two outstanding items"
         2 (count bl1024-parked))

(assert= "bl1024: the parked tickets are one outstanding subject"
         "the parked tickets"
         (:subject (first (filter #(= "the parked tickets" (:subject %)) bl1024-parked))))

(assert= "bl1024: it names the folder they are held in - Article 3.1 forbids promoting from there"
         "backlog/hold/"
         (:folder (first (filter #(= "the parked tickets" (:subject %)) bl1024-parked))))

(assert= "bl1024: it names every parked ticket, not a count"
         ["BL-586" "BL-1012" "BL-1017"]
         (:tickets (first (filter #(= "the parked tickets" (:subject %)) bl1024-parked))))

(assert-true "bl1024: the parked item names an owner"
             (seq (:owner (first (filter #(= "the parked tickets" (:subject %)) bl1024-parked)))))

(assert-true "bl1024: the uncommitted backlog moves are the other outstanding subject"
             (seq (filter #(= "the uncommitted backlog moves" (:subject %)) bl1024-parked)))

(assert-true "bl1024: the moves item names an owner too - two deferrals, two owners"
             (seq (:owner (first (filter #(= "the uncommitted backlog moves" (:subject %)) bl1024-parked)))))

(assert= "bl1024: the moves are enumerated - three parks plus the run ticket's own move"
         4
         (count (:moves (first (filter #(= "the uncommitted backlog moves" (:subject %)) bl1024-parked)))))

;; Honesty, both directions.
(assert-true "bl1024: a run that parked NOTHING manufactures no parked-tickets item"
             (empty? (filter #(= "the parked tickets" (:subject %))
                             (expedite-lib/outstanding-work
                              {:ticket "BL-1021" :parked [] :ticket-moved? true}))))

(assert= "bl1024: a DRY run has nothing outstanding at all - it changed nothing"
         []
         (expedite-lib/outstanding-work
          {:ticket "BL-1021" :parked ["BL-586"] :ticket-moved? true :dry-run? true}))

(assert= "bl1024: a run that parked nothing AND moved nothing has nothing outstanding"
         []
         (expedite-lib/outstanding-work {:ticket "BL-1021" :parked [] :ticket-moved? false}))

;; The rendered summary is the actual channel - the expeditor may not use the
;; mailboxes, tmux, or the coordinator ("machinery it may never use"), so what
;; it PRINTS is its only way to reach the next actor.
(def bl1024-text (expedite-lib/format-outstanding-summary
                  {:items bl1024-parked :parked ["BL-586" "BL-1012" "BL-1017"]}))

(assert-true "bl1024: the summary names each parked ticket"
             (every? #(str/includes? bl1024-text %) ["BL-586" "BL-1012" "BL-1017"]))
(assert-true "bl1024: the summary names the hold folder" (str/includes? bl1024-text "backlog/hold/"))
(assert-true "bl1024: the summary names an owner for each item"
             (<= 2 (count (re-seq #"owner:" bl1024-text))))
(assert-true "bl1024: the summary is labelled OUTSTANDING, so it is skimmable in a terminal"
             (str/includes? bl1024-text "OUTSTANDING"))

(assert-true "bl1024: a run that parked nothing SAYS so rather than staying silent about it"
             (str/includes? (expedite-lib/format-outstanding-summary
                             {:items (expedite-lib/outstanding-work
                                      {:ticket "BL-1021" :parked [] :ticket-moved? true})
                              :parked []})
                            "no tickets are held"))

(assert-true "bl1024: nothing outstanding says exactly that, never an empty heading"
             (str/includes? (expedite-lib/format-outstanding-summary {:items [] :parked [] :dry-run? true})
                            "nothing outstanding"))

;; ── missing-verdict recovery (hotfix: claude -p exits without verdict.json) ─
;; BL-1248 cleaner/hardender exited 0 after parking on Monitor/background work,
;; wrote no verdict, and the driver hard-failed :no-verdict. Class of failure:
;; stage child exits without a parseable verdict.
;;
;; Process fix:
;; - Up to two automatic recoveries (escalating prompts) that demand a written
;;   pass|bounce|fail verdict — never "stand by".
;; - A bounce MUST carry an actionable reason (or class). Driver-synthesized
;;   "no-verdict" bounces are forbidden: they re-enter the same stage with no
;;   new information and burn the bounce bound in a loop.
;; - After recoveries are exhausted, missing verdict still fails closed.

(assert-true "no-verdict: first missing parseable verdict recovers"
             (expedite-lib/should-recover-missing-verdict?
              {:timed-out? false :overrun? false :parsed nil :attempt 0}))
(assert-true "no-verdict: second miss still recovers once more (escalation)"
             (expedite-lib/should-recover-missing-verdict?
              {:timed-out? false :overrun? false :parsed nil :attempt 1}))
(assert-false "no-verdict: third miss does not recover"
              (expedite-lib/should-recover-missing-verdict?
               {:timed-out? false :overrun? false :parsed nil :attempt 2}))
(assert-false "no-verdict: a parseable verdict never recovers"
              (expedite-lib/should-recover-missing-verdict?
               {:timed-out? false :overrun? false :parsed {:verdict "pass"} :attempt 0}))
(assert-false "no-verdict: a timed-out stage never recovers"
              (expedite-lib/should-recover-missing-verdict?
               {:timed-out? true :overrun? false :parsed nil :attempt 0}))
(assert-false "no-verdict: an overrun stage never recovers"
              (expedite-lib/should-recover-missing-verdict?
               {:timed-out? false :overrun? true :parsed nil :attempt 0}))

(assert-true "bounce: reason alone is valid"
             (expedite-lib/bounce-payload-valid? {:reason "coverage gap in parse-enabled?" :class nil}))
(assert-true "bounce: class alone is valid"
             (expedite-lib/bounce-payload-valid? {:reason nil :class "resume-identity"}))
(assert-false "bounce: blank reason and class is NOT valid (loop fuel)"
              (expedite-lib/bounce-payload-valid? {:reason "" :class nil}))
(assert-false "bounce: synthetic no-verdict reason is NOT valid"
              (expedite-lib/bounce-payload-valid? {:reason :no-verdict :class "no-verdict-abandoned"}))
(assert-false "bounce: no-verdict-abandoned class alone is NOT valid"
              (expedite-lib/bounce-payload-valid? {:reason "x" :class "no-verdict-abandoned"}))

(let [p (expedite-lib/stage-user-prompt
         {:role "cleaner" :ticket "BL-1248"
          :verdict-file "/tmp/verdict.json" :recovery? false})]
  (assert-true "no-verdict: initial prompt names the verdict path" (str/includes? p "/tmp/verdict.json"))
  (assert-true "no-verdict: initial prompt forbids Monitor waits" (str/includes? p "Monitor"))
  (assert-true "no-verdict: initial prompt forbids standing by" (str/includes? p "stand by"))
  (assert-true "no-verdict: initial prompt requires last-action write" (str/includes? p "LAST action")))

(let [p (expedite-lib/stage-user-prompt
         {:role "hardender" :ticket "BL-1248"
          :verdict-file "/tmp/verdict.json" :recovery? true :attempt 1})]
  (assert-true "no-verdict: recovery prompt is labelled RECOVERY" (str/includes? p "RECOVERY"))
  (assert-true "no-verdict: recovery forbids standing by" (str/includes? p "stand by"))
  (assert-true "no-verdict: recovery requires pass|bounce|fail" (str/includes? p "pass"))
  (assert-true "no-verdict: recovery prompt still names the path" (str/includes? p "/tmp/verdict.json")))

(let [p (expedite-lib/stage-user-prompt
         {:role "hardender" :ticket "BL-1248"
          :verdict-file "/tmp/verdict.json" :recovery? true :attempt 2})]
  (assert-true "no-verdict: escalated recovery names ESCALATED" (str/includes? p "ESCALATED"))
  (assert-true "no-verdict: escalated recovery demands a real bounce reason if bouncing"
               (str/includes? p "actionable reason")))

(assert= "no-verdict: finalize timeout before missing-verdict"
         :stage-timeout
         (:reason (expedite-lib/finalize-stage-result
                   {:timed-out? true :overrun? false :parsed nil
                    :role "cleaner" :exit 0 :elapsed {:overrun? false} :attempt 0})))
(assert= "no-verdict: finalize miss always fails closed (never synthesizes a bounce)"
         {:verdict :fail :reason :no-verdict :stage "hardender" :exit 0}
         (expedite-lib/finalize-stage-result
          {:timed-out? false :overrun? false :parsed nil
           :role "hardender" :exit 0 :elapsed {:overrun? false} :attempt 2}))
(assert= "no-verdict: finalize advances a real pass"
         :pass
         (:verdict (expedite-lib/finalize-stage-result
                    {:timed-out? false :overrun? false
                     :parsed {:verdict "pass" :summary "ok"}
                     :role "cleaner" :exit 0 :attempt 0
                     :elapsed {:overrun? false :elapsed-ms 1}})))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (println (str "expedite_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
