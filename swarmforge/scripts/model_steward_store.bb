#!/usr/bin/env bb
;; Model Steward's fs adapter (BL-547 Slice 1) — mirrors
;; support_thread_store.bb / operator_memory_store.bb's shape: thin fs I/O
;; only, no decisions (those live in model_steward_lib.bb). Owns:
;;   - the committed schema+seed under swarmforge/model-steward/seed/
;;     (tracked; read-only at runtime)
;;   - the mutable runtime registry under .swarmforge/model-steward/registry.json
;;     (gitignored; initialised from the seed on first read)
;;   - certification report artifacts under
;;     .swarmforge/model-steward/certification-reports/
;;
;; JSON keys that carry a "provider/model" composite (capabilities, adapters)
;; must never be keywordized with plain `true` — Clojure's `keyword` splits
;; on "/" into a namespaced keyword and silently drops the provider on any
;; (name k) round-trip (caught by model_steward_test_runner.bb's seed-transform
;; tests). composite-safe-key-fn keywordizes only slash-free keys.
(ns model-steward-store
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def default-state-dir-rel ".swarmforge/model-steward")

(def seed-file-rel "swarmforge/model-steward/seed/models.seed.json")

(defn- composite-safe-key-fn [k]
  (if (clojure.string/includes? k "/") k (keyword k)))

(defn- parse-json [text]
  (json/parse-string text composite-safe-key-fn))

;; JSON has no keyword/string distinction, so a :role_matrix key written from
;; a string-keyed in-memory registry (model_steward_lib.bb/seed-data->registry
;; normalizes role names to plain strings via (name k)) comes back
;; keywordized on every subsequent read — composite-safe-key-fn keywordizes
;; any key without a "/", and role names (e.g. "coder") never have one.
;; model_steward_lib.bb always looks role_matrix up by string role name
;; (role-recommendations, add-role-ranking), so re-stringify here on the way
;; back out of JSON. (name k) is a no-op when k is already a string.
(defn- stringify-role-matrix-keys [registry]
  (update registry :role_matrix
          (fn [role_matrix] (into {} (map (fn [[k v]] [(name k) v])) role_matrix))))

(defn registry-file [state-dir]
  (fs/path state-dir "registry.json"))

(defn certification-reports-dir [state-dir]
  (fs/path state-dir "certification-reports"))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

;; *file* is dynamically scoped to whichever file is currently being loaded —
;; it must be captured HERE, at load time, into a plain def. Referencing
;; *file* lazily inside a defn instead reads the CALLER's *file* binding at
;; call time (e.g. "NO_SOURCE_PATH" under `bb -e`, or another script's own
;; path under `load-file`), silently truncating repo-root. This mirrors
;; prompt_engine_lib.bb's `lib-dir` and every other script-dir def in
;; swarmforge/scripts/ — this file was the one exception, caught by its own
;; smoke test.
(def ^:private this-file (fs/canonicalize *file*))

(defn repo-root []
  (fs/parent (fs/parent (fs/parent this-file))))

(defn read-seed! []
  (parse-json (slurp (str (fs/path (repo-root) seed-file-rel)))))

(defn write-registry! [state-dir registry]
  (atomic-spit! (registry-file state-dir) (json/generate-string registry)))

(defn read-registry!
  "Reads the runtime registry, initialising it from the committed seed on
   first use (via seed->registry, which the caller supplies so this stays
   thin fs I/O — model_steward_lib.bb/seed-data->registry is the transform)."
  [state-dir seed-data->registry]
  (let [p (registry-file state-dir)]
    (if (fs/exists? p)
      (stringify-role-matrix-keys (parse-json (slurp (str p))))
      (let [initial (seed-data->registry (read-seed!))]
        (write-registry! state-dir initial)
        initial))))

(defn write-certification-report! [state-dir provider model timestamp report]
  (let [safe-ts (clojure.string/replace timestamp #"[^A-Za-z0-9._-]" "-")
        file-name (str provider "__" model "__" safe-ts ".json")
        path (fs/path (certification-reports-dir state-dir) file-name)]
    (atomic-spit! path (json/generate-string report))
    (str "certification-reports/" file-name)))

(defn read-certification-report! [state-dir relative-path]
  (let [p (fs/path state-dir relative-path)]
    (when (fs/exists? p)
      (parse-json (slurp (str p))))))
