#!/usr/bin/env bb
;; BL-1801: launch-time gate for a local-model seat's first turn against
;; the window Ollama actually serves it. Thin: this file only gathers the
;; facts (the composed prompt's character count, the served window from
;; Ollama's own /api/show, or the context length the swarm started Ollama
;; with) and hands them to local_model_window_gate_lib.bb's pure decision.
;;
;; Usage:
;;   local_model_window_gate_cli.bb check \
;;     --role <role> --model <model> --prompt-file <path> \
;;     --endpoint-url <http://host:port/v1> \
;;     [--context-length <n>] --overhead-chars <n> [--override 0|1]
;;
;; Exits 0 on :proceed or :warn (a warning is printed to stderr); exits 1
;; on :refuse, having started nothing.
(ns local-model-window-gate-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "local_model_window_gate_lib.bb")))

(defn- sh! [& args]
  (apply process/sh args))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn opt-value [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (>= idx 0) (get args (inc idx)))))

;; The native Ollama API (never the OpenAI-compat /v1 suffix the seat's
;; own launch uses) - local_model_endpoint_url in swarmforge.sh returns
;; the /v1 base, so this strips it.
(defn- native-base [endpoint-url]
  (str/replace endpoint-url #"/v1/?$" ""))

(defn served-window
  "The num_ctx Ollama reports for `model` via POST /api/show, parsed from
   the `parameters` field's own text blob (e.g. \"num_ctx    32768\\n...\").
   nil on any failure (unreachable endpoint, non-2xx, unparseable body, or
   no num_ctx line) - the caller falls back to the swarm's own context
   length, never throws."
  [endpoint-url model]
  (try
    (let [{:keys [exit out]} (sh! "curl" "-sS" "-m" "5"
                                  (str (native-base endpoint-url) "/api/show")
                                  "-d" (json/generate-string {:model model}))]
      (when (zero? exit)
        (let [body (json/parse-string out true)
              params (:parameters body)]
          (when (string? params)
            (when-let [m (re-find #"(?m)^\s*num_ctx\s+(\d+)" params)]
              (Long/parseLong (second m)))))))
    (catch Exception _ nil)))

(defn- parse-int [s]
  (when-not (str/blank? (str s))
    (try (Long/parseLong (str/trim (str s))) (catch Exception _ nil))))

(defn run-check
  "Gathers the facts and returns local-model-window-gate-lib/window-outcome's
   verdict. A pure function of its explicit inputs (never touches *out*/
   System/exit) so the CLI's own main below stays a thin wrapper."
  [{:keys [role model prompt-file endpoint-url context-length overhead-chars override?]}]
  (let [composed-chars (count (slurp prompt-file))
        window (or (served-window endpoint-url model) (parse-int context-length))
        estimate (local-model-window-gate-lib/estimate-tokens composed-chars overhead-chars)]
    (local-model-window-gate-lib/window-outcome
     {:window window :estimate-tokens estimate :override? override? :role role :model model})))

(defn -main [args]
  (when (not= "check" (first args))
    (binding [*out* *err*] (println "Usage: local_model_window_gate_cli.bb check --role <role> --model <model> --prompt-file <path> --endpoint-url <url> [--context-length <n>] --overhead-chars <n> [--override 0|1]"))
    (System/exit 2))
  (let [rest-args (rest args)
        role (opt-value rest-args "--role")
        model (opt-value rest-args "--model")
        prompt-file (opt-value rest-args "--prompt-file")
        endpoint-url (opt-value rest-args "--endpoint-url")
        context-length (opt-value rest-args "--context-length")
        overhead-chars (parse-int (opt-value rest-args "--overhead-chars"))
        override? (= "1" (opt-value rest-args "--override"))]
    (when (or (str/blank? role) (str/blank? model) (str/blank? prompt-file)
              (str/blank? endpoint-url) (nil? overhead-chars))
      (binding [*out* *err*] (println "local_model_window_gate_cli.bb check: --role, --model, --prompt-file, --endpoint-url and --overhead-chars are all required"))
      (System/exit 2))
    (let [{:keys [decision message]}
          (run-check {:role role :model model :prompt-file prompt-file
                      :endpoint-url endpoint-url :context-length context-length
                      :overhead-chars overhead-chars :override? override?})]
      (case decision
        :proceed nil
        :warn (binding [*out* *err*] (println (str "WARN: " message)))
        :refuse (do (binding [*out* *err*] (println (str "REFUSE: " message)))
                    (System/exit 1))))))

(-main (cli-args))
