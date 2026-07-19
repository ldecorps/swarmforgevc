#!/usr/bin/env bb

(load-file (str (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*)) ".." "operator_telegram_lib.bb")))

(require '[operator-telegram-lib :as sut]
         '[clojure.string :as str])

(def failures (atom []))

(defn assert= [label expected actual]
  (when-not (= expected actual)
    (swap! failures conj (str label "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-contains [label haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str label "\n  expected text containing: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(def status
  {:state "idle"
   :provider_state "available"
   :agents_running 7
   :pending_events 2
   :updated_at "2026-07-19T20:00:00Z"
   :tunnel {:state "running" :url "https://vscode.dev/tunnel/swarmforge/abc"}})

(def roles [{:role "coder" :status "working"}
            {:role "QA" :status "idle"}])

(assert= "allowlisted sender passes"
         true
         (sut/allowlisted? "12345" {:message {:from {:id 12345}}}))

(assert= "non-allowlisted sender is refused"
         false
         (sut/allowlisted? "12345" {:message {:from {:id 999}}}))

(let [{:keys [reply control-action next-state]} (sut/handle-command {:text "/status"
                                                                     :status status
                                                                     :roles roles
                                                                     :state {}})]
  (assert= "/status is read-only" nil control-action)
  (assert-contains "/status includes health" reply "state: idle")
  (assert-contains "/status includes roles" reply "coder=working")
  (assert-contains "/status includes tunnel URL" reply "https://vscode.dev/tunnel/swarmforge/abc")
  (assert= "/status does not alter state" {} next-state))

(doseq [[cmd expected] [["/tunnel" "running"]
                       ["/help" "/ensure"]]]
  (let [{:keys [reply control-action]} (sut/handle-command {:text cmd :status status :roles roles :state {}})]
    (assert= (str cmd " is read-only") nil control-action)
    (assert-contains (str cmd " returns its own information") reply expected)))

(let [{:keys [reply control-action next-state]} (sut/handle-command {:text "/ensure" :status status :roles roles :state {}})]
  (assert= "/ensure prompt does not run control action" nil control-action)
  (assert-contains "/ensure asks for confirmation" reply "confirm")
  (assert= "/ensure records pending confirmation" {:ensure-pending? true} next-state))

(let [{:keys [reply control-action next-state]} (sut/handle-command {:text "confirm"
                                                                     :status status
                                                                     :roles roles
                                                                     :state {:ensure-pending? true}})]
  (assert= "confirm runs ensure once" :ensure control-action)
  (assert-contains "confirm reports the action" reply "Running ./swarm ensure")
  (assert= "confirm clears pending state and marks running" {:ensure-pending? false :ensure-running? true} next-state))

(let [{:keys [reply control-action next-state]} (sut/handle-command {:text "/ensure"
                                                                     :status status
                                                                     :roles roles
                                                                     :state {:ensure-running? true}})]
  (assert= "busy /ensure starts no second run" nil control-action)
  (assert-contains "busy /ensure replies busy" reply "already running")
  (assert= "busy /ensure preserves running state" {:ensure-running? true} next-state))

(let [{:keys [reply control-action log]} (sut/handle-update {:allowed-user-id "12345"
                                                            :update {:message {:chat {:id 9}
                                                                               :from {:id 999}
                                                                               :text "/status"}}
                                                            :status status
                                                            :roles roles
                                                            :state {}})]
  (assert= "refused sender gets no reply" nil reply)
  (assert= "refused sender runs no action" nil control-action)
  (assert= "refused sender is logged" :ignored-non-allowlisted (:event log)))

(assert= "401 maps to auth-lost"
         {:state :auth_lost :attempts 1 :backoff_until_ms 1500}
         (sut/next-auth-state {:status 401}
                              {:attempts 0}
                              {:now-ms 500 :backoff-base-ms 1000 :backoff-max-ms 60000}))

(assert= "successful Telegram response clears auth loss"
         {:state :ok :attempts 0 :backoff_until_ms nil}
         (sut/next-auth-state {:status 200}
                              {:attempts 3 :backoff_until_ms 9000}
                              {:now-ms 500 :backoff-base-ms 1000 :backoff-max-ms 60000}))

(let [req (sut/send-message-request "TOKEN" 123 "hello")]
  (assert-contains "sendMessage URL carries bot token" (:url req) "botTOKEN/sendMessage")
  (assert= "sendMessage body targets chat and text"
           {:chat_id 123 :text "hello" :disable_web_page_preview true}
           (:form-params req)))

(if (empty? @failures)
  (println "ALL PASS: operator_telegram_lib.bb")
  (do
    (doseq [failure @failures] (println "FAIL:" failure))
    (System/exit 1)))
