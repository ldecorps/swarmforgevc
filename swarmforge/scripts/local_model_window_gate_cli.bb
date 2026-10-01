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
;;   local_model_window_gate_cli.bb dead-zone \
;;     --role <role> --model <model> --endpoint-url <http://host:port/v1> \
;;     [--context-length <n>] [--override 0|1]
;;
;; Exits 0 on :proceed or :warn (a warning is printed to stderr); exits 1
;; on :refuse, having started nothing. `dead-zone` (BL-1840) always prints
;; the window's own compaction trigger to stdout as `TRIGGER: <n>` (or
;; `TRIGGER: unknown` when the window could not be learned) before that
;; decision, so a caller can read it regardless of the verdict.
(ns local-model-window-gate-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
;; BL-1838: served-window (the num_ctx read) moved into the lib itself -
;; this load-file brings it (and estimate-tokens/window-outcome) into
;; scope, referenced below as local-model-window-gate-lib/served-window.
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

(defn- parse-int [s]
  (when-not (str/blank? (str s))
    (try (Long/parseLong (str/trim (str s))) (catch Exception _ nil))))

(defn run-check
  "Gathers the facts and returns local-model-window-gate-lib/window-outcome's
   verdict. A pure function of its explicit inputs (never touches *out*/
   System/exit) so the CLI's own main below stays a thin wrapper."
  [{:keys [role model prompt-file endpoint-url context-length overhead-chars override?]}]
  (let [composed-chars (count (slurp prompt-file))
        window (or (local-model-window-gate-lib/served-window endpoint-url model) (parse-int context-length))
        estimate (local-model-window-gate-lib/estimate-tokens composed-chars overhead-chars)]
    (local-model-window-gate-lib/window-outcome
     {:window window :estimate-tokens estimate :override? override? :role role :model model})))

;; BL-1840: gathers the facts for the dead-zone check and returns
;; local-model-window-gate-lib/dead-zone-outcome's verdict, plus the
;; window's own trigger (nil when the window itself is nil) - a pure
;; function of its explicit inputs, same posture as run-check above.
(defn run-dead-zone-check
  [{:keys [role model endpoint-url context-length override?]}]
  (let [window (or (local-model-window-gate-lib/served-window endpoint-url model) (parse-int context-length))
        trigger (when window (local-model-window-gate-lib/qwen-compaction-trigger window))
        outcome (local-model-window-gate-lib/dead-zone-outcome
                 {:window window :override? override? :role role :model model})]
    (assoc outcome :trigger trigger)))

(defn- run-check-main [rest-args]
  (let [role (opt-value rest-args "--role")
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

(defn- run-dead-zone-main [rest-args]
  (let [role (opt-value rest-args "--role")
        model (opt-value rest-args "--model")
        endpoint-url (opt-value rest-args "--endpoint-url")
        context-length (opt-value rest-args "--context-length")
        override? (= "1" (opt-value rest-args "--override"))]
    (when (or (str/blank? role) (str/blank? model) (str/blank? endpoint-url))
      (binding [*out* *err*] (println "local_model_window_gate_cli.bb dead-zone: --role, --model and --endpoint-url are all required"))
      (System/exit 2))
    (let [{:keys [decision message trigger]}
          (run-dead-zone-check {:role role :model model :endpoint-url endpoint-url
                                 :context-length context-length :override? override?})]
      (println (str "TRIGGER: " (if trigger trigger "unknown")))
      (case decision
        :proceed nil
        :warn (binding [*out* *err*] (println (str "WARN: " message)))
        :refuse (do (binding [*out* *err*] (println (str "REFUSE: " message)))
                    (System/exit 1))))))

(defn -main [args]
  (case (first args)
    "check" (run-check-main (rest args))
    "dead-zone" (run-dead-zone-main (rest args))
    (do
      (binding [*out* *err*]
        (println "Usage: local_model_window_gate_cli.bb check --role <role> --model <model> --prompt-file <path> --endpoint-url <url> [--context-length <n>] --overhead-chars <n> [--override 0|1]")
        (println "   or: local_model_window_gate_cli.bb dead-zone --role <role> --model <model> --endpoint-url <url> [--context-length <n>] [--override 0|1]"))
      (System/exit 2))))

(-main (cli-args))
