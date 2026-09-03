#!/usr/bin/env bb
;; BL-1181: CLI for BoB starting cast export + ModelFactory overlay apply.
;; BL-1337: the same two verbs now take --profile <name>, reading a steward-
;; owned profile from .swarmforge/model-steward/profiles/<name>.json. The
;; profile constrains the SAME cherry-pick and the handshake gates the SAME
;; apply path - no second generator, no second door.
;;
;; Host reachability is answered HERE, not in the lib: the lib takes an
;; injected predicate so it never reads a key, and this adapter only ever
;; asks "is this provider's credential present and non-empty on this host",
;; answering a boolean. No key VALUE is read into any output.
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

(defn profiles-dir []
  (str (fs/path (steward-state-dir) "profiles")))

(defn read-profile! [name]
  (let [path (fs/path (profiles-dir) (str name ".json"))]
    (when-not (fs/exists? path)
      (throw (ex-info (str "no such profile: " name " (looked in " (profiles-dir) ")") {:profile name})))
    (bob-starting-cast-lib/parse-profile (json/parse-string (slurp (str path))))))

;; The provider -> credential env var map the launcher itself uses. Presence
;; only: a blank or missing value means "not reachable on this host", and the
;; value is never read into a message, a cast or a note.
(def provider-credential-env
  {"anthropic" ["ANTHROPIC_API_KEY" "ANTHROPIC_AUTH_TOKEN" "CLAUDE_CODE_OAUTH_TOKEN"]
   "openrouter" ["OPENROUTER_API_KEY"]
   "cerebras" ["CEREBRAS_API_KEY"]
   "mistral" ["MISTRAL_API_KEY"]
   "openai" ["OPENAI_API_KEY"]
   "qwen" ["QWEN_API_KEY"]
   "local" []})

(defn host-reachable?
  "True when this host carries a non-blank credential for the provider. A
   provider with no credential requirement (local) is reachable by definition;
   a provider this map does not know is NOT assumed reachable - failing closed
   is the whole point of the handshake."
  [provider _model]
  (if-let [vars (get provider-credential-env provider)]
    (or (empty? vars)
        (boolean (some (fn [v] (not (str/blank? (str (System/getenv v))))) vars)))
    false))

(defn run-profile-export [name]
  (let [registry (load-registry)
        result (bob-starting-cast-lib/generate-cast-from-profile
                registry (read-profile! name) {:reachable? host-reachable?})]
    (println (json/generate-string (dissoc result :profile)))
    (binding [*out* *err*]
      (println (bob-starting-cast-lib/evidence-note-text result)))
    (if (:runnable? result)
      0
      (do (binding [*out* *err*]
            (println (bob-starting-cast-lib/generation-failure-text result)))
          1))))

(defn run-profile-apply [name]
  (let [registry (load-registry)
        result (bob-starting-cast-lib/generate-cast-from-profile
                registry (read-profile! name) {:reachable? host-reachable?})]
    (binding [*out* *err*]
      (println (bob-starting-cast-lib/evidence-note-text result)))
    (if-not (:runnable? result)
      (do (binding [*out* *err*]
            (println (bob-starting-cast-lib/generation-failure-text result)))
          1)
      (let [plan (bob-starting-cast-lib/apply-via-modelfactory-overlay (:cast result) result)
            overlay-path (model-factory-store/write-assignment-overlay! (factory-state-dir) (:assignment plan))]
        (println (json/generate-string (assoc plan :overlay-path overlay-path)))
        0))))

(defn profile-name [args]
  (second (drop-while #(not= "--profile" %) args)))

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
      "export" (if-let [name (profile-name args)]
                 (run-profile-export name)
                 (run-export (rest args)))
      "apply" (if-let [name (profile-name args)]
                (run-profile-apply name)
                (run-apply (rest args)))
      (do (binding [*out* *err*]
            (println "Usage: bob_starting_cast_cli.bb export|apply [--profile <name>]"))
          1))))

(when (= *file* (System/getProperty "babashka.file"))
  (System/exit (-main)))
