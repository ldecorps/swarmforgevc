#!/usr/bin/env bb
;; CLI facade for the launcher: BL-519 cache-warm content-hash decision.
(ns cache-warm-cli
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "cache_warm_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn usage []
  (println "Usage: cache_warm_cli.bb <command> [args...]")
  (println "Commands:")
  (println "  stable-prefix-content-hash [model-routing-text]")
  (println "  decide-and-record-warm <state-dir> <pack-name> [model-routing-text] [stable-text-override]")
  (System/exit 1))

(let [args (cli-args)
      cmd (first args)]
  (case cmd
    "stable-prefix-content-hash"
    (println (cache-warm-lib/stable-prefix-content-hash :model-routing-text (get args 1 "")))

    "decide-and-record-warm"
    (let [state-dir (nth args 1)
          pack-name (nth args 2)
          model-routing-text (get args 3 "")
          ;; stable-text-override: test-only seam (BL-519 scenario 05) to
          ;; simulate a constitution change without mutating the real
          ;; swarmforge/constitution.prompt on disk. A real launcher call
          ;; never passes a 5th arg, so args 4 is absent and the real
          ;; stable-prefix-text is used, unchanged from production.
          stable-text-override (get args 4)
          result (cache-warm-lib/decide-and-record-warm! state-dir pack-name
                                                          :model-routing-text model-routing-text
                                                          :stable-text stable-text-override)]
      (println (name (:decision result)))
      (println (:hash result)))

    (usage)))
