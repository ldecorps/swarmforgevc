#!/usr/bin/env bb
;; BL-1026 property test (coder-authored, two DECLARED invariants) over the
;; expeditor's per-stage budget: the valve in expedite_lib.bb and the gate that
;; holds every stated copy of its default together.
;;
;;   Invariant 1: "Raising the default never disarms the valve: a stage past
;;   whatever the budget is is still killed, and the boundary is >= not >."
;;
;;   Invariant 2: "Every place the expeditor states its default per-stage
;;   budget states the same value as the code, and the check that proves it
;;   fails when one of them is changed."
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Both invariants have a state a naive generator effectively never visits:
;;
;;   Invariant 1's whole content is the BOUNDARY - elapsed exactly equal to the
;;   budget. Drawing elapsed and budget independently hits that on the order of
;;   one run in a billion, so a `>` regression would sail through any number of
;;   runs. Every row therefore CONSTRUCTS its elapsed FROM the budget in force
;;   (b-1, b, b+k), which is the same discipline as deriving a collision pair
;;   from one side rather than drawing both: the interesting case exists by
;;   construction, not by luck, and a floor asserts it was reached.
;;
;;   Invariant 1 also quantifies over the DEFAULT ITSELF - "raising the default
;;   never disarms the valve" is a claim about every value the default could
;;   take, not the one compiled in today. The default is a var, so each run
;;   rebinds it and re-checks the valve, and P3 re-checks it after a RAISE
;;   specifically. Testing only the current 90 minutes would leave the actual
;;   claim unquantified.
;;
;;   Invariant 2's drifted value is DERIVED from the code's value (expected
;;   minutes plus a non-zero delta), never drawn independently - an independent
;;   draw can coincide with the expected value and silently generate a
;;   non-drift while claiming to test drift.
;;
;; What this runner CANNOT reach, said plainly so it is not read as coverage it
;; does not have: whether the CLI actually consults the verdict and kills the
;; process group is a control-flow fact about expedite_cli.bb's `sh-bounded`,
;; not a property of a pure function; and whether the gate is ever RUN is what
;; the acceptance feature's scenarios 02 and 03 hold. The real four sites are
;; gated against the real constant in expedite_lib_test_runner.bb.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored,
;; counts MEASURED (seed 1026, 400 runs):
;;   - `>=` -> `>` in stage-timeout-verdict ......... P1 141, P2 62, P3 400
;;   - `(or timeout-ms default)` -> `default` ....... P1 167, P2 269
;;   - dropping the :states-no-budget branch ........ P4 113, P5 113, P6 113
;;   - budget-mirror-findings returning [] .......... P4 316, P5 113, P6 316
;; Every number above is the measured count, not an estimate. P3's 400/400 on
;; the first break is the one to read: every single run rebinds the default to
;; a raised value and checks the boundary there, so a `>` regression cannot hide
;; behind a default that happens not to be hit.

(ns bl1026-stage-budget-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {:under 0 :at-boundary 0 :past 0
                     :explicit 0 :implicit 0 :raised 0
                     :mut-none 0 :mut-whole 0 :mut-half 0 :mut-deleted 0
                     :spelling-a 0 :spelling-b 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; ── invariant 2 fixtures ──────────────────────────────────────────────────
;; The two spellings really in use. Rendering them here rather than reading the
;; real files is what lets the generator quantify over drift at all - the real
;; files state exactly one value, by construction of the gate.
(defn- render [spelling ms minutes]
  (case spelling
    :a (str "#   --stage-timeout-ms N  per-stage budget (default " minutes " min)")
    :b (str "| `--stage-timeout-ms` | integer | `" ms "` (" minutes " min) | Per-stage budget. |")))

(def site-names ["site/one.bb" "site/two.sh" "site/three.md" "site/four.md"])

(loop [i 0 s 1026]
  (when (< i runs)
    (let [;; ── the budget in force, and an elapsed CONSTRUCTED from it ──
          [bmin s1] (gen-int s 240)
          budget-min (inc bmin)                       ; 1..240 minutes
          budget-ms (* budget-min 60 1000)
          [rel s2] (gen-int s1 3)                     ; 0 under, 1 at, 2 past
          [overshoot s3] (gen-int s2 600000)
          elapsed (case rel
                    0 (dec budget-ms)                 ; one ms under - never killed
                    1 budget-ms                       ; the boundary itself
                    2 (+ budget-ms overshoot 1))      ; past
          [explicit? s4] (gen-int s3 2)
          ;; ── the default itself is quantified over, not assumed ──
          [dmin s5] (gen-int s4 240)
          default-min (inc dmin)
          default-ms (* default-min 60 1000)
          ;; ── invariant 2's readings ──
          [mut s6] (gen-int s5 4)                     ; 0 none 1 whole 2 half 3 deleted
          mutation (nth [:none :whole :half :deleted] mut)
          [victim s7] (gen-int s6 (count site-names))
          [delta0 s8] (gen-int s7 120)
          delta (inc delta0)                          ; non-zero BY CONSTRUCTION
          expected-min 90
          expected-ms (* expected-min 60 1000)
          drift-min (+ expected-min delta)
          [sp s9] (gen-int s8 2)
          ;; :half needs a spelling that states the value twice
          spelling (if (= mutation :half) :b (nth [:a :b] sp))
          readings (vec (map-indexed
                          (fn [idx nm]
                            {:site nm
                             :content
                             (if (and (= idx victim) (not= mutation :none))
                               (case mutation
                                 :whole (render spelling (* drift-min 60 1000) drift-min)
                                 :half (render :b expected-ms drift-min)
                                 :deleted "this site no longer states a budget at all")
                               (render spelling expected-ms expected-min))})
                          site-names))]

      (swap! coverage update (case rel 0 :under 1 :at-boundary 2 :past) inc)
      (swap! coverage update (if (zero? explicit?) :explicit :implicit) inc)
      (swap! coverage update (keyword (str "mut-" (name mutation))) inc)
      (swap! coverage update (if (= spelling :a) :spelling-a :spelling-b) inc)

      ;; ── P1 (invariant 1): the valve, at whatever budget is in force ──
      ;; overrun? is exactly `elapsed >= budget`. The boundary row is what
      ;; separates >= from >, and it is reached by construction every ~3rd run.
      (let [v (expedite-lib/stage-timeout-verdict
                {:started-at-ms 0 :now-ms elapsed :timeout-ms budget-ms})]
        (when (not= (:overrun? v) (>= elapsed budget-ms))
          (report! "P1 (invariant 1: a stage past its budget is killed, boundary is >=)" s
                   {:budget-ms budget-ms :elapsed elapsed :rel rel}
                   (str "overrun? was " (:overrun? v) ", expected " (>= elapsed budget-ms)))))

      ;; ── P2 (invariant 1): which budget is in force is never confused ──
      ;; An explicit budget is reported even when the default dwarfs it; the
      ;; default is reported only when none was given. Raising the default must
      ;; not start overriding a stage's own budget.
      (with-redefs [expedite-lib/default-stage-timeout-ms default-ms]
        (let [v (expedite-lib/stage-timeout-verdict
                  (cond-> {:started-at-ms 0 :now-ms elapsed}
                    (zero? explicit?) (assoc :timeout-ms budget-ms)))
              in-force (if (zero? explicit?) budget-ms default-ms)]
          (when (not= (:timeout-ms v) in-force)
            (report! "P2 (invariant 1: the budget in force is the explicit one, else the default)" s
                     {:explicit (zero? explicit?) :budget-ms budget-ms :default-ms default-ms}
                     (str "reported " (:timeout-ms v) ", expected " in-force)))
          (when (not= (:overrun? v) (>= elapsed in-force))
            (report! "P2 (invariant 1: the verdict follows the budget in force)" s
                     {:elapsed elapsed :in-force in-force}
                     (str "overrun? was " (:overrun? v))))))

      ;; ── P3 (invariant 1): RAISING the default never disarms the valve ──
      ;; The literal claim: for any default, and any raise of it, a stage at or
      ;; past the NEW default is still killed, and one under it still is not.
      ;; Quantifying over the raise is the point - a valve that only holds at
      ;; today's 90 minutes is not what the invariant asserts.
      (let [raised-ms (+ default-ms (* (inc delta) 60 1000))]
        (swap! coverage update :raised inc)
        (with-redefs [expedite-lib/default-stage-timeout-ms raised-ms]
          (let [at (expedite-lib/stage-timeout-verdict {:started-at-ms 0 :now-ms raised-ms})
                past (expedite-lib/stage-timeout-verdict {:started-at-ms 0 :now-ms (+ raised-ms 1)})
                under (expedite-lib/stage-timeout-verdict {:started-at-ms 0 :now-ms (dec raised-ms)})]
            (when-not (:overrun? at)
              (report! "P3 (invariant 1: raising the default never disarms the valve)" s
                       {:raised-ms raised-ms} "a stage exactly AT the raised default was not killed"))
            (when-not (:overrun? past)
              (report! "P3 (invariant 1: raising the default never disarms the valve)" s
                       {:raised-ms raised-ms} "a stage PAST the raised default was not killed"))
            (when (:overrun? under)
              (report! "P3 (invariant 1: the valve does not fire early either)" s
                       {:raised-ms raised-ms} "a stage under the raised default was killed")))))

      ;; ── P4 (invariant 2): the gate names exactly the site that drifted ──
      (let [findings (expedite-lib/budget-mirror-findings readings expected-ms)
            named (set (map :site findings))
            expected-named (if (= mutation :none) #{} #{(nth site-names victim)})]
        (when (not= named expected-named)
          (report! "P4 (invariant 2: every stated place agrees, and only the drifted one is named)" s
                   {:mutation mutation :victim (nth site-names victim) :spelling spelling}
                   (str "gate named " (pr-str named) ", expected " (pr-str expected-named))))

        ;; ── P5 (invariant 2): a site that stops stating it is drift too ──
        (when (= mutation :deleted)
          (when-not (some #(and (= (:site %) (nth site-names victim))
                                (= (:reason %) :states-no-budget))
                          findings)
            (report! "P5 (invariant 2: deleting the statement is drift, not silence)" s
                     {:victim (nth site-names victim)}
                     (str "no :states-no-budget finding: " (pr-str findings)))))

        ;; ── P6 (invariant 2, second clause): the check FAILS when one is
        ;; changed. This is the half that makes the gate a gate rather than a
        ;; formality - the clause the old test 15 could not satisfy.
        (when (and (not= mutation :none) (empty? findings))
          (report! "P6 (invariant 2: the check fails when one place is changed)" s
                   {:mutation mutation :victim (nth site-names victim)}
                   "a changed site produced NO findings - the gate is vacuous"))
        (when (and (= mutation :none) (seq findings))
          (report! "P6 (invariant 2: the check does not cry wolf when all agree)" s
                   {:readings readings} (pr-str findings))))

      (recur (inc i) s9))))

;; Reach floors. These are assertions, not diagnostics: if the generator stops
;; reaching the boundary or stops producing each mutation kind, the properties
;; above are still "passing" while quantifying over nothing.
(doseq [[k floor] {:under 80 :at-boundary 80 :past 80
                   :explicit 120 :implicit 120 :raised 400
                   :mut-none 60 :mut-whole 60 :mut-half 60 :mut-deleted 60
                   :spelling-a 60 :spelling-b 120}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1026 stage-budget properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
