#!/usr/bin/env bb
;; CLI facade for shell callers — same commands, agent-specific behavior inside.
(ns agent-runtime-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "agent_runtime_lib.bb")))
(load-file (str (fs/path scripts-dir "agent_runtime_inject.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn usage []
  (println "Usage: agent_runtime_cli.bb <command> [args...]")
  (println "Commands:")
  (println "  handoff-draft-path <agent>")
  (println "  wake-text <agent>")
  (println "  bootstrap-text <agent> <role> [two-pack:0|1] [overlay-prompt-rel-path]")
  (println "  run-bootstrap <socket> <session> <agent> <role> <prompt-file> [two-pack:0|1] [overlay-prompt-rel-path]")
  (System/exit 1))

(let [args (cli-args)
      cmd (first args)]
  (case cmd
    "handoff-draft-path"
    (println (agent-runtime-lib/handoff-draft-path (nth args 1)))

    "wake-text"
    (println (:text (first (agent-runtime-lib/wake-steps (nth args 1)))))

    "bootstrap-text"
    (let [agent (nth args 1)
          role (nth args 2)
          two-pack? (= "1" (get args 3 "0"))
          overlay (get args 4 "")]
      (print (agent-runtime-lib/bootstrap-text agent role
                                               :two-pack? two-pack?
                                               :overlay-prompt overlay)))

    "run-bootstrap"
    (let [socket (nth args 1)
          session (nth args 2)
          agent (nth args 3)
          role (nth args 4)
          prompt-file (nth args 5)
          two-pack? (= "1" (get args 6 "0"))
          overlay (get args 7 "")]
      (agent-runtime-inject/run-bootstrap! socket session agent role prompt-file
                                           two-pack? overlay))

    (usage)))
