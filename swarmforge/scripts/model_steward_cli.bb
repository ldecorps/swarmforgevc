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
  (println "  trial status [--role <role>]")
  (println "  trial assess --role <role> [--now <iso>]")
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
    (model-steward-lib/certify with-report provider model report-path)
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

(defn transfer-memory!
  "Runs BL-1178's capture/inject for one trial boundary, and REFUSES the seat
   move when it fails - an amnesiac seat reported as success is the failure
   BL-1178's own invariant 2 names. `boundary` is nil when the step changes no
   model (a promotion leaves the trial model seated), and then nothing is owed.

   MODEL_STEWARD_MEMORY_TOOL overrides the tool path so the acceptance and the
   shell test can drive a stub instead of a live capture."
  [boundary role]
  (when boundary
    (let [tool (or (System/getenv "MODEL_STEWARD_MEMORY_TOOL") (memory-tool-path))]
      (when-not (fs/exists? tool)
        (trial-die! (node-tool-bringup-lib/missing-tool-message "trial-boundary-memory" tool)))
      (let [{:keys [exit out err]} (process/sh
                                    ["node" tool
                                     "--role" role
                                     "--boundary" (if (= boundary "trial-start") "start" "end")
                                     "--target" (str (model-steward-store/repo-root))])]
        (when-not (zero? exit)
          (trial-die! (str "trial refused: agent-memory transfer failed at " boundary
                           " for " role " - the seat was NOT moved"
                           (when-not (str/blank? (str out)) (str " :: " (str/trim (str out))))
                           (when-not (str/blank? (str err)) (str " :: " (str/trim (str err)))))))
        {:boundary boundary :role role}))))

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
                          role)
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
                          role)
        (save-trials! (assoc-in trials [:permanent role] seat))
        (write-seat! role seat)
        (println (str "trial " (name (:decision outcome))
                      " role=" role
                      " permanent=" (model-steward-trial-lib/seat-id seat)
                      " reason=" (:reason outcome)))))))

(defn run-trial [rest-args]
  (case (first rest-args)
    "nominate" (run-trial-nominate (vec (rest rest-args)))
    "status" (run-trial-status (vec (rest rest-args)))
    "assess" (run-trial-assess (vec (rest rest-args)))
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
    (usage)))
