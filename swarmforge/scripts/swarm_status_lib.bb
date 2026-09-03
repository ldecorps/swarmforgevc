;; swarm_status_lib.bb — pure formatting for `./swarm status`.
;;
;; No filesystem, no clock, no process. Callers inject now-ms, process
;; snapshots, handoff file contents, and tmux session rows.

(ns swarm-status-lib
  (:require [clojure.string :as str]))

(defn parse-envelope-headers
  "Parse leading key: value lines until a blank line."
  [content]
  (->> (str/split-lines (or content ""))
       (take-while #(not (str/blank? %)))
       (keep (fn [line]
               (when-let [[_ k v] (re-matches #"^([A-Za-z0-9_-]+):\s*(.*)$" line)]
                 [(str/lower-case k) v])))
       (into {})))

(defn handoff-ticket
  "Best-effort ticket / subject label from headers."
  [headers]
  (let [candidates [(get headers "task")
                    (get headers "ticket")
                    (get headers "subject")
                    (get headers "message")]]
    (some #(let [s (str/trim (str %))]
             (when-not (str/blank? s) s))
          candidates)))

(defn parse-instant-ms
  "Parse an ISO-8601 instant string to epoch millis; nil if unparseable."
  [s]
  (when (and s (not (str/blank? (str s))) (not= "?" (str s)))
    (try
      (.toEpochMilli (java.time.Instant/parse (str s)))
      (catch Exception _
        ;; Some writers emit >9 fractional digits; Instant allows up to 9.
        (try
          (let [trimmed (str/replace (str s) #"(\.\d{9})\d+(Z)$" "$1$2")]
            (.toEpochMilli (java.time.Instant/parse trimmed)))
          (catch Exception _ nil))))))

(defn format-ago-ms
  "Relative age for handoff lines: '5 mins ago', '1.5 hours ago', '2.3 days ago'."
  [age-ms]
  (let [age-ms (max 0 (long (or age-ms 0)))
        mins (/ age-ms 60000.0)
        hours (/ age-ms 3600000.0)
        days (/ age-ms 86400000.0)]
    (cond
      (< age-ms 60000) "just now"
      (< age-ms 3600000) (format "%d mins ago" (long (Math/floor mins)))
      (< age-ms 86400000) (format "%.1f hours ago" hours)
      :else (format "%.1f days ago" days))))

(defn summarize-handoff
  "Pure summary from handoff file content + optional mtime / now."
  [content {:keys [mtime-iso mtime-ms path now-ms]}]
  (let [h (parse-envelope-headers content)
        ticket (or (handoff-ticket h) "(no task)")
        ticket' (if (> (count ticket) 72)
                  (str (subs ticket 0 69) "...")
                  ticket)
        at (or (get h "created_at") mtime-iso "?")
        at-ms (or (parse-instant-ms (get h "created_at"))
                  (when (number? mtime-ms) (long mtime-ms)))
        ago (when (and now-ms at-ms)
              (format-ago-ms (- (long now-ms) (long at-ms))))]
    (cond-> {:from (or (get h "from") "?")
             :to (or (get h "to") "?")
             :type (or (get h "type") "?")
             :ticket ticket'
             :at at
             :path (str path)}
      ago (assoc :ago ago))))

(defn format-duration-ms
  "Human uptime from millisecond duration (non-negative)."
  [ms]
  (let [ms (max 0 (long (or ms 0)))
        total-sec (quot ms 1000)
        days (quot total-sec 86400)
        hours (quot (mod total-sec 86400) 3600)
        mins (quot (mod total-sec 3600) 60)
        secs (mod total-sec 60)]
    (cond
      (pos? days) (format "%dd %dh %dm" days hours mins)
      (pos? hours) (format "%dh %dm" hours mins)
      (pos? mins) (format "%dm %ds" mins secs)
      :else (format "%ds" secs))))

(defn uptime-from-started-ms
  [now-ms started-at-ms]
  (when (and now-ms started-at-ms (number? started-at-ms) (>= (long started-at-ms) 0))
    (format-duration-ms (- (long now-ms) (long started-at-ms)))))

(defn uptime-from-epoch-sec
  "tmux session_created is epoch seconds."
  [now-ms created-epoch-sec]
  (when (and now-ms created-epoch-sec)
    (format-duration-ms (- (long now-ms) (* (long created-epoch-sec) 1000)))))

(defn classify-component
  "alive? true/false/nil → :up :down :unknown"
  [alive?]
  (cond
    (true? alive?) :up
    (false? alive?) :down
    :else :unknown))

(defn agent-liveness-verdict
  "BL-1019: status agrees with babysitter's three-state discrimination —
   missing session → :down; process gather failed → :unknown (never :down);
   session present + agent child → :up; session present without agent → :down.
   Pane command (zsh/bash) is irrelevant — claude runs as a child."
  [{:keys [session-present? has-agent-process? process-gather-failed?]}]
  (cond
    (not session-present?) :down
    (true? process-gather-failed?) :unknown
    (true? has-agent-process?) :up
    :else :down))

(defn format-component-line
  [{:keys [name status uptime detail]}]
  (let [st (case status
             :up "UP"
             :down "DOWN"
             :dormant "DORMANT"
             :unknown "unknown"
             ;; BL-958: the tmux server is gone while role metadata is still
             ;; present — one control-plane row instead of per-role DOWN.
             :control-plane-missing "control-plane-missing"
             ;; BL-1199: an absent named tunnel is not a fault - never DOWN.
             :not-configured "NOT_CONFIGURED"
             "????")
        up (or uptime "-")
        det (when (and detail (not (str/blank? (str detail))))
              (str "  " detail))]
    (format "  %-10s %-28s uptime=%-12s%s" st (str name) up (or det ""))))

(defn- maybe-dormant
  [status dormant?]
  (if (and (= status :down) dormant?) :dormant status))

(defn- alive-status
  [alive?]
  (cond
    (true? alive?) :up
    (false? alive?) :down
    :else :unknown))

(defn agent-status-row
  "Merge role config with live liveness facts (BL-1019). Prefer the
   session/process triple when present; fall back to legacy :alive? for
   callers that have not yet adopted the triple."
  [{:keys [role session agent created-epoch-sec now-ms dormant?
           session-present? has-agent-process? process-gather-failed?
           alive?]}]
  (let [status (if (some? session-present?)
                 (maybe-dormant
                  (agent-liveness-verdict
                   {:session-present? session-present?
                    :has-agent-process? has-agent-process?
                    :process-gather-failed? process-gather-failed?})
                  dormant?)
                 (maybe-dormant (alive-status alive?) dormant?))
        uptime (when (= status :up)
                 (uptime-from-epoch-sec now-ms created-epoch-sec))]
    {:name (str role)
     :status status
     :uptime uptime
     :detail (str/join " "
                       (remove str/blank?
                               [(when session (str "session=" session))
                                (when agent (str "agent=" agent))]))}))

(defn daemon-status-row
  [{:keys [name alive? uptime detail]}]
  {:name (str name)
   :status (classify-component alive?)
   :uptime (when alive? uptime)
   :detail detail})

(defn format-handoff-line
  [{:keys [ago at from to ticket type]}]
  (format "  %-16s  %s → %s  [%s]  %s"
          (or ago at "?")
          (or from "?")
          (or to "?")
          (or type "?")
          (or ticket "(no task)")))

(def ^:private ask-escalation-state-glyph
  {:ok "ok" :warn-unconfigured "warn" :fault "FAULT"})

(defn ask-escalation-row
  "BL-1352: the ask-escalation row for the human status surface. The escalation
   used to report a transport it could not use only into status.json and the
   operator log, neither of which anyone read - so a question could sit
   undelivered for days with the surface showing nothing at all. This row is
   the smallest thing that makes it visible where a human already looks."
  [{:keys [state detail]}]
  {:label "ask escalation"
   :state (or state :unknown)
   :detail (or detail "")})

(defn- format-ask-escalation-line [{:keys [label state detail]}]
  (str "  " label ": "
       (get ask-escalation-state-glyph state (name (or state :unknown)))
       (when-not (str/blank? (str detail)) (str " — " detail))))

(defn render-status-report
  "Render the full human-readable status block."
  [{:keys [project-root agents daemons telegram handoffs generated-at ask-escalation]}]
  (str/join
   "\n"
   (concat
    [(str "SwarmForge status — " (or project-root "?"))
     (when generated-at (str "as of " generated-at))
     ""
     "Agents"]
    (if (seq agents)
      (map format-component-line agents)
      ["  (none)"])
    [""
     "Daemons"]
    (if (seq daemons)
      (map format-component-line daemons)
      ["  (none)"])
    [""
     "Ask escalation"]
    ;; BL-1352: always rendered, even with nothing to report - a row that
    ;; appears only when something is wrong is a row a human never learns to
    ;; look for.
    [(format-ask-escalation-line
      (ask-escalation-row (or ask-escalation
                              {:state :unknown
                               :detail "no escalation state reported by this tick"})))]
    [""
     "Telegram bridge"]
    (if (seq telegram)
      (map format-component-line telegram)
      ["  (none / not configured)"])
    [""
     "Recent handoffs"]
    (if (seq handoffs)
      (map format-handoff-line handoffs)
      ["  (none found)"])
    [""])))
