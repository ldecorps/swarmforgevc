#!/usr/bin/env bb
;; BL-996 declared invariants, coder-first (BL-654). Generative sweep
;; against the REAL three consumers (chase_sweep_lib.bb's
;; actively-processing?, babysitterd_sweep_lib.bb's classify-pane-busy?,
;; loop_detect_lib.bb's classify-pane-loop-signal).
;;
;;   Invariant 1 ("there is one definition of mid-turn - every consumer
;;     reaches the same verdict for the same text"): for random panes drawn
;;     from EITHER an idle-contaminated shape (footer chrome, no live
;;     frame, sometimes quoting the busy marker in scrollback - exactly
;;     BL-970/BL-996's own false-busy shape) OR a live-busy-frame shape
;;     (random verb, random spinner glyph, both ellipsis forms) - NEVER
;;     mixed with a NO_TASK-spin/API-wait shape (invariant 2's own
;;     deliberate exception, tested separately below) - all three
;;     consumers agree on busy-vs-idle.
;;   Invariant 2 ("consolidation never widens a consumer past its own
;;     contract - a model API wait line must NOT read as busy"): for
;;     random NO_TASK-spin panes carrying a random "Waiting for
;;     <provider>/<model>..." line, the loop detector's signal is always
;;     :no-task-spin, never :busy - regardless of the random provider/model
;;     text, and regardless of whether the SAME pane would otherwise
;;     resemble a live frame elsewhere in its scrollback.
;;
;; Reach floors (absolute): invariant-1 idle-contaminated >= 15, invariant-1
;; live-busy-frame >= 15; invariant-2 draws >= 30 (single category, no
;; sub-split needed - every draw exercises the SAME exclusion path with a
;; randomized provider/model).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "chase_sweep_lib.bb")))
(load-file (str (fs/path script-dir ".." "babysitterd_sweep_lib.bb")))
(load-file (str (fs/path script-dir ".." "loop_detect_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 120))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-bool* [] (zero? (rand-int* 2)))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))

(defn rand-word []
  (apply str (repeatedly (+ 4 (rand-int* 8)) #(char (+ 97 (rand-int* 26))))))

(def spinner-glyphs ["✻" "✽" "✶" "✳" "◐" "◓" "⠋" "⠙"])

(defn rand-frame-line [two-word? ascii?]
  (let [glyph (rand-nth* spinner-glyphs)
        verb (if two-word? (str (rand-word) " " (rand-word)) (rand-word))
        ellipsis (if ascii? "..." "…")
        elapsed (str "(" (inc (rand-int* 120)) "s · " (rand-word) ")")]
    (str glyph " " verb ellipsis " " elapsed)))

(defn idle-footer []
  (str "✻ Worked for " (inc (rand-int* 10)) "m " (inc (rand-int* 59)) "s\n"
       "─────────────────────────────────────────── SwarmForge Coder ─\n"
       "❯\n"
       "  ⏵⏵ bypass permissions on (shift+tab to cycle)"))

;; The marker itself is quarantined into a fixture file (never a literal in
;; this source - the same self-referential hazard the ticket describes: a
;; pane displaying this generator's own source would otherwise reproduce
;; the marker it is testing for), read once and reused as one contamination
;; shape among several.
(def quoted-marker-line
  (->> (slurp (str (fs/path script-dir ".." ".." ".." "specs" "features" "fixtures" "BL-996" "idle-with-quoted-marker.txt")))
       str/split-lines
       (filter #(re-find #"pane mid-turn" %))
       first))

(def contamination-shapes
  [(fn [] (str "  ⏵⏵ bypass permissions on · " (rand-word) " still running"))
   (fn [] quoted-marker-line)
   (fn [] (str "⏺ transcript detail line: " (rand-word) " " (rand-word)))])

;; ── invariant-1: idle-contaminated draws ─────────────────────────────────
(def i1-coverage (atom {:idle-contaminated 0 :live-busy-frame 0}))

(dotimes [i runs]
  (let [kind (rand-nth* [:idle :busy])]
    (swap! i1-coverage update (if (= kind :idle) :idle-contaminated :live-busy-frame) inc)
    (let [pane (if (= kind :idle)
                 (let [scroll (repeatedly (+ 2 (rand-int* 6))
                                          (fn [] (if (zero? (rand-int* 3))
                                                   ((rand-nth* contamination-shapes))
                                                   (str "  transcript " (rand-word) " " (rand-word)))))]
                   (str (str/join "\n" scroll) "\n" (idle-footer)))
                 (let [frame (rand-frame-line (rand-bool*) (rand-bool*))]
                   (str (str/join "\n" (repeatedly (rand-int* 6) #(str "⏺ " (rand-word) " " (rand-word))))
                        "\n" frame "\n"
                        "─────────────────────────────────────────── SwarmForge Coder ─\n"
                        "❯\n"
                        "  ⏵⏵ bypass permissions on (shift+tab to cycle)")))
          wake-gate (boolean (chase-sweep-lib/actively-processing? pane))
          babysitter (boolean (babysitterd-sweep-lib/classify-pane-busy? pane))
          loop-busy (= :busy (loop-detect-lib/classify-pane-loop-signal pane))]
      (when-not (= wake-gate babysitter loop-busy)
        (fail! (str "draw " i " (" kind "): consumers disagree - wake-gate=" wake-gate
                    " babysitter=" babysitter " loop-busy=" loop-busy "\n" pane))))))

;; ── invariant-2: NO_TASK-spin + API-wait-line draws ──────────────────────
(def i2-count (atom 0))

(dotimes [i runs]
  (swap! i2-count inc)
  (let [provider (rand-word)
        model (rand-word)
        pane (str "> ! ready_for_next.sh\nNO_TASK\n"
                  "Waiting for " provider "/" model "...\n"
                  "> ! ready_for_next.sh\nNO_TASK\n"
                  "> ! ready_for_next.sh\nNO_TASK\n")
        signal (loop-detect-lib/classify-pane-loop-signal pane)]
    (when (= signal :busy)
      (fail! (str "draw " i ": API-wait line (" provider "/" model ") read as :busy - the circuit breaker is defeated\n" pane)))
    (when-not (= signal :no-task-spin)
      (fail! (str "draw " i ": expected :no-task-spin for provider=" provider " model=" model ", got " signal)))))

;; ── coverage floors ────────────────────────────────────────────────────────
(doseq [[k floor] {:idle-contaminated 15 :live-busy-frame 15}]
  (when (< (get @i1-coverage k) floor)
    (fail! (str "generator coverage: invariant-1 " (name k) " reached only " (get @i1-coverage k) " of " runs " (floor " floor ")"))))
(when (< @i2-count 30)
  (fail! (str "generator coverage: invariant-2 reached only " @i2-count " of " runs " (floor 30)")))

(println (str "  invariant-1 coverage: " (pr-str @i1-coverage)))
(println (str "  invariant-2 draws: " @i2-count))
(if (empty? @failures)
  (do (println (str "bl996 one-definition properties: " runs " draws x2 against the three real classifiers"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
