#!/usr/bin/env bb
;; BL-848: PROPERTY tests over hotfix_certification_lib.bb, covering the
;; three invariants the ticket YAML declares (coder-authored first, per
;; BL-654). Seeded (not wall-clock) randomness so failures reproduce: a
;; fixed-seed java.util.Random, never rand/rand-int's unseeded global
;; generator. Follows the established .bb property-runner precedent
;; (bl839_master_checkout_drift_property_runner.bb) - the "*.property.test.js"
;; / vitest.properties.config.mjs home is a TypeScript convention with no
;; Babashka equivalent (BL-472 tracks pinning real property tooling for .bb
;; scripts, deliberately deferred).
;;
;;   P1 never-certified-without-a-recorded-decision - invariants 1 and 3:
;;      "No hotfix counts as an official swarm deal until ... the human has
;;      been asked" and "certified never auto-fires on green tests alone".
;;      Across many random entries (random stamp-ticket presence, random
;;      stamp-ticket-status, random stamp-ticket-human-approval), the ONLY
;;      entries decide-entry-state ever returns certified/waived for are
;;      those whose human-decision was ALREADY approved/waived in the input.
;;      The generator must reach the sharpest counterexample shape: a stamp
;;      ticket that reached done with human_approval already flipped to
;;      approved (QA passed AND the ordinary ticket-approval flow ran) but
;;      NO ledger human-decision recorded - green tests alone must still not
;;      certify it.
;;
;;   P2 open-entries-keep-resurfacing-until-resolved - invariant 2: "one
;;      audit pass is not enough". Across a long random sequence of tick
;;      times (random deltas) against a fixed resurface cooldown, an entry
;;      that stays open is surfaced more than once - never permanently
;;      muted by the FIRST dedup write. Once a human decision resolves the
;;      entry partway through the simulated sequence, every LATER tick,
;;      however due by cooldown timing, never surfaces it again. The
;;      generator must reach both a multi-surface open run and a resolution
;;      injected mid-stream.

(ns bl848-hotfix-certification-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "hotfix_certification_lib.bb")))
(require '[hotfix-certification-lib :as hc])

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 848))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rchoice [coll] (nth coll (rint (count coll))))

;; ── P1: never-certified-without-a-recorded-decision (invariants 1 + 3) ──────

(def ^:private stamp-ticket-choices [nil "BL-900" "BL-901"])
(def ^:private status-choices [nil "active" "paused" "done"])
(def ^:private human-approval-choices [nil "pending" "approved" "some-other-value"])

(defn- random-entry-without-decision []
  {:stamp-ticket (rchoice stamp-ticket-choices)
   :human-decision nil
   :stamp-ticket-status (rchoice status-choices)
   :stamp-ticket-human-approval (rchoice human-approval-choices)})

(def p1-trials 2000)
(def ^:private p1-reached-sharpest-shape (atom false))

(dotimes [_ p1-trials]
  (let [entry (random-entry-without-decision)
        decided (hc/decide-entry-state entry)]
    (assert-true (str "P1: no human-decision -> never certified/waived (entry=" (pr-str entry) ", got=" (pr-str decided) ")")
                 (not (contains? #{"certified" "waived"} (:state decided))))
    (when (and (= "done" (:stamp-ticket-status entry))
               (= "approved" (:stamp-ticket-human-approval entry))
               (some? (:stamp-ticket entry)))
      (reset! p1-reached-sharpest-shape true)
      (assert-true "P1 sharpest shape: QA-passed + human_approval already approved + no ledger decision -> still awaiting-human, not certified"
                   (= "awaiting-human" (:state decided))))))

;; a non-nil human-decision is the ONLY thing that ever certifies/waives -
;; every random combination of the OTHER fields is irrelevant once it's set
(dotimes [_ 500]
  (let [decision (rchoice ["approved" "waived"])
        entry (assoc (random-entry-without-decision) :human-decision decision)
        decided (hc/decide-entry-state entry)
        expected (if (= decision "approved") "certified" "waived")]
    (assert-true (str "P1: a recorded " decision " decision always resolves to " expected)
                 (= expected (:state decided)))))

(assert-true "P1 generator reached the sharpest counterexample shape (done + approved + no ledger decision)"
             @p1-reached-sharpest-shape)

;; ── P2: open entries keep resurfacing until resolved (invariant 2) ─────────

(def cooldown-ms 1000)
(def ^:private p2-reached-multi-surface (atom false))
(def ^:private p2-reached-mid-stream-resolution (atom false))

(dotimes [trial 40]
  (let [n-ticks (+ 20 (rint 60))
        resolve-at-tick (when (rbool) (+ 3 (rint (max 1 (- n-ticks 3)))))
        base-delta (+ 100 (rint 900))]
    (loop [tick 0 now 0 last-surfaced {} surfaced-count 0 resolved? false]
      (if (>= tick n-ticks)
        (do
          (when (and (not resolve-at-tick) (> surfaced-count 1))
            (reset! p2-reached-multi-surface true))
          (when resolve-at-tick (reset! p2-reached-mid-stream-resolution true))
          (assert-true (str "P2 trial " trial ": an entry left open its whole run is surfaced more than once when the run spans several cooldown windows")
                       (or resolve-at-tick (< (* n-ticks base-delta) (* 2 cooldown-ms)) (> surfaced-count 1))))
        (let [just-resolved? (= tick resolve-at-tick)
              now-resolved? (or resolved? just-resolved?)
              entry (cond-> {:stamp-ticket nil :human-decision nil}
                      now-resolved? (assoc :human-decision "approved"))
              report (hc/assemble-report {:entries [entry] :now-ms now
                                           :last-surfaced-ms-by-commit last-surfaced
                                           :resurface-cooldown-ms cooldown-ms})
              surfaced-this-tick? (pos? (count (:due-for-surfacing report)))]
          (when (and now-resolved? surfaced-this-tick?)
            (swap! failures conj (str "FAIL: P2 trial " trial " tick " tick ": a RESOLVED entry was surfaced again after resolution")))
          (recur (inc tick) (+ now base-delta)
                 (:new-dedup-state report)
                 (if surfaced-this-tick? (inc surfaced-count) surfaced-count)
                 now-resolved?))))))

(assert-true "P2 generator reached a multi-surface open run (never-resolved, spans multiple cooldown windows)"
             @p2-reached-multi-surface)
(assert-true "P2 generator reached a mid-stream resolution (resurfacing stops the instant a decision is recorded)"
             @p2-reached-mid-stream-resolution)

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "bl848_hotfix_certification_property_runner: ok")
