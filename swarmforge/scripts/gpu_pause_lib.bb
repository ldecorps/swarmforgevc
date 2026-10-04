;; gpu_pause_lib.bb — a timed quiet for the local-model GPU.
;;
;; The Telegram /gpu verb writes .swarmforge/operator/gpu-pause.json. While
;; that marker is active, the local-model seats are stopped and their model
;; is unloaded so the fans go quiet. Babysitter and the claim-idle ladder
;; read this same predicate and treat those seats as paused, not stalled:
;; no half-launch repair (which would start qwen and bring the GPU back),
;; no stuck-parcel finding, no claim reclaim.

(ns gpu-pause-lib
  (:require [clojure.string :as str]))

(def duration-ms
  {"30m" (* 30 60 1000)
   "1h" (* 60 60 1000)
   "2h" (* 2 60 60 1000)})

(defn duration-ms-for
  "Millis for a /gpu duration token, or nil when the token is not one of
   the three the verb offers."
  [token]
  (get duration-ms (str/trim (str token))))

(defn pause-active?
  "True only while the marker says active and its untilMs is still ahead.
   A missing untilMs is not active: this pause is always for a period, so
   an open-ended marker cannot keep the GPU quiet forever by accident.
   now-ms is injected; this function does not read the clock."
  [{:keys [active untilMs]} now-ms]
  (boolean (and active (number? untilMs) (number? now-ms) (> (long untilMs) (long now-ms)))))

(defn local-model-seat?
  [agent]
  (= "local-model" (str/trim (str (or agent "")))))
