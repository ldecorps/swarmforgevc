#!/usr/bin/env bb
;; PromptEngine CLI — the primary shell entry point for prompt composition
;; (BL-546 Slice 1). Launch scripts obtain every system prompt through THIS
;; CLI (swarmforge.sh's write_agent_instruction_file shells here); nothing
;; else may assemble prompt text. agent_runtime_cli.bb keeps its pre-BL-546
;; commands as thin wrappers until remaining callers migrate.
;;
;; Usage:
;;   prompt_engine_cli.bb compose <agent> <role> [two-pack:0|1] [overlay-prompt-rel-path] [--deterministic]
;;   prompt_engine_cli.bb stable-prefix-text
;;   prompt_engine_cli.bb stable-bootstrap-prefix
(ns prompt-engine-cli
  (:require [babashka.fs :as fs]
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
  (println "  compose <agent> <role> [two-pack:0|1] [overlay-prompt-rel-path] [--deterministic]")
  (println "  stable-prefix-text")
  (println "  stable-bootstrap-prefix")
  (System/exit 1))

(let [args (cli-args)
      cmd (first args)]
  (case cmd
    "compose"
    (let [positional (vec (take-while #(not= "--deterministic" %) (rest args)))
          deterministic? (some #(= "--deterministic" %) (rest args))
          agent (nth positional 0 nil)
          role (nth positional 1 nil)]
      (when (or (str/blank? agent) (str/blank? role))
        (usage))
      (print (:system-prompt (prompt-engine-lib/compose
                              role {:agent agent
                                    :two-pack? (= "1" (get positional 2 "0"))
                                    :overlay-prompt (get positional 3 "")
                                    :deterministic? (boolean deterministic?)}))))

    "stable-prefix-text"
    (print (prompt-engine-lib/stable-prefix-text))

    "stable-bootstrap-prefix"
    (print (prompt-engine-lib/stable-bootstrap-prefix))

    (usage)))
