#!/usr/bin/env bb
;; BL-2050 (coder.prompt's Invariants section - first authorship rests
;; with the coder): PROPERTY test encoding the declared invariant.
;;
;;   invariant - "A role other than QA never completes a forwarding
;;      git_handoff with a reason once it has committed for that ticket
;;      since the parcel was queued, unless a git_handoff naming the
;;      ticket was queued.": an EXHAUSTIVE sweep over every
;;      {forwarding? master-resident? evidenced? qa-note-evidenced?
;;      qa-stage? committed? reason} combination (2*2*2*2*2*2*2 = 128
;;      states - small enough to enumerate completely rather than sample,
;;      the strongest possible reachability floor) of
;;      forward-completion-decision, checked against an
;;      INDEPENDENTLY-shaped oracle (derived fresh from the invariant's own
;;      English text, never copied from the implementation's `cond`).
;;
;; Real-fixture, through-the-real-script coverage of this same invariant
;; (the "unless a git_handoff naming the ticket was queued" / "a role
;; other than QA" / "once it has committed" shapes acting on an actual
;; completion run) lives in the acceptance feature
;; (specs/features/BL-2050-....feature, driven by
;; bl2050CommittedParcelNotANoOpSteps.js) - this runner is the PURE
;; decision's own property proof, not a second copy of that IO.
;;
;; Non-vacuity proven by hand before committing: the property fails (every
;; committed?=true, qa-stage?=false, evidenced?=false case mismatches,
;; both with and without a reason) when forward-completion-decision's new
;; `(and committed? (not qa-stage?) (not evidenced?)) :refuse-committed`
;; clause is deleted. Reverted before landing.

(ns bl2050-forward-gate-committed-property-runner
  (:require [babashka.fs :as fs]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "forward_evidence_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

;; Independently-shaped oracle: each candidate outcome's own applicability
;; is computed as a flag, then the FIRST true flag in priority order wins
;; (a `some`/lookup resolution, not the implementation's nested `cond`).
(defn- oracle-decision
  [{:keys [forwarding? master-resident? evidenced? qa-note-evidenced? qa-stage? committed? reason]}]
  (let [gate-engaged? (and forwarding? (not master-resident?))
        committed-breach? (and gate-engaged? (boolean committed?) (not qa-stage?) (not (boolean evidenced?)))
        reason-given? (some? reason)
        other-evidence? (or (boolean evidenced?) (boolean qa-note-evidenced?))
        flags [[(not gate-engaged?) :complete-plain]
               [committed-breach? :refuse-committed]
               [reason-given? :complete-with-reason]
               [other-evidence? :complete-plain]]]
    (or (some (fn [[flag? outcome]] (when flag? outcome)) flags)
        :refuse)))

(def bool-values [true false])
(def reason-values [nil "a stated reason"])

(doseq [forwarding? bool-values
        master-resident? bool-values
        evidenced? bool-values
        qa-note-evidenced? bool-values
        qa-stage? bool-values
        committed? bool-values
        reason reason-values]
  (let [facts {:forwarding? forwarding? :master-resident? master-resident?
               :evidenced? evidenced? :qa-note-evidenced? qa-note-evidenced?
               :qa-stage? qa-stage? :committed? committed? :reason reason}
        got (forward-evidence-lib/forward-completion-decision facts)
        want (oracle-decision facts)]
    (when (not= want got)
      (fail! (str "invariant: " (pr-str facts) " -> expected " want " got " got)))))

;; A caller that omits committed?/qa-stage? entirely (the batch path,
;; which never passes them) must get exactly today's four-key answer -
;; proven by the SAME oracle with those two keys simply absent from the
;; facts map (nil, same as `false` for every `(not committed?)`-shaped
;; check above, since `committed?` false and nil both fail every `and`).
(doseq [forwarding? bool-values
        master-resident? bool-values
        evidenced? bool-values
        qa-note-evidenced? bool-values
        reason reason-values]
  (let [facts {:forwarding? forwarding? :master-resident? master-resident?
               :evidenced? evidenced? :qa-note-evidenced? qa-note-evidenced?
               :reason reason}
        got (forward-evidence-lib/forward-completion-decision facts)
        want (oracle-decision facts)]
    (when (not= want got)
      (fail! (str "invariant (no committed?/qa-stage? key): " (pr-str facts) " -> expected " want " got " got)))))

(println "bl2050_forward_gate_committed property: 128-state oracle sweep + 32-state no-key sweep")
(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
