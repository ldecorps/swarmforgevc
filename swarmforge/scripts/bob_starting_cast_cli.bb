#!/usr/bin/env bb
;; BL-1181: CLI for BoB starting cast export + ModelFactory overlay apply.
(ns bob-starting-cast-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "model_steward_store.bb")))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_store.bb")))
(load-file (str (fs/path scripts-dir "bob_starting_cast_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn steward-state-dir []
  (or (System/getenv "MODEL_STEWARD_STATE_DIR")
      (str (fs/path (model-steward-store/repo-root) model-steward-store/default-state-dir-rel))))

(defn factory-state-dir []
  (or (System/getenv "MODEL_FACTORY_STATE_DIR")
      (str (fs/path (model-factory-store/repo-root) model-factory-store/default-state-dir-rel))))

(defn load-registry []
  (model-steward-store/read-registry! (steward-state-dir) model-steward-lib/seed-data->registry))

(defn run-export [_args]
  (let [registry (load-registry)
        cast (bob-starting-cast-lib/export-bob-starting-cast registry model-factory-lib/swarm-roles)]
    (println (json/generate-string cast))
    0))

(defn run-apply [_args]
  (let [registry (load-registry)
        cast (bob-starting-cast-lib/export-bob-starting-cast registry model-factory-lib/swarm-roles)
        plan (bob-starting-cast-lib/apply-via-modelfactory-overlay cast)
        overlay-path (model-factory-store/write-assignment-overlay! (factory-state-dir) (:assignment plan))]
    (println (json/generate-string (assoc plan :overlay-path overlay-path)))
    0))

(defn -main [& _args]
  (let [args (cli-args)]
    (case (first args)
      "export" (run-export (rest args))
      "apply" (run-apply (rest args))
      (do (binding [*out* *err*]
            (println "Usage: bob_starting_cast_cli.bb export|apply"))
          1))))

(when (= *file* (System/getProperty "babashka.file"))
  (System/exit (-main)))
