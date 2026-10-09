#!/usr/bin/env bb
;; local_seat_acceptance_gate_lib.bb — BL-2071: a local-model seat's
;; git_handoff is queued, and local_seat_phase_cli.bb's `pass` moves a
;; parcel's phase to done, only when the ticket's own acceptance: feature
;; passes at the commit being checked. The human, 2026-10-07, verbatim: "Iq3
;; shoyld absokuyely eun the acceptence tests ad part of asses step, to
;; avoid qa findong the error." Measured over the iq3 coder's sessions since
;; 2026-10-04: 258 swarm_handoff.sh calls, only 104 of them in a session that
;; had run the feature first - most forwards ran no check at all, and QA
;; found the errors instead.
;;
;; ONE CHECK, TWO CALLERS (BL-2071 invariant 2): run-check! below is called
;; from swarm_handoff.bb's send gate (findings-for-git-handoff) AND from
;; local_seat_phase_cli.bb's `pass` subcommand, so the assert step's own
;; pass and the forward can never judge the same commit differently.
;;
;; FAIL CLOSED ON THE FEATURE'S OWN OUTCOME — the opposite posture of every
;; sibling git_handoff gate in swarm_handoff.bb's chain. A failing scenario,
;; an unresolved step (both surface identically: runtime.js throws from
;; INSIDE the running scenario, never at generation time, so both are an
;; ordinary TAP "not ok"), or a run that cannot complete within the bound
;; (a wedged child, a spawn failure once cli.js is confirmed present) all
;; REFUSE - this gate exists because a local seat's forward with no check
;; at all was the defect itself, and fail-open on these would recreate that
;; exact gap under a different name. This is a deliberate, ticket-mandated
;; exception to the fail-open posture every other *_gate_lib.bb in this
;; family takes.
;;
;; FAIL OPEN ON cli.js ITSELF BEING UNREACHABLE — the one exception, and a
;; narrower infrastructure-only case than the paragraph above: a checkout
;; that cannot even locate the acceptance-running tool is not a signal
;; about the TICKET's quality, the same line BL-761's acceptance-contract
;; gate already draws (see run-acceptance-feature!'s header for why this
;; matters in practice, not only in principle).
;;
;; CLOUD SEATS ARE UNCHANGED (scenario 03): local-model-seat? gates the
;; WHOLE check before anything else runs - a non-local-model seat's call
;; makes no acceptance run at all, never a vacuous pass. The check is keyed
;; off the SEAT's own SWARMFORGE_ROLE (e.g. "coder" vs "coder@2"), never the
;; canonicalized STAGE sender-role returns elsewhere in swarm_handoff.bb
;; (BL-983 collapses both seats to the stage "coder", which would blind
;; this gate to exactly the distinction it exists to draw).
;;
;; cli.js's own location is resolved from `root` exactly as
;; pre_qa_gate_gather_lib.bb's run-contract-step-resolver resolves
;; resolve_contract_steps.js: "this checkout's own copy - a stable tool...
;; not part of the cited commit's contract." No git-show materialization is
;; needed here (unlike that resolver): this check runs at the seat's live
;; HEAD, which the ticket's own direction states IS the commit being
;; forwarded by construction, never a different historical commit.

(ns local-seat-acceptance-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def ^:private lib-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path lib-dir "gpu_pause_lib.bb")))
(load-file (str (fs/path lib-dir "pipeline_stage_lib.bb")))
(load-file (str (fs/path lib-dir "pre_qa_gate_gather_lib.bb")))
(load-file (str (fs/path lib-dir "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path lib-dir "handoff_lib.bb")))

;; Generous over a mutation-free Babashka check's own git/fs calls, but this
;; bounds a REAL node process running a whole feature file (gherkin parse +
;; generate + `node --test`) - BL-1358's real-git-fixture scenarios alone run
;; 10-20s each, so a multi-scenario feature can legitimately take a minute.
;; Configurable for the same reason sh!'s own bound is (a slow host raises it
;; without editing code), never to disable the ceiling (BL-2071 invariant 1:
;; a run past the bound is a refusal, never a silent pass).
(def default-run-bound-ms 120000)

(defn run-bound-ms []
  (or (some-> (System/getenv "SWARMFORGE_LOCAL_SEAT_ACCEPTANCE_BOUND_MS") parse-long)
      default-run-bound-ms))

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn acceptance-declaration
  "The ticket's own acceptance: value read from its live backlog YAML under
   `root`, or nil when the ticket cannot be found or the declaration is
   blank/multi-line (inline Gherkin) - nothing this gate can run as a single
   feature-file path. The QA-edge acceptance-contract gate (BL-761) owns
   that judgement; this gate only ever runs a real, resolvable path."
  [root ticket-id]
  (when-let [content (pre-qa-gate-gather-lib/find-ticket-yaml-content (str root) ticket-id)]
    (let [raw (read-yaml-field content "acceptance")]
      (when (and raw (not (str/blank? raw)) (not (str/includes? raw "\n")))
        raw))))

(defn feature-path
  "declaration resolved against root - as-is when it is already absolute
   (the fixture's own convenience; a real ticket's acceptance: is always
   root-relative)."
  [root declaration]
  (if (fs/absolute? declaration) declaration (str (fs/path root declaration))))

(defn failing-lines
  "Every TAP 'not ok' line, plus every 'error:' detail line, from a cli.js
   run's combined stdout+stderr - together these name both the failing
   scenario (BL-2071 example row 1) and, for an unresolved step, the step
   text itself (example row 3's \"no step handler matched ...\" detail,
   which runtime.js throws from inside the running scenario - see this
   file's header)."
  [output]
  (->> (str/split-lines (or output ""))
       (filter #(re-find #"^\s*(not ok \d|error:)" %))
       (mapv str/trim)))

(defn run-acceptance-feature!
  "Runs `node <root>/specs/pipeline/cli.js <feature-path>` with cwd root,
   bounded by run-bound-ms. {:passed? :timed-out? :infra-missing? :output}.
   cli.js itself missing at root is INFRASTRUCTURE trouble, not a quality
   signal about the ticket's feature - the same line BL-761's
   acceptance-contract gate already draws between \"the declaration cannot
   be read\" (fails closed) and \"the step registry cannot be LOADED at
   all\" (fails open, see acceptance_contract_gate_lib.bb's header). Every
   fixture across this suite that forwards a local-model seat's parcel for
   an UNRELATED reason (BL-2038's session-restart mechanics, say) commits a
   placeholder acceptance: feature solely to satisfy the EXISTENCE-only
   gates (BL-880/BL-761) that predate this one and never actually ran it;
   a real swarmforge checkout always has cli.js, so this can only fire in
   exactly those unrelated fixtures - never in production, and never in
   this ticket's own scenarios (which always symlink cli.js in)."
  [root declaration]
  (let [cli-js (str (fs/path (str root) "specs" "pipeline" "cli.js"))]
    (if-not (fs/exists? cli-js)
      {:passed? true :infra-missing? true
       :output (str "local_seat_acceptance_gate_lib: cli.js not found at " cli-js)}
      (let [path (feature-path root declaration)
            result (daemon-cycle-guard-lib/sh! {:dir (str root) :bound-ms (run-bound-ms)}
                                                "node" cli-js path)]
        {:passed? (zero? (:exit result))
         :timed-out? (= 124 (:exit result))
         :output (str (:out result) (:err result))}))))

(defn blocked? [result] (boolean (seq (:findings result))))

(defn refusal-message
  "task-name is nil-safe so the SAME formatting serves local_seat_phase_cli.bb's
   `pass` (no task: header, just a ticket id) and swarm_handoff.bb's
   git_handoff gate (a task name) - both name the ticket either way."
  [{:keys [ticket-id task-name findings]}]
  (let [{:keys [feature-path timed-out? failing output]} (first findings)
        name (or task-name ticket-id)]
    (cond
      timed-out?
      (format (str "BL-2071: the acceptance feature %s for %s did not complete within %dms at "
                   "the forwarded commit - a local-model seat's forward is refused on a run "
                   "that cannot complete, never silently passed.")
              feature-path name (run-bound-ms))

      (seq failing)
      (format "BL-2071: the acceptance feature %s for %s failed at the forwarded commit:\n%s"
              feature-path name (str/join "\n" failing))

      :else
      (format "BL-2071: the acceptance feature %s for %s could not be run at the forwarded commit.\nOutput:\n%s"
              feature-path name output))))

(defn run-check!
  "The one check both callers share (BL-2071 invariant 2). {:findings []}
   when the declaration is unreadable (nothing to run), cli.js itself is
   missing at root (infrastructure trouble - a :warnings entry names it,
   fail OPEN, see run-acceptance-feature!'s header), or the run passes.
   One finding, blocking, otherwise."
  [{:keys [root ticket-id]}]
  (if-let [declaration (acceptance-declaration root ticket-id)]
    (let [run (run-acceptance-feature! root declaration)]
      (cond
        (:infra-missing? run)
        {:findings [] :warnings [(format "local-seat-acceptance check for %s could not run (%s) - send allowed, unverified (BL-2071)"
                                          ticket-id (:output run))]}

        (:passed? run)
        {:findings []}

        :else
        {:findings [{:ticket-id ticket-id
                     :feature-path (feature-path root declaration)
                     :timed-out? (:timed-out? run)
                     :failing (failing-lines (:output run))
                     :output (:output run)}]}))
    {:findings []}))

(defn findings-for-git-handoff
  "opts: {:root :seat :task-name :commit}. {:findings []} when `seat` (the
   sender's own raw SWARMFORGE_ROLE, never swarm_handoff.bb's canonicalized
   STAGE - see this file's header) is not a local-model seat (scenario 03) or
   the task name names no ticket. commit is accepted for symmetry with every
   sibling gate's call shape but not otherwise consulted: the ticket's own
   direction states the seat's worktree HEAD IS the commit being forwarded
   when it sends, so there is nothing for this gate to check out."
  [{:keys [root seat task-name commit]}]
  (if-not (gpu-pause-lib/local-model-seat? (:agent (handoff-lib/load-role-info seat (str root))))
    {:findings []}
    (let [ticket-id (pipeline-stage-lib/extract-ticket-id task-name)]
      (if-not ticket-id
        {:findings []}
        (-> (run-check! {:root root :ticket-id ticket-id})
            (update :findings (fn [findings] (mapv #(assoc % :task-name task-name) findings))))))))
