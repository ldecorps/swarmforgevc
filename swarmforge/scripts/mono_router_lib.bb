;; mono_router_lib.bb — pure topology rules for `config rotation router`.
;;
;; Intended standing shape (BL-518):
;;   - ONE resident pipeline pane (first non-coordinator role in roles.tsv)
;;   - coordinator (always standing infrastructure)
;;   - every other pipeline role is a dormant rotate target (launch script
;;     on disk only; no tmux session)
;;
;; No filesystem / tmux I/O here — callers inject conf text and role rows.

(ns mono-router-lib
  (:require [clojure.string :as str]))

(defn conf-rotation-router?
  "True when pack/conf text declares `config rotation router`."
  [conf-text]
  (boolean
   (when conf-text
     (re-find #"(?m)^(?:config\s+)?rotation\s+router\b"
              (str conf-text)))))

(defn parse-identity-map
  "Parse swarm-identity TSV (key\\tvalue lines) into a string map."
  [identity-text]
  (->> (str/split-lines (or identity-text ""))
       (remove str/blank?)
       (keep (fn [line]
               (let [[k v] (str/split line #"\t" 2)]
                 (when (and k v) [k v]))))
       (into {})))

(defn rotation-router-from-identity?
  "True when identity already records rotation=router."
  [identity-text]
  (= "router" (get (parse-identity-map identity-text) "rotation")))

(defn classify-role
  "Given ordered role names (roles.tsv order) and one role, return
   :resident | :coordinator | :dormant.
   Resident = first role that is not coordinator."
  [ordered-roles role]
  (let [roles (vec ordered-roles)
        resident (first (remove #(= "coordinator" %) roles))]
    (cond
      (= role "coordinator") :coordinator
      (= role resident) :resident
      :else :dormant)))

(defn should-have-standing-session?
  "Under rotation router, only resident + coordinator stand."
  [ordered-roles role]
  (contains? #{:resident :coordinator} (classify-role ordered-roles role)))

(defn topology-action
  "Pure decide for one role under mono-router.
   alive? = session currently exists.
   Returns :ok | :ensure-standing | :teardown-illicit | :dormant-ok."
  [ordered-roles role alive?]
  (let [standing? (should-have-standing-session? ordered-roles role)]
    (cond
      (and standing? alive?) :ok
      (and standing? (not alive?)) :ensure-standing
      (and (not standing?) alive?) :teardown-illicit
      :else :dormant-ok)))

(defn rotate-viable?
  "BL-537: pure - could rotate_to_role place work on this dormant target
   right now? Mirrors rotate-resident-to!'s two failure modes, in its
   precedence order (resident-first, then launch script). Callers own all
   IO (pane-alive?, fs/exists?) and pass in only the booleans."
  [{:keys [resident-alive? launch-script-present?]}]
  (cond
    (not resident-alive?)
    {:viable? false :reason "no live resident session to rotate from"}

    (not launch-script-present?)
    {:viable? false :reason "missing launch script for role"}

    :else
    {:viable? true}))

(defn rotate-gate-decision
  "BL-805: pure decide for the RESIDENT-INVOKED rotation entry only
   (rotate_to_role.bb -> handoff-lib/respawn-as!). The daemon's own
   rotate-resident-to! call (handoffd.bb chase) never routes through this -
   gating it would risk deadlocking chase-driven drain on the very parcel
   it is trying to clear (invariant: daemon rotation always fails open).
   blocking-file = the departing role's inbox/in_process/*.handoff path, or
   nil when that box holds no real parcel (missing, empty, or holding only
   claim-progress/nudge/chase sidecars - callers pass handoff-lib's already
   *.handoff-filtered result, so a sidecar alone never reaches here).
   Returns :proceed, :proceed-forced (blocked, but the force override is
   set), or :refuse (blocked, no override)."
  [{:keys [blocking-file force?]}]
  (cond
    (nil? blocking-file) :proceed
    force? :proceed-forced
    :else :refuse))

(defn summarize-topology
  "For reporting: count actions across roles with {:role :alive?}."
  [ordered-roles role-alive-rows]
  (let [actions (map (fn [{:keys [role alive?]}]
                       {:role role
                        :class (classify-role ordered-roles role)
                        :action (topology-action ordered-roles role (boolean alive?))})
                     role-alive-rows)]
    {:actions actions
     :illicit (filterv #(= :teardown-illicit (:action %)) actions)
     :missing-standing (filterv #(= :ensure-standing (:action %)) actions)}))

(defn dormant-mailbox-chase-action
  "How chase should poke a role that may be a mono-router dormant target.

   Incident 2026-07-19: wake-session remapped cleaner→resident while the
   resident was still identity=coder. Chase injected 'new handoff mail' into
   the coder pane; ready_for_next read coder's empty mailbox → NO_TASK, while
   cleaner/inbox/new held the real parcels. Coordinator could not promote the
   next ticket because BL-508 stayed active waiting on cleaner.

   Returns:
     :wake-own-session — role has its own standing pane; wake that session
     :wake-resident    — no own pane, but resident already IS this role
     :rotate           — no own pane, and resident is a different identity;
                         must respawn-as! before any wake
     :wake-own-session — also the degrade path when no resident pane exists"
  [{:keys [target-session-exists? resident-session-exists? active-role target-role]}]
  (cond
    target-session-exists? :wake-own-session
    (not resident-session-exists?) :wake-own-session
    (= (str active-role) (str target-role)) :wake-resident
    :else :rotate))

(defn resident-poke-target?
  "True when a chase poke for this role lands on the shared mono-router
   resident pane: :rotate/:wake-resident by definition, :wake-own-session
   only when the resolved wake session IS the resident session (the home
   role, whose roles.tsv session name doubles as the resident pane).
   Classic-pack roles resolve to their own standing panes and must never
   be throttled by the resident pane's busy state or wake budget."
  [{:keys [action wake-session resident-session]}]
  (boolean
   (or (contains? #{:rotate :wake-resident} action)
       (and (not (str/blank? (str resident-session)))
            (= (str wake-session) (str resident-session))))))

(defn chase-poke-plan
  "Pure gate for one chase poke (wake / in-process resume).

   Two pane regimes:
   - resident-target? false — the role's own standing pane (classic packs,
     or the mono-router degrade path when no resident pane exists). Only
     THAT pane's busy state gates the poke; the shared resident budget and
     the resident pane's busy/recent state are irrelevant (incident
     2026-07-23: a busy coder pane must not block chasing cleaner's own
     pane on a classic 7-pack).
   - resident-target? true — the shared rotating pane. Busy footer, recent
     churn, and the one-inject-per-sweep budget all gate.

   :resident-budget? tells the caller whether a PERFORMED poke consumes the
   per-sweep resident budget. Starvation regression guard (2026-07-23,
   architect starved behind specifier's refused broadcast rotate): the
   caller must only consume the budget when the wake/rotate actually lands,
   never merely for attempting one.

   Returns {:mode :skip|:wake|:rotate, :skip-reason :busy|:dedup|:recent,
            :resident-budget? bool}."
  [{:keys [action resident-target? target-pane-busy?
           resident-busy? resident-recently-active? resident-woken-this-sweep?]}]
  (if-not resident-target?
    (if target-pane-busy?
      {:mode :skip :skip-reason :busy :resident-budget? false}
      {:mode :wake :resident-budget? false})
    (cond
      resident-busy? {:mode :skip :skip-reason :busy :resident-budget? true}
      resident-woken-this-sweep? {:mode :skip :skip-reason :dedup :resident-budget? true}
      resident-recently-active? {:mode :skip :skip-reason :recent :resident-budget? true}
      (= action :rotate) {:mode :rotate :resident-budget? true}
      :else {:mode :wake :resident-budget? true})))

(defn resident-launch-role
  "Under mono-router the standing tmux session keeps the home role's session
   name (usually coder), but after rotate_to_role the pane runs a different
   role's launch script. `./swarm ensure` must restore THAT script, not always
   home — otherwise ensure mid-pipeline wipes cleaner/architect/… back to coder."
  [home-role active-role]
  (let [active (some-> active-role str str/trim not-empty)]
    (or active home-role)))

;; ── BL-648: relaunch boots the resident AS the recorded active role ────────
;; Distinct from resident-launch-role above (which `./swarm ensure` uses to
;; restore an ALREADY-alive resident's script - the pane exists, ensure only
;; decides which script belongs on it). This is the boot-time decision, made
;; before any pane exists at all, so it also validates the recorded value
;; against the actual role roster: a marker naming a role that no longer
;; exists must fall back to home LOUDLY rather than crash the launch
;; (BL-648 scenario 03), and only `rotation router` reads the marker at all -
;; every other rotation mode boots exactly as before, marker untouched
;; (BL-648 scenario 06).
(defn resolve-boot-role
  "Args (map): :home-role - this pack's resident/home role (roles.tsv row 1).
   :recorded-role - the RAW mono-router-active-role marker content, or
   nil/blank when the marker is missing - callers must not pre-default this
   to home themselves, or the :blank vs :unknown-role distinction is lost.
   :known-roles - every role name in this pack's roles.tsv (a coll or set).
   :rotation-mode - \"router\", \"sequential\", or nil/anything else.

   Returns {:role :fallback? :reason :recorded}. :reason is one of nil (a
   real recorded role was used), :not-router, :blank, :unknown-role."
  [{:keys [home-role recorded-role known-roles rotation-mode]}]
  (let [recorded (some-> recorded-role str str/trim not-empty)]
    (cond
      (not= rotation-mode "router")
      {:role home-role :fallback? false :reason :not-router :recorded recorded}

      (nil? recorded)
      {:role home-role :fallback? false :reason :blank :recorded recorded}

      (contains? (set known-roles) recorded)
      {:role recorded :fallback? false :reason nil :recorded recorded}

      :else
      {:role home-role :fallback? true :reason :unknown-role :recorded recorded})))

(defn should-send-stuck-escalation-email?
  "Whether handoffd should email the human for a stuck-escalation edge.
   Mono-router dormant roles keep roles.tsv session names with no standing
   pane — emailing \"specifier is stuck\" floods the human and cannot be
   fixed by attaching that session. Still record chase-escalations.json;
   skip the email when escalating a role with no live session. Clearing
   (escalated?=false) always proceeds so recovery can disarm state."
  [{:keys [escalated? session-exists?]}]
  (or (not escalated?) (boolean session-exists?)))

(def default-rotate-cooldown-ms 30000)

(defn actionable-mail?
  "True when a role holds in_process work, new git_handoff mail, a directed
   rule_proposal, or a note that has aged past the BL-576 threshold. Fresh
   notes never qualify — that broadcast-thrash protection is unchanged.
   rule_proposal is immediately actionable (like git_handoff): it is a
   directed Article 5.1 parcel, never a multi-role broadcast; excluding it
   left specifier mailboxes permanently non-rotatable (2026-08-03 starve)."
  [{:keys [in-process-count git-handoff-count rule-proposal-count aged-note-count]}]
  (or (pos? (or in-process-count 0))
      (pos? (or git-handoff-count 0))
      (pos? (or rule-proposal-count 0))
      (pos? (or aged-note-count 0))))

;; BL-636: handoff-protocol.md priority scale is two digits 00-99, lower
;; first. A missing/unparseable value must never jump the rotate queue, so
;; it ranks strictly worse than any valid priority.
(def missing-priority-rank 100)

(defn parse-priority-rank
  "Pure: a handoff `priority:` header value to an int 0-99. Absent, blank,
   and anything that is not exactly two digits degrade to
   missing-priority-rank (100) — never throw, never sort ahead of real mail."
  [s]
  (let [trimmed (some-> s str str/trim not-empty)]
    (if (and trimmed (re-matches #"[0-9][0-9]" trimmed))
      (parse-long trimmed)
      missing-priority-rank)))

(defn best-priority-rank
  "Lowest (best) priority rank among a coll of raw priority header strings.
   Empty coll -> missing-priority-rank."
  [priorities]
  (if (seq priorities)
    (apply min (map parse-priority-rank priorities))
    missing-priority-rank))

(defn preferred-rotate-target
  "Among mailbox score rows, the actionable role with the best (lowest)
   :best-priority; at equal priority, newest :newest-created-at wins (BL-636)
   UNLESS BL-651's starve override fires: when starve-after-ms is a number
   (not nil, not :off) and at least one row in the BEST priority band has
   waited (:oldest-actionable-waited-ms) at or past that threshold, the
   OLDEST such row wins instead — the override never reaches into a worse
   priority band (ticket constraint 4: age breaks ties, it never inverts
   priority). sort-by is stable, so newest-first survives inside each
   priority band when the override does not fire. Rows that omit
   :best-priority (legacy callers) rank as missing-priority-rank and
   therefore keep pure newest-first behaviour; omitting starve-after-ms
   (the arity-1 call every pre-BL-651 caller still makes) reproduces BL-636
   ordering byte-for-byte."
  [rows & [starve-after-ms]]
  (let [ordered (->> rows
                      (filter :actionable?)
                      (sort-by :newest-created-at)
                      reverse
                      (sort-by #(or (:best-priority %) missing-priority-rank)))]
    (when (seq ordered)
      (let [best-band (or (:best-priority (first ordered)) missing-priority-rank)
            band-rows (filter #(= best-band (or (:best-priority %) missing-priority-rank)) ordered)
            starved (when (number? starve-after-ms)
                      (filter #(and (:oldest-actionable-waited-ms %)
                                    (>= (:oldest-actionable-waited-ms %) starve-after-ms))
                              band-rows))]
        (:role
         (if (seq starved)
           (apply max-key #(or (:oldest-actionable-waited-ms %) 0) starved)
           (first ordered)))))))

;; ── BL-550: non-home resident strands after a merge-up note ────────────────
;; QA's merge-up note broadcasts to all 5 pipeline roles at once. On the full
;; 7-pack that's fine (each role is its own process); on mono-router there is
;; ONE resident that rotates through roles to consume each note and is left
;; stranded in whichever non-home role processed the LAST one. The next wake
;; (e.g. a fresh coder handoff) then runs ready_for_next.sh AS that stranded
;; role, gets NO_TASK on an empty mailbox, and idles - the real work sits
;; unseen until a coordinator manually chases it back home.

(def default-rotation-home
  "The role ready_for_next* rotates back to when a non-home role's mailbox
   goes empty. Pack-agnostic: read from `config rotation_home`, never
   hard-coded at any call site - a future pack with a different home role
   only has to set that one conf line."
  "coder")

(defn parse-rotation-home
  "Pure: `config rotation_home <role>` from conf text, or default-rotation-home
   when the line is absent/unparseable."
  [conf-text]
  (or (some-> (re-find #"(?m)^(?:config\s+)?rotation_home\s+(\S+)" (str conf-text))
              second)
      default-rotation-home))

(defn rotate-home?
  "True when the current role should rotate back to home instead of
   reporting NO_TASK: mono-router is active, this role is NOT home, and its
   mailbox (in_process + dequeueable new/) is empty. The home role itself
   never rotates to itself, and a role holding real work is never diverted.

   The coordinator is reserved infrastructure, never part of the rotation
   (BL-614) - it never rotates regardless of mailbox state, rotation mode,
   or home role, even in the degenerate case where home-role is somehow
   \"coordinator\"."
  [{:keys [rotation-router? role home-role mailbox-empty?]}]
  (boolean
   (and rotation-router?
        mailbox-empty?
        role
        (not= (str role) "coordinator")
        (not= (str role) (str home-role)))))

(defn should-rotate-resident?
  "Gate resident rotation during chase — avoid mid-turn thrash and burst rotates."
  [{:keys [active-role target-role resident-busy? last-rotate-at-ms now-ms cooldown-ms]}]
  (let [cooldown (or cooldown-ms default-rotate-cooldown-ms)]
    (cond
      resident-busy? :busy
      (and active-role target-role (= (str active-role) (str target-role))) :already-active
      (and last-rotate-at-ms (pos? last-rotate-at-ms)
           (< (- now-ms last-rotate-at-ms) cooldown)) :cooldown
      :else :rotate)))

;; ── BL-576: aged-note actionability ─────────────────────────────────────────
;; actionable-mail? deliberately excludes notes so a QA merge-up broadcast
;; cannot thrash the resident through five rotations in a row. But design
;; kickoffs, steering, and merge-up instructions all travel as `type: note`,
;; so a note sitting in a dormant role's mailbox was refused on every chase
;; sweep forever — work nobody would ever see. Age is what distinguishes the
;; two cases: a fresh note is broadcast noise the resident need not chase; a
;; note nobody has looked at for tens of minutes is unseen work.

(def default-note-actionable-after-ms
  "How long a `type: note` sits unclaimed in a dormant role's inbox/new
   before the chase sweep counts it as actionable. Tracked here as the
   single source of truth — swarmforge.conf documents this default as a
   COMMENTED line rather than duplicating the literal value, so the two
   cannot drift apart."
  1200000)

(defn parse-note-actionable-after-ms
  "Pure: `config note_actionable_after_ms <ms>` from conf text. Honors a
   POSITIVE integer only — absent, malformed, zero, and negative all degrade
   to the default. Unlike BL-216's max-depth there is no negative sentinel:
   a zero/negative threshold would make every note instantly actionable and
   reinstate exactly the broadcast thrash the rule exists to prevent."
  [conf-text]
  (let [n (some->> (str/split-lines (or conf-text ""))
                    (filter #(str/starts-with? % "config note_actionable_after_ms"))
                    first
                    (re-find #"-?\d+")
                    parse-long)]
    (if (and n (pos? n)) n default-note-actionable-after-ms)))

(defn- parse-instant-ms
  "Pure: an ISO-8601 instant string to epoch millis, or nil when absent,
   blank, or unparseable — never throws."
  [s]
  (try
    (some-> s str str/trim not-empty java.time.Instant/parse .toEpochMilli)
    (catch Exception _ nil)))

(defn note-aged?
  "Pure, injected clock: true when a note's age exceeds threshold-ms. Age
   source is the first PARSEABLE of enqueued_at, then created_at —
   enqueued_at leads because it answers 'how long has this sat in THIS
   mailbox' (a redelivered parcel is fresh here even when created long ago).
   File mtime is never consulted (worktree hot-sync touches files). Fails
   CLOSED: when neither header parses, the note is not aged — never rotate
   the resident on a guess."
  [{:keys [enqueued-at created-at now-ms threshold-ms]}]
  (let [age-source (or (parse-instant-ms enqueued-at) (parse-instant-ms created-at))]
    (boolean
     (and age-source
          (>= (- now-ms age-source) threshold-ms)))))

(defn suppress-dormant-note-delivery-wake?
  "BL-576 sub-slice: true only when the just-delivered parcel is a `note`
   AND the delivery's resolved chase action is :rotate (dormant recipient,
   live resident on a different identity). The aged-note chase above now
   guarantees eventual pickup, so this specific wasted wake — one that would
   only re-run ready_for_next as the WRONG identity and NO_TASK — is safe to
   drop. A role with its own pane, a resident already running that role, and
   the no-resident degrade path all keep waking exactly as today."
  [{:keys [parcel-type chase-action]}]
  (boolean
   (and (= "note" parcel-type)
        (= :rotate chase-action))))

;; ── BL-651: starvation-bounded rotate preference ────────────────────────────
;; preferred-rotate-target orders candidates by priority band then newest-
;; first (BL-636), but nothing weighed how LONG a role's oldest actionable
;; parcel had already waited — a queue that keeps receiving fresher mail at
;; the same priority (on this pack, normally home/coder) could outrank an
;; older dormant parcel for as long as the fresh mail kept arriving, with
;; nothing bounding the wait. rotation_starve_after_ms bounds that: INSIDE
;; the best priority band only (ticket constraint 4 — age never inverts
;; priority), a row whose oldest actionable parcel has waited at or past the
;; threshold wins over a fresher row in the same band, oldest-first.

(def default-rotation-starve-after-ms
  "How long a role's oldest actionable parcel may wait before its age begins
   to outrank a fresher same-priority parcel elsewhere. 10 minutes —
   deliberately below flow-watchdog-lib/default-warn-ms (15 minutes) so a
   dormant queue drains before the human is ever alarmed about it (the
   ticket's own Shape requirement). Tracked here as the single source of
   truth, mirroring default-note-actionable-after-ms — swarmforge.conf
   documents this default as a COMMENTED line rather than duplicating the
   literal value, so the two cannot drift apart."
  600000)

(defn parse-rotation-starve-after-ms
  "Pure: `config rotation_starve_after_ms <ms-or-off>` from conf text. The
   literal `off` disables the age input entirely — preferred-rotate-target
   then reproduces BL-636 ordering byte-for-byte (a pure additive override,
   never a rewrite of the existing ordering). A positive integer sets the
   threshold in ms. Absent, blank, zero, negative, and anything else
   unparseable all degrade to the default — never throw, never silently
   disable the starve check on a typo (mirrors
   parse-note-actionable-after-ms's degrade-to-default failure mode)."
  [conf-text]
  (if-let [line (some (fn [l] (when (str/starts-with? l "config rotation_starve_after_ms") l))
                       (str/split-lines (or conf-text "")))]
    (let [value (str/trim (subs line (count "config rotation_starve_after_ms")))]
      (if (= "off" value)
        :off
        (let [n (some->> (re-find #"-?\d+" value) parse-long)]
          (if (and n (pos? n)) n default-rotation-starve-after-ms))))
    default-rotation-starve-after-ms))

(defn oldest-actionable-waited-ms
  "Pure: among a coll of {:enqueued-at :created-at} age sources (one per
   actionable parcel in a role's mailbox), the wait in ms (from now-ms) of
   the OLDEST parcel — the same enqueued_at-else-created_at, never-file-
   mtime rule as note-aged?/parse-instant-ms, so a worktree hot-sync
   touching the file can never reset a parcel's wait. nil when the coll is
   empty or no parcel in it has a parseable age source — fails closed, an
   unknown age can never win a starve comparison in preferred-rotate-target
   (a nil :oldest-actionable-waited-ms is filtered out there, never
   defaulted to zero or infinity)."
  [age-sources now-ms]
  (some->> (seq age-sources)
           (keep (fn [{:keys [enqueued-at created-at]}]
                   (or (parse-instant-ms enqueued-at) (parse-instant-ms created-at))))
           seq
           (apply min)
           (- now-ms)))
