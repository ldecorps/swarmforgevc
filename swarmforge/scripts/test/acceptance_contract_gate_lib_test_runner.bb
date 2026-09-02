#!/usr/bin/env bb
;; TDD runner for acceptance_contract_gate_lib.bb — BL-761 pure decision
;; surface: declaration-readable?/registry-loadable?/unresolved-steps ->
;; findings/warnings. No git, no filesystem, no require of the real step
;; registry - every fact this lib needs is passed in as plain data by the
;; caller (pre_qa_gate_gather_lib.bb owns the git/fs/require legwork).

(ns acceptance-contract-gate-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "acceptance_contract_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── declaration unreadable -> fails CLOSED ──────────────────────────────

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? false
               :registry-loadable? true :unresolved-steps []})]
  (assert= "an unreadable declaration produces exactly one finding"
           1 (count (:findings result)))
  (assert= "the finding's class is :acceptance-contract"
           :acceptance-contract (:class (first (:findings result))))
  (assert-true "the finding names the declaration as unreadable"
               (re-find #"unreadable" (:detail (first (:findings result)))))
  (assert= "no warnings when the declaration itself is the problem"
           [] (:warnings result)))

;; registry-loadable?/unresolved-steps must never be consulted once the
;; declaration itself is unreadable - a bogus/impossible combination
;; (registry NOT loadable AND unresolved-steps present) still yields the
;; single declaration finding, not a crash or a second finding.
(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? false
               :registry-loadable? false :registry-load-error "boom"
               :unresolved-steps [{:scenario "s" :example-index nil :step-text "x"}]})]
  (assert= "declaration-unreadable short-circuits regardless of registry state"
           1 (count (:findings result))))

;; ── registry unloadable -> fails OPEN (warning, never a finding) ───────

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? true
               :registry-loadable? false :registry-load-error "Cannot find module '../../../extension/out/tools/foo'"
               :unresolved-steps []})]
  (assert= "an unloadable registry produces no findings"
           [] (:findings result))
  (assert= "an unloadable registry produces exactly one warning"
           1 (count (:warnings result)))
  (assert-true "the warning names the ticket and the load error"
               (and (re-find #"BL-999" (first (:warnings result)))
                    (re-find #"extension/out/tools/foo" (first (:warnings result))))))

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? true
               :registry-loadable? false :unresolved-steps []})]
  (assert-true "a nil registry-load-error still produces a readable warning, never throws"
               (re-find #"unknown error" (first (:warnings result)))))

;; ── BL-1031 ruling (b): wait-bound hit fails CLOSED with a named finding ─

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? true
               :registry-loadable? false :wait-bound-hit? true
               :registry-load-error "wait-bound hit (exit 124): daemon-cycle-guard: bounded-wait timeout"
               :unresolved-steps []})]
  (assert= "wait-bound hit produces exactly one finding" 1 (count (:findings result)))
  (assert= "wait-bound hit produces no fail-open warning" [] (:warnings result))
  (assert-true "the finding names the wait-bound"
               (re-find #"wait-bound" (:detail (first (:findings result))))))

;; ── declaration readable + registry loadable + no unresolved steps -> clean pass

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? true
               :registry-loadable? true :unresolved-steps []})]
  (assert= "a fully-resolved contract produces no findings" [] (:findings result))
  (assert= "a fully-resolved contract produces no warnings" [] (:warnings result)))

;; ── unresolved steps -> one finding each, naming scenario/row/step ─────

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? true :registry-loadable? true
               :unresolved-steps [{:scenario "the parcel is refused" :example-index nil
                                    :step-text "the widget spins up"}]})]
  (assert= "one unresolved step (no example row) -> one finding"
           1 (count (:findings result)))
  (assert= "the finding's class is :acceptance-contract"
           :acceptance-contract (:class (first (:findings result))))
  (assert-true "the detail names the scenario"
               (re-find #"the parcel is refused" (:detail (first (:findings result)))))
  (assert-true "the detail names the step text"
               (re-find #"the widget spins up" (:detail (first (:findings result)))))
  (assert-true "a step with no example row names no row number"
               (not (re-find #"example row" (:detail (first (:findings result)))))))

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? true :registry-loadable? true
               :unresolved-steps [{:scenario "a Scenario Outline" :example-index 2
                                    :step-text "the substituted value appears"}]})]
  (assert-true "an unresolved outline row names the 1-indexed example row"
               (re-find #"example row 3" (:detail (first (:findings result))))))

;; every unresolved step becomes its OWN finding - a step failure anywhere,
;; including the last scenario checked, is never silently dropped or
;; merged into a single summary finding (BL-761 invariant 2: never
;; skipped, sampled, or assumed matched).
(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-999" :declaration-readable? true :registry-loadable? true
               :unresolved-steps [{:scenario "first scenario" :example-index nil :step-text "a"}
                                   {:scenario "last scenario" :example-index nil :step-text "z"}]})]
  (assert= "two unresolved steps -> two findings, in gathered order"
           ["first scenario" "last scenario"]
           (mapv :scenario (:findings result))))

;; ── BL-1340: the exit end of the gate promotion opens ────────────────────
;; Promotion now admits a draft the ticket pins itself to converting, so the
;; refusal moves here: a parcel whose acceptance STILL names a .feature.draft
;; at the cited commit never reaches QA. Fails CLOSED, and names the draft -
;; BL-441's silence is a contract that went unexecuted, and the runner globs
;; *.feature, so a draft is exactly that silence however well its steps
;; happen to resolve.

(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-9340"
               :declaration-readable? true
               :declaration-draft "specs/features/BL-9340-thing.feature.draft"
               :registry-loadable? true
               :unresolved-steps []})]
  (assert= "BL-1340: an unconverted draft is one finding" 1 (count (:findings result)))
  (assert= "BL-1340: and it is an acceptance-contract finding" :acceptance-contract
           (:class (first (:findings result))))
  (assert-true "BL-1340: and it names the draft"
               (clojure.string/includes? (:detail (first (:findings result)))
                                         "specs/features/BL-9340-thing.feature.draft"))
  (assert= "BL-1340: a closed failure is never softened into a warning" [] (:warnings result)))

;; The declared ordering (draft checked BEFORE wait-bound-hit?) is itself an
;; observable contract, not just prose: a ticket that hits BOTH must surface
;; the draft finding, which tells the human what to actually fix ("convert
;; your draft"), not the wait-bound message, which reads as a transient
;; infrastructure hiccup and would send them chasing the wrong thing.
(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-9340"
               :declaration-readable? true
               :declaration-draft "specs/features/BL-9340-thing.feature.draft"
               :registry-loadable? true
               :wait-bound-hit? true
               :unresolved-steps []})]
  (assert= "BL-1340: draft outranks wait-bound-hit? when both are true" 1 (count (:findings result)))
  (assert-true "BL-1340: and the surfaced finding is the draft one, not the wait-bound one"
               (clojure.string/includes? (:detail (first (:findings result)))
                                         "specs/features/BL-9340-thing.feature.draft")))

;; Every step resolving is not a rescue: the runner still never executes a
;; .feature.draft, so a clean resolution must not turn this into a pass.
(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-9340"
               :declaration-readable? true
               :declaration-draft "specs/features/BL-9340-thing.feature.draft"
               :registry-loadable? true
               :unresolved-steps []})]
  (assert-true "BL-1340: a draft whose steps all resolve still fails"
               (seq (:findings result))))

;; A converted pointer is untouched - the ordinary path stays exactly as it
;; was, and nothing about draft-ness fires for a live .feature.
(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-9340"
               :declaration-readable? true
               :declaration-draft nil
               :registry-loadable? true
               :unresolved-steps []})]
  (assert= "BL-1340: a converted pointer still passes clean" {:findings [] :warnings []} result))

;; An unreadable declaration still wins: there is nothing to call a draft.
(let [result (acceptance-contract-gate-lib/evaluate
              {:ticket-id "BL-9340"
               :declaration-readable? false
               :declaration-draft "specs/features/BL-9340-thing.feature.draft"})]
  (assert= "BL-1340: an unreadable declaration keeps its own finding" 1 (count (:findings result))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: acceptance_contract_gate_lib.bb"))
