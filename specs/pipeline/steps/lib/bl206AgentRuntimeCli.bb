#!/usr/bin/env bb
;; BL-206/BL-1945 acceptance shim: drives the REAL agent_runtime_lib.bb /
;; prompt_engine_lib.bb capability model and lifecycle-verb functions -
;; never a restatement of the capability map or the step-production logic.
;; Mirrors the exact assertions swarmforge/scripts/test/
;; agent_runtime_test_runner.bb already carries for BL-206's own three
;; scenarios.
;;
;; Usage:
;;   bb bl206AgentRuntimeCli.bb wake-steps <agent>
;;   bb bl206AgentRuntimeCli.bb wake-steps-as-synthetic-copy-of <sourceAgent> <newAgentName>
;;       - redefines provider-capabilities with <newAgentName> declaring the
;;         SAME capability flags as <sourceAgent> (capability-branching-01's
;;         "decided purely from data" proof) and prints its wake-steps.
;;   bb bl206AgentRuntimeCli.bb synthetic-provider-steps
;;       - declares a wholly synthetic provider with only capability flags
;;         (no code change) and prints its wake-steps/bootstrap-steps/
;;         needs-tmux-bootstrap - new-provider-is-capabilities-02's proof.
;;   bb bl206AgentRuntimeCli.bb lifecycle-step <health|stop|respawn> <agent>
;;       - prints the step(s) that verb produces for <agent>.
(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts" "agent_runtime_lib.bb")))

(def args *command-line-args*)
(def command (first args))

(defn print-json [data]
  (println (json/generate-string data)))

(case command
  "wake-steps"
  (print-json (agent-runtime-lib/wake-steps (second args)))

  "wake-steps-as-synthetic-copy-of"
  (let [source-agent (second args)
        new-agent (nth args 2)]
    (with-redefs [prompt-engine-lib/provider-capabilities
                  (assoc prompt-engine-lib/provider-capabilities
                         new-agent (get prompt-engine-lib/provider-capabilities source-agent))]
      (print-json (agent-runtime-lib/wake-steps new-agent))))

  "synthetic-provider-steps"
  (let [synthetic-caps (assoc prompt-engine-lib/provider-capabilities
                               "bl206-synthetic-provider"
                               {:wake-style :chat-message
                                :bootstrap-style :embedded
                                :bootstrap-text-style :generic})]
    (with-redefs [prompt-engine-lib/provider-capabilities synthetic-caps
                  prompt-engine-lib/supported-agents (conj prompt-engine-lib/supported-agents "bl206-synthetic-provider")]
      (print-json {:wakeSteps (agent-runtime-lib/wake-steps "bl206-synthetic-provider")
                   :bootstrapSteps (agent-runtime-lib/bootstrap-steps "bl206-synthetic-provider" "coder")
                   :needsTmuxBootstrap (agent-runtime-lib/needs-tmux-bootstrap? "bl206-synthetic-provider")})))

  "lifecycle-step"
  (let [verb (second args)
        agent (nth args 2)
        step-fn (case verb
                  "health" agent-runtime-lib/health-steps
                  "stop" agent-runtime-lib/stop-steps
                  "respawn" agent-runtime-lib/respawn-steps
                  (throw (ex-info (str "unknown lifecycle verb: " verb) {:verb verb})))]
    (print-json (step-fn agent)))

  (binding [*out* *err*]
    (println "usage: bl206AgentRuntimeCli.bb <wake-steps|wake-steps-as-synthetic-copy-of|synthetic-provider-steps|lifecycle-step> ...")
    (System/exit 2)))
