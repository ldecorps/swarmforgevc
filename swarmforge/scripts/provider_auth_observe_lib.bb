;; provider_auth_observe_lib.bb — auth-class pane-observation state machine
;; (BL-536).
;;
;; Problem: an AuthenticationError left a standing role idle while handoffd
;; stayed healthy (SRE incident 2026-07-19) - liveness was never the
;; question, the role's process was alive, just wedged behind a credential
;; error. agent_runtime_lib/classify-provider-error already maps this text
;; to :auth and provider_compat_lib/provider-auth-error-text? already
;; recognizes it, but nothing observed pane scrollback for it and healed.
;;
;; Pure: no filesystem, no tmux, no clock side effects (mirrors
;; loop_detect_lib.bb's shape). State is a plain map the caller persists
;; per role (an in-memory atom in handoffd is fine, same rationale as
;; loop-detect-states there - a restart losing an in-flight episode's
;; attempt count is safe; the next auth-class observation just starts a
;; fresh episode).
;;
;; Load:
;;   (load-file ... "provider_auth_observe_lib.bb")
;;   provider-auth-observe-lib/decide-auth-observation ...

(ns provider-auth-observe-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_compat_lib.bb")))

(def default-config
  {;; BL-536: swarmforge.conf `config auth_respawn_max_attempts <n>` -
   ;; respawns allowed per failure episode before an observe tick stops
   ;; acting and alerts instead. Matches the ticket's suggested default.
   :max-attempts 3})

(defn classify-auth-signal
  "Classify recent pane text for auth-class failure. Returns :auth | :healthy."
  [pane-text]
  (if (provider-compat-lib/provider-auth-error-text? pane-text) :auth :healthy))

(defn next-episode-state
  "Advance per-role episode state from a classification. State shape:
   {:attempts int :alerted bool}. A :healthy observation ends the episode
   ('an observation with no auth-class text ends the episode and resets
   the count') - an :auth observation leaves prior state untouched (the
   attempt/alert bookkeeping is advanced by decide-episode-action below,
   not here)."
  [prev signal]
  (let [prev (or prev {:attempts 0 :alerted false})]
    (case signal
      :healthy {:attempts 0 :alerted false}
      :auth prev)))

(defn decide-episode-action
  "Pure decision for one :auth-signal observation given the role's prior
   episode state and the configured attempt cap. Returns {:state :action},
   action one of :respawn | :alert | :none.
   - Below the cap: respawn and count the attempt (invariant 1: bounded
     respawns per episode across all observe ticks).
   - At/above the cap, not yet alerted this episode: alert once.
   - At/above the cap, already alerted: quiet - no further respawns, no
     duplicate alerts (invariant 2)."
  [state max-attempts]
  (cond
    (< (:attempts state) max-attempts)
    {:state (update state :attempts inc) :action :respawn}

    (not (:alerted state))
    {:state (assoc state :alerted true) :action :alert}

    :else
    {:state state :action :none}))

(defn decide-auth-observation
  "Pure decision for one observe tick: classifies pane-text, advances the
   role's episode state, and decides the action. Returns
   {:signal :state :action}."
  ([prev-state pane-text] (decide-auth-observation prev-state pane-text default-config))
  ([prev-state pane-text config]
   (let [cfg (merge default-config config)
         signal (classify-auth-signal pane-text)
         next (next-episode-state prev-state signal)]
     (if (= signal :healthy)
       {:signal signal :state next :action :none}
       (let [{:keys [state action]} (decide-episode-action next (:max-attempts cfg))]
         {:signal signal :state state :action action})))))

(defn parse-max-attempts
  "Pure: `config auth_respawn_max_attempts <n>` from conf text. Honors a
   POSITIVE integer only - absent, malformed, zero, and negative all
   degrade to the default (mirrors mono-router-lib/parse-note-actionable-
   after-ms's degrade-to-default failure mode)."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config auth_respawn_max_attempts"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) n (:max-attempts default-config))))

(defn format-alert-reason
  [role max-attempts]
  (str "Auth-class failure persists on role '" role "' after " max-attempts
       " respawn attempt" (if (= 1 max-attempts) "" "s") " (BL-536). "
       "Provider credentials likely need manual attention."))

(defn format-telegram-alert
  "Standing Operator-topic text (telegram-reply-outbox.jsonl threadId OPERATOR)."
  [role max-attempts]
  (str "⚠️ Auth-class failure on `" role "` persisted after " max-attempts
       " respawn attempts - provider credentials likely need manual attention."))

(defn format-email-subject
  [role]
  (str "SwarmForge: persistent auth failure (" role ") - respawn cap reached"))
