;; babysitterd_sweep_lib.bb — pure finding-assembly core for babysitterd (BL-611).
;;
;; Ports the deterministic health-sweep prototype
;; (.swarmforge/operator/babysitter_check.sh, untracked) into a pure,
;; unit-tested core: given a snapshot struct (tmux sessions/panes, process
;; liveness, file listings/ages, pane captures, meminfo, pause state) it
;; returns the findings list and the swarm-starved streak to persist. No
;; tmux, no fs, no clock read happens in this file — the gathering layer
;; (babysitter_check.bb) is a thin I/O wrapper that builds the snapshot and
;; persists the returned streak/dedup state.
;;
;; Every finding is {:key :severity ("CRIT"|"WARN") :message}.

(ns babysitterd-sweep-lib
  (:require [clojure.string :as str]))

;; ── check 1: live-session-per-role ──────────────────────────────────────────

(defn check-live-session
  [{:keys [role pane-exists? has-claude-process?]}]
  (cond
    (not pane-exists?)
    {:key (str "pane-" role) :severity "CRIT"
     :message (str "swarmforge-" role ": tmux session missing")}

    (not has-claude-process?)
    {:key (str "proc-" role) :severity "CRIT"
     :message (str "swarmforge-" role ": pane alive but NO claude process under it (half-launch/exit)")}

    :else nil))

;; ── check 2: remote-control-flag ─────────────────────────────────────────────

(defn check-remote-control
  [{:keys [role pane-exists? has-claude-process? has-remote-control?]}]
  (when (and pane-exists? has-claude-process? (not has-remote-control?))
    {:key (str "rc-" role) :severity "WARN"
     :message (str "swarmforge-" role ": claude alive but --remote-control flag missing (RC degraded)")}))

;; ── check 3: handoffd-supervisor-fresh ───────────────────────────────────────

(defn check-handoffd-supervisor-fresh
  [{:keys [handoffd-alive? supervisor-alive? log-age-secs max-age-secs]}]
  (cond
    (not handoffd-alive?)
    {:key "handoffd" :severity "CRIT"
     :message "handoffd.bb not running — no deliveries/chases (restart via start_handoff_daemon.sh only)"}

    (not supervisor-alive?)
    {:key "handoffd-sup" :severity "WARN"
     :message "handoffd_supervisor.bb not running"}

    (and log-age-secs max-age-secs (> log-age-secs max-age-secs))
    {:key "heartbeat" :severity "CRIT"
     :message (str "handoffd.log silent " log-age-secs "s (> " max-age-secs "s) — daemon may be futex-hung: process alive, ensure dead")}

    :else nil))

;; ── check 4: dead-letter-nonempty ────────────────────────────────────────────

(defn check-dead-letter
  [{:keys [failed-count]}]
  (when (pos? (long (or failed-count 0)))
    {:key "failed-box" :severity "CRIT"
     :message (str failed-count " parcel(s) in handoffs/failed/ dead-letter box")}))

;; ── check 5: stuck-in-process ─────────────────────────────────────────────────

(defn check-stuck-in-process
  [stuck-parcels]
  (vec
   (for [{:keys [name age-min]} (or stuck-parcels [])]
     {:key (str "stuck-" (subs (str name) 0 (min 40 (count (str name)))))
      :severity "WARN"
      :message (str "in_process parcel older than 30m (age=" age-min "m): " name)})))

;; ── check 6: menu-blocked-pane ────────────────────────────────────────────────

(defn check-menu-blocked
  [{:keys [role menu-blocked?]}]
  (when menu-blocked?
    {:key (str "menu-" role) :severity "CRIT"
     :message (str "swarmforge-" role ": pane appears BLOCKED on an interactive menu/dialog — needs a human choice, do not auto-pick")}))

;; ── check 7: busy-but-frozen ──────────────────────────────────────────────────

(defn check-busy-frozen
  [{:keys [role busy? hash-history]}]
  (let [history (or hash-history [])]
    (when (and busy?
               (>= (count history) 3)
               (apply = (take-last 3 history)))
      {:key (str "frozen-" role) :severity "WARN"
       :message (str "swarmforge-" role ": busy footer shown but pane content unchanged for 3 sweeps — possible hung turn")})))

;; ── check 8: memory-floor ─────────────────────────────────────────────────────

(defn check-memory-floor
  [{:keys [available-mb floor-mb]}]
  (when (< (long (or available-mb 0)) (long (or floor-mb 0)))
    {:key "memory" :severity "CRIT"
     :message (str "only " available-mb "MB available (< " floor-mb "MB) — check for orphaned vitest/stryker workers (free -h FIRST)")}))

;; ── check 11: claim-progress risk scan (BL-528 salvage) ──────────────────────

(def ^:private claim-risk-crit-severities #{"critical" "halt-imminent"})

(defn check-claim-risk
  [{:keys [role severity reclaims hint] :as assessment}]
  (when assessment
    {:key (str "claim-risk-" role)
     :severity (if (contains? claim-risk-crit-severities severity) "CRIT" "WARN")
     :message (str role " " severity " reclaims=" reclaims (when hint (str " — " hint)))}))

;; ── check 9: rotate-not-honored ───────────────────────────────────────────────

(defn check-rotate-not-honored
  [{:keys [note-name note-target note-age-min grace-min
           note-mtime-ms active-role-file-mtime-ms active-role paused?]
    :as note}]
  (when (and note (not paused?)
             note-age-min grace-min (> (long note-age-min) (long grace-min))
             note-mtime-ms active-role-file-mtime-ms
             (> (long note-mtime-ms) (long active-role-file-mtime-ms))
             note-target active-role
             (not= (str/lower-case (str note-target)) (str/lower-case (str active-role))))
    {:key (str "rotate-unhonored-" note-target) :severity "CRIT"
     :message (str "rotate note completed >" grace-min "m ago (" note-name
                   ") but mono-router-active-role is still '" active-role
                   "' not '" note-target
                   "' — instruction was delivered and marked done, never executed; re-issue or run rotate_to_role.sh " note-target)}))

;; ── check 10: swarm-starved (streak-gated, abandoned/aged-aware) ────────────

(defn- fresh-pending? [{:keys [abandoned? age-min]} pending-max-age-min]
  (and (not abandoned?) age-min (<= (long age-min) (long pending-max-age-min))))

(defn- motion-in-process? [{:keys [owner-busy?]}]
  (boolean owner-busy?))

(def default-pending-max-age-min 120)

(defn check-swarm-starved
  [{:keys [active-ticket-count any-pane-busy? paused? prev-streak
           pending-claims in-process-claims pending-max-age-min]
    :or {pending-max-age-min default-pending-max-age-min}}]
  (let [has-motion-pending? (some #(fresh-pending? % pending-max-age-min) (or pending-claims []))
        has-motion-inprocess? (some motion-in-process? (or in-process-claims []))
        idle-this-sweep? (and (not paused?)
                              (pos? (long (or active-ticket-count 0)))
                              (not any-pane-busy?)
                              (not has-motion-pending?)
                              (not has-motion-inprocess?))
        new-streak (if idle-this-sweep? (inc (long (or prev-streak 0))) 0)]
    {:finding (when (>= new-streak 2)
                {:key "swarm-starved" :severity "CRIT"
                 :message (str "swarm appears STARVED: " active-ticket-count
                               " active ticket(s) but zero pending/in-process parcels and every pane idle for "
                               new-streak " consecutive sweeps — likely a lost instruction or stale assignment; check the newest completed notes and ticket assigned_to fields")})
     :new-streak new-streak}))

;; ── 6d-09: busy detection survives 80-column truncation ─────────────────────
;; A truncated pane capture can lose the "esc to interrupt" hint text before
;; the spinner glyph/elapsed-time pattern that precedes it in the footer, so
;; busy detection must not depend on that literal substring alone.

(def ^:private spinner-glyph-re #"[✻✽✶✳]")
(def ^:private elapsed-time-re #"\(?\d+s\b|\bfor\s+\d+m?\d*s\b")

(defn classify-pane-busy?
  [pane-text]
  (let [text (str pane-text)]
    (boolean
     (or (str/includes? text "esc to interrupt")
         (and (re-find spinner-glyph-re text)
              (re-find elapsed-time-re text))))))

;; ── check 12 / 17: resume-overdue (planned pause failed to auto-resume) ─────

(def default-resume-overdue-threshold-ms (* 15 60 1000))

(defn check-resume-overdue
  [{:keys [paused? now-ms until-ms overdue-threshold-ms]
    :or {overdue-threshold-ms default-resume-overdue-threshold-ms}}]
  (when (and paused? now-ms until-ms
             (> (- (long now-ms) (long until-ms)) (long overdue-threshold-ms)))
    {:key "resume-overdue" :severity "CRIT"
     :message (str "pause untilMs expired " (quot (- (long now-ms) (long until-ms)) 60000)
                   "min ago but control-pause.json still active — auto-resume sweep failed, swarm sleeping past its window")}))

;; ── nudge eligibility (scenario 13) ──────────────────────────────────────────

(defn nudge-eligible?
  [{:keys [key severity]}]
  (boolean
   (or (= "CRIT" severity)
       (and (= "WARN" severity) (str/starts-with? (str key) "stuck-")))))

;; ── decide-nudges: pure dedup + cooldown decision (scenario 11) ─────────────

(def default-nudge-cooldown-ms (* 30 60 1000))

(defn decide-nudges
  "findings: seq of findings this sweep. opts: {:last-nudged-ms-by-key {} :now-ms :cooldown-ms}.
   Returns {:to-nudge [findings due now] :new-dedup-state {key -> now-ms for every nudged key}}."
  [findings {:keys [last-nudged-ms-by-key now-ms cooldown-ms]
             :or {last-nudged-ms-by-key {} cooldown-ms default-nudge-cooldown-ms}}]
  (let [eligible (filter nudge-eligible? findings)
        due? (fn [{:keys [key]}]
               (let [last-ms (get last-nudged-ms-by-key key)]
                 (or (nil? last-ms)
                     (>= (- (long now-ms) (long last-ms)) (long cooldown-ms)))))
        to-nudge (vec (filter due? eligible))]
    {:to-nudge to-nudge
     :new-dedup-state (reduce (fn [m {:keys [key]}] (assoc m key now-ms))
                               last-nudged-ms-by-key
                               to-nudge)}))

;; ── formatting ────────────────────────────────────────────────────────────

(defn format-finding-line
  [{:keys [key severity message]} ts]
  (str ts " " severity " [" key "] " message))

(defn format-nudge-message
  [findings]
  (str "babysitter health sweep: "
       (str/join " ; " (map :message findings))
       " — investigate and take the minimal correct action (or tell the human)."))

;; ── assemble-findings: the single pure entry point ──────────────────────────
;; snapshot keys: :roles (seq of per-role maps for checks 1/2/6/7),
;; :handoffd-alive? :handoffd-supervisor-alive? :handoffd-log-age-secs
;; :handoffd-max-age-secs, :failed-count, :stuck-parcels, :available-mb
;; :mem-floor-mb, :claim-risks (pre-scanned assessments), :rotate-note (or nil),
;; :pause {:active? :until-ms}, :now-ms, :active-ticket-count :any-pane-busy?
;; :prev-streak :pending-claims :in-process-claims :overdue-threshold-ms.

(defn assemble-findings
  [{:keys [roles handoffd-alive? handoffd-supervisor-alive? handoffd-log-age-secs
           handoffd-max-age-secs failed-count stuck-parcels available-mb mem-floor-mb
           claim-risks rotate-note pause now-ms active-ticket-count any-pane-busy?
           prev-streak pending-claims in-process-claims overdue-threshold-ms
           pending-max-age-min]}]
  (let [paused? (boolean (:active? pause))
        role-findings (mapcat (fn [role]
                                 (remove nil?
                                         [(check-live-session role)
                                          (check-remote-control role)
                                          (check-menu-blocked role)
                                          (check-busy-frozen role)]))
                               (or roles []))
        handoffd-finding (check-handoffd-supervisor-fresh
                          {:handoffd-alive? handoffd-alive?
                           :supervisor-alive? handoffd-supervisor-alive?
                           :log-age-secs handoffd-log-age-secs
                           :max-age-secs handoffd-max-age-secs})
        dead-letter-finding (check-dead-letter {:failed-count failed-count})
        stuck-findings (check-stuck-in-process stuck-parcels)
        memory-finding (check-memory-floor {:available-mb available-mb :floor-mb mem-floor-mb})
        claim-findings (map check-claim-risk (or claim-risks []))
        rotate-finding (check-rotate-not-honored (when rotate-note (assoc rotate-note :paused? paused?)))
        {starved-finding :finding new-streak :new-streak}
        (check-swarm-starved {:active-ticket-count active-ticket-count
                              :any-pane-busy? any-pane-busy?
                              :paused? paused?
                              :prev-streak prev-streak
                              :pending-claims pending-claims
                              :in-process-claims in-process-claims
                              :pending-max-age-min pending-max-age-min})
        resume-overdue-finding (check-resume-overdue {:paused? paused?
                                                      :now-ms now-ms
                                                      :until-ms (:until-ms pause)
                                                      :overdue-threshold-ms overdue-threshold-ms})
        findings (vec (remove nil?
                              (concat role-findings
                                      [handoffd-finding dead-letter-finding]
                                      stuck-findings
                                      [memory-finding]
                                      claim-findings
                                      [rotate-finding starved-finding resume-overdue-finding])))]
    {:findings findings :new-streak new-streak}))
