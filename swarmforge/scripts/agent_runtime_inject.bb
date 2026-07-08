#!/usr/bin/env bb
;; Executes agent-runtime step sequences against tmux (inject adapter).
(ns agent-runtime-inject
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "agent_runtime_lib.bb")))

(def notify-max-retries 3)
(def notify-retry-delay-ms 200)

(defn tmux! [& args]
  (apply process/sh "tmux" args))

(defn capture-pane-text [socket session]
  (:out (tmux! "-S" socket "capture-pane" "-p" "-t" session)))

(defn last-non-blank-line [pane-text]
  (last (remove str/blank? (str/split-lines (or pane-text "")))))

(defn pending-input-line [pane-text]
  (let [line (last-non-blank-line pane-text)]
    (if (nil? line)
      ""
      (if-let [[_ tail] (re-find #"[$#❯>]\s*(\S.*)?$" line)]
        (str/trim (or tail ""))
        ""))))

(defn pending-input? [pane-text]
  (not (str/blank? (pending-input-line pane-text))))

(defn text-still-pending? [pane-text text]
  (let [pending (pending-input-line pane-text)]
    (and (not (str/blank? pending)) (str/includes? pending (str/trim text)))))

(defn send-submit! [socket session]
  (let [cr (tmux! "-S" socket "send-keys" "-t" session "C-m")]
    (Thread/sleep 50)
    (let [lf (tmux! "-S" socket "send-keys" "-t" session "C-j")]
      (and (zero? (:exit cr)) (zero? (:exit lf))))))

(defn execute-step! [socket session step]
  (case (:op step)
    :sleep (Thread/sleep (:ms step))
    :send-literal
    (let [res (tmux! "-S" socket "send-keys" "-t" session "-l" (:text step))]
      (when-not (zero? (:exit res))
        (throw (ex-info "tmux send-literal failed" res)))
      (Thread/sleep 150))
    :paste-file
    (let [path (:path step)
          res (tmux! "-S" socket "load-buffer" "-b" "swarmforge-bootstrap" path)]
      (when-not (zero? (:exit res))
        (throw (ex-info "tmux load-buffer failed" res)))
      (let [paste (tmux! "-S" socket "paste-buffer" "-d" "-t" session "-b" "swarmforge-bootstrap")]
        (when-not (zero? (:exit paste))
          (throw (ex-info "tmux paste-buffer failed" paste)))
        (Thread/sleep 150)))
    :submit
    (when-not (send-submit! socket session)
      (throw (ex-info "tmux submit failed" {:session session})))
    (throw (ex-info "unknown agent-runtime step" step))))

(defn execute-steps! [socket session steps]
  (doseq [step steps]
    (execute-step! socket session step)))

(defn notify-max-retries-for [agent]
  (case (agent-runtime-lib/normalize-agent agent)
    "aider" 10
    notify-max-retries))

(defn notify-retry-delay-ms-for [agent attempt]
  (case (agent-runtime-lib/normalize-agent agent)
    "aider" (* 500 attempt)
    (* notify-retry-delay-ms attempt)))

(defn notify-agent!
  "Agent-aware wake with verified submit (replaces one-size-fits-all chat wake)."
  [socket session agent & {:keys [log-fn on-outcome script-rel-path]}]
  (let [steps (agent-runtime-lib/wake-steps agent :script-rel-path script-rel-path)
        wake-text (:text (first (filter #(= :send-literal (:op %)) steps)))
        log! (or log-fn (fn [& _] nil))
        report! (or on-outcome (fn [& _] nil))
        before (capture-pane-text socket session)
        stacked? (pending-input? before)
        pending-text (if stacked? (pending-input-line before) wake-text)]
    (when-not stacked?
      (doseq [step (filter #(not= :submit (:op %)) steps)]
        (execute-step! socket session step)))
    (loop [attempt 1]
      (when-not (send-submit! socket session)
        (report! "error" "tmux send submit failed" attempt stacked?)
        (throw (ex-info "tmux send submit failed" {:session session})))
      (let [capture (capture-pane-text socket session)]
        (cond
          (agent-runtime-lib/wake-delivery-confirmed? agent capture pending-text)
          (do (report! "ok" nil attempt stacked?) :ok)

          (>= attempt (notify-max-retries-for agent))
          (let [detail (if stacked?
                         "pane already held undelivered input and it still would not submit"
                         (str "submit not confirmed after " attempt " attempt(s)"))]
            (log! "notify-delivery-failed" session detail)
            (report! "failed" detail attempt stacked?)
            :failed)

          :else
          (do
            (Thread/sleep (notify-retry-delay-ms-for agent attempt))
            (recur (inc attempt))))))))

(defn run-bootstrap! [socket session agent role prompt-file two-pack? & [overlay-prompt]]
  (let [steps (agent-runtime-lib/bootstrap-steps agent role
                                                 :two-pack? two-pack?
                                                 :overlay-prompt overlay-prompt
                                                 :prompt-file prompt-file)]
    (execute-steps! socket session steps)))
