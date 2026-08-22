#!/usr/bin/env bb
;; BL-902 coder pass (BL-654 Invariants): PROPERTY tests over
;; briefing_email_lib.bb's send-unsent-briefings! encoding the ticket's
;; three declared invariants:
;;
;;   P1/P2 zero-gathering-cost-independent - "When a briefing cannot be
;;      delivered, zero section adapters are invoked - sendability is
;;      decided before any gathering, rendering, or shell-out happens" and
;;      "The undeliverable path's cost is independent of backlog size,
;;      diagram count, and briefing length."
;;   P3 byte-identical-outcome - "Deciding sendability earlier changes only
;;      timing: which briefings are marked sent, and every log line a
;;      consumer keys off, are byte-identical to today's behaviour."
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none).
;; See ambulance_lib_property_runner.bb's header for the Babashka-property-
;; tooling-gap note (BL-472) this one shares: no test.check equivalent is
;; wired for .bb scripts, so this is a hand-rolled generator in the actual
;; enforced gate for .bb code (swarmforge/scripts/test/).
;;
;; Non-vacuity proven by hand at authoring time: temporarily reverted
;; send-unsent-briefings! to always call compose-and-send-one! first (the
;; pre-BL-902 shape, dropping the early :send-reason! check) and ran this
;; file - P1/P2 failed on every generated case (every tracked adapter WAS
;; invoked, and the run threw the deliberate "must never be called"
;; sentinel from the P1/P2 :send-email! adapter, caught and reported by
;; check-all below as a failure) exactly as expected, then the fix was
;; restored and all three properties passed again.

(ns bl902-briefing-send-reason-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 13]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (try (pred-fn input) (catch Exception e (str "threw: " (.getMessage e))))]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def reasons [:disabled :missing-api-key])

;; content-len/diagram-count model "backlog size, diagram count, and
;; briefing length" from invariant 2 - varied per run to prove the
;; undeliverable path's behavior never depends on them.
(defn- gen-input [s]
  (let [[reason s1] (gen-pick s reasons)
        [content-len s2] (gen-int s1 5000)
        [diagram-count s3] (gen-int s2 20)]
    [{:reason reason :content-len content-len :diagram-count diagram-count} s3]))

;; Every optional/required gather-or-render adapter send-unsent-briefings!
;; knows about, each recording its own invocation - the exhaustive set this
;; ticket's "zero section adapters are invoked" invariant quantifies over.
(defn- tracked-adapters [calls content-len diagram-count]
  {:read-briefing-content (fn [_f] (swap! calls conj :read) (apply str (repeat content-len "x")))
   :suite-duration-line (fn [] (swap! calls conj :suite-duration) "line")
   :needs-approval-section (fn [] (swap! calls conj :needs-approval) "line")
   :merged-blocked-digest (fn [] (swap! calls conj :merged-blocked) "line")
   :stage-dwell-section (fn [] (swap! calls conj :stage-dwell) "line")
   :chase-trend-section (fn [] (swap! calls conj :chase-trend) "line")
   :not-done-count-line (fn [] (swap! calls conj :not-done) "line")
   :standing-rule-violations-line (fn [] (swap! calls conj :standing-rule) "line")
   :suboptimality-verdict-line (fn [] (swap! calls conj :suboptimality) "line")
   :qa-bounce-line (fn [] (swap! calls conj :qa-bounce) "line")
   :telegram-bridge-cost-line (fn [] (swap! calls conj :telegram) "line")
   :token-burn-section (fn [] (swap! calls conj :token-burn) {:appended-text "x"})
   :diagram-section (fn []
                       (swap! calls conj :diagram)
                       {:html (apply str (repeat diagram-count "<img/>"))
                        :note-line "note"
                        :attachments (vec (repeat diagram-count {:filename "d.png" :content-id "d" :base64 "AA=="}))})})

(defn- expected-skip-key [reason]
  (case reason
    :disabled "briefing-skip-disabled"
    :missing-api-key "briefing-skip-missing-key"))

;; P1/P2: an undeliverable reason invokes ZERO tracked adapters (invariant
;; 1) and produces the SAME empty sent-set + single skip log line
;; REGARDLESS of content-len/diagram-count (invariant 2's cost
;; independence) - :send-email! itself is a sentinel that throws, so any
;; regression that reaches it (i.e. composed first) is caught as a failure
;; by check-all's try/catch rather than crashing this runner.
(check-all
 "P1-P2-zero-gathering-cost-independent"
 gen-input
 (fn [{:keys [reason content-len diagram-count]}]
   (let [dir (str (fs/create-temp-dir {:prefix "bl902-prop-"}))
         calls (atom [])
         log-calls (atom [])
         file-name "2026-08-16.md"]
     (try
       (spit (str (fs/path dir file-name)) "content\n")
       (let [adapters (merge (tracked-adapters calls content-len diagram-count)
                              {:send-reason! (fn [] reason)
                               :send-email! (fn [& _] (throw (ex-info "must never be called - send-reason! already said undeliverable" {})))
                               :log! (fn [& parts] (swap! log-calls conj (vec parts)))})
             sent (briefing-email-lib/send-unsent-briefings! dir adapters)]
         (cond
           (seq @calls)
           (str "expected zero tracked adapter invocations, got: " (pr-str @calls))

           (seq sent)
           (str "expected nothing marked sent, got: " (pr-str sent))

           (not= [[(expected-skip-key reason) file-name]] @log-calls)
           (str "expected exactly one skip log call " (pr-str [(expected-skip-key reason) file-name])
                ", got: " (pr-str @log-calls))

           :else true))
       (finally (fs/delete-tree dir))))))

;; P3: the SAME log line and SAME (empty) sent-set are produced whether the
;; reason is discovered by the new early :send-reason! adapter or by the
;; pre-BL-902 path (a full compose then :send-email! itself reporting
;; :reason) - the early-skip optimization changes only WHEN the reason is
;; discovered, never WHAT the observable outcome is (invariant 3).
(defn- run-once! [via-early? reason content-len diagram-count file-name]
  (let [dir (str (fs/create-temp-dir {:prefix "bl902-prop-p3-"}))
        log-calls (atom [])]
    (try
      (spit (str (fs/path dir file-name)) "content\n")
      (let [base-adapters (tracked-adapters (atom []) content-len diagram-count)
            adapters (if via-early?
                       (merge base-adapters
                              {:send-reason! (fn [] reason)
                               :send-email! (fn [& _] (throw (ex-info "must never be called" {})))
                               :log! (fn [& parts] (swap! log-calls conj (vec parts)))})
                       (merge base-adapters
                              {:send-email! (fn [& _] {:success false :reason reason})
                               :log! (fn [& parts] (swap! log-calls conj (vec parts)))}))
            sent (briefing-email-lib/send-unsent-briefings! dir adapters)]
        {:sent sent :log @log-calls})
      (finally (fs/delete-tree dir)))))

(check-all
 "P3-byte-identical-outcome"
 gen-input
 (fn [{:keys [reason content-len diagram-count]}]
   (let [file-name "2026-08-16.md"
         early (run-once! true reason content-len diagram-count file-name)
         old (run-once! false reason content-len diagram-count file-name)]
     (cond
       (not= (:sent early) (:sent old))
       (str "sent-set differs: early=" (pr-str (:sent early)) " old=" (pr-str (:sent old)))

       (not= (:log early) (:log old))
       (str "log differs: early=" (pr-str (:log early)) " old=" (pr-str (:log old)))

       :else true))))

;; generator-reach floor: confirm the seeded generator actually reaches
;; BOTH undeliverable reasons within the configured run budget - an
;; assertion, not a hope, per this ticket's own generator-reach requirement.
(let [seen (atom #{})]
  (loop [i 0 s 13]
    (when (< i runs)
      (let [[{:keys [reason]} s'] (gen-input s)]
        (swap! seen conj reason)
        (recur (inc i) s'))))
  (doseq [r reasons]
    (when-not (contains? @seen r)
      (swap! failures conj (str "FAIL generator-reach: never sampled reason " r " across the configured run budget")))))

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str "\n" (count @failures) " of " (* 2 runs) " property checks failed"))
    (System/exit 1))
  (println (str "ALL PASS: bl902_briefing_send_reason_property_runner.bb (" runs " runs)")))
