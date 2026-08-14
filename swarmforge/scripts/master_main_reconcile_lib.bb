;; BL-891: after QA lands an approved commit by pushing origin/main, nothing
;; ever advances the LOCAL `main` ref that the master checkout (coordinator +
;; specifier) actually reads - see this ticket's own notes for the incident
;; (a specifier scope decision written against a 20-minutes-stale local
;; `main`, corrected only by luck). push_sweep_lib.bb (BL-356) already solved
;; the mirror-image problem (local commits never reaching origin); this lib
;; is the pure decision/state logic for the opposite direction (origin's
;; landed commits never reaching local `main`) - own small copy, not required
;; from push_sweep_lib.bb, per this project's established small-duplication-
;; over-cross-file-coupling convention (see push_sweep_lib.bb's own header
;; comment).
;;
;; Deliberately NO push-retry-style bounded backoff/alarm state machine here:
;; unlike a flaky network push, reconciling a clean tree is a single local
;; git op with no transient-failure mode worth retrying on a backoff curve -
;; the only two outcomes are "reconciled" or "blocked" (dirty tree / merge
;; conflict), and a blocked tick stays blocked until something ELSE (a human,
;; or the next landing) changes the picture. State here exists ONLY to avoid
;; re-sending the identical surfaced note every single poll cycle while a
;; block persists - cleared, and free to surface again, the moment the
;; blocking REASON changes (same self-healing shape push_sweep_lib.bb's own
;; sweep! uses for its alarm flags).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "master_main_reconcile_lib.bb")))
;; and referred to as master-main-reconcile-lib/foo.
(ns master-main-reconcile-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(defn- read-json [path]
  (when (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true) (catch Exception _ nil))))

;; ── durable state (daemon-dir-scoped, mirrors push_sweep_lib.bb's own
;;    state-file posture) ──────────────────────────────────────────────────

(defn state-path [daemon-dir]
  (str (fs/path daemon-dir "master-main-reconcile-state.json")))

(defn read-state [daemon-dir]
  (or (read-json (state-path daemon-dir)) {}))

(defn write-state! [daemon-dir state]
  (spit (state-path daemon-dir) (json/generate-string state)))

;; ── pure: what should this sweep do, given local main's ahead/behind counts
;;    against origin/main, and whether the master checkout's working tree is
;;    clean? `behind` zero means origin has nothing local doesn't already
;;    have - up to date regardless of ahead (this sweep only ever merges
;;    origin FORWARD into local, it never pushes - that direction is already
;;    push_sweep_lib.bb's job). A dirty tree blocks reconciliation entirely,
;;    however far behind local is - the ticket's own constraint: "never
;;    touch the master checkout while its working tree is dirty". ──────────
(defn reconcile-decision
  [{:keys [behind clean?]}]
  (let [behind (or behind 0)]
    (cond
      (zero? behind) :up-to-date
      (not clean?) :dirty-blocked
      :else :should-reconcile)))

;; ── observable drift report (scenario 04: "the drift check runs" and
;;    reports both counts) - trivial, but gives the ahead/behind numbers
;;    their own directly-testable unit distinct from the full sweep. ───────
(defn drift-report
  [{:keys [ahead behind]}]
  {:ahead (or ahead 0) :behind (or behind 0)})

;; ── surfaced-note message + draft (≤80 chars, per handoff-protocol.md's
;;    `note` message field limit) - reused by both blocked outcomes so the
;;    coordinator gets ONE recognizable shape regardless of which reason
;;    fired. ───────────────────────────────────────────────────────────────
(defn surface-message
  [{:keys [behind reason]}]
  (case reason
    :dirty (str "BL-891: master main " behind " behind origin, dirty tree - not reconciled")
    :conflict (str "BL-891: master main reconcile hit a merge conflict, aborted, " behind " behind")))

(defn surface-draft-lines
  "A `note` to the coordinator only - reconciling the master checkout's own
   `main` ref is not a role's judgement call, it is the surfaced FACT that
   this sweep could not act; the coordinator is the constitution's own
   'unblock stalls' role (Article 1.1)."
  [msg]
  ["type: note"
   "to: coordinator"
   "priority: 00"
   (str "message: " msg)])

;; ── adapter-injected orchestration ───────────────────────────────────────
;; adapters: {:rev-counts! (fn [] -> {:ahead int :behind int}) - already
;;                          fetches origin/main as a side effect, same
;;                          posture as push_sweep_lib.bb's own :rev-counts!
;;           :clean?       (fn [] -> bool) - is the master checkout's
;;                          working tree clean right now?
;;           :merge!       (fn [] -> {:success bool :error str?}) - the
;;                          SOLE state-mutating call this lib ever makes.
;;                          Called ONLY when reconcile-decision says
;;                          :should-reconcile (behind>0 AND clean?). Must
;;                          never be a reset/rebase/stash/force-update -
;;                          that is the caller's (handoffd.bb's) contract,
;;                          not something this pure lib can enforce by
;;                          itself, but it is also the ONLY mutating
;;                          adapter offered, so there is nowhere else for
;;                          one to hide.
;;           :surface!     (fn [msg] -> nil) - sends the surfaced note
;;           :log!         (fn [& parts])}
;;
;; Self-healing across transitions, mirroring push_sweep_lib.bb's own
;; sweep!: reaching :up-to-date or a successful :should-reconcile always
;; clears persisted state, so a LATER, unrelated block always surfaces
;; fresh rather than being silently suppressed by a stale flag from a
;; resolved episode.
(defn sweep!
  [daemon-dir adapters]
  (let [state (read-state daemon-dir)
        counts ((:rev-counts! adapters))
        {:keys [ahead behind]} (drift-report counts)]
    ((:log! adapters) "master-main-reconcile" "drift" (str "ahead=" ahead " behind=" behind))
    (let [clean? (boolean ((:clean? adapters)))
          decision (reconcile-decision {:behind behind :clean? clean?})]
      (case decision
        :up-to-date
        (do
          ((:log! adapters) "master-main-reconcile" "up-to-date")
          (when (seq state) (write-state! daemon-dir {})))

        :dirty-blocked
        (do
          ((:log! adapters) "master-main-reconcile" "dirty-blocked")
          (if (= (:surfaced state) "dirty")
            nil
            (do
              ((:surface! adapters) (surface-message {:behind behind :reason :dirty}))
              (write-state! daemon-dir {:surfaced "dirty"}))))

        :should-reconcile
        (let [result ((:merge! adapters))]
          (if (:success result)
            (do
              ((:log! adapters) "master-main-reconcile" "reconciled")
              (write-state! daemon-dir {}))
            (do
              ((:log! adapters) "master-main-reconcile" "conflict" (str (:error result)))
              (if (= (:surfaced state) "conflict")
                nil
                (do
                  ((:surface! adapters) (surface-message {:behind behind :reason :conflict}))
                  (write-state! daemon-dir {:surfaced "conflict"}))))))))))
