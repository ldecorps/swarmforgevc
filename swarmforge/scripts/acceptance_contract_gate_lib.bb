#!/usr/bin/env bb
;; BL-761: pure decision surface for the pre-QA acceptance-contract gate - the
;; third finding beside ancestry and wiring (BL-531) that arms on the same
;; documenter -> QA edge. Turns pre-gathered facts (never git, fs, or a
;; step-registry require of its own) into an ordered list of
;; PRE_QA_GATE_FAIL :acceptance-contract findings, or a fail-open warning.
;; pre_qa_gate_gather_lib.bb does all the git/fs/require legwork - resolving
;; the ticket's acceptance: declaration to a feature file at the cited
;; commit, parsing it with the vendored APS parser, materializing and
;; require()-ing the step registry as it existed at that same commit, and
;; resolving every step of every scenario (substituting every Scenario
;; Outline example row first) - and calls `evaluate` here to decide.
;;
;; Third invariant (BL-761 ticket YAML): an acceptance declaration that
;; cannot be read - absent, inline-only, or naming a missing file - fails
;; CLOSED (a finding); an infrastructure failure that prevents the check
;; from running at all (the step registry itself cannot be loaded at the
;; cited commit - e.g. extension/out/ was never compiled) fails OPEN (a
;; warning, never a finding) - the same fail-open posture the existing
;; ancestry/wiring findings take for infrastructure trouble.

(ns acceptance-contract-gate-lib)

;; ── finding/warning formatting ──────────────────────────────────────────

(defn- unresolved-step-detail
  [{:keys [scenario example-index step-text]}]
  (if example-index
    (format "scenario \"%s\" [example row %d]: no step handler matched \"%s\""
            scenario (inc example-index) step-text)
    (format "scenario \"%s\": no step handler matched \"%s\"" scenario step-text)))

(defn- unresolved-step-finding
  [ticket-id step]
  (merge {:class :acceptance-contract :ticket-id ticket-id
          :detail (unresolved-step-detail step)}
         step))

(def ^:private unreadable-declaration-detail
  "acceptance: declaration is unreadable at the cited commit (absent, inline Gherkin, or naming a feature file that does not exist there)")

;; ── top-level entry point ────────────────────────────────────────────────

(defn evaluate
  "opts: {:ticket-id :declaration-readable? :registry-loadable?
   :registry-load-error :unresolved-steps}. Returns {:findings [...]
   :warnings [...]}.

   - declaration-readable? false -> one :acceptance-contract finding, fails
     CLOSED; registry-loadable?/unresolved-steps are never consulted (there
     is nothing to resolve steps against).
   - declaration-readable? true but registry-loadable? false -> no finding,
     one warning naming registry-load-error - fails OPEN.
   - both readable/loadable -> one :acceptance-contract finding per
     unresolved step (every scenario, every Scenario Outline example row,
     every step - none skipped, sampled, or assumed matched), in the order
     gathered. Empty unresolved-steps -> a clean pass: no findings, no
     warnings."
  [{:keys [ticket-id declaration-readable? registry-loadable? registry-load-error unresolved-steps]}]
  (cond
    (not declaration-readable?)
    {:findings [{:class :acceptance-contract :ticket-id ticket-id :detail unreadable-declaration-detail}]
     :warnings []}

    (not registry-loadable?)
    {:findings []
     :warnings [(format "acceptance-contract:%s step registry could not be loaded at the cited commit (%s)"
                         ticket-id (or registry-load-error "unknown error"))]}

    :else
    {:findings (mapv (partial unresolved-step-finding ticket-id) (or unresolved-steps []))
     :warnings []}))
