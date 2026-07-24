#!/usr/bin/env bb
;; BL-607: the role-facing ASK leg. A pipeline role (specifier first; the
;; mechanism itself is role-generic) raises a clarifying question into ITS
;; OWN Telegram topic instead of the shared agent-questions topic
;; operator_ask.bb's --thread SUP-### asks always use. Reuses BL-483's
;; option normalization (operator-lib/ask-options) and appends to the SAME
;; reply-outbox operator_ask.bb already writes - never a second, parallel
;; outbox - marking the entry "roleQuestion": role (instead of
;; "agentQuestion": true) as the routing signal
;; telegramFrontDeskBotCore.ts's relayOneRecord uses to retarget delivery
;; to that role's own topic (deliverRoleQuestion) rather than the shared
;; one (deliverAgentQuestion).
;;
;; ONE pending question PER ROLE (not one globally - operator_ask.bb's own
;; awaiting-answer.json is a SEPARATE, unrelated single-pending guard for
;; the Operator's SUP-thread ask): a per-role marker file at
;; .swarmforge/operator/role-awaiting/<role>.json refuses a second ask for
;; the SAME role while the first is still pending, but never blocks a
;; DIFFERENT role from asking concurrently.
;;
;; This CLI never resolves a Telegram topic id itself (that lookup - role
;; -> topic id via role-topic-map.json - happens entirely on the TS side,
;; same "bb owns state, TS owns Telegram" split as every other ask/reply
;; CLI in this directory).
;;
;; Usage: role_ask.bb <project-root> --role <role> --question <q> [--options '["a","b"]']

(ns role-ask
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "operator_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: role_ask.bb <project-root> --role <role> --question <q> [--options '[\"a\",\"b\"]']"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 1 *command-line-args*)))
(when (or (str/blank? (:role opts)) (str/blank? (:question opts))) (usage))

(def role (:role opts))
(def state-dir (fs/path project-root ".swarmforge"))
(def op-dir (fs/path state-dir "operator"))
(def reply-outbox-file (fs/path op-dir "telegram-reply-outbox.jsonl"))
(def awaiting-file (fs/path op-dir "role-awaiting" (str role ".json")))

;; Mirrors telegramFrontDeskBotCore.ts's own ROLE_ASK_THREAD_PREFIX exactly
;; - the synthetic threadId under which the ask-message mapping
;; (recordAskMessage/readAskMessage/resolveAskOptions, all keyed by an
;; opaque threadId string) is reused for a role question, never a second
;; storage schema. Colon-free by construction (role names never contain
;; one) so it round-trips through composeAskButtons' "ask:<threadId>:<idx>"
;; callback_data and its ASK_CALLBACK_DATA_PATTERN `[^:]+` capture intact.
(defn ask-thread-id [role]
  (str "role-ask-" role))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn append-to-outbox! [thread-id text extra]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file)
        (str (json/generate-string (merge {"threadId" thread-id "text" text} extra)) "\n")
        :append true))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn parse-options
  "Same malformed-input-degrades-to-nil posture as operator_ask.bb's own
   parse-options - never crashes the ask CLI over a bad --options value."
  [raw]
  (when raw
    (try
      (operator-lib/ask-options (json/parse-string raw))
      (catch Exception e
        (binding [*out* *err*]
          (println (str "role_ask.bb: --options was not a usable JSON array of strings/label-objects (" (.getMessage e) ") - falling back to a plain message")))
        nil))))

(defn -main []
  (if (fs/exists? awaiting-file)
    (do
      (binding [*out* *err*]
        (println (str "role_ask.bb: \"" role "\" already has a clarifying question pending - refusing to ask a second one until it is answered")))
      (println (json/generate-string {:asked false :reason "already-pending"})))
    (let [question (:question opts)
          resolved-options (parse-options (:options opts))
          thread-id (ask-thread-id role)]
      (append-to-outbox! thread-id question (cond-> {"roleQuestion" role}
                                               resolved-options (assoc "options" resolved-options)))
      (atomic-spit! awaiting-file
                    (json/generate-string {:question question
                                            :asked_at_ms (System/currentTimeMillis)
                                            :options resolved-options}))
      (println (json/generate-string {:asked true :role role :question question :options resolved-options})))))

(-main)
