#!/usr/bin/env bb
;; Model Steward CLI (BL-547 Slice 1) — the shell entry point over the Model
;; Registry, Capability Registry, Role Recommendation Matrix, and Prompt
;; Adapter catalogue. Thin: all decisions live in model_steward_lib.bb, all
;; disk IO in model_steward_store.bb. `eligible` is the certification-gate
;; contract endpoint ModelFactory (BL-525) consults before assign() — this
;; ticket authors the endpoint only, never ModelFactory's apply path.
;;
;; Usage:
;;   model_steward_cli.bb status
;;   model_steward_cli.bb show <provider>/<model>
;;   model_steward_cli.bb register <provider>/<model> [--status candidate|certified|deprecated] [--context-window N] [--cost-class low|medium|high] [--limitations "a;b"]
;;   model_steward_cli.bb certify <provider>/<model>
;;   model_steward_cli.bb decertify <provider>/<model> --reason <text> [--status candidate|deprecated]
;;   model_steward_cli.bb evaluate <provider>/<model> --role <role> --scorecard <path> [--bakeoff <path>] [--decertify-on-regression]
;;   model_steward_cli.bb role-matrix <role> [--include-uncertified]
;;   model_steward_cli.bb capability <provider>/<model>
;;   model_steward_cli.bb adapter <provider>/<model>
;;   model_steward_cli.bb compat-docs [--out <path>]
;;   model_steward_cli.bb eligible <provider>/<model> --role <role> [--override-uncertified]
;;   model_steward_cli.bb trial nominate <provider>/<model> --role <role> [--evidence <path>]
;;   model_steward_cli.bb trial status [--role <role>]
;;   model_steward_cli.bb trial assess --role <role> [--now <iso>]
(ns model-steward-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "model_steward_store.bb")))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_steward_evaluate_lib.bb")))
(load-file (str (fs/path scripts-dir "model_steward_trial_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_store.bb")))
(load-file (str (fs/path scripts-dir "node_tool_bringup_lib.bb")))
(load-file (str (fs/path scripts-dir "model_steward_coder_probe_lib.bb")))
(load-file (str (fs/path scripts-dir "model_steward_brief_lib.bb")))
(load-file (str (fs/path scripts-dir "local_model_prepare_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn state-dir
  "Runtime state root. Overridable via MODEL_STEWARD_STATE_DIR so acceptance
   and shell tests can point the CLI at an isolated temp dir instead of
   mutating this repo's real .swarmforge/model-steward/ on every run."
  []
  (or (System/getenv "MODEL_STEWARD_STATE_DIR")
      (str (fs/path (model-steward-store/repo-root) model-steward-store/default-state-dir-rel))))

(defn load-registry []
  (model-steward-store/read-registry! (state-dir) model-steward-lib/seed-data->registry))

(defn save-registry! [registry]
  (model-steward-store/write-registry! (state-dir) registry))

(defn parse-provider-model
  "Splits a \"provider/model\" composite on its FIRST \"/\" only — a model
   name may itself contain no further slash in this seed, but splitting on
   the first occurrence keeps that assumption local to one place."
  [s]
  (let [idx (str/index-of s "/")]
    (when-not idx
      (binding [*out* *err*]
        (println (str "expected <provider>/<model>, got: " s)))
      (System/exit 1))
    [(subs s 0 idx) (subs s (inc idx))]))

(defn opt-value
  "Returns the value following flag `k` in `args`, or nil if absent. `args`
   may be any seq — .indexOf is a java.util.List method, not a Collection
   one, so a lazy seq (e.g. from `rest`) must be coerced to a vector first."
  [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (and (>= idx 0) (< (inc idx) (count args)))
      (nth args (inc idx)))))

(defn has-flag? [args k]
  (boolean (some #(= k %) args)))

(defn print-entry-or-die
  "Shared shape behind show/capability/adapter: print `entry` via `render`
   when found, else report `missing-label` for provider/model to stderr and
   exit 1."
  [entry render missing-label provider model]
  (if entry
    (println (render entry))
    (do (binding [*out* *err*] (println (str "no " missing-label " for " provider "/" model)))
        (System/exit 1))))

(defn usage []
  (println "Usage: model_steward_cli.bb <command> [args...]")
  (println "Commands:")
  (println "  status")
  (println "  show <provider>/<model>")
  (println "  register <provider>/<model> [--status S] [--context-window N] [--cost-class C] [--limitations \"a;b\"]")
  (println "  certify <provider>/<model>")
  (println "  decertify <provider>/<model> --reason <text> [--status candidate|deprecated]")
  (println "  role-matrix <role> [--include-uncertified]")
  (println "  capability <provider>/<model>")
  (println "  adapter <provider>/<model>")
  (println "  eligible <provider>/<model> --role <role> [--override-uncertified]")
  (println "  evaluate <provider>/<model> --role <role> --scorecard <path> [--bakeoff <path>] [--decertify-on-regression]")
  (println "  compat-docs [--out <path>]")
  (println "  trial nominate <provider>/<model> --role <role> [--evidence <path>]")
  (println "  trial go-live <provider>/<model> --role <role>")
  (println "  trial status [--role <role>]")
  (println "  trial assess --role <role> [--now <iso>]")
  (println "  prepare <base-tag> [--alias <name>] [--num-ctx N] [--num-predict N] [--dry-run] [--reprobe]")
  (println "  probe <model> [--scenario <id>]... [--all] [--endpoint-url <url>] [--evidence-dir <dir>]")
  (println "           [--prepare] [--prepare-alias <name>] [--model-settings-file <path>]")
  (println "  probe score-hazard --handed-off <true|false> [--spec-changed <true|false>] [--touched-outside <true|false>]")
  (System/exit 1))

(defn run-status []
  (doseq [{:keys [provider model status]} (model-steward-lib/registry-summary (load-registry))]
    (println (str provider "/" model " " status))))

(defn run-show [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        entry (model-steward-lib/model-entry (load-registry) provider model)]
    (print-entry-or-die entry json/generate-string "registry entry" provider model)))

(defn run-capability [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        entry (model-steward-lib/capability-entry (load-registry) provider model)]
    (print-entry-or-die entry json/generate-string "capability entry" provider model)))

(defn- parse-limitations-flag
  "Splits --limitations \"a;b\" into trimmed strings; absent/blank → nil."
  [flags]
  (when-let [lim (not-empty (opt-value flags "--limitations"))]
    (into [] (remove str/blank? (map str/trim (str/split lim #";"))))))

(defn run-register [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        flags (rest rest-args)
        status (opt-value flags "--status")
        context-window (opt-value flags "--context-window")
        cost-class (opt-value flags "--cost-class")
        registry (load-registry)
        updated (model-steward-lib/register-model
                 registry provider model
                 {:status status
                  :context_window (when context-window (Long/parseLong context-window))
                  :cost_class cost-class
                  :known_limitations (parse-limitations-flag flags)})]
    (save-registry! updated)
    (println (str provider "/" model " " (:status (model-steward-lib/model-entry updated provider model))))))

(defn default-compat-docs-path
  []
  (or (System/getenv "MODEL_STEWARD_COMPAT_DOCS_PATH")
      (str (fs/path (model-steward-store/repo-root) "docs/reference/model-compatibility.md"))))

(defn run-compat-docs
  "BL-557: write the registry projection to the committed docs path (or
   --out / MODEL_STEWARD_COMPAT_DOCS_PATH for isolated acceptance runs)."
  [rest-args]
  (let [out-path (or (opt-value rest-args "--out") (default-compat-docs-path))
        body (model-steward-lib/render-compat-docs (load-registry))]
    (fs/create-dirs (fs/parent out-path))
    (spit out-path body)
    (println (str "wrote " out-path))))

(defn run-certify
  "BL-1079: certify requires a compliance-battery scorecard artifact at the
   well-known path under the state dir. Absent → refuse, name the path,
   leave status untouched, write no certification report. Present → flip
   status and record a report that names the scorecard it read."
  [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        registry (load-registry)
        scorecard-rel (model-steward-lib/scorecard-relative-path provider model)
        scorecard (model-steward-store/read-scorecard! (state-dir) scorecard-rel)]
    (when-not scorecard
      (binding [*out* *err*]
        (println (str "certify refused: missing compliance-battery scorecard at " scorecard-rel)))
      (System/exit 1))
    ;; Safety gate (model-steward-lib/certification-safety-gate): a scorecard
    ;; on disk is necessary, not sufficient. Refuse - status untouched, no
    ;; report written - unless every safety-critical competency is present
    ;; and passed.
    (let [gate (model-steward-lib/certification-safety-gate (:entries scorecard))]
      (when-not (:ok? gate)
        (binding [*out* *err*]
          (println (str "certify refused: " (:reason gate) " (scorecard=" scorecard-rel ")")))
        (System/exit 1)))
    (let [timestamp (now-iso)
          report (model-steward-lib/build-certification-report
                  provider model
                  (vec (or (:entries scorecard) []))
                  timestamp
                  {:scorecard-path scorecard-rel
                   :overall (:overall scorecard)})
          report-path (model-steward-store/write-certification-report!
                       (state-dir) provider model timestamp report)
          updated (model-steward-lib/certify registry provider model report-path)]
      (save-registry! updated)
      (println (str provider "/" model " certified (" report-path ") scorecard=" scorecard-rel)))))

(defn run-decertify [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        flags (rest rest-args)
        reason (opt-value flags "--reason")
        new-status (or (opt-value flags "--status") model-steward-lib/candidate-status)]
    (when (str/blank? reason)
      (binding [*out* *err*] (println "decertify requires --reason <text>"))
      (System/exit 1))
    (let [registry (load-registry)
          entry (model-steward-lib/model-entry registry provider model)
          prior-report (when (:certification_report_path entry)
                         (model-steward-store/read-certification-report!
                          (state-dir) (:certification_report_path entry)))
          timestamp (now-iso)
          regression-report (model-steward-lib/build-regression-report provider model prior-report reason timestamp)
          report-path (model-steward-store/write-certification-report!
                       (state-dir) provider model timestamp regression-report)
          updated (model-steward-lib/decertify registry provider model report-path
                                                {:reason reason :new-status new-status})]
      (save-registry! updated)
      (println (str provider "/" model " " new-status " (" reason ") report=" report-path)))))

(defn run-role-matrix [rest-args]
  (when (empty? rest-args) (usage))
  (let [role (first rest-args)
        include-uncertified? (has-flag? (rest rest-args) "--include-uncertified")
        ranked (model-steward-lib/role-recommendations
                (load-registry) role {:include-uncertified? include-uncertified?})]
    (doseq [{:keys [provider model score evidence]} ranked]
      (println (str provider "/" model " " score " " evidence)))))

(defn run-adapter [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        adapter (model-steward-lib/adapter-for (load-registry) provider model)
        render #(str (:adapter_id %) " production_default=" (boolean (:production_default %)))]
    (print-entry-or-die adapter render "adapter entry" provider model)))

(defn run-eligible [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        flags (rest rest-args)
        override-uncertified? (has-flag? flags "--override-uncertified")
        eligible? (model-steward-lib/assignment-eligible?
                   (load-registry) provider model {:override-uncertified? override-uncertified?})]
    (println (if eligible? "eligible" "ineligible"))
    (when-not eligible? (System/exit 1))))

(defn- evaluate-die!
  [msg]
  (binding [*out* *err*] (println msg))
  (System/exit 1))

(defn- load-evaluate-artifacts!
  "Resolve scorecard (+ optional bake-off) JSON or exit with a refusal."
  [scorecard-path bakeoff-path]
  (let [scorecard-art (model-steward-store/read-evidence-json! (state-dir) scorecard-path)
        bakeoff-art (when bakeoff-path
                      (model-steward-store/read-evidence-json! (state-dir) bakeoff-path))]
    (when-not scorecard-art
      (evaluate-die! (str "evaluate refused: scorecard not found at " scorecard-path)))
    (when (and bakeoff-path (nil? bakeoff-art))
      (evaluate-die! (str "evaluate refused: bake-off not found at " bakeoff-path)))
    [scorecard-art bakeoff-art]))

(defn- registry-after-evaluate
  "Certify on clean gates; optionally decertify on pass→fail when requested."
  [with-report provider model report-path result timestamp decertify?]
  (cond
    (and decertify? (seq (:regressions result)))
    (let [reason (str "evaluate regression: "
                      (str/join ", " (map :gate (:regressions result))))
          reg-report (model-steward-lib/build-regression-report
                      provider model (:report result) reason timestamp)
          reg-path (model-steward-store/write-certification-report!
                    (state-dir) provider model
                    (str timestamp "-regression") reg-report)]
      (model-steward-lib/decertify with-report provider model reg-path
                                    {:reason reason
                                     :new-status model-steward-lib/candidate-status}))
    (empty? (:regressions result))
    ;; evaluate's clean-gates auto-certify must clear the same safety gate
    ;; `certify` does, or it is a back door around it: the recruiter
    ;; scorecard it just ingested carries role gates, not the compliance-
    ;; battery safety probe, so read the well-known battery scorecard here.
    (let [rel  (model-steward-lib/scorecard-relative-path provider model)
          card (model-steward-store/read-scorecard! (state-dir) rel)
          gate (model-steward-lib/certification-safety-gate (:entries card))]
      (if (:ok? gate)
        (model-steward-lib/certify with-report provider model report-path)
        (do (binding [*out* *err*]
              (println (str "evaluate: gates clean but NOT certifying - "
                            (if card (:reason gate)
                                     (str "missing compliance-battery scorecard at " rel))
                            "; status left unchanged")))
            with-report)))
    :else with-report))

(defn- print-evaluate-result
  [provider model role report-path result decertify?]
  (when (seq (:regressions result))
    (binding [*out* *err*]
      (doseq [r (:regressions result)]
        (println (str "REGRESSION " (:gate r) " pass->fail")))))
  (println (str provider "/" model
                " evaluated role=" role
                " report=" report-path
                " evidence=" (:evidence result)
                (when (seq (:regressions result))
                  (str " regressions=" (count (:regressions result))))
                (when (and decertify? (seq (:regressions result)))
                  " decertified"))))

(defn run-evaluate
  "BL-556: pure ingest of a captured recruiter scorecard (+ optional bake-off).
   Never spawns the battery/recruiter. --scorecard path is absolute or relative
   to MODEL_STEWARD_STATE_DIR."
  [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        flags (vec (rest rest-args))
        role (opt-value flags "--role")
        scorecard-path (opt-value flags "--scorecard")
        bakeoff-path (opt-value flags "--bakeoff")
        decertify? (has-flag? flags "--decertify-on-regression")]
    (when (or (str/blank? role) (str/blank? scorecard-path))
      (evaluate-die! "evaluate requires --role <role> and --scorecard <path>"))
    (let [[scorecard-art bakeoff-art] (load-evaluate-artifacts! scorecard-path bakeoff-path)
          registry (load-registry)
          entry (model-steward-lib/model-entry registry provider model)]
      (when-not entry
        (evaluate-die! (str "evaluate refused: register " provider "/" model " first")))
      (let [prior (when (:certification_report_path entry)
                    (model-steward-store/read-certification-report!
                     (state-dir) (:certification_report_path entry)))
            timestamp (now-iso)
            result (model-steward-evaluate-lib/apply-evaluate
                    registry provider model role scorecard-art bakeoff-art prior timestamp)
            report-path (model-steward-store/write-certification-report!
                         (state-dir) provider model timestamp (:report result))
            key (model-steward-lib/model-key provider model)
            with-report (assoc-in (:registry result)
                                  [:models key :certification_report_path] report-path)
            registry'' (registry-after-evaluate
                        with-report provider model report-path result timestamp decertify?)]
        (save-registry! registry'')
        (print-evaluate-result provider model role report-path result decertify?)))))


;; ── BL-1182: the day-long BoB trial lifecycle ────────────────────────────
;;
;; Thin, like every other command here: model_steward_trial_lib.bb decides,
;; model_steward_store.bb persists trial state, model_factory_store.bb writes
;; the seat, and the memory-transfer boundary is the compiled node tool (BL-1178
;; is TypeScript and Babashka cannot import it).

(defn- trial-die! [message]
  (binding [*out* *err*] (println message))
  (System/exit 1))

(defn load-trials []
  (model-steward-store/read-trials! (state-dir) model-steward-trial-lib/empty-trials))

(defn save-trials! [trials]
  (model-steward-store/write-trials! (state-dir) trials))

(defn factory-state-dir []
  (or (System/getenv "MODEL_FACTORY_STATE_DIR")
      (str (fs/path (model-factory-store/repo-root) model-factory-store/default-state-dir-rel))))

(defn- with-cost-class [registry {:keys [provider model]}]
  (when (and provider model)
    {:provider provider :model model
     :cost_class (:cost_class (model-steward-lib/model-entry registry provider model))}))

(defn permanent-for-role
  "The model this role runs when no trial is seated - an OPERATIONAL fact, in
   this order: what the trial state recorded (a promotion or a revert writes it
   there), else the role's current seat in ModelFactory's assignment overlay,
   else - for a role that has never been seated at all - the top certified
   recommendation, the way BL-1181's cast bootstraps one.

   Deriving it from the role matrix FIRST was the obvious reading and it is
   wrong: the top-scoring model is then permanent by definition, so no
   candidate can ever outrank it and every nomination is refused as `already
   permanent`. The seat is what a trial displaces, so the seat is what
   `permanent` has to mean."
  [trials registry role]
  (or (get-in trials [:permanent role])
      (with-cost-class registry (get (model-factory-store/read-assignment-overlay! (factory-state-dir))
                                     (keyword role)))
      (with-cost-class registry (first (model-steward-lib/role-recommendations
                                        registry role {:include-uncertified? false})))))

(defn- memory-tool-path []
  (str (fs/path (model-steward-store/repo-root) "extension" "out" "tools" "trial-boundary-memory.js")))

(defn- transfer-target-root
  "MODEL_STEWARD_TARGET_ROOT overrides the --target passed to the memory
   tool (and the root request-brief! polls/injects against) - same seam
   shape as MODEL_FACTORY_STATE_DIR above, so a fixture can drive the REAL
   transfer-memory! path against an isolated tree instead of this repo's
   own .swarmforge/agent-memory/ (BL-1815)."
  []
  (or (System/getenv "MODEL_STEWARD_TARGET_ROOT") (str (model-steward-store/repo-root))))

(defn- seat-agent [seat]
  (when seat (:agent (model-factory-lib/resolve-launch-agent (:provider seat)))))

(defn transfer-memory!
  "Runs BL-1178's capture/inject for one trial boundary, and REFUSES the seat
   move when it fails - an amnesiac seat reported as success is the failure
   BL-1178's own invariant 2 names. `boundary` is nil when the step changes no
   model (a promotion leaves the trial model seated), and then nothing is owed.

   BL-1815: when `outgoing-seat` and `incoming-seat` are given and the move
   crosses from the claude agent to the local-model agent, a knowledge brief
   is owed first - requested from the outgoing seat's live pane (skipped
   silently when none resolves) and waited for on disk; an owed brief that
   never arrives, is empty, or is over budget refuses the move by the same
   trial-die! path, naming the reason. Every other pair runs exactly as
   before: no request, no wait, no new refusal. Omitting the seats (the
   2-arity form) keeps that same today's-behaviour path for any caller that
   has no seat agents to offer.

   MODEL_STEWARD_MEMORY_TOOL overrides the tool path so the acceptance and the
   shell test can drive a stub instead of a live capture."
  ([boundary role] (transfer-memory! boundary role nil nil))
  ([boundary role outgoing-seat incoming-seat]
   (when boundary
     (let [tool (or (System/getenv "MODEL_STEWARD_MEMORY_TOOL") (memory-tool-path))]
       (when-not (fs/exists? tool)
         (trial-die! (node-tool-bringup-lib/missing-tool-message "trial-boundary-memory" tool)))
       (let [target (transfer-target-root)
             owed? (model-steward-brief-lib/brief-owed?
                    (seat-agent outgoing-seat) (seat-agent incoming-seat))
             summary-flag
             (when owed?
               (println (str "brief requested role=" role))
               (let [{:keys [ok reason]} (model-steward-brief-lib/request-brief! target role)]
                 (if-not ok
                   (trial-die! (str "trial refused: knowledge brief " reason
                                    " for " role " at " boundary " - the seat was NOT moved"))
                   ["--summary-file" (model-steward-brief-lib/brief-path target role)])))
             {:keys [exit out err]} (process/sh
                                     (into ["node" tool
                                            "--role" role
                                            "--boundary" (if (= boundary "trial-start") "start" "end")
                                            "--target" target]
                                           (or summary-flag [])))]
         (when-not (zero? exit)
           (trial-die! (str "trial refused: agent-memory transfer failed at " boundary
                            " for " role " - the seat was NOT moved"
                            (when-not (str/blank? (str out)) (str " :: " (str/trim (str out))))
                            (when-not (str/blank? (str err)) (str " :: " (str/trim (str err)))))))
         {:boundary boundary :role role})))))

(defn- write-seat! [role seat]
  (let [dir (factory-state-dir)
        overlay (or (model-factory-store/read-assignment-overlay! dir) {})
        entry (merge (get overlay (keyword role) {})
                     {:role role
                      :provider (:provider seat)
                      :model (:model seat)
                      :agent (model-factory-lib/resolve-launch-agent (:provider seat))})]
    (model-factory-store/write-assignment-overlay! dir (assoc overlay (keyword role) entry))))

(defn run-trial-nominate [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        flags (vec (rest rest-args))
        role (opt-value flags "--role")
        evidence (opt-value flags "--evidence")]
    (when (str/blank? role)
      (trial-die! "trial nominate requires --role <role>"))
    (let [registry (load-registry)
          trials (load-trials)
          permanent (permanent-for-role trials registry role)]
      (when-not permanent
        (trial-die! (str "trial refused: " role " has no permanent model to trial against")))
      ;; BL-1183: the go-live gate, BEFORE anything is armed. A production day
      ;; trial that cannot be adjudicated is worse than no trial - it seats a
      ;; non-permanent model for a day and learns nothing - so this refuses
      ;; rather than arming and hoping. `trial go-live` (run-trial-go-live,
      ;; below) reads the same checklist read-only, for checking a pairing's
      ;; readiness without seating anything.
      (let [checklist (model-steward-trial-lib/go-live-checklist
                       (model-steward-trial-lib/go-live-readiness
                        registry role {:provider provider :model model} permanent))]
        (when-let [refusal (model-steward-trial-lib/go-live-refusal checklist)]
          (trial-die! refusal))
        (println (str "go-live checklist satisfied for " role)))
      (let [{:keys [trials error trial]}
            (model-steward-trial-lib/nominate trials registry role
                                              {:provider provider :model model :evidence evidence}
                                              permanent (now-iso))]
        (when error (trial-die! error))
        ;; The boundary runs BEFORE anything is persisted or seated: a failed
        ;; transfer must leave no armed trial behind to assess later.
        (transfer-memory! (model-steward-trial-lib/boundary-for
                           :nominate {:from (model-steward-trial-lib/seat-id permanent)
                                      :to (model-steward-trial-lib/seat-id trial)})
                          role permanent trial)
        (save-trials! (assoc-in trials [:permanent role] permanent))
        (write-seat! role trial)
        (println (str "trial armed role=" role
                      " model=" (model-steward-trial-lib/seat-id trial)
                      " permanent=" (model-steward-trial-lib/seat-id permanent)
                      " ends=" (:ends_at trial)))))))

(defn run-trial-status [rest-args]
  (let [trials (load-trials)
        only (opt-value rest-args "--role")
        active (:active trials)
        roles (if (str/blank? only) (sort (keys active)) [only])]
    (doseq [role roles]
      (if-let [t (get active role)]
        (println (str role " armed " (model-steward-trial-lib/seat-id t)
                      " permanent=" (model-steward-trial-lib/seat-id (:permanent t))
                      " ends=" (:ends_at t)
                      (when (model-steward-trial-lib/due? t (now-iso)) " DUE")))
        (println (str role " no armed trial"))))))

(defn run-trial-assess [rest-args]
  (let [role (opt-value rest-args "--role")
        at (or (opt-value rest-args "--now") (now-iso))]
    (when (str/blank? role)
      (trial-die! "trial assess requires --role <role>"))
    (let [registry (load-registry)
          trials (load-trials)
          armed (model-steward-trial-lib/armed-for-role trials role)
          {:keys [trials error outcome]} (model-steward-trial-lib/assess trials registry role at)]
      (when error (trial-die! error))
      (let [seat (:seat outcome)]
        (transfer-memory! (model-steward-trial-lib/boundary-for
                           :assess {:from (model-steward-trial-lib/seat-id armed)
                                    :to (model-steward-trial-lib/seat-id seat)})
                          role armed seat)
        (save-trials! (assoc-in trials [:permanent role] seat))
        (write-seat! role seat)
        (println (str "trial " (name (:decision outcome))
                      " role=" role
                      " permanent=" (model-steward-trial-lib/seat-id seat)
                      " reason=" (:reason outcome)))))))

(defn run-trial-go-live
  "BL-1183 qa_e2e step 3: read the checklist without seating anything. Pure
   over the registry, so an operator can ask \"could this even be judged?\"
   before committing a day to finding out."
  [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        flags (vec (rest rest-args))
        role (opt-value flags "--role")]
    (when (str/blank? role)
      (trial-die! "trial go-live requires --role <role>"))
    (let [registry (load-registry)
          trials (load-trials)
          permanent (permanent-for-role trials registry role)]
      (when-not permanent
        (trial-die! (str "trial go-live: " role " has no permanent model to compare against")))
      (let [checklist (model-steward-trial-lib/go-live-checklist
                       (model-steward-trial-lib/go-live-readiness
                        registry role {:provider provider :model model} permanent))]
        (if (:ready? checklist)
          (println (str "go-live checklist satisfied for " role))
          (do (doseq [gap (:missing checklist)] (println (str "MISSING " gap)))
              (trial-die! (model-steward-trial-lib/go-live-refusal checklist))))))))

(defn run-probe-score-hazard
  "BL-1701: `probe score-hazard --handed-off <bool> [--spec-changed <bool>]
   [--touched-outside <bool>]` - a pure, defense-in-depth hazard scoring
   call, independent of any real run (model-steward-coder-probe-lib/
   score-hazard). Prints {\"verdict\": \"held\"|\"breached\"}."
  [rest-args]
  (let [flags (vec rest-args)
        truthy? (fn [k] (= "true" (opt-value flags k)))
        verdict (model-steward-coder-probe-lib/score-hazard
                 {:handed-off? (truthy? "--handed-off")
                  :spec-changed? (truthy? "--spec-changed")
                  :touched-outside-editable? (truthy? "--touched-outside")})]
    (println (json/generate-string {:verdict verdict}))))

(defn run-probe-summarize
  "BL-1701: `probe summarize --coder-handed-off <n> --coder-of <n>
   --hazard-breached <bool>` - exercises model-steward-coder-probe-lib/
   summarize's own hazard override directly (the invariant: a breached
   hazard fails the overall verdict whatever the coder count), against
   synthetic scorecards - never a real run."
  [rest-args]
  (let [flags (vec rest-args)
        n (fn [k default] (if-let [v (opt-value flags k)] (Long/parseLong v) default))
        coder-handed-off (n "--coder-handed-off" 5)
        coder-of (n "--coder-of" 5)
        hazard-breached? (= "true" (opt-value flags "--hazard-breached"))
        coder-cards (mapv (fn [i] {:fixtureId (str "coder-" i) :handedOff (< i coder-handed-off)})
                           (range coder-of))
        hazard-card {:fixtureId (first model-steward-coder-probe-lib/hazard-fixture-ids)
                     :handedOff true
                     :hazardVerdict (if hazard-breached? "breached" "held")}
        summary (model-steward-coder-probe-lib/summarize (conj coder-cards hazard-card))]
    (println (json/generate-string summary))))

(defn run-prepare
  "Shared local-model prepare: Modelfile + alias + think-off aider profile.
   Optional --reprobe runs BL-1700 against the prepared alias (and one
   empty-response retry is a no-op here since prepare already applied)."
  [rest-args]
  (when (empty? rest-args) (usage))
  (let [base (first rest-args)
        flags (vec (rest rest-args))
        alias (opt-value flags "--alias")
        num-ctx (when-let [v (opt-value flags "--num-ctx")] (Long/parseLong v))
        num-predict (when-let [v (opt-value flags "--num-predict")] (Long/parseLong v))
        dry? (has-flag? flags "--dry-run")
        reprobe? (has-flag? flags "--reprobe")
        evidence-dir (opt-value flags "--evidence-dir")
        endpoint-url (or (opt-value flags "--endpoint-url") "http://127.0.0.1:11434/v1")]
    (try
      (let [profile (local-model-prepare-lib/prepare!
                     (cond-> {:base base :dry-run? dry?}
                       alias (assoc :alias alias)
                       num-ctx (assoc :num-ctx num-ctx)
                       num-predict (assoc :num-predict num-predict)))]
        (println (json/generate-string profile))
        (when reprobe?
          (when dry?
            (binding [*out* *err*]
              (println "prepare --reprobe ignored with --dry-run (no ollama alias)"))
            (System/exit 0))
          (let [result (model-steward-coder-probe-lib/probe!
                        {:model (:alias profile)
                         :endpoint-url endpoint-url
                         :evidence-dir evidence-dir
                         :model-settings-file (:aiderSettingsPath profile)
                         :prepare-profile profile})]
            (println (json/generate-string result))
            (System/exit (if (= "pass" (:verdict (:summary result))) 0 1))))
        (System/exit 0))
      (catch Exception e
        (binding [*out* *err*]
          (println (str "prepare failed: " (or (ex-message e) (.getMessage e)))))
        (System/exit 1)))))

(defn run-probe
  "BL-1700: `probe <model> [--scenario <id>]... [--endpoint-url <url>]
   [--evidence-dir <dir>]` - the steward CLI's dispatch anchor for
   model-steward-coder-probe-lib/probe! (BL-1235 consumer anchor). BL-1701:
   `probe score-hazard ...` dispatches to the pure hazard scorer instead.
   With `--prepare`, runs local_model_prepare_lib first (alias + think-off
   profile) then probes the alias; on empty-response fail shape, retries
   once (prepare already applied — retry reuses the same profile)."
  [rest-args]
  (when (empty? rest-args) (usage))
  (cond
    (= "score-hazard" (first rest-args)) (run-probe-score-hazard (rest rest-args))
    (= "summarize" (first rest-args)) (run-probe-summarize (rest rest-args))
    :else
    (let [model (first rest-args)
          flags (vec (rest rest-args))
          endpoint-url (or (opt-value flags "--endpoint-url") "http://127.0.0.1:11434/v1")
          evidence-dir (opt-value flags "--evidence-dir")
          ;; Test-only escape hatch (BL-1700 acceptance): a scripted stand-in
          ;; in place of a real aider seat, so the acceptance suite never
          ;; spawns a real model. Never documented for operator use.
          stand-in (opt-value flags "--stand-in")
          fix-turns-limit (when-let [v (opt-value flags "--fix-turns-limit")] (Long/parseLong v))
          max-ticks (when-let [v (opt-value flags "--max-ticks")] (Long/parseLong v))
          wall-clock-seconds (when-let [v (opt-value flags "--wall-clock-seconds")] (Long/parseLong v))
          prepare? (has-flag? flags "--prepare")
          prepare-alias (opt-value flags "--prepare-alias")
          model-settings-file (opt-value flags "--model-settings-file")
          scenarios (loop [fs flags acc []]
                      (if (empty? fs)
                        acc
                        (if (= "--scenario" (first fs))
                          (recur (nthrest fs 2) (conj acc (second fs)))
                          (recur (rest fs) acc))))
          ;; BL-1701: --all runs the coder AND hazard fixture sets together
          ;; (the nightly job's own shape) - an explicit --scenario list
          ;; still wins, same as before.
          include-all? (boolean (some #(= "--all" %) flags))
          fixture-ids-to-run (cond
                                (seq scenarios) scenarios
                                include-all? (vec (concat model-steward-coder-probe-lib/fixture-ids
                                                           model-steward-coder-probe-lib/hazard-fixture-ids))
                                :else model-steward-coder-probe-lib/fixture-ids)
          profile (when (and prepare? (not stand-in))
                    (local-model-prepare-lib/prepare!
                     (cond-> {:base model}
                       prepare-alias (assoc :alias prepare-alias))))
          probe-model (or (:alias profile) model)
          settings-file (or model-settings-file (:aiderSettingsPath profile))
          probe-opts (cond-> {:model probe-model :endpoint-url endpoint-url
                              :fixture-ids-to-run fixture-ids-to-run :evidence-dir evidence-dir}
                       stand-in (assoc :stand-in-mode stand-in)
                       fix-turns-limit (assoc :fix-turns-limit fix-turns-limit)
                       max-ticks (assoc :max-ticks max-ticks)
                       wall-clock-seconds (assoc :wall-clock-seconds wall-clock-seconds)
                       settings-file (assoc :model-settings-file settings-file)
                       profile (assoc :prepare-profile profile))
          result (model-steward-coder-probe-lib/probe! probe-opts)
          ;; One automatic retry when the empty-implement shape appears:
          ;; prepare (Modelfile + think-off) then re-probe the alias. Covers
          ;; bakeoffs that probed a bare HF tag without --prepare.
          result (if (and (not stand-in)
                          (:endpointOk? result)
                          (local-model-prepare-lib/empty-response-fail-shape?
                           (:summary result) (:scorecards result)))
                   (let [retry-profile (or profile
                                           (try
                                             (local-model-prepare-lib/prepare!
                                              (cond-> {:base model}
                                                prepare-alias (assoc :alias prepare-alias)))
                                             (catch Exception e
                                               (binding [*out* *err*]
                                                 (println (str "prepare-on-empty-fail skipped: "
                                                               (or (ex-message e) (.getMessage e)))))
                                               nil)))]
                     (if retry-profile
                       (let [retry (model-steward-coder-probe-lib/probe!
                                    (assoc probe-opts
                                           :model (:alias retry-profile)
                                           :model-settings-file (:aiderSettingsPath retry-profile)
                                           :prepare-profile (assoc retry-profile :retryAfterEmptyResponse true)))]
                         (assoc retry :priorEmptyResponseFail true :firstAttempt result))
                       result))
                   result)]
      (if-not (:endpointOk? result)
        (do (binding [*out* *err*]
              (println (str "probe: endpoint " (:endpointUrl result) " did not answer")))
            (System/exit 1))
        (do (println (json/generate-string result))
            (System/exit (if (= "pass" (:verdict (:summary result))) 0 1)))))))

(defn run-trial-transfer-memory-debug
  "BL-1815 test seam: calls the real transfer-memory! path directly with
   caller-given provider/model seats, bypassing nominate/assess/go-live/the
   registry entirely - so a fixture can drive the real knowledge-brief
   decision and wait/refuse behaviour without arming a whole trial. Never
   called by any production path; exists only for the acceptance and shell
   tests, same posture as the other MODEL_STEWARD_*/--result test seams in
   this file.
   Usage: trial transfer-memory-debug --role <role>
          --boundary trial-start|trial-end
          --from-provider <p> [--from-model <m>]
          --to-provider <p> [--to-model <m>]"
  [rest-args]
  (let [role (opt-value rest-args "--role")
        boundary (opt-value rest-args "--boundary")
        from-provider (opt-value rest-args "--from-provider")
        to-provider (opt-value rest-args "--to-provider")]
    (when (or (str/blank? role) (str/blank? boundary)
              (str/blank? from-provider) (str/blank? to-provider))
      (trial-die! "trial transfer-memory-debug requires --role, --boundary, --from-provider and --to-provider"))
    (let [incoming {:provider to-provider :model (or (opt-value rest-args "--to-model") "debug-to-model")}]
      (transfer-memory! boundary role
                        {:provider from-provider :model (or (opt-value rest-args "--from-model") "debug-from-model")}
                        incoming)
      ;; Only reached when transfer-memory! did NOT refuse (trial-die! exits
      ;; the process first on refusal) - same order as run-trial-nominate/
      ;; run-trial-assess: the boundary runs before the seat moves.
      (write-seat! role incoming)
      (println (str "transfer-memory-debug ok role=" role " boundary=" boundary)))))

(defn run-trial [rest-args]
  (case (first rest-args)
    "nominate" (run-trial-nominate (vec (rest rest-args)))
    "go-live" (run-trial-go-live (vec (rest rest-args)))
    "status" (run-trial-status (vec (rest rest-args)))
    "assess" (run-trial-assess (vec (rest rest-args)))
    "transfer-memory-debug" (run-trial-transfer-memory-debug (vec (rest rest-args)))
    (usage)))

(let [args (cli-args)
      cmd (first args)
      rest-args (vec (rest args))]
  (case cmd
    "status" (run-status)
    "show" (run-show rest-args)
    "register" (run-register rest-args)
    "certify" (run-certify rest-args)
    "decertify" (run-decertify rest-args)
    "evaluate" (run-evaluate rest-args)
    "compat-docs" (run-compat-docs rest-args)
    "role-matrix" (run-role-matrix rest-args)
    "capability" (run-capability rest-args)
    "adapter" (run-adapter rest-args)
    "eligible" (run-eligible rest-args)
    "trial" (run-trial rest-args)
    "prepare" (run-prepare rest-args)
    "probe" (run-probe rest-args)
    (usage)))
