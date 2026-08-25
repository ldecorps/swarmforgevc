#!/usr/bin/env bb
;; BL-976 coder pass (BL-654 Invariants): PROPERTY test encoding declared
;; invariant 1 - "Whenever notify_email_to is configured and the daemon
;; generation's environment lacks a usable RESEND_API_KEY, the operator is
;; alerted through a transport that does not itself need the key, exactly
;; once per daemon generation, within the first sweep cycle."
;;
;; Drives the REAL daemon_alarm_lib.bb decision pair (email-send-reason ->
;; alert-keyless-if-needed!) through simulated daemon generations: a fresh
;; one-shot atom per generation, N sweep cycles, and a transport that can
;; fail its first K delivery attempts (a spit to the Telegram outbox can
;; throw) - "exactly once" must mean one successful DELIVERY, with a
;; failed attempt retried on the next cycle, never one attempt.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (bl902_briefing_send_reason_property_runner.bb's header states it):
;; deterministic, never rand - a flaky property is worse than none. The
;; BL-992 D1 bounce class (a reseeding runner whose default draw count
;; cannot reliably clear its own reach floors) cannot occur here: the seed
;; is fixed, so the generated case set - and therefore every reach count
;; asserted at the bottom - is identical on every run, bare or not.
;;
;; Non-vacuity proven by hand at authoring time (BL-654): temporarily
;; removed the (not (already-alerted?!)) guard from alert-keyless-if-needed!
;; - 50/300 cases failed, "expected exactly 1 successful delivery(ies),
;; got 3 at cycles [1 2 3]" - then separately reordered mark-alerted! ahead
;; of send-alert! - 39/300 cases failed, "got 0 at cycles []" (a failed
;; first attempt marks the generation alerted and the alert is lost
;; forever, exactly the silent-loss shape the ordering contract exists to
;; prevent) - then restored the fix; all 300 cases pass.

(ns bl976-keyless-alert-once-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_alarm_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def class-counts (atom {}))

(defn- gen-input [s]
  (let [[to-configured? s1] (gen-pick s [true false])
        [key-present? s2] (gen-pick s1 [true false])
        [sweeps s3] (gen-int s2 6)          ; 0..5 -> 1..6 below
        [fail-first-k s4] (gen-int s3 3)]   ; 0..2 transport failures
    [{:to-configured? to-configured?
      :key-present? key-present?
      :sweeps (inc sweeps)
      :fail-first-k fail-first-k} s4]))

(defn- run-generation
  "One simulated daemon generation: fixed (to, key) for its lifetime, a
   fresh one-shot atom, `sweeps` cycles of the exact wiring
   handoffd.bb's email-keyless-alert-sweep! uses. The transport throws on
   its first `fail-first-k` invocations. Returns {:deliveries [cycle ...]
   :attempts n}."
  [{:keys [to-configured? key-present? sweeps fail-first-k]}]
  (let [to (when to-configured? "operator@example.com")
        api-key (when key-present? "bl976-prop-fixture-key")
        alerted? (atom false)
        attempts (atom 0)
        deliveries (atom [])]
    (dotimes [cycle sweeps]
      (try
        (daemon-alarm-lib/alert-keyless-if-needed!
         (daemon-alarm-lib/email-send-reason to api-key)
         {:already-alerted?! (fn [] @alerted?)
          :send-alert! (fn []
                         (swap! attempts inc)
                         (when (<= @attempts fail-first-k)
                           (throw (ex-info "transport down" {})))
                         (swap! deliveries conj (inc cycle)))
          :mark-alerted! (fn [] (reset! alerted? true))})
        (catch Exception _ nil)))          ; run-sweep! isolates a throw too
    {:deliveries @deliveries :attempts @attempts}))

(defn- check-case [{:keys [to-configured? key-present? sweeps fail-first-k] :as input}]
  (let [{:keys [deliveries attempts]} (run-generation input)
        keyless? (and to-configured? (not key-present?))
        expected-deliveries (if (and keyless? (< fail-first-k sweeps)) 1 0)]
    (swap! class-counts update
           [(if to-configured? :to :no-to) (if key-present? :key :no-key)]
           (fnil inc 0))
    (when (pos? fail-first-k) (swap! class-counts update :transport-fails (fnil inc 0)))
    (when (>= fail-first-k sweeps) (swap! class-counts update :fails-outlast-sweeps (fnil inc 0)))
    (when (>= sweeps 3) (swap! class-counts update :multi-sweep (fnil inc 0)))
    (cond
      (not= (count deliveries) expected-deliveries)
      (str "expected exactly " expected-deliveries " successful delivery(ies), got "
           (count deliveries) " at cycles " (pr-str deliveries))

      ;; delivered on the FIRST cycle whose transport works (k=0 -> cycle 1,
      ;; the invariant's "within the first sweep cycle"); a failed attempt
      ;; retried the very next cycle, never later
      (and (= expected-deliveries 1) (not= deliveries [(inc fail-first-k)]))
      (str "delivery never retried to the first working cycle: expected cycle "
           (inc fail-first-k) ", got " (pr-str deliveries))

      ;; a generation that should never alert must never even attempt
      (and (not keyless?) (pos? attempts))
      (str "non-keyless generation attempted the transport " attempts " time(s)")

      ;; once delivered, no further attempts (the one-shot atom holds)
      (and (= expected-deliveries 1) (not= attempts (inc fail-first-k)))
      (str "expected attempts to stop at the successful delivery ("
           (inc fail-first-k) "), got " attempts)

      :else true)))

(loop [i 0 s 13]
  (when (< i runs)
    (let [[input s'] (gen-input s)
          result (try (check-case input) (catch Exception e (str "threw: " (.getMessage e))))]
      (when-not (true? result)
        (report! "keyless-alert-exactly-once-per-generation" s input (str result)))
      (recur (inc i) s'))))

;; ── generator reach floors (BL-654: asserted, never hoped-for) ───────────
;; Deterministic seed 13 -> these counts are identical on every run; the
;; floors fail loudly if a future generator edit starves a class.
(let [counts @class-counts
      floors {[:to :no-key] 40      ; the invariant's own quantified class
              [:to :key] 40
              [:no-to :no-key] 40
              [:no-to :key] 40
              :transport-fails 80   ; retry semantics actually exercised
              :fails-outlast-sweeps 15 ; zero-successful-delivery class
              :multi-sweep 100}]    ; dedup across cycles actually exercised
  (doseq [[class floor] floors]
    (let [n (get counts class 0)]
      (when (< n floor)
        (swap! failures conj
               (str "REACH FLOOR MISSED: class " (pr-str class) " reached " n
                    " of " runs " (floor " floor ")"))))))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println "FAILED:" (count @failures) "failure(s) across" runs "runs")
      (System/exit 1))
  (do (println "OK:" runs "generations, invariant 1 held; class coverage:" (pr-str @class-counts))
      (System/exit 0)))
