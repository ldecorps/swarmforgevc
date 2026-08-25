#!/usr/bin/env bb

(ns operator-telegram
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "operator_telegram_lib.bb")))
(require '[operator-telegram-lib :as telegram-lib])

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_telegram.bb <ensure|run|poll-once|stop> <project-root>"))
  (System/exit 1))

(def command (or (first *command-line-args*) (usage)))
(def project-root (or (second *command-line-args*) (usage)))
(def script-path (str (fs/canonicalize *file*)))
(def op-dir (fs/path project-root ".swarmforge" "operator"))
(def status-file (fs/path op-dir "telegram-console.status.json"))
(def pid-file (fs/path op-dir "telegram-console.pid"))
(def stop-file (fs/path op-dir "telegram-console.stop"))
(def log-file (fs/path op-dir "telegram-console.log"))
(def state-file (fs/path op-dir "telegram-console.state.json"))
(def roles-file (fs/path project-root ".swarmforge" "roles.tsv"))
(def operator-status-file (fs/path op-dir "status.json"))

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (str path ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true})))

(defn write-json! [path value]
  (atomic-spit! path (str (json/generate-string value) "\n")))

(defn log! [& parts]
  (fs/create-dirs op-dir)
  (spit (str log-file) (str (now-iso) " " (str/join " " parts) "\n") :append true))

(defn write-status! [m]
  (write-json! status-file (assoc m :updated_at (now-iso))))

(defn read-json [path default]
  (if (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true)
         (catch Exception _ default))
    default))

(defn pid-alive? [pid]
  (try
    (when pid
      (let [handle (java.lang.ProcessHandle/of (long pid))]
        (and (.isPresent handle) (.isAlive (.get handle)))))
    (catch Exception _ false)))

(defn configured? []
  (and (not (str/blank? (System/getenv "OPERATOR_TELEGRAM_BOT_TOKEN")))
       (not (str/blank? (System/getenv "OPERATOR_TELEGRAM_ALLOWED_USER_ID")))))

(defn disabled? []
  (or (= "1" (System/getenv "SWARMFORGE_SKIP_TELEGRAM"))
      (not (configured?))))

(defn read-roles []
  (if-not (fs/exists? roles-file)
    []
    (->> (str/split-lines (slurp (str roles-file)))
         (map #(str/split % #"\t"))
         (map (fn [[role status]] {:role role :status status}))
         vec)))

(defn run-ensure! []
  (if-let [fake (System/getenv "OPERATOR_TELEGRAM_FAKE_ENSURE_RESULT")]
    (do
      (when-let [count-file (System/getenv "OPERATOR_TELEGRAM_ENSURE_COUNT_FILE")]
        (spit count-file "1\n" :append true))
      (json/parse-string fake true))
    (let [{:keys [exit out err]} (process/sh {:continue true :dir project-root} "bash" "./swarm" "ensure")
          combined (str (or out "") (when (seq err) (str "\n" err)))
          lines (str/split-lines combined)
          tail (str/join "\n" (take-last 8 lines))]
      {:exit exit :tail tail})))

(defn send-message! [token chat-id text]
  (if-let [outbox (System/getenv "OPERATOR_TELEGRAM_SEND_OUTBOX")]
    (spit outbox (str (json/generate-string {:chat_id chat-id :text text}) "\n") :append true)
    (let [{:keys [url form-params]} (telegram-lib/send-message-request token chat-id text)]
      (process/sh {:continue true}
                  "curl" "-fsS" "-X" "POST"
                  "-d" (str "chat_id=" (:chat_id form-params))
                  "-d" (str "text=" (:text form-params))
                  "-d" "disable_web_page_preview=true"
                  url))))

(defn parse-http-status [s]
  (try (Long/parseLong (str/trim (or s "")))
       (catch Exception _ nil)))

(defn curl-json-with-status [args]
  (let [{:keys [exit out err]} (apply process/sh {:continue true} args)
        lines (str/split-lines (or out ""))
        status (parse-http-status (last lines))
        body (str/join "\n" (butlast lines))]
    (if (zero? (long (or exit 0)))
      {:status status
       :body (try (json/parse-string body true)
                  (catch Exception e
                    {:ok false :description (str "invalid JSON: " (.getMessage e))}))}
      {:status status :error (str/trim (or err "curl failed"))})))

(defn get-updates! [token offset]
  (let [url (str "https://api.telegram.org/bot" token "/getUpdates")
        args (cond-> ["curl" "-sS" "-w" "\n%{http_code}" "-G"
                      "-d" "timeout=25"
                      "-d" "allowed_updates=[\"message\"]"
                      url]
               offset (conj "-d" (str "offset=" offset)))
        {:keys [status body error]} (curl-json-with-status args)]
    (cond
      error {:status status :error error}
      (= 401 status) {:status 401}
      (not= 200 status) {:status status :error (or (:description body) "Telegram getUpdates failed")}
      (false? (:ok body)) {:status status :error (or (:description body) "Telegram getUpdates returned ok=false")}
      :else {:status status :updates (vec (or (:result body) []))})))

(defn updates-from-source! [token state]
  (if-let [raw (System/getenv "OPERATOR_TELEGRAM_FAKE_UPDATE")]
    {:status 200 :updates [(json/parse-string raw true)] :fake? true}
    (get-updates! token (:offset state))))

(defn next-offset [state updates]
  (let [ids (seq (keep :update_id updates))
        max-id (when ids (apply max ids))]
    (if max-id
      (assoc state :offset (inc (long max-id)))
      state)))

(defn process-update! [token allowed-id status roles state update]
  (let [result (telegram-lib/handle-update {:allowed-user-id allowed-id
                                            :update update
                                            :status status
                                            :roles roles
                                            :state state})
        next-state (:next-state result)
        persisted-state
        (if (= :ensure (:control-action result))
          (let [ensure-result (run-ensure!)
                final-result (telegram-lib/handle-command {:text "confirm"
                                                           :status status
                                                           :roles roles
                                                           :state (assoc state :ensure-pending? true)
                                                           :ensure-result ensure-result})]
            (when (:chat-id result)
              (send-message! token (:chat-id result) (:reply final-result)))
            (assoc (:next-state final-result) :ensure-running? false))
          next-state)]
    (when-let [event (some-> result :log :event name)]
      (log! event (str (:user-id (:log result)))))
    (when (and (:reply result) (:chat-id result) (not (:control-action result)))
      (send-message! token (:chat-id result) (:reply result)))
    persisted-state))

(defn poll-once! []
  (let [token (System/getenv "OPERATOR_TELEGRAM_BOT_TOKEN")
        allowed-id (System/getenv "OPERATOR_TELEGRAM_ALLOWED_USER_ID")
        operator-status (read-json operator-status-file {})
        roles (read-roles)
        state (read-json state-file {})
        fake-auth? (= "1" (System/getenv "OPERATOR_TELEGRAM_FAKE_AUTH_LOST"))]
    (cond
      fake-auth?
      (let [next-state (telegram-lib/next-auth-state {:status 401} state
                                                     {:now-ms (now-ms)
                                                      :backoff-base-ms 1000
                                                      :backoff-max-ms 60000})]
        (write-status! next-state)
        (write-json! state-file next-state)
        (log! "auth-lost")
        :auth-lost)

      :else
      (let [{:keys [status updates error]} (updates-from-source! token state)]
        (cond
          (= 401 status)
          (let [next-state (telegram-lib/next-auth-state {:status 401} state
                                                         {:now-ms (now-ms)
                                                          :backoff-base-ms 1000
                                                          :backoff-max-ms 60000})]
            (write-status! next-state)
            (write-json! state-file next-state)
            (log! "auth-lost")
            :auth-lost)

          error
          (do
            (log! "get-updates-error" (str status) error)
            :telegram-error)

          (seq updates)
          (let [next-state (next-offset
                            (reduce (fn [s update]
                                      (process-update! token allowed-id operator-status roles s update))
                                    state
                                    updates)
                            updates)]
            (write-json! state-file next-state)
            :processed)

          :else
          (do
            (write-json! state-file (next-offset state updates))
            :idle))))))

(defn run-loop! []
  (fs/create-dirs op-dir)
  (write-json! pid-file (.pid (java.lang.ProcessHandle/current)))
  (write-status! {:state :ok :last_poll_at (now-iso)})
  (while (not (fs/exists? stop-file))
    (if (= "1" (System/getenv "OPERATOR_TELEGRAM_FAKE_POLL"))
      (do
        (write-status! {:state :ok :last_poll_at (now-iso)})
        (Thread/sleep 1000))
      (do
        (poll-once!)
        (write-status! {:state :ok :last_poll_at (now-iso)})
        (Thread/sleep 25000))))
  (write-status! {:state :stopped}))

(defn stop! []
  (fs/create-dirs op-dir)
  (atomic-spit! stop-file "stop\n")
  (when-let [pid (read-json pid-file nil)]
    (when (pid-alive? pid)
      (try (.destroy (.get (java.lang.ProcessHandle/of (long pid)))) (catch Exception _ nil))
      (Thread/sleep 100)
      (when (pid-alive? pid)
        (try (.destroyForcibly (.get (java.lang.ProcessHandle/of (long pid)))) (catch Exception _ nil)))))
  (fs/delete-if-exists pid-file)
  (write-status! {:state :stopped}))

(defn ensure! []
  (fs/create-dirs op-dir)
  (cond
    (disabled?)
    (do (write-status! {:state :disabled}) :disabled)

    (let [status (read-json status-file {})
          backoff-until (:backoff_until_ms status)]
      (and (= "auth_lost" (str (:state status)))
           backoff-until
           (< (now-ms) (long backoff-until))))
    (do (log! "auth-lost-backoff") :auth-lost-backoff)

    (pid-alive? (read-json pid-file nil))
    (do (write-status! {:state :ok :last_poll_at (now-iso)}) :already-running)

    :else
    (do
      (fs/delete-if-exists stop-file)
      (let [proc (process/process {:out (str log-file) :err (str log-file)
                                   :extra-env {"OPERATOR_TELEGRAM_BOT_TOKEN" (System/getenv "OPERATOR_TELEGRAM_BOT_TOKEN")
                                               "OPERATOR_TELEGRAM_ALLOWED_USER_ID" (System/getenv "OPERATOR_TELEGRAM_ALLOWED_USER_ID")
                                               "OPERATOR_TELEGRAM_FAKE_POLL" (System/getenv "OPERATOR_TELEGRAM_FAKE_POLL")
                                               "OPERATOR_TELEGRAM_FAKE_UPDATE" (System/getenv "OPERATOR_TELEGRAM_FAKE_UPDATE")
                                               "OPERATOR_TELEGRAM_FAKE_AUTH_LOST" (System/getenv "OPERATOR_TELEGRAM_FAKE_AUTH_LOST")}}
                                  "bb" script-path "run" project-root)
            pid (.pid (:proc proc))]
        (write-json! pid-file pid)
        (write-status! {:state :ok :last_poll_at (now-iso)})
        :started))))

(case command
  "ensure" (ensure!)
  "run" (run-loop!)
  "poll-once" (println (name (poll-once!)))
  "stop" (stop!)
  (usage))
