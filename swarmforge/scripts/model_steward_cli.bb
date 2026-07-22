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
;;   model_steward_cli.bb register <provider>/<model> [--status candidate|certified|deprecated] [--context-window N] [--cost-class low|medium|high]
;;   model_steward_cli.bb certify <provider>/<model>
;;   model_steward_cli.bb decertify <provider>/<model> --reason <text> [--status candidate|deprecated]
;;   model_steward_cli.bb role-matrix <role> [--include-uncertified]
;;   model_steward_cli.bb capability <provider>/<model>
;;   model_steward_cli.bb adapter <provider>/<model>
;;   model_steward_cli.bb eligible <provider>/<model> --role <role> [--override-uncertified]
(ns model-steward-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "model_steward_store.bb")))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))

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

(defn usage []
  (println "Usage: model_steward_cli.bb <command> [args...]")
  (println "Commands:")
  (println "  status")
  (println "  show <provider>/<model>")
  (println "  register <provider>/<model> [--status S] [--context-window N] [--cost-class C]")
  (println "  certify <provider>/<model>")
  (println "  decertify <provider>/<model> --reason <text> [--status candidate|deprecated]")
  (println "  role-matrix <role> [--include-uncertified]")
  (println "  capability <provider>/<model>")
  (println "  adapter <provider>/<model>")
  (println "  eligible <provider>/<model> --role <role> [--override-uncertified]")
  (System/exit 1))

(defn run-status []
  (doseq [{:keys [provider model status]} (model-steward-lib/registry-summary (load-registry))]
    (println (str provider "/" model " " status))))

(defn run-show [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        entry (model-steward-lib/model-entry (load-registry) provider model)]
    (if entry
      (println (json/generate-string entry))
      (do (binding [*out* *err*] (println (str "no registry entry for " provider "/" model)))
          (System/exit 1)))))

(defn run-capability [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        entry (model-steward-lib/capability-entry (load-registry) provider model)]
    (if entry
      (println (json/generate-string entry))
      (do (binding [*out* *err*] (println (str "no capability entry for " provider "/" model)))
          (System/exit 1)))))

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
                  :cost_class cost-class})]
    (save-registry! updated)
    (println (str provider "/" model " " (:status (model-steward-lib/model-entry updated provider model))))))

(defn run-certify [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        registry (load-registry)
        timestamp (now-iso)
        report (model-steward-lib/build-certification-report provider model [] timestamp)
        report-path (model-steward-store/write-certification-report! (state-dir) provider model timestamp report)
        updated (model-steward-lib/certify registry provider model report-path)]
    (save-registry! updated)
    (println (str provider "/" model " certified (" report-path ")"))))

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
        adapter (model-steward-lib/adapter-for (load-registry) provider model)]
    (if adapter
      (println (str (:adapter_id adapter) " production_default=" (boolean (:production_default adapter))))
      (do (binding [*out* *err*] (println (str "no adapter entry for " provider "/" model)))
          (System/exit 1)))))

(defn run-eligible [rest-args]
  (when (empty? rest-args) (usage))
  (let [[provider model] (parse-provider-model (first rest-args))
        flags (rest rest-args)
        override-uncertified? (has-flag? flags "--override-uncertified")
        eligible? (model-steward-lib/assignment-eligible?
                   (load-registry) provider model {:override-uncertified? override-uncertified?})]
    (println (if eligible? "eligible" "ineligible"))
    (when-not eligible? (System/exit 1))))

(let [args (cli-args)
      cmd (first args)
      rest-args (vec (rest args))]
  (case cmd
    "status" (run-status)
    "show" (run-show rest-args)
    "register" (run-register rest-args)
    "certify" (run-certify rest-args)
    "decertify" (run-decertify rest-args)
    "role-matrix" (run-role-matrix rest-args)
    "capability" (run-capability rest-args)
    "adapter" (run-adapter rest-args)
    "eligible" (run-eligible rest-args)
    (usage)))
