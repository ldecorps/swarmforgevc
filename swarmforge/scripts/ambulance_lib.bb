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

(defn- dir-has-ticket-id?
  "True when some YAML file ANYWHERE under dir (fs/glob \"**.yaml\" matches
   at any nested depth, same idiom ticket_status_lib.bb already relies on)
   declares this exact id. Shared by ticket-has-file? (searches the whole
   backlog/ tree) and ticket-location below (searches one subdir at a time).

   BL-813: fs/glob lists a path, then this fn slurps it - a file that moves
   or is deleted between those two steps (e.g. a ticket promoted active/ ->
   done/ mid-poll) threw FileNotFoundException and crashed the daemon. Each
   candidate's slurp+field-read is its own try/catch: a vanished entry just
   doesn't match (`some` moves on to the next glob hit, or to false), never
   a crash."
  [dir ticket-id]
  (boolean
   (and (fs/exists? dir)
        (some (fn [path]
                (try
                  (= ticket-id (read-yaml-field (slurp (str path)) "id"))
                  (catch Exception _ false)))
              (fs/glob dir "**.yaml")))))

(defn ticket-has-file?
  "True when some YAML file ANYWHERE under backlog/ (active/paused/done/hold,
   and any nested milestone subdir) declares this exact id. A marker naming a
   ticket with no file anywhere would hold EVERYTHING forever - precisely the
   deadlock the operator ruled out - so the read side (read-ambulance-state
   below) treats that as mode OFF rather than trusting the marker."
  [project-root ticket-id]
  (dir-has-ticket-id? (fs/path project-root "backlog") ticket-id))

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

;; ── engage!/release!: the marker's only writers (ambulance_cli.bb, the
;;    Telegram Control topic's own TS-side mirror of this exact shape, and -
;;    release! only, BL-679 - handoffd.bb's auto-exit sweep below) ─────────

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

;; ── BL-679 piece 3: automatic exit ──────────────────────────────────────
;; A sweep on the daemon's existing cadence (handoffd.bb's
;; ambulance-auto-exit-sweep!, a thin wrapper around auto-exit! below)
;; releases the mode BY ITSELF once the ambulance ticket has left the
;; pipeline - never engages one (that stays a human-only act via
;; engage!/ambulance_cli.bb/the Telegram Control topic, untouched by this
;; slice). Exit is one-directional, per the ticket's own closing line.

(defn ticket-location
  "Where ticket-id's YAML currently sits under backlog/ - :active, :paused,
   :hold, :done (any nested milestone subdir under done/ counts, same
   at-any-depth glob ticket-has-file? already uses), or nil when no YAML
   names this id anywhere under backlog/ (vanished). A candidate file that
   moves or is deleted mid-check (e.g. promoted active/ -> done/ mid-poll)
   just doesn't match that subdir - same BL-813 per-candidate try/catch
   fail-open shape as ticket-has-file? above, never a crash."
  [project-root ticket-id]
  (let [has-in-subdir? (fn [subdir]
                          (dir-has-ticket-id? (fs/path project-root "backlog" subdir) ticket-id))]
    (cond
      (has-in-subdir? "done") :done
      (has-in-subdir? "hold") :hold
      (has-in-subdir? "active") :active
      (has-in-subdir? "paused") :paused
      :else nil)))

(defn decide-auto-exit
  "Pure: given the ambulance ticket's backlog location (:active :paused :hold
   :done, or nil for vanished), decides whether the auto-exit sweep releases
   the mode this cycle, and which case fired:
   - :done -> release, case :delivered - the ticket reached backlog/done/.
   - :hold, or nil (vanished from backlog/ entirely) -> release, case
     :abandoned - the deadlock case the operator ruled out (invariant 2): a
     mode that keeps holding everything for a ticket nobody is working is
     strictly worse than no mode, and must not starve silently.
   - anything else (:active - a bounce is normal ambulance lineage, still in
     flight; :paused, defensively - never observed in practice since the
     promotion freeze keeps a NEW ticket out of paused/, but an ambulance
     ticket found there should not silently release either) -> hold, case
     :in-flight."
  [location]
  (cond
    (= location :done) {:release? true :case :delivered}
    (or (= location :hold) (nil? location)) {:release? true :case :abandoned}
    :else {:release? false :case :in-flight}))

(defn auto-exit!
  "The full BL-679 piece-3 decision+action against a REAL project root: reads
   the marker fresh (never cached), and when it claims an active ride for a
   syntactically valid ticket id, classifies that ticket's current backlog
   location and releases when decide-auto-exit says so. Returns nil when
   there was nothing to do (mode not engaged at all, or the ticket is still
   in flight and the mode correctly holds); returns {:ticket :case} exactly
   when a release just happened, for the caller (handoffd.bb's thin
   ambulance-auto-exit-sweep! wrapper) to announce.

   Deliberately reads the RAW marker (read-raw-marker), never read-ambulance-
   state/describe-status: those already degrade a vanished-ticket marker to
   {:active false} on their own (BL-655's read-side deadlock fail-safe,
   ticket-has-file?) - correct for every OTHER hold/delivery/rotation site,
   which only need to stop treating a dead marker as engaged, but WRONG here.
   This function's entire job is to actively RELEASE and ANNOUNCE the
   vanished case (decide-auto-exit's :abandoned, invariant 2) rather than let
   it go silently unreleased-on-disk forever behind that same read-side
   degrade - the one difference between 'reads as off' and 'is actually off,
   loudly, on record'.

   Deliberately the one function BL-654's declared-invariant property tests
   exercise directly - every other duty a real sweep needs (Telegram outbox
   write, daemon log) is genuinely impure IO better left to the thin
   wrapper, never folded in here."
  [project-root]
  (let [raw (read-raw-marker project-root)
        ticket (:ticket raw)]
    (when (and (:active raw) (string? ticket) (re-matches ticket-id-pattern ticket))
      (let [location (ticket-location project-root ticket)
            {:keys [release? case]} (decide-auto-exit location)]
        (when release?
          (release! project-root)
          {:ticket ticket :case case})))))

(defn auto-exit-announcement-text
  "The Telegram OPERATOR-topic text for an auto-exit release. case is
   :delivered or :abandoned (decide-auto-exit's own case keywords).
   :abandoned is deliberately LOUD (carries the same 'ESCALATE' marker
   format-alarm-text uses for its own loud tier) - this is the deadlock case
   the operator explicitly ruled out, and it must never read as a quiet,
   routine release. queued-expedited-defect-id, when non-nil, is named FIRST
   - ahead of the release line itself - per the ticket's ordering
   requirement: an expedited critical/high defect that queued (never
   promoted - the mode outranks Article 3.2.4 while engaged) mid-ride must
   be the most visible thing in the announcement, not buried after it."
  [{:keys [ticket queued-expedited-defect-id] case-kw :case}]
  (str (when queued-expedited-defect-id
         (str "⚠️ Expedited defect " queued-expedited-defect-id
              " queued during the ride and was never promoted - it is next. "))
       (case case-kw
         :delivered
         (str "Ambulance auto-released - " ticket
              " reached backlog/done/. Every held parcel resumes moving.")
         :abandoned
         (str "🚨 ESCALATE Ambulance auto-released - " ticket
              " left the pipeline for a human ruling (backlog/hold/ or vanished from backlog/ "
              "entirely) while the ride was still engaged. Holding everything for a ticket nobody "
              "is working is worse than no mode, so releasing now. Every held parcel resumes moving.")
         (str "Ambulance auto-released for " ticket "."))))
