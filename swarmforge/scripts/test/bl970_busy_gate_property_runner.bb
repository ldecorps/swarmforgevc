#!/usr/bin/env bb
;; BL-970 declared invariants, coder-first (BL-654). Generative sweep over
;; synthetic pane snapshots against the REAL chase_sweep_lib classifier:
;;
;;   Invariant 1: a pane rendering the idle input prompt with no live
;;     turn-status frame is NEVER busy, whatever marker text persists in
;;     its visible scrollback. Idle tails are drawn from the real idle
;;     footer shapes (finished-turn "Worked for" line with optional
;;     lingering-shells suffix, prompt, permission chrome) and the
;;     scrollback is CONTAMINATED by construction with the exact shapes
;;     that used to false-busy: backgrounded-shell chrome lines, quoted
;;     busy-marker phrases inside transcript detail lines, transcript
;;     bullets with ellipsis-parens, and byte-perfect LIVE FRAME lines
;;     placed above the classifier's tail window (the zone layer).
;;   Invariant 2: a pane rendering a live turn-status frame is busy even
;;     when its verb appears in NO hand-maintained list - verbs are random
;;     letter strings (one or two words) that provably never appeared in
;;     the retired verb list, with random spinner glyphs, both ellipsis
;;     forms, and random digit-led paren content; each frame is planted in
;;     the tail among realistic footer chrome.
;;
;; Reach floors (absolute): idle-contaminated >= 10, quoted-marker >= 5,
;; above-window-frame >= 4, busy-random-verb >= 10, busy-two-word >= 4,
;; busy-ascii-ellipsis >= 3.
;;
;; Non-vacuity (staged-first restore, run 2026-08-20, recorded in the
;; parcel commit):
;;   - break 1 (inv 1): classifier reverted to anywhere-in-pane word
;;     matching (re-find of a marker phrase over the WHOLE text) - RED on
;;     the first contaminated-idle draw.
;;   - break 2 (inv 2): the structural frame pattern replaced by the
;;     retired hand-maintained verb list - RED on the first random-verb
;;     frame draw (unlisted by construction).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 120))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def failures (atom []))
(def coverage (atom {:idle-contaminated 0 :quoted-marker 0 :above-window-frame 0
                     :busy-random-verb 0 :busy-two-word 0 :busy-ascii-ellipsis 0}))
(defn fail! [msg] (swap! failures conj msg))

(def retired-verbs
  ;; The hand-maintained list the fix removed - random verbs must provably
  ;; not collide with it (invariant 2's whole point).
  #{"whirlpooling" "vibing" "perambulating" "swirling" "marinating" "incubating"
    "pondering" "noodling" "dilly-dallying" "tinkering" "generating"})

(defn rand-word []
  (let [w (apply str (repeatedly (+ 4 (rand-int* 8)) #(char (+ 97 (rand-int* 26)))))]
    (if (retired-verbs w) (recur) w)))

(defn cap [w] (str (str/upper-case (subs w 0 1)) (subs w 1)))

(def glyphs ["·" "✳" "✢" "✻" "✽" "✶" "*" "+"])

(defn rand-frame-line [two-word? ascii?]
  (let [verb (if two-word? (str (cap (rand-word)) " " (rand-word)) (cap (rand-word)))
        ell (if ascii? "..." "…")
        paren (rand-nth* [(str (inc (rand-int* 59)) "s")
                          (str (inc (rand-int* 9)) "m " (rand-int* 59) "s")
                          (str (inc (rand-int* 9)) "m 10s · ↓ " (inc (rand-int* 20)) "." (rand-int* 9) "k tokens")])]
    (str (rand-nth* glyphs) " " verb ell " (" paren ")")))

(def contamination-shapes
  [(fn [] "  Running…")
   (fn [] (str "⏺ Bash(" (rand-word) " " (rand-word) ")"))
   (fn [] (str "  ⎿  {:detail \"pane mid-turn (esc to interrupt) — retry when idle\"}"))
   (fn [] (str "⏺ " (cap (rand-word)) "… (2 of 3)"))
   (fn [] (str "● Explore(" (rand-word) ")"))
   (fn [] "● Running 3 shell command lines from the log")
   (fn [] (str "  " (rand-word) " compacting conversation " (rand-word)))])

(defn idle-tail []
  (str "✻ Worked for " (inc (rand-int* 9)) "m " (rand-int* 59) "s"
       (rand-nth* ["" (str " · " (inc (rand-int* 6)) " shells still running")]) "\n"
       "──────────────────────────────── SwarmForge Role ─\n"
       "❯\n"
       "─────────────────────────────────────────────────\n"
       "  ⏵⏵ bypass permissions on (shift+tab to cycle)"))

(dotimes [i runs]
  (if (zero? (rand-int* 2))
    ;; ── invariant 1 draw: contaminated idle pane ─────────────────────────
    (let [quoted? (zero? (rand-int* 3))
          above-frame? (zero? (rand-int* 4))
          scroll (vec (concat
                       (when above-frame? [(rand-frame-line false false)])
                       (repeatedly (+ (if above-frame? 21 2) (rand-int* 6))
                                   (fn [] (if (zero? (rand-int* 3))
                                            ((rand-nth* contamination-shapes))
                                            (str "  transcript " (rand-word) " " (rand-word)))))
                       (when quoted? [((nth contamination-shapes 2))])))
          pane (str (str/join "\n" scroll) "\n" (idle-tail))]
      (swap! coverage update :idle-contaminated inc)
      (when quoted? (swap! coverage update :quoted-marker inc))
      (when above-frame? (swap! coverage update :above-window-frame inc))
      (when (chase-sweep-lib/actively-processing? pane)
        (fail! (str "draw " i ": IDLE pane (contaminated scrollback, quoted?=" quoted?
                    " above-frame?=" above-frame? ") classified busy:\n" pane))))
    ;; ── invariant 2 draw: live frame with an unlisted verb ───────────────
    (let [two-word? (zero? (rand-int* 3))
          ascii? (zero? (rand-int* 4))
          frame (rand-frame-line two-word? ascii?)
          pane (str (str/join "\n" (repeatedly (rand-int* 8) #(str "⏺ " (rand-word) " " (rand-word))))
                    "\n" frame "\n"
                    "──────────────────────────────── SwarmForge Role ─\n"
                    "❯\n"
                    "  ⏵⏵ bypass permissions on (shift+tab to cycle)")]
      (swap! coverage update :busy-random-verb inc)
      (when two-word? (swap! coverage update :busy-two-word inc))
      (when ascii? (swap! coverage update :busy-ascii-ellipsis inc))
      (when-not (chase-sweep-lib/actively-processing? pane)
        (fail! (str "draw " i ": MID-TURN pane (frame \"" frame "\") classified idle"))))))

(doseq [[k floor] {:idle-contaminated 10 :quoted-marker 5 :above-window-frame 4
                   :busy-random-verb 10 :busy-two-word 4 :busy-ascii-ellipsis 3}]
  (when (< (get @coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k) " of " runs " (floor " floor ")"))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl970 busy-gate properties: " runs " synthetic panes against the real classifier"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
