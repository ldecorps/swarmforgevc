#!/usr/bin/env bb
;; babysitter_runtime.bb — cheap always-alive loop that wakes the Babysitter LLM.
;;
;; Idles most of the time. Fires an observe wake when:
;;   - .swarmforge/babysitter/wake-queue.jsonl has events (handoffd enqueues), or
;;   - BABYSITTER_OBSERVE_INTERVAL_MS elapsed since last observe (default 20 min).
;;
;; Usage:
;;   bb babysitter_runtime.bb <project-root>
;;   bb babysitter_runtime.bb <project-root> --tick-once
;;
;; Env:
;;   BABYSITTER_OBSERVE_INTERVAL_MS  default 1200000 (20 min)
;;   BABYSITTER_POLL_MS              wake-queue poll cadence (default 5000)
;;   BABYSITTER_DEBOUNCE_MS          min gap between fires (default 30000)

(ns babysitter-runtime
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "babysitter_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: babysitter_runtime.bb <project-root> [--tick-once]"))
  (System/exit 1))

(def project-root
  (or (first (filter #(not (str/starts-with? % "-")) *command-line-args*))
      (usage)))

(def tick-once? (boolean (some #{"--tick-once"} *command-line-args*)))

(def state-dir (fs/path project-root ".swarmforge" "babysitter"))
(def enabled-file (fs/path state-dir "enabled"))
(def stop-file (fs/path state-dir "stop"))
(def wake-queue (fs/path state-dir "wake-queue.jsonl"))
(def state-file (fs/path state-dir "runtime-state.json"))
(def pid-file (fs/path state-dir "runtime.pid"))
(def log-file (fs/path state-dir "runtime.log"))
(def socket-path-file (fs/path state-dir "socket.path"))

(def observe-interval-ms
  (or (some-> (System/getenv "BABYSITTER_OBSERVE_INTERVAL_MS") parse-long)
      babysitter-lib/default-observe-interval-ms))

(def poll-ms
  (or (some-> (System/getenv "BABYSITTER_POLL_MS") parse-long) 5000))

(def debounce-ms
  (or (some-> (System/getenv "BABYSITTER_DEBOUNCE_MS") parse-long)
      babysitter-lib/default-debounce-ms))

(defn now-ms [] (System/currentTimeMillis))

(defn log! [& xs]
  (let [line (str (java.time.Instant/now) " " (str/join " " (map str xs)) "\n")]
    (fs/create-dirs state-dir)
    (spit (str log-file) line :append true)
    (print line)
    (flush)))

(defn read-state []
  (if (fs/exists? state-file)
    (try (json/parse-string (slurp (str state-file)) true)
         (catch Exception _ {}))
    {}))

(defn write-state! [m]
  (fs/create-dirs state-dir)
  (spit (str state-file) (str (json/generate-string m) "\n")))

(defn read-queue []
  (if (fs/exists? wake-queue)
    (babysitter-lib/parse-wake-queue (slurp (str wake-queue)))
    []))

(defn clear-queue! []
  (when (fs/exists? wake-queue)
    (spit (str wake-queue) "")))

(defn babysitter-socket []
  (cond
    (fs/exists? socket-path-file)
    (str/trim (slurp (str socket-path-file)))
    (fs/exists? (fs/path state-dir "babysitter-tmux.sock"))
    (str (fs/path state-dir "babysitter-tmux.sock"))
    :else nil))

(defn tmux! [& args]
  (let [r (apply process/sh (concat ["tmux"] args))]
    (assoc r :ok? (zero? (:exit r)))))

(defn session-alive? [sock]
  (and sock
       (fs/exists? sock)
       (:ok? (tmux! "-S" sock "has-session" "-t" "babysitter"))))

(defn inject-wake! [sock message]
  ;; Do NOT send C-c — that can kill an idle aider session. Type at >
  ;; the same way handoffd wakes swarm panes.
  (when (session-alive? sock)
    (tmux! "-S" sock "send-keys" "-t" "babysitter:0.0" "-l" "--" message)
    (Thread/sleep 100)
    (tmux! "-S" sock "send-keys" "-t" "babysitter:0.0" "Enter")
    true))

(defn ensure-llm! []
  (let [sock (babysitter-socket)]
    (if (session-alive? sock)
      sock
      (do
        (log! "llm-down relaunching")
        (process/sh "bash" (str (fs/path script-dir "launch_babysitter.sh")) project-root)
        (Thread/sleep 1500)
        (babysitter-socket)))))

(defn fire-observe! [events reason]
  (let [sock (ensure-llm!)
        msg (babysitter-lib/format-wake-message reason events)]
    (if (and sock (inject-wake! sock msg))
      (do (log! "woke" (name reason) "events" (count events))
          true)
      (do (log! "wake-failed" (name reason))
          false))))

(defn tick! []
  (if-not (fs/exists? enabled-file)
    (do (log! "disabled (no enabled file)") false)
    (let [st (read-state)
          now (now-ms)
          events (read-queue)
          fire? (babysitter-lib/should-fire-observe?
                 {:now-ms now
                  :last-observe-ms (:last-observe-ms st)
                  :last-fire-ms (:last-fire-ms st)
                  :interval-ms observe-interval-ms
                  :debounce-ms debounce-ms
                  :pending-count (count events)})
          timer-due? (babysitter-lib/next-observe-due?
                      now (:last-observe-ms st) observe-interval-ms)
          reason (babysitter-lib/classify-wake-reason events timer-due?)]
      (when fire?
        (when (fire-observe! events reason)
          (clear-queue!)
          (write-state! (assoc st
                               :last-observe-ms now
                               :last-fire-ms now
                               :last-reason (name reason)))))
      fire?)))

(defn claim-pid! []
  (fs/create-dirs state-dir)
  (spit (str pid-file) (str (.pid (java.lang.ProcessHandle/current)) "\n")))

(defn stop-requested? []
  (fs/exists? stop-file))

(defn -main []
  (fs/create-dirs state-dir)
  (fs/delete-if-exists stop-file)
  (claim-pid!)
  (log! "babysitter_runtime start"
        "interval-ms" observe-interval-ms
        "poll-ms" poll-ms
        "debounce-ms" debounce-ms)
  (tick!)
  (when-not tick-once?
    (loop []
      (when-not (stop-requested?)
        (Thread/sleep poll-ms)
        (try (tick!)
             (catch Exception e
               (log! "tick-error" (.getMessage e))))
        (recur))))
  (log! "babysitter_runtime exit")
  (fs/delete-if-exists pid-file))

(-main)
