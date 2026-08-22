#!/usr/bin/env bb
;; BL-1053 property test (coder-authored, ONE declared invariant).
;;
;;   Every provider key in the registry resolves to exactly one launch agent,
;;   and no two provider keys resolve to an agent that cannot serve them. A
;;   provider added without its own provider->agent entry falls through to
;;   another provider's binary rather than failing, which is the confusing
;;   failure this ticket exists to prevent.
;;
;; WHY THE PAIRS ARE CONSTRUCTED, NOT DRAWN INDEPENDENTLY (BL-654's known
;; failure shape (b)). The transformation this code conflates is PROTOCOL ->
;; PROVIDER: qwen-code and codex both speak the OpenAI-compatible wire
;; protocol, and qwen-code even authenticates with `--auth-type openai`, so
;; the plausible mistake is filing a qwen model under the "openai" key. Two
;; provider keys drawn independently would land on that exact pair rarely.
;; P2 therefore draws ONE Token Plan model and derives BOTH keys it could
;; plausibly be filed under - every generated pair is the collision by
;; construction.
;;
;; WHY THE CHECK REACHES ACROSS A FILE BOUNDARY. A provider->agent value is
;; only meaningful against the launcher's own allow-list: "qwen_code" or
;; "qwencode" would satisfy every assertion inside model_factory_lib.bb and
;; then fail at launch with "Unsupported agent". P1 resolves every registered
;; agent against prompt_engine_lib.bb's supported-agents AND its capability
;; map, which is where that answer actually lives.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause):
;;   (a) NEAR-MISS PROVIDER NAMES. A name drawn from random letters is
;;       trivially unknown; the names that actually get typed are case
;;       variants, whitespace-padded keys, and - most plausibly of all - the
;;       AGENT name used as a provider key ("qwen-code" instead of "qwen").
;;       Each carries its own floor rather than turning up by luck.
;;   (b) KNOWN PROVIDERS. If every drawn provider were unknown, a resolver
;;       that reported EVERYTHING unknown would pass. Known keys are drawn
;;       and floored too.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break applied and
;; reverted:
;;   - agent-for-provider restored to (get provider->agent provider provider)  P2b
;;   - the "qwen" entry removed from provider->agent ................... P1, P2a
;;   - "openai" remapped to "qwen-code" ................................ P2a
;;   - assign-role's unknown-provider guard neutralized (its `when-not
;;     known?` made unreachable, so the descriptor is built anyway) ..... P3
;;     P3's output on that break is the defect's exact shape: an otherwise
;;     ordinary assignment map carrying :agent nil.

(ns bl1053-provider-routing-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (str (fs/parent test-dir)))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

;; ONE generator advanced across every run - a fresh LCG seeded per run index
;; returns a near-constant first draw for a small modulus (BL-991's measured
;; degenerate draw; BL-1057 recorded the same shape per position).
(def rng
  (let [state (atom 1053)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(def known-providers (vec (sort (keys model-factory-lib/provider->agent))))

;; ── P1: every registered provider resolves to exactly one REAL agent ─────

(check! "provider->agent is empty - every check below would assert about nothing"
        (seq known-providers))

(doseq [provider known-providers]
  (bump! :registered-provider)
  (let [res (model-factory-lib/resolve-launch-agent provider)
        agent (model-factory-lib/agent-for-provider provider)]
    (check! (str "provider '" provider "' does not report as known") (true? (:known? res)))
    (check! (str "provider '" provider "' resolves inconsistently: report says "
                 (pr-str (:agent res)) ", direct lookup says " (pr-str agent))
            (= agent (:agent res)))
    (check! (str "provider '" provider "' names no agent") (some? agent))
    ;; Across the boundary: the launcher, not this file, decides what an
    ;; agent name means.
    (check! (str "provider '" provider "' names agent " (pr-str agent)
                 ", which is not an agent the launcher supports")
            (contains? prompt-engine-lib/supported-agents agent))
    (check! (str "agent " (pr-str agent) " (provider '" provider
                 "') has no provider-capabilities entry of its own - it would launch with claude's shape")
            (contains? prompt-engine-lib/provider-capabilities agent))
    ;; "exactly one": resolution is a function, so asking twice must agree.
    (check! (str "provider '" provider "' does not resolve deterministically")
            (= agent (model-factory-lib/agent-for-provider provider)))))

;; ── P2a: the constructed shortcut pair never collapses ───────────────────

;; Every model on the Token Plan, i.e. every model for which "file it under
;; openai, the protocol matches" is a live temptation.
(def token-plan-models
  ["qwen3.7-plus" "qwen3.6-flash" "qwen3.7-max" "qwen3.8-max-preview"
   "deepseek-v4-pro" "glm-5.2"])

;; The two keys ONE Token Plan model could be filed under: the correct one,
;; and the protocol-shaped shortcut. Derived from the model, never drawn
;; beside it.
(defn candidate-keys-for [_model] ["qwen" "openai"])

(doseq [run-index (range runs)]
  (let [model (token-plan-models (rng (count token-plan-models)))
        [correct shortcut] (candidate-keys-for model)
        where (str "run " run-index " model " model)]
    (bump! :shortcut-pairs)
    (let [a (model-factory-lib/agent-for-provider correct)
          b (model-factory-lib/agent-for-provider shortcut)]
      (check! (str where ": the correct key '" correct "' resolves to " (pr-str a)
                   ", not the qwen-code launch agent")
              (= "qwen-code" a))
      (check! (str where ": '" correct "' and '" shortcut "' both resolve to " (pr-str a)
                   " - filing a Token Plan model under the protocol-shaped key would launch it "
                   "through the same binary either way, which is the collapse this invariant forbids")
              (not= a b))
      (check! (str where ": the shortcut key '" shortcut "' resolves to " (pr-str b)
                   " - it must still name the binary it named before this ticket")
              (= "codex" b)))))

;; ── P2b: an unregistered provider is reported, never guessed ─────────────

;; The names that actually get typed, not random letters: case variants,
;; whitespace-padded keys, and the AGENT name used as a provider key - which
;; is the most plausible mistake of all, since "qwen-code" is the string a
;; reader has just seen on the other side of the map.
(defn draw-unknown-provider []
  (let [base (known-providers (rng (count known-providers)))
        agent (model-factory-lib/agent-for-provider base)]
    (case (rng 6)
      0 (str/upper-case base)
      1 (str " " base)
      2 (str base " ")
      3 (or agent (str base "-agent"))
      4 (str base (inc (rng 9)))
      (str base "-" (rand-nth ["compat" "plan" "v2"])))))

(doseq [run-index (range runs)]
  (let [provider (draw-unknown-provider)
        where (str "run " run-index " " (pr-str provider))]
    (if (contains? model-factory-lib/provider->agent provider)
      ;; A draw that happens to BE a registered key falls here. Known-provider
      ;; coverage does not rest on it: P1 walks every registered key and P3
      ;; floors :assign-known, so a resolver that reported EVERYTHING unknown
      ;; fails there regardless of how this draw lands.
      (do (bump! :known-draw)
          (check! (str where ": a registered key must report as known")
                  (true? (:known? (model-factory-lib/resolve-launch-agent provider)))))
      (let [res (model-factory-lib/resolve-launch-agent provider)
            agent (model-factory-lib/agent-for-provider provider)]
        (bump! :unknown-draw)
        (when (= provider (str/upper-case provider)) (bump! :case-variant))
        (when (not= provider (str/trim provider)) (bump! :whitespace-variant))
        (when (contains? (set (vals model-factory-lib/provider->agent)) provider)
          (bump! :agent-name-as-provider))
        (check! (str where ": an unregistered provider reported as known")
                (false? (:known? res)))
        (check! (str where ": an unregistered provider named launch agent " (pr-str (:agent res)))
                (nil? (:agent res)))
        (check! (str where ": agent-for-provider answered " (pr-str agent)
                     " for an unregistered provider - it must answer nil, never a guess")
                (nil? agent))
        ;; The specific pre-BL-1053 shape: answering with the provider's own
        ;; name, which reads downstream as an ordinary agent string.
        (check! (str where ": agent-for-provider echoed the provider back as its own agent")
                (not= provider agent))
        (check! (str where ": the unknown report does not name the provider it could not resolve")
                (str/includes? (str (:reason res)) (str/trim provider)))))))

;; ── P3: an assignment is never handed on naming no agent ─────────────────

(defn registry-for [provider model]
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model provider model {:status "certified" :cost_class "low"})
      (model-steward-lib/add-role-ranking "coder" provider model 0.9 "property-fixture")))

(doseq [run-index (range (quot runs 4))]
  (let [known? (zero? (rng 2))
        provider (if known?
                   (known-providers (rng (count known-providers)))
                   (draw-unknown-provider))
        registered? (contains? model-factory-lib/provider->agent provider)
        reg (registry-for provider (str "model-" run-index))
        outcome (try {:entry (model-factory-lib/assign-role reg "coder" model-factory-lib/quality-mode)}
                     (catch Exception e {:threw (.getMessage e)}))
        where (str "assign run " run-index " provider " (pr-str provider))]
    (if registered?
      (do (bump! :assign-known)
          (check! (str where ": a registered provider's assignment threw: " (:threw outcome))
                  (nil? (:threw outcome)))
          (check! (str where ": a registered provider's assignment names no agent")
                  (some? (:agent (:entry outcome)))))
      (do (bump! :assign-unknown)
          (check! (str where ": an unregistered provider produced an assignment instead of failing: "
                       (pr-str (:entry outcome)))
                  (some? (:threw outcome)))
          (check! (str where ": the failure does not name the offending provider: " (:threw outcome))
                  (and (:threw outcome)
                       (str/includes? (:threw outcome) (str/trim provider))))))))

;; ── reach, asserted rather than hoped for ────────────────────────────────

(defn floor! [k min-count]
  (let [seen (get @reached k 0)]
    (when (< seen min-count)
      (fail! (str "generator reach: " k " was produced " seen " times, needed >= " min-count
                  ". A property that never reaches a state proves nothing about it.")))))

(floor! :registered-provider 4)
(floor! :shortcut-pairs (max 1 (quot runs 2)))
(floor! :unknown-draw (max 1 (quot runs 4)))
(floor! :case-variant 10)
(floor! :whitespace-variant 20)
(floor! :agent-name-as-provider 10)
(floor! :assign-known 5)
(floor! :assign-unknown 5)

(if (empty? @failures)
  (println (str "bl1053 provider routing: ALL PROPERTIES HELD (" runs " runs)"))
  (do (println (str "bl1053 provider routing: " (count @failures) " FAILURE(S):"))
      (doseq [f (take 20 @failures)] (println f))
      (when (> (count @failures) 20)
        (println (str "... and " (- (count @failures) 20) " more")))
      (System/exit 1)))
