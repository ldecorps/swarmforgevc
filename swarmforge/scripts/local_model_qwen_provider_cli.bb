#!/usr/bin/env bb
;; BL-1838: merges a local-model seat's qwen provider entry
;; (modelProviders.openai) into its worktree's .qwen/settings.json, beside
;; BL-1829's tool lists, with contextWindowSize set to the window Ollama
;; actually serves the seat's model - never a value only the operator's own
;; ~/.qwen/settings.json holds. The num_ctx read is
;; local_model_window_gate_lib.bb's served-window, the exact function the
;; launch-time window gate already uses (IO-near code calls the owner,
;; BL-1811) - never a second parser here. The entry shape itself lives in
;; local_model_qwen_provider_lib.bb (pure, unit-tested there); this file
;; only gathers the facts and does the IO. With neither a served window nor
;; the swarm's own context length known, writes no entry and prints one
;; warning line naming the seat.
;;
;; Usage:
;;   local_model_qwen_provider_cli.bb write --settings-file <path> \
;;     --model <id> --endpoint-url <http://host:port/v1> \
;;     [--base-url <http://host:port/v1>] [--context-length <n>] [--role <role>]
(ns local-model-qwen-provider-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "local_model_qwen_provider_lib.bb")))
(load-file (str (fs/path scripts-dir "local_model_window_gate_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn opt-value [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (>= idx 0) (get args (inc idx)))))

(defn- read-settings [path]
  (if (fs/exists? path)
    (json/parse-string (slurp (str path)) true)
    {}))

(defn write-provider!
  "Reads settings-file (or starts from {}), merges in model's provider
   entry keyed to the served-or-fallback window, and writes it back.
   Returns :written, or :skipped when neither the served window nor
   context-length is known (prints ONE warning line naming role/model to
   stderr and touches the file not at all)."
  [{:keys [settings-file model endpoint-url base-url context-length role]}]
  (let [served (local-model-window-gate-lib/served-window endpoint-url model)
        window (local-model-qwen-provider-lib/resolve-window served context-length)]
    (if (nil? window)
      (do (binding [*out* *err*]
            (println (str "WARN: no known context window for " (if (str/blank? (str role)) "seat" role)
                          " (" model ") - qwen settings written with no provider entry")))
          :skipped)
      (let [existing (read-settings settings-file)
            ;; BL-1917: the entry's baseUrl is the seat's own URL (its
            ;; tool-call shim) when given; the window is still read from the
            ;; endpoint itself, which answers before any pane starts.
            merged (local-model-qwen-provider-lib/merge-provider-entry
                    existing model (if (str/blank? (str base-url)) endpoint-url base-url) window)]
        (fs/create-dirs (fs/parent (fs/path settings-file)))
        (spit (str settings-file) (json/generate-string merged {:pretty true}))
        :written))))

(defn -main [args]
  (when (not= "write" (first args))
    (binding [*out* *err*] (println "Usage: local_model_qwen_provider_cli.bb write --settings-file <path> --model <id> --endpoint-url <url> [--base-url <url>] [--context-length <n>] [--role <role>]"))
    (System/exit 2))
  (let [rest-args (rest args)
        settings-file (opt-value rest-args "--settings-file")
        model (opt-value rest-args "--model")
        endpoint-url (opt-value rest-args "--endpoint-url")
        base-url (opt-value rest-args "--base-url")
        context-length (opt-value rest-args "--context-length")
        role (opt-value rest-args "--role")]
    (when (or (str/blank? settings-file) (str/blank? model) (str/blank? endpoint-url))
      (binding [*out* *err*] (println "local_model_qwen_provider_cli.bb write: --settings-file, --model and --endpoint-url are all required"))
      (System/exit 2))
    (write-provider! {:settings-file settings-file :model model :endpoint-url endpoint-url
                       :base-url base-url :context-length context-length :role role})))

(-main (cli-args))
