#!/usr/bin/env bb
;; ModelFactory CLI (BL-525 Slice 1) — thin main over model_factory_lib.bb
;; (decisions) and model_factory_store.bb (IO). Consumes the Model Steward
;; read API (model_steward_lib.bb / model_steward_store.bb) to resolve a
;; certified, recruiter-ranked role->{agent,provider,model} map under a
;; cheap|quality steering policy, and can cold-apply it (write the overlay +
;; run a stop/relaunch plan through an injectable launch seam).
;;
;; Usage:
;;   model_factory_cli.bb assign --mode cheap|quality [--role <role>] [--override-uncertified] [--today <YYYY-MM-DD>]
;;   model_factory_cli.bb cold-apply --mode cheap|quality --pack <name> [--override-uncertified] [--today <YYYY-MM-DD>] [--launch-seam <path>]
;;   model_factory_cli.bb mark-exhausted <provider> --date <YYYY-MM-DD>
;;   model_factory_cli.bb resolve-model <role> <pack-model>
;;
;; resolve-model (BL-563 Slice 1) is the thin IO edge write_claude_settings_file
;; and write_agent_instruction_file (swarmforge.sh) shell out to: reads the
;; runtime assignment overlay (MODEL_FACTORY_STATE_DIR-overridable, same as
;; every other command here) via model-factory-store/read-assignment-overlay!'s
;; degrade-never-crash reader, then applies the pure
;; model-factory-lib/resolve-role-model decision and prints the winning model.
(ns model-factory-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "model_steward_store.bb")))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_store.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn opt-value
  "Returns the value following flag `k` in `args`, or nil if absent. `args`
   may be any seq — .indexOf is a java.util.List method, so a lazy seq
   (e.g. from `rest`) must be coerced to a vector first."
  [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (and (>= idx 0) (< (inc idx) (count args)))
      (nth args (inc idx)))))

(defn has-flag? [args k]
  (boolean (some #(= k %) args)))

(defn steward-state-dir
  "Runtime state root for the Model Steward registry this CLI reads.
   Overridable via MODEL_STEWARD_STATE_DIR so acceptance/shell tests can
   point at an isolated fixture registry instead of this repo's real
   .swarmforge/model-steward/."
  []
  (or (System/getenv "MODEL_STEWARD_STATE_DIR")
      (str (fs/path (model-steward-store/repo-root) model-steward-store/default-state-dir-rel))))

(defn factory-state-dir
  "Runtime state root for ModelFactory's own overlay + quota-state.
   Overridable via MODEL_FACTORY_STATE_DIR (mirrors MODEL_STEWARD_STATE_DIR)."
  []
  (or (System/getenv "MODEL_FACTORY_STATE_DIR")
      (str (fs/path (model-factory-store/repo-root) model-factory-store/default-state-dir-rel))))

(defn load-steward-registry []
  (model-steward-store/read-registry! (steward-state-dir) model-steward-lib/seed-data->registry))

(defn require-mode [flags]
  (let [mode (opt-value flags "--mode")]
    (when-not (contains? model-factory-lib/steering-modes mode)
      (binding [*out* *err*]
        (println (str "expected --mode cheap|quality, got: " mode)))
      (System/exit 1))
    mode))

(defn assign-opts [flags]
  {:override-uncertified? (has-flag? flags "--override-uncertified")
   :quota-state (model-factory-store/read-quota-state! (factory-state-dir))
   :today (opt-value flags "--today")})

(defn usage []
  (println "Usage: model_factory_cli.bb <command> [args...]")
  (println "Commands:")
  (println "  assign --mode cheap|quality [--role <role>] [--override-uncertified] [--today <YYYY-MM-DD>]")
  (println "  cold-apply --mode cheap|quality --pack <name> [--override-uncertified] [--today <YYYY-MM-DD>] [--launch-seam <path>]")
  (println "  mark-exhausted <provider> --date <YYYY-MM-DD>")
  (println "  resolve-model <role> <pack-model>")
  (System/exit 1))

(defn run-assign [rest-args]
  (let [mode (require-mode rest-args)
        role (opt-value rest-args "--role")
        registry (load-steward-registry)
        opts (assign-opts rest-args)]
    (if role
      (let [entry (model-factory-lib/assign-role registry role mode opts)]
        (if entry
          (println (json/generate-string entry))
          (do (binding [*out* *err*] (println (str "no eligible candidate for role " role)))
              (System/exit 1))))
      (println (json/generate-string (model-factory-lib/assign-swarm registry mode opts))))))

(defn run-cold-apply [rest-args]
  (let [mode (require-mode rest-args)
        pack (opt-value rest-args "--pack")
        seam-path (or (opt-value rest-args "--launch-seam")
                      (model-factory-store/default-launch-seam (model-factory-store/repo-root)))]
    (when (str/blank? pack)
      (binding [*out* *err*] (println "cold-apply requires --pack <name>"))
      (System/exit 1))
    (let [registry (load-steward-registry)
          opts (assign-opts rest-args)
          assignment (model-factory-lib/assign-swarm registry mode opts)
          state-dir (factory-state-dir)
          overlay-path (model-factory-store/write-assignment-overlay! state-dir assignment)
          plan (model-factory-lib/cold-apply-plan pack overlay-path)
          exit-code (model-factory-store/invoke-launch-seam! seam-path plan (model-factory-store/repo-root))]
      (println (json/generate-string {:assignment assignment :plan plan :seam_exit exit-code}))
      (when-not (zero? exit-code) (System/exit exit-code)))))

(defn run-resolve-model [rest-args]
  (when (< (count rest-args) 2) (usage))
  (let [role (first rest-args)
        pack-model (second rest-args)
        overlay (model-factory-store/read-assignment-overlay! (factory-state-dir))]
    (println (model-factory-lib/resolve-role-model overlay role pack-model))))

(defn run-mark-exhausted [rest-args]
  (when (empty? rest-args) (usage))
  (let [provider (first rest-args)
        flags (rest rest-args)
        date (opt-value flags "--date")]
    (when (str/blank? date)
      (binding [*out* *err*] (println "mark-exhausted requires --date <YYYY-MM-DD>"))
      (System/exit 1))
    (model-factory-store/mark-exhausted! (factory-state-dir) provider date)
    (println (str provider " exhausted_date=" date))))

(let [args (cli-args)
      cmd (first args)
      rest-args (vec (rest args))]
  (case cmd
    "assign" (run-assign rest-args)
    "cold-apply" (run-cold-apply rest-args)
    "mark-exhausted" (run-mark-exhausted rest-args)
    "resolve-model" (run-resolve-model rest-args)
    (usage)))
