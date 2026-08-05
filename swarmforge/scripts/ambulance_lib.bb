;; BL-655: ambulance mode, rung 2 of the escalation ladder (Article 3.2.4
;; expedite lane below, the Expeditor BL-567 above). The swarm keeps running -
;; every daemon, every alarm, every topic - and this ONE durable marker names
;; the single ticket whose parcels are allowed to move; everything else is
;; HELD in place, byte-identical, never delivered/dropped/quarantined/
;; abandoned/rewritten.
;;
;; Modeled directly on backlog_depth_lib.bb's BL-423 pause pair
;; (read-pause-state/pause-active?): an impure reader that degrades to "off"
;; on ANY read/parse/validation failure, plus a pure predicate over the
;; already-parsed value. That split is copied, not extended - this is a
;; separate marker/predicate, never folded into the pause gate.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "ambulance_lib.bb")))
;; and referred to as ambulance-lib/foo. Deliberately has NO load-file of its
;; own on handoff_lib.bb - handoff_lib.bb load-files THIS file, and a reverse
;; dependency would be circular. Callers that already have a parsed
;; {:headers :body} envelope (handoff-lib/parse-envelope's own shape) pass it
;; straight in; this file never parses raw handoff content itself.

(ns ambulance-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def marker-relpath
  [".swarmforge" "operator" "control-ambulance.json"])

(defn marker-path [project-root]
  (apply fs/path project-root marker-relpath))

(def ticket-id-pattern #"BL-\d+")

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn ticket-has-file?
  "True when some YAML file ANYWHERE under backlog/ (active/paused/done/hold,
   and any nested milestone subdir - fs/glob \"**.yaml\" matches at any
   depth, same idiom ticket_status_lib.bb already relies on) declares this
   exact id. A marker naming a ticket with no file anywhere would hold
   EVERYTHING forever - precisely the deadlock the operator ruled out - so
   the read side (read-ambulance-state below) treats that as mode OFF rather
   than trusting the marker.

   BL-813: fs/glob lists a path, then this fn slurps it - a file that moves
   or is deleted between those two steps (e.g. a ticket promoted active/ ->
   done/ mid-poll) threw FileNotFoundException and crashed the daemon. Each
   candidate's slurp+field-read is now its own try/catch: a vanished entry
   just doesn't match (`some` moves on to the next glob hit, or to false),
   never a crash."
  [project-root ticket-id]
  (let [backlog-dir (fs/path project-root "backlog")]
    (boolean
     (and (fs/exists? backlog-dir)
          (some (fn [path]
                  (try
                    (= ticket-id (read-yaml-field (slurp (str path)) "id"))
                    (catch Exception _ false)))
                (fs/glob backlog-dir "**.yaml"))))))

(defn- read-raw-marker
  "nil for a missing/unreadable/unparseable marker file - never a crash.
   Distinct from read-ambulance-state below: this is the RAW parsed JSON
   (before the ticket-has-file? fail-safe check), used internally by
   engage!/release! to decide idempotency without re-deriving the full
   decision."
  [project-root]
  (try
    (json/parse-string (slurp (str (marker-path project-root))) true)
    (catch Exception _ nil)))

(defn describe-status
  "The rich, human-facing status (ambulance_cli.bb status / a Telegram
   confirmation): the SAME degrade-to-off decision read-ambulance-state makes
   below, but keeps the raw marker fields (:engagedAtMs :by) and a
   human-readable :reason explaining why an engaged-looking marker still
   reads as off. Never throws - every branch is a plain value."
  [project-root]
  (let [raw (read-raw-marker project-root)
        ticket (:ticket raw)]
    (cond
      (not (map? raw))
      {:active false :reason "no marker file (or unreadable/unparseable)"}

      (not (:active raw))
      {:active false :reason "marker explicitly inactive"}

      (not (and (string? ticket) (re-matches ticket-id-pattern ticket)))
      {:active false :reason "marker names no valid BL-### ticket id"}

      (not (ticket-has-file? project-root ticket))
      {:active false :reason (str "ticket " ticket " has no YAML file under backlog/")}

      :else
      {:active true :ticket ticket :engagedAtMs (:engagedAtMs raw) :by (:by raw)})))

(defn read-ambulance-state
  "The impure fs-reading half every decision site (delivery, dequeue,
   rotation) calls FRESH at the moment of its own decision - never cached.
   {:active false} for every failure mode (absent/empty/unparseable marker,
   one naming no ticket id, or one naming a ticket with no YAML anywhere
   under backlog/); {:active true :ticket \"BL-...\"} only when the marker is
   genuinely well-formed and live."
  [project-root]
  (select-keys (describe-status project-root) [:active :ticket]))

(defn attributed-tickets
  "Every BL-### id mentioned in a parcel's task: header, message: header, or
   body - the parcel's FULL attribution set. Pure over an already-parsed
   {:headers :body} envelope (handoff-lib/parse-envelope's own shape)."
  [{:keys [headers body]}]
  (set (re-seq ticket-id-pattern
               (str/join " " (remove nil? [(get headers "task") (get headers "message") body])))))

(defn parcel-held?
  "The ONE hold predicate, read fresh at every decision site. False whenever
   ambulance-state is inactive. Attribution fails OPEN (deliberate, per
   spec): a parcel mentioning no ticket id at all always moves. A parcel is
   HELD only when its attribution set is non-empty AND excludes the
   ambulance ticket - a parcel naming BOTH the ambulance ticket and another
   one still moves (positive attribution to the ambulance ticket is present)."
  [ambulance-state envelope]
  (boolean
   (and (:active ambulance-state)
        (let [attributed (attributed-tickets envelope)]
          (and (seq attributed)
               (not (contains? attributed (:ticket ambulance-state))))))))

;; ── engage!/release!: the marker's only writers (ambulance_cli.bb, and the
;;    Telegram Control topic's own TS-side mirror of this exact shape) ──────

(defn engage!
  "Writes the marker naming ticket as the sole ambulance patient. IDEMPOTENT:
   if the marker already names this exact ticket and is active, the file is
   left byte-identical - no rewrite, no fresh engagedAtMs masking as a state
   change. who is a free-text attribution string (\"cli\", \"telegram\", ...)."
  [project-root ticket who]
  (let [raw (read-raw-marker project-root)]
    (if (and (:active raw) (= ticket (:ticket raw)))
      raw
      (let [marker {:active true :ticket ticket :engagedAtMs (System/currentTimeMillis) :by who}]
        (fs/create-dirs (fs/parent (marker-path project-root)))
        (spit (str (marker-path project-root)) (json/generate-string marker))
        marker))))

(defn release!
  "Clears the marker. IDEMPOTENT: if already inactive (marker absent, or an
   explicit active:false already on disk), the file is left byte-identical -
   a release with no mode set is a true no-op, never a spurious write."
  [project-root]
  (let [raw (read-raw-marker project-root)]
    (if (not (:active raw))
      (or raw {:active false})
      (let [marker {:active false}]
        (fs/create-dirs (fs/parent (marker-path project-root)))
        (spit (str (marker-path project-root)) (json/generate-string marker))
        marker))))
