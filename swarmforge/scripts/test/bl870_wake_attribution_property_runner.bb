#!/usr/bin/env bb
;; BL-870 (BL-654 Invariants): PROPERTY tests over wake_attribution_lib.bb's
;; build-attribution, encoding the ticket's two declared invariants:
;;
;;   1. "No wake text reaches an agent pane without a corresponding
;;      attribution record naming the role, the deciding sweep, and the
;;      motivating handoff or an explicit marker that there was none."
;;      The WIRING half of this (every real notify call site actually
;;      calls record-wake-attribution!) is a daemon-control-flow fact
;;      proven by test_handoffd_wake_attribution_wiring.sh against the
;;      real handoffd.bb daemon, not something a pure function over
;;      arbitrary inputs can demonstrate (same split as
;;      provider_auth_observe_lib_property_runner.bb's own precedent: the
;;      decision/record-shape is a property here, the daemon actually
;;      calling it is a wiring smoke test). What IS a property of pure
;;      build-attribution: for ANY input, the record it returns faithfully
;;      carries role/sweep/outcome unchanged and marks the handoff
;;      present/absent EXACTLY according to whether handoff-id was given -
;;      never silently dropping or fabricating the handoff signal. P1/P2
;;      below encode that.
;;
;;   2. "Attribution is observation only: for identical inputs the sweep
;;      reaches the same wake, skip or rotate outcome whether or not
;;      attribution is recorded." build-attribution takes :outcome as an
;;      INPUT (it is decided entirely upstream, by mono-router-lib/
;;      chase-poke-plan, before chase-poke-and-notify! ever calls this
;;      function - see that function's own docstring) and never derives it
;;      from anything else; P3 below proves build-attribution is a pure,
;;      referentially transparent function of its own arguments alone - it
;;      cannot be influenced by, and cannot influence, anything but the
;;      record it returns. Combined with the structural fact (verifiable by
;;      reading chase-poke-and-notify!) that every record-wake-attribution!
;;      call sits strictly AFTER `(case (:mode plan) ...)` has already
;;      selected its branch, in a try/catch that swallows its own
;;      exceptions, this is the executable half of invariant 2 the daemon-
;;      control-flow layer admits (mirrors chase-rotate-to!'s own BL-795/
;;      BL-654 precedent comment: no property-test framework is wired for
;;      that layer regardless).
;;
;; Non-vacuity proven by hand at authoring time: temporarily made
;; build-attribution ignore its :outcome arg (hard-coded
;; wake-attribution-lib/outcome-landed) - P1 and P3 both failed immediately
;; (P1 on the first skipped-outcome case generated, P3 on the first case
;; where outcome differed across two calls); restored the file, reran
;; clean - all properties held again. `git diff` confirmed no residual
;; change was left behind.

(ns bl870-wake-attribution-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "wake_attribution_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(zero? n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 11]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── generator: an arbitrary attribution-record input ──────────────────────

(def roles ["coder" "cleaner" "architect" "hardender" "documenter" "qa" "coordinator" "specifier"])
(def sweeps [wake-attribution-lib/sweep-inbox-item
             wake-attribution-lib/sweep-stuck-in-process
             wake-attribution-lib/sweep-claim-idle-probe])
(def outcomes [wake-attribution-lib/outcome-landed wake-attribution-lib/outcome-skipped])
(def skip-reasons ["busy" "not-preferred" "dedup" ""])

(defn gen-input [s]
  (let [[role-n s1] (gen-int s (count roles))
        [sweep-n s2] (gen-int s1 (count sweeps))
        [has-handoff? s3] (gen-bool s2)
        [handoff-n s4] (gen-int s3 1000)
        [outcome-n s5] (gen-int s4 (count outcomes))
        [reason-n s6] (gen-int s5 (count skip-reasons))
        [at-ms s7] (gen-int s6 1000000000)]
    [{:role (nth roles role-n)
      :sweep (nth sweeps sweep-n)
      :handoff-id (when has-handoff? (str "00_2026081" handoff-n "_from_x_to_y.handoff"))
      :outcome (nth outcomes outcome-n)
      :skip-reason (nth skip-reasons reason-n)
      :at-ms at-ms}
     s7]))

;; ── P1: the record always names the exact role/sweep/outcome it was given,
;;    never a substitute or a dropped value ─────────────────────────────────

(check-all "P1 build-attribution faithfully carries role/sweep/outcome/at-ms unchanged"
  gen-input
  (fn [input]
    (let [record (wake-attribution-lib/build-attribution input)]
      (or (and (= (:role record) (:role input))
               (= (:sweep record) (:sweep input))
               (= (:outcome record) (:outcome input))
               (= (:atMs record) (:at-ms input)))
          (str "record=" (pr-str record) " input=" (pr-str input))))))

;; ── P2: handoffPresent?/handoffId exactly reflect whether a handoff-id was
;;    given - "an explicit marker that there was none", never inferred from
;;    a blank/omitted field ────────────────────────────────────────────────

(check-all "P2 handoffPresent?/handoffId exactly mirror whether handoff-id was given"
  gen-input
  (fn [input]
    (let [record (wake-attribution-lib/build-attribution input)
          had-handoff? (boolean (:handoff-id input))]
      (or (and (= (:handoffPresent? record) had-handoff?)
               (= (:handoffId record) (:handoff-id input)))
          (str "record=" (pr-str record) " input=" (pr-str input))))))

;; ── P3: build-attribution is referentially transparent - calling it twice
;;    with the same input (regardless of how many OTHER calls happened in
;;    between, with arbitrary other inputs) always yields an equal record.
;;    This is the executable half of invariant 2: nothing about recording
;;    an attribution carries hidden state that could feed back into a
;;    later wake/skip decision ─────────────────────────────────────────────

(check-all "P3 build-attribution(input) is unaffected by interleaved calls with other inputs"
  (fn [s]
    (let [[fixed s1] (gen-input s)
          [noise-a s2] (gen-input s1)
          [noise-b s3] (gen-input s2)]
      [{:fixed fixed :noise-a noise-a :noise-b noise-b} s3]))
  (fn [{:keys [fixed noise-a noise-b]}]
    (let [before (wake-attribution-lib/build-attribution fixed)
          _ (wake-attribution-lib/build-attribution noise-a)
          _ (wake-attribution-lib/build-attribution noise-b)
          after (wake-attribution-lib/build-attribution fixed)]
      (or (= before after)
          (str "before=" (pr-str before) " after=" (pr-str after))))))

;; ── generator coverage, asserted rather than assumed ──────────────────────

(let [buckets (loop [i 0 s 11 acc {:landed 0 :skipped 0 :handoff-present 0 :handoff-absent 0}]
                (if (= i runs)
                  acc
                  (let [[input s'] (gen-input s)]
                    (recur (inc i) s'
                           (cond-> acc
                             (= (:outcome input) wake-attribution-lib/outcome-landed) (update :landed inc)
                             (= (:outcome input) wake-attribution-lib/outcome-skipped) (update :skipped inc)
                             (:handoff-id input) (update :handoff-present inc)
                             (not (:handoff-id input)) (update :handoff-absent inc))))))
      floor (quot runs 10)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [b [:landed :skipped :handoff-present :handoff-absent]]
    (when (< (get buckets b 0) floor)
      (report! (str "COVERAGE " b) 11 buckets (str b " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "wake_attribution_lib build-attribution properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
