;; BL-530: ensure-time self-heal for a pack's coordinator launch contract.
;; BL-512's recurring-failure-mode audit (rank 3) found packs launching
;; "healthy" with a broken coordinator launch contract - e.g. an aider
;; coordinator with no coordinator_model, silently defaulting to the
;; Claude-only "claude-sonnet-5" (coordinator_config_lib.bb), which is
;; meaningless spliced into an OpenAI-compat `aider --model` argv. That
;; produces busy-idle thrash that still reads as a healthy pane.
;;
;; A pack has opted into this agent-specific contract the moment it names
;; a non-default coordinator_agent (BL-319): every pack that already gets
;; it right (codex/gemini/perplexity/qwen/vibe-mono-router.conf) sets BOTH
;; coordinator_model and rotation whenever it sets coordinator_agent;
;; cerebras-mono-router.conf violates the convention by omitting
;; coordinator_model - the concrete regression this ticket closes.
;;
;; Pure: operates on a pack conf file's raw text only, no IO - so the same
;; check runs identically from swarm_ensure.bb (a live swarm's effective
;; conf) and from a unit test (any packs/*.conf on disk).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "launch_contract_lib.bb")))
;; and referred to as launch-contract-lib/foo.

(ns launch-contract-lib
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "coordinator_config_lib.bb")))

(defn requires-explicit-launch-contract?
  "A pack requires its own coordinator_model/rotation - rather than the
   Claude-only defaults - the moment it names a coordinator_agent other
   than the default `claude`."
  [conf-text]
  (not= (coordinator-config-lib/coordinator-agent conf-text)
        coordinator-config-lib/default-coordinator-agent))

(defn missing-coordinator-model?
  [conf-text]
  (and (requires-explicit-launch-contract? conf-text)
       (nil? (coordinator-config-lib/raw-config-value conf-text "coordinator_model"))))

(defn missing-rotation?
  [conf-text]
  (and (requires-explicit-launch-contract? conf-text)
       (nil? (coordinator-config-lib/raw-config-value conf-text "rotation"))))

(defn launch-contract-violations
  "Every required-but-missing pack-contract field, as a seq of
   {:field :detail} maps - empty when the pack's launch contract is
   complete, including every pack that never opted into it at all."
  [conf-text]
  (let [agent (coordinator-config-lib/coordinator-agent conf-text)]
    (cond-> []
      (missing-coordinator-model? conf-text)
      (conj {:field "coordinator_model"
             :detail (str "coordinator_agent is '" agent "' but coordinator_model is unset - "
                          "the Claude-only default '" coordinator-config-lib/default-coordinator-model
                          "' would otherwise be spliced into its argv")})
      (missing-rotation? conf-text)
      (conj {:field "rotation"
             :detail (str "coordinator_agent is '" agent "' but rotation is unset")}))))
