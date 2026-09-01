#!/usr/bin/env bb
;; BL-1318: pack staffing gate CLI — the thin fs adapter over
;; pack_staffing_gate_lib.bb's pure seat-staffing-decision (same "pure lib +
;; thin CLI" split as compliance_battery.bb). It ONLY READS steward evidence
;; (invariant 2): the runtime registry or, falling back, the committed seed,
;; plus the scorecards dir. It never writes the registry, a scorecard or a
;; role matrix, and it never runs a compliance battery.
;;
;; Usage:
;;   pack_staffing_gate_cli.bb <repo-root> <windows-file> [--override]
;;
;; windows-file lines: seat-id<TAB>stage<TAB>agent<TAB>extra-cli
;; stdout (one line per window, same order):
;;   seat-id<TAB>decision<TAB>provider<TAB>model<TAB>failing-check<TAB>steward-command
;;   ... or the single marker line NO_EVIDENCE<TAB><seat-count> when neither
;;   a runtime registry nor the committed seed is readable (a synthetic
;;   fixture world; a real checkout always carries the seed). The caller
;;   records the decisions and enforces refusals (swarmforge.sh's
;;   pack_staffing_gate is that caller).
(ns pack-staffing-gate-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(let [here (fs/parent (fs/canonicalize *file*))]
  (load-file (str (fs/path here "model_steward_lib.bb")))
  (load-file (str (fs/path here "pack_staffing_gate_lib.bb"))))

(defn- composite-safe-key-fn [k]
  ;; provider/model composites must stay strings (keyword splits on "/");
  ;; same rule as model_steward_store.bb's own parser.
  (if (str/includes? k "/") k (keyword k)))

(defn- parse-json [text]
  (json/parse-string text composite-safe-key-fn))

(defn- stringify-role-matrix-keys [registry]
  (update registry :role_matrix
          (fn [role-matrix] (into {} (map (fn [[k v]] [(name k) v])) role-matrix))))

(defn- read-runtime-registry [state-dir]
  (let [path (fs/path state-dir "registry.json")]
    (when (fs/readable? path)
      (stringify-role-matrix-keys (parse-json (slurp (str path)))))))

(defn- read-seed-registry [repo-root]
  (let [path (fs/path repo-root "swarmforge" "model-steward" "seed" "models.seed.json")]
    (when (fs/readable? path)
      (model-steward-lib/seed-data->registry (parse-json (slurp (str path)))))))

(defn- read-scorecards [state-dir]
  (let [dir (fs/path state-dir "scorecards")]
    (if (fs/directory? dir)
      (into {}
            (keep
             (fn [path]
               (when (and (fs/regular-file? path)
                          (str/ends-with? (str path) ".json"))
                 (let [stem (str/replace (fs/file-name path) #"\.json$" "")
                       [provider model] (str/split stem #"__" 2)]
                   (when (and provider model)
                     [(str provider "/" model) (parse-json (slurp (str path)))])))))
            (fs/list-dir dir))
      {})))

(defn- tsv-field [value]
  (str/replace (str (or value "")) #"\t" " "))

(defn main []
  (let [args *command-line-args*]
    (when (< (count args) 2)
      (binding [*out* *err*]
        (println "usage: pack_staffing_gate_cli.bb <repo-root> <windows-file> [--override]"))
      (System/exit 2))
    (let [[repo-root windows-file] args
          override? (some #{"--override"} args)
          state-dir (or (System/getenv "MODEL_STEWARD_STATE_DIR")
                        (str (fs/path repo-root ".swarmforge" "model-steward")))
          lines (->> (str/split-lines (slurp windows-file))
                     (remove str/blank?))
          registry (or (read-runtime-registry state-dir)
                       (read-seed-registry repo-root))]
      (if (nil? registry)
        (println (str "NO_EVIDENCE\t" (count lines)))
        (let [scorecards (read-scorecards state-dir)]
          (doseq [line lines]
            (let [[seat-id stage agent extra-cli] (str/split line #"\t" 4)
                  decision (pack-staffing-gate-lib/seat-staffing-decision
                            {:registry registry :scorecards scorecards}
                            stage agent (or extra-cli "")
                            {:override? override?})]
              (println (str/join "\t"
                                 [(tsv-field seat-id)
                                  (tsv-field (:decision decision))
                                  (tsv-field (:provider decision))
                                  (tsv-field (:model decision))
                                  (tsv-field (:failing-check decision))
                                  (tsv-field (:steward-command decision))])))))))))

(main)
