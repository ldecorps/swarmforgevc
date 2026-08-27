#!/usr/bin/env bb
;; PromptEngine CLI — the primary shell entry point for prompt composition
;; (BL-546 Slice 1). Launch scripts obtain every system prompt through THIS
;; CLI (swarmforge.sh's write_agent_instruction_file shells here); nothing
;; else may assemble prompt text. agent_runtime_cli.bb keeps its pre-BL-546
;; commands as thin wrappers until remaining callers migrate.
;;
;; Usage:
;;   prompt_engine_cli.bb compose <agent> <role> [two-pack:0|1] [overlay-prompt-rel-path] [--model <id>] [--deterministic]
;;   prompt_engine_cli.bb compose-metadata <agent> <role> [two-pack:0|1] [overlay-prompt-rel-path] [--model <id>] [--deterministic]
;;   prompt_engine_cli.bb stable-prefix-text
;;   prompt_engine_cli.bb stable-bootstrap-prefix
;;
;; compose-metadata (BL-563 Slice 2) is compose's read-only sibling: same
;; positional/flag shape, but prints the compose result's :metadata as JSON
;; instead of the system-prompt text — the observable seam that lets a
;; caller (write_agent_instruction_file's sidecar write, or a test) confirm
;; which model a compose invocation actually received, without parsing
;; prose out of the primary .md artifact.
(ns prompt-engine-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn usage []
  (println "Usage: prompt_engine_cli.bb <command> [args...]")
  (println "Commands:")
  (println "  compose <agent> <role> [two-pack:0|1] [overlay-prompt-rel-path] [--model <id>] [--deterministic]")
  (println "  compose-metadata <agent> <role> [two-pack:0|1] [overlay-prompt-rel-path] [--model <id>] [--deterministic]")
  (println "  stable-prefix-text")
  (println "  stable-bootstrap-prefix")
  (System/exit 1))

(defn- flag-value
  "The value following flag `k` in `args`, or nil if `k` is absent."
  [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (and (>= idx 0) (< (inc idx) (count args)))
      (nth args (inc idx)))))

(defn- has-flag? [args k]
  (boolean (some #(= k %) args)))

(defn- strip-flags
  "Positional args only — drops --model <id> and --deterministic wherever
   they appear, so either flag may follow the fixed positional prefix in any
   order (both are optional and independent)."
  [args]
  (loop [xs (vec args) out []]
    (if (empty? xs)
      out
      (let [x (first xs)]
        (cond
          (= x "--deterministic") (recur (rest xs) out)
          (= x "--model") (recur (drop 2 xs) out)
          :else (recur (rest xs) (conj out x)))))))

(defn- compose-result
  "Shared arg-parsing + compose call for both compose and compose-metadata —
   the only difference between the two commands is which key of this same
   result they print."
  [rest-args]
  (let [positional (strip-flags rest-args)
        model (flag-value rest-args "--model")
        deterministic? (has-flag? rest-args "--deterministic")
        agent (nth positional 0 nil)
        role (nth positional 1 nil)]
    (when (or (str/blank? agent) (str/blank? role))
      (usage))
    (prompt-engine-lib/compose
     role {:agent agent
           :model model
           :two-pack? (= "1" (get positional 2 "0"))
           :overlay-prompt (get positional 3 "")
           :deterministic? (boolean deterministic?)})))

(let [args (cli-args)
      cmd (first args)
      rest-args (rest args)]
  (case cmd
    "compose"
    (print (:system-prompt (compose-result rest-args)))

    "compose-metadata"
    (println (json/generate-string (:metadata (compose-result rest-args))))

    "stable-prefix-text"
    (print (prompt-engine-lib/stable-prefix-text))

    "stable-bootstrap-prefix"
    (print (prompt-engine-lib/stable-bootstrap-prefix))

    (usage)))
