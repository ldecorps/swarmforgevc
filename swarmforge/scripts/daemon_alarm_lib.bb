;; BL-144: daemon-death alarm decision/rendering logic, kept pure and
;; reachable without live tmux/process/network (constitution testability
;; boundary) - only the thin adapters handoffd_supervisor.bb injects here
;; touch the filesystem, a real clock, or the network.
(ns daemon-alarm-lib
  (:require [clojure.string :as str]))

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
   the network (mirrors extension/src/notify/resendClient.ts's PostFn)."
  [api-key {:keys [to from subject text]}]
  (let [http (requiring-resolve 'babashka.http-client/post)
        json-generate (requiring-resolve 'cheshire.core/generate-string)]
    (try
      (let [res (http "https://api.resend.com/emails"
                       {:headers {"Authorization" (str "Bearer " api-key)
                                  "Content-Type" "application/json"}
                        :body (json-generate {:from from :to [to] :subject subject :text text})
                        :throw false})]
        {:success (<= 200 (:status res) 299) :status (:status res)})
      (catch Exception e
        {:success false :error (.getMessage e)}))))

(defn send-alarm-email!
  "Sends the alarm email, or reports why it could not: email is off (like
   BL-073's own pattern) until both a recipient and an API key are configured."
  ([api-key to from subject text] (send-alarm-email! api-key to from subject text default-post!))
  ([api-key to from subject text post-fn!]
   (if (or (str/blank? to) (str/blank? api-key))
     {:success false :error "email not configured (missing notify_email_to or RESEND_API_KEY)"}
     (post-fn! api-key {:to to :from from :subject subject :text text}))))

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
