#!/usr/bin/env bb
;; BL-653: append one validated operator event to events.jsonl under the
;; SAME mkdir-lock operator_runtime.bb and operatorEventQueue.ts honor —
;; the deterministic babysitter's escalation wire, never a second queue.
;;
;; Usage: operator_enqueue_event.bb <project-root> '<json-event>'

(ns operator-enqueue-event
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "operator_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_enqueue_event.bb <project-root> '<json-event>'"))
  (System/exit 1))

(defn env-ms [name default]
  (let [raw (System/getenv name)]
    (if (str/blank? raw) default
        (try (Long/parseLong (str/trim raw)) (catch Exception _ default)))))

(def lock-retry-delay-ms (env-ms "OPERATOR_EVENTS_LOCK_RETRY_DELAY_MS" 25))
(def lock-max-wait-ms (env-ms "OPERATOR_EVENTS_LOCK_MAX_WAIT_MS" 5000))

(defn acquire-events-lock! [lock-dir]
  (fs/create-dirs (fs/parent lock-dir))
  (let [deadline (+ (System/currentTimeMillis) lock-max-wait-ms)]
    (loop []
      (if (try
            (fs/create-dir lock-dir)
            true
            (catch java.nio.file.FileAlreadyExistsException _
              false))
        nil
        (if (>= (System/currentTimeMillis) deadline)
          (throw (ex-info (str "events lock timed out after " lock-max-wait-ms "ms")
                           {:lock-dir (str lock-dir)}))
          (do (Thread/sleep lock-retry-delay-ms)
              (recur)))))))

(defn release-events-lock! [lock-dir]
  (fs/delete lock-dir))

(defn with-events-lock* [lock-dir f]
  (acquire-events-lock! lock-dir)
  (try (f) (finally (release-events-lock! lock-dir))))

(defn append-event! [events-file event]
  (fs/create-dirs (fs/parent events-file))
  (spit (str events-file) (str (json/generate-string event) "\n") :append true))

(defn -main []
  (let [project-root (or (nth *command-line-args* 0 nil) (usage))
        event-json (or (nth *command-line-args* 1 nil) (usage))
        event (json/parse-string event-json true)]
    (when-not (operator-lib/valid-event? event)
      (binding [*out* *err*]
        (println (json/generate-string {:error "invalid operator event" :event event})))
      (System/exit 2))
    (let [op-dir (fs/path project-root ".swarmforge" "operator")
          events-file (fs/path op-dir "events.jsonl")
          lock-dir (fs/path op-dir "events.jsonl.lock")]
      (with-events-lock* lock-dir #(append-event! events-file event))
      (println (json/generate-string {:enqueued true :type (:type event)})))))

(when (= *file* (System/getProperty "babashka.file"))
  (-main))
