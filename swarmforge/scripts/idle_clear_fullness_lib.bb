;; idle_clear_fullness_lib.bb — BL-1238: pure decision for whether the
;; agent-side NO_TASK idle-clear (ready_for_next_task.bb /
;; ready_for_next_batch.bb's respawn-self!) should actually fire.
;;
;; Locked human decisions (Cursor 2026-08-28): (1) idle-clear at NO_TASK only
;; when the role's context window is at least the configured threshold
;; full — do not pay for a reload when it is not needed. (2) When no
;; fullness reading can be obtained at all, DO NOT CLEAR — never fall back
;; to the old unconditional behaviour.
;;
;; Mirrors BL-141's own contract (extension/src/swarm/contextFullness.ts
;; resolveContextFullness) rather than inventing a second one: an exact
;; TELEMETRY reading wins when present; otherwise a labelled PROXY reading;
;; otherwise UNAVAILABLE. Both TELEMETRY and PROXY are honoured identically
;; by the decision itself (invariant 2) — :source exists only so a caller
;; can log/record which tier produced the number, never to change the
;; comparison.
;;
;; Pure/IO split (same shape as branch_claim_guard_lib.bb /
;; reference_freshness_lib.bb): this file has no file/tmux/process IO at
;; all. Reading the config threshold and the pane-history proxy is
;; idle_clear_fullness_cli.bb's job.

(ns idle-clear-fullness-lib)

(defn- clamp-percent [v]
  (max 0 (min 100 v)))

(defn resolve-fullness
  "{:percent num-or-nil :source :telemetry|:proxy|:unavailable}. telemetry-
   percent wins when present (not nil); else proxy-percent when present;
   else :unavailable with a nil percent — never a guessed 0 or 100."
  [{:keys [telemetry-percent proxy-percent]}]
  (cond
    (some? telemetry-percent) {:percent (clamp-percent telemetry-percent) :source :telemetry}
    (some? proxy-percent) {:percent (clamp-percent proxy-percent) :source :proxy}
    :else {:percent nil :source :unavailable}))

(defn should-idle-clear?
  "Pure: both declared invariants in one predicate. Opt-in is authoritative
   and first (unchanged BL-089 behaviour); fullness gates second and only
   when a reading (telemetry OR proxy, identically) is actually present at
   or above threshold-percent. An :unavailable reading (percent nil) can
   never satisfy >= and so never clears, by construction — not a special
   case bolted on."
  [{:keys [opt-in? fullness threshold-percent]}]
  (boolean
    (and opt-in?
         (some? (:percent fullness))
         (>= (:percent fullness) threshold-percent))))

(defn decide
  "The full decision plus the metadata a caller logs/records: whether to
   respawn, and which reading (:telemetry/:proxy/:unavailable) drove it."
  [{:keys [fullness] :as input}]
  {:respawn? (should-idle-clear? input)
   :source (:source fullness)
   :percent (:percent fullness)})
