;; BL-144: daemon-death alarm decision/rendering logic, kept pure and
;; reachable without live tmux/process/network (constitution testability
;; boundary) - only the thin adapters handoffd_supervisor.bb injects here
;; touch the filesystem, a real clock, or the network.
(ns daemon-alarm-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(defn parse-conf
  "Parses `config <key> <value>` lines from swarmforge.conf content into a
   plain key->value string map. Blank/comment/unrelated lines are ignored."
  [content]
  (into {}
        (for [line (str/split-lines (or content ""))
              :let [line (str/trim line)]
              :when (str/starts-with? line "config ")
              :let [[_ k v] (re-matches #"config\s+(\S+)\s+(.*)" line)]
              :when k]
          [k (str/trim v)])))

(defn format-failure-log
  "Renders the daemon-death failure report as plain text: death timestamp,
   reason, prior restart history/last incident, a per-role inbox/outbox
   snapshot at time of death, and the daemon's own trailing log lines."
  [{:keys [died-at reason log-tail restart-history last-incident role-counts]}]
  (str/join
   "\n"
   (concat
    ["SwarmForge daemon failure report"
     (str "died_at: " died-at)
     (str "reason: " (name reason))
     (str "restart_history: " (pr-str restart-history))
     (str "last_incident: " (pr-str last-incident))
     ""
     "per-role inbox/outbox snapshot at time of death:"]
    (for [{:keys [role inbox-new outbox]} role-counts]
      (str "  " role ": inbox/new=" inbox-new " outbox=" outbox))
    [""
     "last daemon log lines:"]
    log-tail)))

(defn build-alarm-email
  "Plain-text alarm email content: names the failure log path and the
   recovery command per BL-144's acceptance (daemon-death-alarm-02)."
  [{:keys [failure-log-path ensure-command]}]
  {:subject "SwarmForge: daemon died, swarm halted"
   :text (str "The handoffd daemon died. No auto-restart was attempted - "
              "the swarm has been stopped so a human can look at it.\n\n"
              "Failure log: " failure-log-path "\n"
              "After fixing the daemon, run: " ensure-command "\n")})

(defn default-post!
  "Real Resend POST, isolated behind an injectable seam so tests never touch
   the network (mirrors extension/src/notify/resendClient.ts's PostFn).
   BL-260: an optional :html key is included in the JSON body when present -
   Resend sends a multipart/alternative email (html + text parts) itself
   when both fields are given, so no MIME boundary handling is needed here."
  [api-key {:keys [to from subject text html]}]
  (let [http (requiring-resolve 'babashka.http-client/post)
        json-generate (requiring-resolve 'cheshire.core/generate-string)
        body (cond-> {:from from :to [to] :subject subject :text text}
               html (assoc :html html))]
    (try
      (let [res (http "https://api.resend.com/emails"
                       {:headers {"Authorization" (str "Bearer " api-key)
                                  "Content-Type" "application/json"}
                        :body (json-generate body)
                        :throw false})]
        {:success (<= 200 (:status res) 299) :status (:status res)})
      (catch Exception e
        {:success false :error (.getMessage e)}))))

(defn send-alarm-email!
  "Sends the alarm email, or reports why it could not. BL-215: the two off
   states are distinguished so a caller can tell them apart - no recipient
   is an intentional, quiet no-op (like BL-073's own pattern); a recipient
   present but no API key is a real misconfiguration the caller should
   escalate loudly via warn-missing-key-if-needed! below.

   BL-260: the 7-arg form threads an optional html body through to post-fn!
   (nil when the caller has none, e.g. BL-144's plain-text-only death alarm)
   - the existing 5-/6-arg forms are unchanged and still delegate with no
   html, so every pre-BL-260 caller/test keeps its exact prior behavior."
  ([api-key to from subject text] (send-alarm-email! api-key to from subject text default-post!))
  ([api-key to from subject text post-fn!] (send-alarm-email! api-key to from subject text nil post-fn!))
  ([api-key to from subject text html post-fn!]
   (cond
     (str/blank? to)
     {:success false :reason :disabled :error "email not configured (notify_email_to unset)"}

     (str/blank? api-key)
     {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"}

     :else
     (post-fn! api-key (cond-> {:to to :from from :subject subject :text text}
                          html (assoc :html html))))))

;; BL-215: a recipient-configured-but-keyless daemon must warn loudly instead
;; of silently no-oping (the defect: send-alarm-email!'s old single failure
;; shape made "email intentionally off" and "real misconfiguration"
;; indistinguishable, and the supervisor caller just swallowed the result).
;; Lives in this shared library, not the caller, so BOTH the BL-144 alarm and
;; a future BL-214 briefing send get the warning for free through the same
;; send-configured-alarm-email!-shaped wrapper.

(defn warn-missing-key-if-needed!
  "Given a send-alarm-email! result, logs a loud one-time warning naming
   RESEND_API_KEY when :reason is :missing-api-key and no such warning has
   been logged yet (already-warned?! false) - never logs the key value
   itself (there is none to log: the whole point is that it's absent). A
   no-op for a quiet :disabled no-op, a real send attempt, or a repeat call
   once already warned (do not spam every poll/sweep)."
  [{:keys [reason]} {:keys [already-warned?! log-warning! mark-warned!]}]
  (when (and (= reason :missing-api-key) (not (already-warned?!)))
    (log-warning!
     (str "notify_email_to is configured but RESEND_API_KEY is missing from the daemon's "
          "environment - alarm/briefing email cannot send. Export RESEND_API_KEY in the "
          "daemon's launch environment."))
    (mark-warned!)))

;; BL-214: the one shared "read conf, send, warn if misconfigured" wrapper -
;; every caller (BL-144's alarm, BL-214's briefing sweep) was independently
;; re-deriving the exact same to/from/api-key-from-conf steps and either
;; wiring warn-missing-key-if-needed! or (easy to miss) forgetting to. One
;; function here means a new caller gets the loud warning by construction
;; instead of by remembering to copy it.
(defn send-configured-email!
  "Reads notify_email_to/notify_email_from from conf-file (parse-conf) and
   RESEND_API_KEY from the process env, sends via send-alarm-email!, then
   runs warn-missing-key-if-needed! with warn-adapters (shape:
   {:already-warned?! :log-warning! :mark-warned!}, typically a per-process
   atom so repeated calls across a long-lived daemon warn only once).

   BL-260: the 5-arg form threads an optional html body through; the
   existing 4-arg form (BL-144's death alarm) is unchanged, delegating with
   no html."
  ([conf-file subject text warn-adapters] (send-configured-email! conf-file subject text nil warn-adapters))
  ([conf-file subject text html warn-adapters]
   (let [conf (parse-conf (when (fs/exists? conf-file) (slurp (str conf-file))))
         to (get conf "notify_email_to")
         from (or (get conf "notify_email_from") "onboarding@resend.dev")
         api-key (System/getenv "RESEND_API_KEY")
         result (send-alarm-email! api-key to from subject text html default-post!)]
     (warn-missing-key-if-needed! result warn-adapters)
     result)))

(defn alarm-and-halt!
  "Orchestrates the whole daemon-death response through injected adapters -
   testable with fakes for every side effect (BL-144 non-behavioral gate: no
   real timers, no real process kills, no real network in unit tests). Robust
   to a messy death (nil/partial status, empty log tail, no role counts):
   every adapter call is given already-defaulted inputs."
  [{:keys [reason status now-iso! log-tail! role-counts! write-failure-log! send-email! halt-swarm! write-status!]}]
  (let [died-at (now-iso!)
        log-tail (or (log-tail!) [])
        role-counts (or (role-counts!) [])
        content (format-failure-log {:died-at died-at
                                      :reason reason
                                      :log-tail log-tail
                                      :restart-history (:restart_history status)
                                      :last-incident (:last_incident status)
                                      :role-counts role-counts})
        failure-log-path (write-failure-log! content)
        {:keys [subject text]} (build-alarm-email {:failure-log-path failure-log-path
                                                     :ensure-command "./swarm ensure"})
        email-result (send-email! subject text)]
    (halt-swarm!)
    (write-status! (assoc status
                          :state "halted"
                          :last_incident {:reason (name reason)
                                          :at died-at
                                          :detail "daemon died; alarm sent and swarm halted (no auto-restart)"}
                          :failure_log failure-log-path
                          :alarm_email (:success email-result)))
    {:failure-log-path failure-log-path :email-result email-result}))
