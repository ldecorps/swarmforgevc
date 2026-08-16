#!/usr/bin/env bb
;; BL-896 coder pass (BL-654 Invariants): PROPERTY test over
;; briefing_email_lib.bb's diagram-section-from-sources encoding the
;; ticket's 2nd declared invariant:
;;
;;   "No briefing chart source failing can suppress another source that
;;    succeeded, or the send itself."
;;
;; F4 found that only build-diagram-section (given a pre-combined diagrams
;; seq) was covered by briefing_email_test_runner.bb - the actual combining
;; step that makes the independence claim true (handoffd.bb's former inline
;; concat, now diagram-section-from-sources) had nothing exercising it.
;; handoffd.bb itself cannot be load-file'd by a test harness (it exits
;; immediately when *command-line-args* is empty - see its usage/System.exit
;; at the top of the file), so this drives the lib function directly.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none).
;; See ambulance_lib_property_runner.bb's header for the Babashka-property-
;; tooling-gap note (BL-472) this one shares: no test.check equivalent is
;; wired for .bb scripts, so this is a hand-rolled generator in the actual
;; enforced gate for .bb code (swarmforge/scripts/test/).
;;
;; Non-vacuity proven by hand at authoring time: this property fails when
;; diagram-section-from-sources's try/catch around either source thunk is
;; removed - a :throw outcome on one source then propagates out of the
;; function entirely (violating "or the send itself" - send-unsent-
;; briefings! never gets a section value to send with) instead of degrading
;; to nil while its sibling still ships. Confirmed by temporarily deleting
;; the try/catch, running this file, seeing P1 fail with "itself threw" on
;; every :throw case, then restoring the fix.

(ns bl896-briefing-diagram-source-independence-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

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

;; Four possible behaviors for a source thunk - :throw and :nil both model a
;; production source's own internal catch degrading to nil (nothing this
;; function can see the difference on the wire, but :throw exercises the
;; combinator's OWN defensive catch, which a real production thunk would
;; never trigger); :empty models a render that ran but produced nothing;
;; :success models a real diagram shipping.
(def outcomes [:throw :nil :empty :success])

(defn- gen-input [s]
  (let [[arch-outcome s1] (gen-pick s outcomes)
        [burn-outcome s2] (gen-pick s1 outcomes)]
    [[arch-outcome burn-outcome] s2]))

(defn- thunk-for [outcome value]
  (case outcome
    :throw (fn [] (throw (ex-info "simulated source failure" {})))
    :nil (fn [] nil)
    :empty (fn [] [])
    :success (fn [] value)))

(def arch-items [{:name "architecture" :base64 "QVJDSA=="}])
(def burn-items [{:name "not-done-burndown" :base64 "QlVSTg=="}])

;; P1: one source's failure (throw/nil/empty) never suppresses a succeeding
;; sibling's diagram, never suppresses the section itself being producible
;; (the precondition for the send to happen at all), and both-fail never
;; carries a stray :attachments key.
(check-all
 "P1-source-independence"
 gen-input
 (fn [[arch-outcome burn-outcome]]
   (let [arch-fn (thunk-for arch-outcome arch-items)
         burn-fn (thunk-for burn-outcome burn-items)
         {:keys [threw result]}
         (try {:result (briefing-email-lib/diagram-section-from-sources arch-fn burn-fn)}
              (catch Exception e {:threw (.getMessage e)}))]
     (cond
       threw
       (str "diagram-section-from-sources itself threw (violates \"or the send itself\"): " threw)

       (not (string? (:note-line result)))
       (str "expected a sendable section (string :note-line) always; got: " (pr-str result))

       :else
       (let [attachments (or (:attachments result) [])
             filenames (set (map :filename attachments))
             arch-shipped? (contains? filenames "architecture-diagram.png")
             burn-shipped? (contains? filenames "not-done-burndown-diagram.png")
             arch-should-ship? (= arch-outcome :success)
             burn-should-ship? (= burn-outcome :success)]
         (cond
           (not= arch-shipped? arch-should-ship?)
           (str "architecture shipped=" arch-shipped? " expected=" arch-should-ship?
                " (its own outcome was " arch-outcome ", sibling burndown outcome was " burn-outcome ")")

           (not= burn-shipped? burn-should-ship?)
           (str "burndown shipped=" burn-shipped? " expected=" burn-should-ship?
                " (its own outcome was " burn-outcome ", sibling architecture outcome was " arch-outcome ")")

           (and (not arch-should-ship?) (not burn-should-ship?) (contains? result :attachments))
           (str "expected no :attachments key when both sources fail; got: " (pr-str result))

           :else true))))))

;; generator-reach floor: confirm the seeded generator actually reaches the
;; exact divergent cases the invariant is about (one throws for real while
;; the other succeeds) within the configured run budget - an assertion, not
;; a hope, per this ticket's own generator-reach requirement.
(let [reached (atom false)]
  (loop [i 0 s 11]
    (when (< i runs)
      (let [[[arch-outcome burn-outcome] s'] (gen-input s)]
        (when (or (and (= arch-outcome :throw) (= burn-outcome :success))
                  (and (= burn-outcome :throw) (= arch-outcome :success)))
          (reset! reached true))
        (recur (inc i) s'))))
  (when-not @reached
    (swap! failures conj "FAIL generator-reach: never sampled a (throw, success) divergent pair across the configured run budget - P1 would pass vacuously on the exact case it exists to catch")))

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str "\n" (count @failures) " of " (* 2 runs) " property checks failed"))
    (System/exit 1))
  (println (str "ALL PASS: bl896_briefing_diagram_source_independence_property_runner.bb (" runs " runs)")))
