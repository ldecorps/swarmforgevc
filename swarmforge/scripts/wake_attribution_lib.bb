;; BL-870: wake attribution. Before this, handoffd.bb's chase sweep only
;; recorded the NEGATIVE case (chase-wake-skip-<reason> when a wake was
;; withheld) - a wake that actually landed injected text into a pane and
;; logged nothing about what motivated it. A false "new handoff mail" wake
;; with a genuinely empty mailbox recurred twice (2026-08-07, 2026-08-10)
;; and was undiagnosable both times for exactly that reason.
;;
;; This lib is the pure/near-pure half: build-attribution constructs the
;; record; motivating-handoff answers "what handoff (if any) is sitting in
;; the role's mailbox right now" by reading the real directory (the same
;; question the daemon's own false-wake incidents turned on - "was new/
;; and in_process/ really empty"). handoffd.bb owns the durable JSONL write
;; (mirrors chaser-telemetry-file/log-chaser-telemetry!'s own pure/impure
;; split) and calls both of these at each of its four wake sites (notify!,
;; notify-in-process-resume! via chase-poke-and-notify!, and the claim-idle
;; probe injector), wrapped in try/catch so a recording failure never blocks
;; the wake itself - attribution is observation only (invariant 2).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "wake_attribution_lib.bb")))
;; and referred to as wake-attribution-lib/foo.

(ns wake-attribution-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

;; ── the three sweeps the daemon's chase path currently runs, named exactly
;;    as the ticket's own acceptance scenarios name them ──────────────────

(def sweep-inbox-item "inbox-item")
(def sweep-stuck-in-process "stuck-in-process")
(def sweep-claim-idle-probe "claim-idle-probe")

(def outcome-landed "landed")
(def outcome-skipped "skipped")

(defn build-attribution
  "Pure. role/sweep/outcome are strings the caller already decided;
   handoff-id is the motivating handoff's filename, or nil when the
   role's mailbox held none - recorded explicitly as :handoffPresent?
   false rather than left to be inferred from a blank field, so 'no wake
   text reaches a pane without a corresponding record... or an explicit
   marker that there was none' holds for the absent case too. at-ms is
   the caller's own timestamp, never generated here, so this stays a pure
   function of its arguments (invariant 2: nothing here can vary the
   sweep's own wake/skip outcome)."
  [{:keys [role sweep handoff-id outcome at-ms skip-reason]}]
  (cond-> {:role role
           :sweep sweep
           :handoffId handoff-id
           :handoffPresent? (boolean handoff-id)
           :outcome outcome
           :atMs at-ms}
    (and (= outcome outcome-skipped) (not (str/blank? (str skip-reason))))
    (assoc :skipReason skip-reason)))

(defn motivating-handoff
  "First (filename-sorted) *.handoff file currently sitting in role-info's
   `dir-key` mailbox (:new or :in_process), or nil when none. Read fresh at
   wake-attribution time rather than threaded from the sweep's own earlier
   scan, so an attribution never claims a handoff the sweep saw a moment
   ago but that has already moved on - and so a genuinely empty mailbox is
   caught exactly as BL-870's own false wake was. Sorting by filename is
   deterministic and, given this project's <priority>_<timestamp>_<sequence>
   naming convention, also orders oldest/highest-priority first."
  [role-info dir-key]
  (let [dir (handoff-lib/mailbox-dir role-info dir-key)]
    (when (fs/exists? dir)
      (->> (fs/list-dir dir)
           (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
           (map fs/file-name)
           sort
           first))))
