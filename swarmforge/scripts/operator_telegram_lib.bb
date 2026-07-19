#!/usr/bin/env bb

(ns operator-telegram-lib
  (:require [clojure.string :as str]))

(def supported-commands ["/status" "/ensure" "/tunnel" "/help"])

(defn- user-id [update]
  (some-> update :message :from :id str))

(defn chat-id [update]
  (some-> update :message :chat :id))

(defn message-text [update]
  (some-> update :message :text str/trim))

(defn allowlisted? [allowed-user-id update]
  (and (not (str/blank? (str allowed-user-id)))
       (= (str allowed-user-id) (user-id update))))

(defn- command-token [text]
  (some-> text str/trim (str/split #"\s+") first str/lower-case (str/replace #"@.*$" "")))

(defn- role-summary [roles]
  (let [items (->> roles
                   (map (fn [role]
                          (str (or (:role role) (:name role) "unknown")
                               "="
                               (or (:status role) (:state role) "unknown"))))
                   (remove str/blank?))]
    (if (seq items) (str/join ", " items) "none reported")))

(defn format-status-summary [status roles]
  (let [tunnel (:tunnel status)]
    (str "Swarm status\n"
         "state: " (or (:state status) "unknown") "\n"
         "provider: " (or (:provider_state status) "unknown") "\n"
         "agents: " (or (:agents_running status) 0) "\n"
         "pending: " (or (:pending_events status) 0) "\n"
         "roles: " (role-summary roles) "\n"
         "tunnel: " (or (:url tunnel) "unavailable")
         " (" (or (:state tunnel) "unknown") ")\n"
         "freshness: " (or (:updated_at status) "unknown"))))

(defn format-tunnel-summary [status]
  (let [tunnel (:tunnel status)]
    (str "Tunnel " (or (:state tunnel) "unknown") ": " (or (:url tunnel) "unavailable"))))

(defn help-text []
  (str "Supported commands: " (str/join " " supported-commands) "\n"
       "/ensure asks for confirmation before running ./swarm ensure."))

(defn ensure-result-text [{:keys [exit tail]}]
  (str "./swarm ensure exit " (or exit 0)
       (when (seq (str/trim (or tail "")))
         (str "\n" (str/trim tail)))))

(defn handle-command [{:keys [text status roles state ensure-result]}]
  (let [cmd (command-token text)
        state (or state {})]
    (cond
      (= cmd "/status")
      {:reply (format-status-summary status roles) :next-state state}

      (= cmd "/tunnel")
      {:reply (format-tunnel-summary status) :next-state state}

      (= cmd "/help")
      {:reply (help-text) :next-state state}

      (and (:ensure-pending? state) (#{"confirm" "/confirm" "yes" "run"} cmd))
      {:reply (if ensure-result
                (ensure-result-text ensure-result)
                "Running ./swarm ensure. I will report the result here.")
       :control-action :ensure
       :next-state (assoc state :ensure-pending? false :ensure-running? true)}

      (= cmd "/ensure")
      (if (:ensure-running? state)
        {:reply "An ensure is already running; no second ensure was started."
         :next-state state}
        {:reply "Confirm /ensure by replying confirm. Nothing has run yet."
         :next-state (assoc state :ensure-pending? true)})

      :else
      {:reply (help-text) :next-state state})))

(defn handle-update [{:keys [allowed-user-id update status roles state ensure-result]}]
  (if-not (allowlisted? allowed-user-id update)
    {:log {:event :ignored-non-allowlisted :user-id (user-id update)}
     :next-state (or state {})}
    (assoc (handle-command {:text (message-text update)
                            :status status
                            :roles roles
                            :state state
                            :ensure-result ensure-result})
           :chat-id (chat-id update))))

(defn next-auth-state [{:keys [status]} prev-state {:keys [now-ms backoff-base-ms backoff-max-ms]}]
  (if (= 401 status)
    (let [attempts (inc (long (or (:attempts prev-state) 0)))
          backoff (min (long (or backoff-max-ms 60000))
                       (* (long (or backoff-base-ms 1000))
                          (long (Math/pow 2 (dec attempts)))))]
      {:state :auth_lost
       :attempts attempts
       :backoff_until_ms (+ (long (or now-ms 0)) backoff)})
    {:state :ok :attempts 0 :backoff_until_ms nil}))

(defn send-message-request [token chat-id text]
  {:method :post
   :url (str "https://api.telegram.org/bot" token "/sendMessage")
   :form-params {:chat_id chat-id :text text :disable_web_page_preview true}})
