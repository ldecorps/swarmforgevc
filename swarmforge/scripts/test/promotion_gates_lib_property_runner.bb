#!/usr/bin/env bb
;; BL-663 coder pass (BL-654 Invariants): PROPERTY tests over
;; promotion_gates_lib.bb, encoding the ticket's two declared invariants:
;;
;;   1. "A promotion is refused unless every gate passes" - the example-based
;;      runner (promotion_gates_lib_test_runner.bb) only ever breaks ONE gate
;;      at a time per example. P1 here quantifies over every combination of
;;      held?/human_approval/depth/orthogonality at once and checks BOTH that
;;      a refusal only ever fires when at least one gate genuinely fails
;;      (soundness) AND that any failing gate produces a refusal naming the
;;      correct one under the fixed precedence order (completeness) - the
;;      exact shape of bug ("gate exists but a combination slips through")
;;      that made instances 1-4 invisible to machinery in the first place.
;;   2. "assigned_to is never silently rewritten...a reroute is an explicit,
;;      logged decision, never a side effect" - P2/P3 quantify route-target
;;      over the whole space of assigned_to strings, including values no
;;      hand-written example covers (case variants, empty string, other role
;;      names), and P3 states the "never a side effect" half as a genuine
;;      property: applying route-target's own decision must be a FIXED
;;      POINT - a second call on the settled value never asks to rewrite
;;      again.
;;
;; Both scripts call the SAME promotion_gates_cli.bb, which calls the SAME
;; promotion-gates-lib/evaluate and /route-target - proving these properties
;; once here is what "BOTH rewrite sites, not only the promote commit" (the
;; ticket's own invariant 2 wording) actually rests on structurally: a single
;; shared decision function, never two independently-drifting copies.
;;
;; Deterministic by construction: a seeded LCG, never rand. GENERATOR
;; WEIGHTING: small alphabets everywhere (per the recorded lesson that a wide
;; uniform draw can pass hundreds of runs against a live defect because it
;; never reaches the interesting/colliding state) - see the "generator
;; coverage" asserts at the bottom, which fail loudly if a future tweak
;; skews the distribution back out of the interesting region.
;;
;; Non-vacuity proven by hand at authoring time: P1 was run against a
;; deliberately broken evaluate (orthogonality-refusal branch dropped from
;; the `or` chain) and failed as expected before this file was finalized;
;; P2/P3 were run against a broken route-target (assigned-to: "specifier"
;; wrongly routed to coder) and likewise failed.

(ns promotion-gates-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator ──────────────────────────────────────────────────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── generators ────────────────────────────────────────────────────────────

;; Small, deliberately overlapping alphabets - a wide alphabet makes the
;; interesting (colliding-epic, failing-approval) branches rare; see
;; expedite_lib_property_runner.bb's own header for the recorded incident
;; this weighting posture is a direct response to.
(def approval-alphabet [nil "approved" "pending" "amending"])
(def epic-alphabet ["alpha" "beta"])

(defn gen-content [s]
  (let [[approval s1] (gen-pick s approval-alphabet)
        [epic? s2] (gen-bool s1)
        [epic s3] (gen-pick s2 epic-alphabet)]
    [(str (when approval (str "human_approval: " approval "\n"))
          (when epic? (str "epic: " epic "\n")))
     s3]))

(defn gen-active-epics [s]
  (let [[n s1] (gen-int s 3)]
    (reduce (fn [[acc sx] _]
              (let [[e sy] (gen-pick sx epic-alphabet)]
                [(conj acc e) sy]))
            [#{} s1] (range n))))

;; WEIGHTED, per the recorded "uniform draw passed hundreds of runs against a
;; live defect because it never reached the interesting state" trap
;; (expedite_lib_property_runner.bb's own header): drawing every field
;; independently and uniformly makes ALL-GATES-PASS a rare conjunction (each
;; of held?/approval/depth/orthogonality independently has to land on its
;; passing branch), so P1's :ok branch was measured at 27/500 - below the
;; 10% floor - before this shape draw was added. A third of contexts are now
;; a GUARANTEED-compliant shape (mirrors gen-probe's own "fully stopped"
;; bucket), so the :ok branch is genuinely, not just theoretically, covered.
(defn gen-context [s]
  (let [[shape s0] (gen-int s 3)]
    (if (zero? shape)
      (let [[epic? s1] (gen-bool s0)
            [epic s2] (gen-pick s1 epic-alphabet)]
        [{:content (str "human_approval: approved\n" (when epic? (str "epic: " epic "-solo\n")))
          :held? false :active-count 0 :max-depth 3 :active-epics #{}}
         s2])
      (let [[content s1] (gen-content s0)
            [held? s2] (gen-bool s1)
            [active-count s3] (gen-int s2 4)
            [max-depth s4] (gen-int s3 4)
            [active-epics s5] (gen-active-epics s4)]
        [{:content content :held? held? :active-count active-count :max-depth max-depth :active-epics active-epics} s5]))))

(def assigned-to-alphabet ["specifier" "coder" nil "documenter" "cleaner" "" "Specifier" "Coder"])

(defn gen-assigned-to [s] (gen-pick s assigned-to-alphabet))

;; ── P1: evaluate refuses iff at least one gate fails, naming the FIRST by
;;        fixed precedence (held -> human_approval -> depth -> orthogonality) ─

(check-all "P1 evaluate composition: refuses iff a gate fails, names the first one"
  gen-context
  (fn [{:keys [content held? active-count max-depth active-epics] :as ctx}]
    (let [result (promotion-gates-lib/evaluate ctx)
          hold (promotion-gates-lib/hold-refusal held?)
          approval (promotion-gates-lib/human-approval-refusal content)
          depth (promotion-gates-lib/depth-refusal active-count max-depth)
          ortho (promotion-gates-lib/orthogonality-refusal (promotion-gates-lib/read-epic content) active-epics)
          expected (:gate (or hold approval depth ortho))]
      (cond
        (and (nil? expected) (not (:ok result)))
        (str "no gate fails but evaluate refused: " (pr-str result))

        (and expected (:ok result))
        (str "gate " expected " fails but evaluate returned ok")

        (and expected (not= expected (:gate result)))
        (str "expected first-failing gate " expected " but evaluate named " (:gate result))

        :else true))))

;; ── P2: route-target never marks assigned_to: specifier for rewrite, and
;;        always routes it to the specifier; every other value routes to
;;        coder, rewritten iff it did not already read exactly "coder" ────

(check-all "P2 route-target: specifier is never rewritten; everything else routes to coder"
  gen-assigned-to
  (fn [assigned-to]
    (let [{:keys [route-to rewrite-assigned-to?]} (promotion-gates-lib/route-target assigned-to)]
      (if (= "specifier" assigned-to)
        (cond
          (not= "specifier" route-to) (str "specifier routed to " route-to)
          rewrite-assigned-to? "specifier was marked for rewrite"
          :else true)
        (cond
          (not= "coder" route-to) (str "non-specifier " (pr-str assigned-to) " routed to " route-to)
          (not= (not= "coder" assigned-to) (boolean rewrite-assigned-to?))
          (str "rewrite flag " rewrite-assigned-to? " disagrees with assigned_to=" (pr-str assigned-to))
          :else true)))))

;; ── P3: route-target is a fixed point - "never a side effect" means a
;;        second call on the settled value never asks to rewrite again ────

(check-all "P3 route-target fixed point: settling once never asks to rewrite twice"
  gen-assigned-to
  (fn [assigned-to]
    (let [first-decision (promotion-gates-lib/route-target assigned-to)
          settled (if (:rewrite-assigned-to? first-decision) (:route-to first-decision) assigned-to)
          second-decision (promotion-gates-lib/route-target settled)]
      (if (:rewrite-assigned-to? second-decision)
        (str "not a fixed point: settled value " (pr-str settled) " still asks for rewrite -> " (pr-str second-decision))
        true))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [[refused ok] (loop [i 0 s 7 r 0 o 0]
                     (if (= i runs)
                       [r o]
                       (let [[ctx s'] (gen-context s)]
                         (if (:ok (promotion-gates-lib/evaluate ctx))
                           (recur (inc i) s' r (inc o))
                           (recur (inc i) s' (inc r) o)))))
      floor (quot runs 10)]
  (println (str "  generator coverage: refused=" refused " ok=" ok))
  (when (< refused floor)
    (report! "COVERAGE P1 refused branch" 7 {:refused refused :floor floor} "the refused branch is barely exercised"))
  (when (< ok floor)
    (report! "COVERAGE P1 ok branch" 7 {:ok ok :floor floor} "the ok branch is barely exercised")))

(let [[rewritten kept] (loop [i 0 s 7 rw 0 kp 0]
                          (if (= i runs)
                            [rw kp]
                            (let [[assigned-to s'] (gen-assigned-to s)
                                  rewrite? (:rewrite-assigned-to? (promotion-gates-lib/route-target assigned-to))]
                              (if rewrite?
                                (recur (inc i) s' (inc rw) kp)
                                (recur (inc i) s' rw (inc kp))))))
      floor (quot runs 10)]
  (println (str "  generator coverage: rewrite=" rewritten " kept=" kept))
  (when (< rewritten floor)
    (report! "COVERAGE P2/P3 rewrite branch" 7 {:rewritten rewritten :floor floor} "the rewrite branch is barely exercised"))
  (when (< kept floor)
    (report! "COVERAGE P2/P3 kept branch" 7 {:kept kept :floor floor} "the no-rewrite branch is barely exercised")))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "promotion_gates_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
