#!/usr/bin/env bb
;; Context Telemetry's fs adapter (GH-22 Slice 1) — mirrors
;; model_steward_store.bb's shape: thin fs I/O only, no decisions (those
;; live in context_telemetry_lib.bb). Owns the append-only runtime log under
;; .swarmforge/telemetry/context-events.jsonl (gitignored, mirrors
;; .swarmforge/model-steward/'s posture — no committed seed here, this log
;; starts empty).
(ns context-telemetry-store
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def default-state-dir-rel ".swarmforge/telemetry")

;; *file* is dynamically scoped to whichever file is currently being loaded —
;; capture it HERE, at load time, into a plain def. Referencing it lazily
;; inside a defn instead reads the CALLER's *file* binding at call time
;; (mirrors model_steward_store.bb's this-file — the same script-dir
;; discovery hazard applies to every load-file'd script in this dir).
(def ^:private this-file (fs/canonicalize *file*))

(defn repo-root []
  (fs/parent (fs/parent (fs/parent this-file))))

(defn log-file [state-dir]
  (fs/path state-dir "context-events.jsonl"))

(defn append-event!
  "Appends one already-validated event as a single JSONL line. Callers must
   validate BEFORE calling this — this function has no validation of its
   own, so the only way the log stays free of malformed records is that the
   CLI never reaches this call on a failed validate-event."
  [state-dir event]
  (fs/create-dirs state-dir)
  (spit (str (log-file state-dir)) (str (json/generate-string event) "\n") :append true))

(defn read-events!
  "Every recorded event, parsed with keyword keys, in file (append) order.
   Returns an empty coll when the log does not exist yet — a fresh state
   dir with nothing recorded is not an error."
  [state-dir]
  (let [f (log-file state-dir)]
    (if (fs/exists? f)
      (->> (slurp (str f))
           str/split-lines
           (remove str/blank?)
           (mapv #(json/parse-string % true)))
      [])))
