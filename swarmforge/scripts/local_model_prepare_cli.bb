#!/usr/bin/env bb
;; local_model_prepare_cli.bb — thin CLI over local_model_prepare_lib.bb
;;
;; Usage:
;;   local_model_prepare_cli.bb <base-tag> [--alias <name>] [--num-ctx N]
;;       [--num-predict N] [--dry-run] [--state-dir <dir>]
;;
;; Prints a JSON profile on success. Exit 0 on success, 1 on failure.
;; Never certifies, never rewrites packs, never staffs a seat.
(ns local-model-prepare-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "local_model_prepare_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn opt-value [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (and (>= idx 0) (< (inc idx) (count args)))
      (nth args (inc idx)))))

(defn has-flag? [args k]
  (boolean (some #(= k %) args)))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: local_model_prepare_cli.bb <base-tag> [--alias <name>] [--num-ctx N] [--num-predict N] [--dry-run] [--state-dir <dir>]"))
  (System/exit 1))

(let [args (cli-args)]
  (when (empty? args) (usage))
  (let [base (first args)
        flags (vec (rest args))
        alias (opt-value flags "--alias")
        num-ctx (when-let [v (opt-value flags "--num-ctx")] (Long/parseLong v))
        num-predict (when-let [v (opt-value flags "--num-predict")] (Long/parseLong v))
        state-dir (opt-value flags "--state-dir")
        dry? (has-flag? flags "--dry-run")]
    (try
      (let [profile (local-model-prepare-lib/prepare!
                     (cond-> {:base base :dry-run? dry?}
                       alias (assoc :alias alias)
                       num-ctx (assoc :num-ctx num-ctx)
                       num-predict (assoc :num-predict num-predict)
                       state-dir (assoc :state-dir state-dir)))]
        (println (json/generate-string profile))
        (System/exit 0))
      (catch Exception e
        (binding [*out* *err*]
          (println (str "prepare failed: " (or (ex-message e) (.getMessage e)))))
        (System/exit 1)))))
