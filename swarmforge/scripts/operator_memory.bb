#!/usr/bin/env bb
;; BL-282: one-shot CLI over the Operator's long-term memory store -
;; mirrors operator_reply.bb's own "thin CLI wrapping a pure lib + real fs
;; adapters" shape. This is the tool the disposable Operator LLM calls
;; (per its future prompt, specifier-owned, lands WITH this slice) once it
;; has judged a fact from a conversation as durable/generalizable enough
;; to remember - one call per fact, mirroring operator_reply.bb's own
;; one-reply-per-call convention. All real fs I/O lives HERE; every
;; decision it wires (append+dedup, load-for-wake) is the pure logic in
;; operator_memory_lib.bb.
;;
;; Usage:
;;   operator_memory.bb <project-root> distill --fact <text>
;;   operator_memory.bb <project-root> load

(ns operator-memory
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "operator_memory_lib.bb")))
(load-file (str (fs/path script-dir "operator_memory_store.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_memory.bb <project-root> distill --fact <text> | load"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))
(def subcommand (or (nth *command-line-args* 1 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 2 *command-line-args*)))
(def state-dir (fs/path project-root ".swarmforge"))
(def adapters (operator-memory-store/adapters-for state-dir))

(defn run-distill! []
  (when (str/blank? (:fact opts)) (usage))
  (let [store (operator-memory-lib/distill-facts! [(:fact opts)] adapters)]
    (println (json/generate-string store))))

(defn run-load! []
  (println (json/generate-string (operator-memory-lib/facts-for-wake ((:read-store! adapters))))))

(defn -main []
  (case subcommand
    "distill" (run-distill!)
    "load" (run-load!)
    (usage)))

(-main)
