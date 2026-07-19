;; Endless-loop detector for agent panes (token-burn circuit breaker).
;;
;; Problem: an agent that re-runs ready_for_next.sh on every NO_TASK changes
;; the pane every few seconds. chase_sweep_lib/track-pane-activity! then
;; treats that as "fresh activity", so stuck-in_process never escalates, and
;; tokens burn forever. This lib classifies that NO_TASK spin and decides when
;; the swarm must hard-stop.
;;
;; Pure: no filesystem, no tmux, no clock side effects. State is a plain map
;; the caller persists (in-memory atom in handoffd is fine — a restart that
;; loses strikes is safe; the next spin rebuilds them quickly).
;;
;; Load:
;;   (load-file ... "loop_detect_lib.bb")
;;   loop-detect-lib/classify-pane-loop-signal ...

(ns loop-detect-lib
  (:require [clojure.string :as str]))

(def default-config
  {;; How many NO_TASK lines must appear in the RECENT pane window to count as
   ;; spin. Callers should pass only the last ~20 lines — full scrollback from
   ;; an earlier burn would false-positive a healthy idle prompt.
   :no-task-count-threshold 2
   ;; ready_for_next invocations (script path or bare) in the same window.
   :ready-for-next-count-threshold 2
   ;; Consecutive chase observations classified :no-task-spin before halt.
   ;; Chase runs ~every 5s; 3 observations ≈ 15s of ongoing spin.
   :consecutive-spin-observations 3})

(def ^:private no-task-line-re #"(?m)^NO_TASK\s*$")
(def ^:private task-line-re #"(?m)^TASK:")
(def ^:private ready-for-next-re #"(?i)ready_for_next(?:_task|_batch)?\.sh")
;; Only Claude Code's mid-turn footer. Do NOT treat aider's "Waiting for
;; openai/..." as busy: that line appears during a NO_TASK spin's own API
;; calls and would reset strikes forever, defeating the circuit breaker.
(def ^:private busy-footer-re #"(?i)esc to interrupt")

(defn count-matches
  [re text]
  (count (re-seq re (or text ""))))

(defn classify-pane-loop-signal
  "Classify recent pane text for endless-idle-loop detection.
   Returns :no-task-spin | :progress | :busy | :quiet.
   :progress resets strikes (TASK visible, or real work).
   :busy means Claude is mid-turn — do not strike.
   :quiet is idle without a spin pattern — clear strikes (a single NO_TASK
   then sitting at a prompt is healthy mono-router idle)."
  ([pane-text] (classify-pane-loop-signal pane-text default-config))
  ([pane-text config]
   (let [t (or pane-text "")
         cfg (merge default-config config)
         no-task-n (count-matches no-task-line-re t)
         task-n (count-matches task-line-re t)
         ready-n (count-matches ready-for-next-re t)
         busy? (boolean (re-find busy-footer-re t))]
     (cond
       busy? :busy
       (pos? task-n) :progress
       (and (>= no-task-n (:no-task-count-threshold cfg))
            (>= ready-n (:ready-for-next-count-threshold cfg)))
       :no-task-spin
       :else :quiet))))

(defn next-loop-state
  "Advance per-role strike state from a classification.
   State shape: {:strikes int :last-signal keyword}."
  [prev signal]
  (let [prev (or prev {:strikes 0 :last-signal :quiet})]
    (case signal
      :no-task-spin {:strikes (inc (:strikes prev)) :last-signal :no-task-spin}
      :progress {:strikes 0 :last-signal :progress}
      :busy {:strikes 0 :last-signal :busy}
      {:strikes 0 :last-signal :quiet})))

(defn should-halt-for-loop?
  "True when consecutive :no-task-spin observations reach the threshold."
  ([state] (should-halt-for-loop? state default-config))
  ([state config]
   (let [cfg (merge default-config config)
         strikes (or (:strikes state) 0)]
     (>= strikes (:consecutive-spin-observations cfg)))))

(defn decide-loop-action
  "Pure decision for one observation: returns :halt or :continue."
  ([prev-state pane-text]
   (decide-loop-action prev-state pane-text default-config))
  ([prev-state pane-text config]
   (let [signal (classify-pane-loop-signal pane-text config)
         next (next-loop-state prev-state signal)]
     {:signal signal
      :state next
      :action (if (should-halt-for-loop? next config) :halt :continue)})))

(defn format-halt-reason
  [role state]
  (str "Endless NO_TASK loop detected on role '" role
       "' (strikes=" (or (:strikes state) 0)
       "). Swarm halted to stop token burn. "
       "Re-launch after fixing the idle path (mono-router: STOP after NO_TASK; "
       "coordinator must promote paused work into open active slots)."))
