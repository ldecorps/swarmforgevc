#!/usr/bin/env bb
;; BL-1318: pack staffing gate — PURE decisions only. Before a launch seats
;; role R with provider/model M, refuse unless M is ranked on R's role
;; matrix, R's compliance gate for M is decided pass, and assignment-eligible?
;; holds. No disk IO here — pack_staffing_gate_cli.bb owns reading the
;; steward evidence (registry/seed + scorecards) and never writes any of it
;; (the gate only READS steward evidence, invariant 2).
;;
;; The decision fn seat-staffing-decision is the one rule every caller
;; shares (ticket required_wiring anchor 2): the shell gate in
;; swarmforge.sh's parse_config and the tests all drive THIS fn, so they
;; cannot drift into two different rules.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pack_staffing_gate_lib.bb")))
;; and referred to as pack-staffing-gate-lib/foo. Callers must also load
;; model_steward_lib.bb first (model-steward-lib/* is referenced directly —
;; same contract as model_factory_lib.bb).
(ns pack-staffing-gate-lib
  (:require [clojure.string :as str]))

(def decision-pass "pass")
(def decision-refuse "refuse")
(def decision-override "override")

;; The feature file's failing-check vocabulary — a literal per check, named
;; at mint so the acceptance step handler matches them verbatim (BL-874).
(def check-unresolved "seat-model-unresolved")
(def check-not-on-role-matrix "not-on-role-matrix")
(def check-role-gate-not-pass "role-gate-not-pass")
(def check-not-assignment-eligible "not-assignment-eligible")

;; ── seat model resolution ────────────────────────────────────────────────
;; A seat's steward identity has to be RESOLVED from its window line. No
;; existing helper does this (provider_compat_lib.bb only maps api keys for
;; perplexity/cerebras/qwen), so this is an explicit table-driven map seeded
;; from the live packs — never inference. An entry the table does not cover
;; is UNRESOLVED, and invariant 1 makes that a refusal, never a guess.

;; provider keyed by [agent model] — the shapes the live packs pin.
;; `claude` harness seats run gateway models too (the Token Plan gateway
;; speaks the anthropic protocol), so the steward provider is a property of
;; the MODEL entry, not of the harness agent.
(def agent-model-providers
  {["claude" "claude-sonnet-5"] "anthropic"
   ["claude" "claude-opus-5"] "anthropic"
   ["claude" "qwen3.8-max"] "qwen"
   ["cursor" "auto"] "cursor"
   ["gemini" "gemini-2.5-pro"] "google"})

(defn agent-model-provider
  "Table-driven provider lookup for a harness agent + pinned model, or nil."
  [agent model]
  (get agent-model-providers [(str/lower-case (str agent)) (str model)]))

;; provider keyed by --openai-api-base HOST — for openai-compatible seats
;; (aider) the registry provider comes from the api-base host, not from the
;; `openai/` prefix the CLI convention carries.
(def api-base-host-providers
  {"api.deepseek.com" "deepseek"
   "token-plan.ap-southeast-1.maas.aliyuncs.com" "qwen"})

(defn flag-value
  "First token following `flag` in the window line's extra CLI args, or nil."
  [extra-cli flag]
  (let [tokens (str/split (str extra-cli) #"\s+")]
    (->> tokens
         (partition 2 1)
         (filter #(= flag (first %)))
         first
         second)))

(defn- url-host [url]
  (-> (str url)
      (str/replace #"^[a-zA-Z][a-zA-Z0-9+.-]*://" "")
      (str/split #"/")
      first))

(defn resolve-seat
  "Resolves a window line to its steward identity. Returns
   {:status :resolved :provider p :model m}  — a mapped steward identity
   {:status :no-pin}                          — the line pins no model at all
                                              (the pack claims nothing the
                                              steward can clear or refuse)
   {:status :unresolved :reason ...}         — the line pins something the
                                              table does not cover (refuses)
   No inference, no guessing — invariant 1."
  [agent extra-cli]
  (let [agent (str/lower-case (str agent))
        model (flag-value extra-cli "--model")
        api-base (flag-value extra-cli "--openai-api-base")]
    (cond
      (= "none" agent) {:status :no-pin}
      (nil? model) {:status :no-pin}
      api-base
      (let [host (url-host api-base)
            provider (get api-base-host-providers host)]
        (if provider
          {:status :resolved :provider provider :model (str/replace-first model #"^openai/" "")}
          {:status :unresolved
           :reason (str "api-base host '" host "' has no steward provider mapping")}))
      :else
      (if-let [provider (agent-model-provider agent model)]
        {:status :resolved :provider provider :model model}
        {:status :unresolved
         :reason (str "agent '" agent "' + model '" model "' has no steward provider mapping")}))))

;; ── the checks ───────────────────────────────────────────────────────────

;; The scorecard competency spelling per pipeline role. Every role's gate
;; competency is "<role>-gate" with one live exception: the hardender role's
;; battery competency is spelled hardener-gate (see scorecards/*.json).
(def role-gate-competency-overrides {"hardender" "hardener-gate"})

(defn gate-competency [role]
  (get role-gate-competency-overrides role (str role "-gate")))

(defn- battery-role-token [role]
  ;; compliance_battery.bb's gate subcommands are lowercase tokens
  ;; (gate qa / gate hardener / ...), while scorecard competencies keep the
  ;; role's own casing (QA-gate / hardener-gate).
  (str/lower-case (str/replace (gate-competency role) #"-gate$" "")))

(defn ranked-on-role-matrix?
  "True when R's role matrix carries an entry for provider/model whose
   evidence is not BL-1140's revoked human-operator-priority tag — a revoked
   standing human pick confers no staffing standing."
  [registry role provider model]
  (some (fn [entry]
          (and (= provider (:provider entry))
               (= model (:model entry))
               (not (model-steward-lib/revoked-human-priority-evidence?
                     (:evidence entry)))))
        (get-in registry [:role_matrix role] [])))

(defn role-gate-passed?
  "True when the model's compliance scorecard decides R's gate 'pass'.
   Missing scorecard, missing entry, or any other status (e.g.
   human-verdict-pending) is NOT a decided pass — fail closed."
  [scorecard role]
  (let [competency (gate-competency role)]
    (boolean
     (some (fn [entry]
             (and (= competency (str (:competency entry)))
                  (= "pass" (str (:status entry)))))
           (:entries scorecard [])))))

(defn steward-command-for
  "The runnable steward CLI an operator reaches for per failing check."
  [check role provider model]
  (case check
    "not-on-role-matrix"
    (str "bb swarmforge/scripts/model_steward_cli.bb role-matrix " role)
    "role-gate-not-pass"
    (str "bb swarmforge/scripts/compliance_battery.bb gate " (battery-role-token role)
         " (then record the verdict: bb swarmforge/scripts/model_steward_cli.bb show "
         provider "/" model ")")
    "not-assignment-eligible"
    (str "bb swarmforge/scripts/model_steward_cli.bb status (certify requires a scorecard: show "
         provider "/" model ")")
    nil))

;; ── seat-staffing-decision — the shared pure rule ────────────────────────

(defn seat-staffing-decision
  "Decides one window line. evidence is {:registry <map> :scorecards
   {\"provider/model\" <scorecard map>}} — plain data, no IO. opts may set
   :override? (the PACK_STAFFING_SKIP_GATE=1 operator escape hatch).

   Checks, in order (first failure is THE reported check):
     1. the seat resolves to a steward identity        (seat-model-unresolved)
     2. identity ranked on the role's matrix, unrevoked (not-on-role-matrix)
     3. the role's compliance gate is decided pass     (role-gate-not-pass)
     4. assignment-eligible? holds                     (not-assignment-eligible)

   Every call returns a decision in the pass/refuse/override vocabulary —
   never nil, never a default (invariant 1). An override is never recorded
   or printed as a pass (invariant 3)."
  [evidence role agent extra-cli opts]
  (let [role (str role)
        override? (boolean (:override? opts))
        resolution (resolve-seat agent extra-cli)
        base {:role role :agent agent :extra-cli extra-cli
              :no-pin? (= :no-pin (:status resolution))}]
    (cond
      ;; the pack pins nothing — nothing for the steward to clear or refuse
      (= :no-pin (:status resolution))
      (assoc base :decision decision-pass :provider nil :model nil
             :failing-check nil :steward-command nil)

      (= :unresolved (:status resolution))
      (if override?
        (assoc base :decision decision-override :provider nil :model nil
               :failing-check check-unresolved
               :steward-command nil)
        (assoc base :decision decision-refuse :provider nil :model nil
               :failing-check check-unresolved
               :steward-command nil))

      :else
      (let [{:keys [provider model]} resolution
            registry (:registry evidence)
            scorecard (get-in evidence [:scorecards (str provider "/" model)])
            failing-check (cond
                            (not (ranked-on-role-matrix? registry role provider model))
                            check-not-on-role-matrix
                            (not (role-gate-passed? scorecard role))
                            check-role-gate-not-pass
                            (not (model-steward-lib/assignment-eligible? registry provider model))
                            check-not-assignment-eligible
                            :else nil)]
        (cond
          (nil? failing-check)
          (assoc base :decision decision-pass :provider provider :model model
                 :failing-check nil :steward-command nil)
          override?
          (assoc base :decision decision-override :provider provider :model model
                 :failing-check failing-check
                 :steward-command (steward-command-for failing-check role provider model))
          :else
          (assoc base :decision decision-refuse :provider provider :model model
                 :failing-check failing-check
                 :steward-command (steward-command-for failing-check role provider model)))))))
