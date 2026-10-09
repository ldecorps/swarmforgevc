#!/usr/bin/env bb
;; local_model_prepare_lib.bb — shared mechanical prepare for a new local
;; (ollama/HF GGUF) coder candidate. Recruiter invokes after pull; steward
;; invokes for bakeoff re-probe. Does NOT certify, rewrite packs, or staff
;; seats. Frozen Modelfile template under swarmforge/packs/.
(ns local-model-prepare-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def default-num-ctx 32768)
(def default-num-predict 4096)

(def ^:private template-rel "swarmforge/packs/local-coder-prepare.Modelfile.tmpl")

;; Capture at load time — runtime *file* is the caller (e.g. a test runner).
(def ^:private lib-dir
  (str (fs/parent (fs/canonicalize *file*))))

(defn repo-root
  "Checkout root: parent of swarmforge/ (lib lives in swarmforge/scripts/)."
  []
  (str (fs/parent (fs/parent lib-dir))))

(defn prepared-dir
  "Where prepared Modelfiles / profiles land. Overridable for tests."
  ([]
   (prepared-dir (or (System/getenv "MODEL_STEWARD_STATE_DIR")
                     (str (fs/path (repo-root) ".swarmforge" "model-steward")))))
  ([state-dir]
   (str (fs/path state-dir "prepared"))))

(defn template-path
  ([] (template-path (repo-root)))
  ([root] (str (fs/path root template-rel))))

(defn sanitize-alias
  "Turn a base tag into a short ollama alias (library-style, no slashes)."
  [base]
  (let [s (-> (str base)
              (str/replace #"^hf\.co/" "")
              (str/replace #"[/:]+" "-")
              (str/replace #"[^A-Za-z0-9._-]+" "-")
              (str/replace #"-+" "-")
              (str/replace #"^-|-$" "")
              str/lower-case)
        s (if (str/blank? s) "prepared-local" s)
        s (if (> (count s) 48) (subs s 0 48) s)]
    (str "prepared-" s)))

(defn render-modelfile
  "Pure: fill the frozen template. Returns Modelfile text."
  [{:keys [from num-ctx num-predict template-text]
    :or {num-ctx default-num-ctx num-predict default-num-predict}}]
  (when (str/blank? from)
    (throw (ex-info "prepare: :from (base tag) required" {})))
  (let [tmpl (or template-text
                 (slurp (template-path)))]
    (-> tmpl
        (str/replace "{{FROM}}" (str from))
        (str/replace "{{NUM_CTX}}" (str num-ctx))
        (str/replace "{{NUM_PREDICT}}" (str num-predict)))))

(defn think-off-aider-settings
  "YAML fragment for .aider.model.settings.yml covering the ids aider may use."
  [model-ids]
  (str/join
   "\n"
   (mapcat
    (fn [id]
      [(str "- name: " id)
       "  edit_format: diff"
       "  use_repo_map: true"
       "  extra_params:"
       "    think: false"
       "  reasoning_tag: think"
       ""])
    model-ids)))

(defn aider-model-ids-for
  "Ids to register in aider settings for a prepared alias / base tag."
  [alias-or-tag]
  (let [raw (str alias-or-tag)
        with-ollama (if (str/includes? raw "/") raw (str "ollama_chat/" raw))]
    (distinct [raw with-ollama (str "openai/" raw)])))

(defn empty-response-fail-shape?
  "True when a BL-1700 summary looks like the XXS/Qwen3.6 empty-implement
   failure: 0 handoffs and every coder fixture ended 'no model commit' fast."
  [{:keys [handedOff of verdict] :as summary} scorecards]
  (let [coder-sc (remove (fn [sc]
                           (re-find #"hazard|path-mention|spec-changed|read-only"
                                    (str (:fixtureId sc))))
                         scorecards)]
    (boolean
     (and summary
          (= 0 (or handedOff 0))
          (pos? (or of 0))
          (= "fail" verdict)
          (seq coder-sc)
          (every? (fn [sc]
                    (and (= "no model commit" (:outcome sc))
                         (number? (:wallSeconds sc))
                         (< (:wallSeconds sc) 60)))
                  coder-sc)))))

(defn- sh-ok?
  "Run argv; return {:ok? :out :err :exit}. dry-run? skips the process."
  [dry-run? argv]
  (if dry-run?
    {:ok? true :out (str "dry-run: " (str/join " " argv)) :err "" :exit 0}
    (let [p (apply process/shell {:out :string :err :string :continue true} argv)]
      {:ok? (zero? (:exit p)) :out (:out p) :err (:err p) :exit (:exit p)})))

(defn write-aider-settings!
  "Write think-off settings for model-ids to path. Returns path."
  [path model-ids]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (think-off-aider-settings model-ids))
  (str path))

(defn prepare!
  "Prepare a local coder alias from a base ollama/HF tag.
   Opts:
     :base            required base tag
     :alias           optional alias (default sanitize-alias of base)
     :num-ctx         default 32768
     :num-predict     default 4096
     :root            repo root (default repo-root)
     :state-dir       steward state dir (default .swarmforge/model-steward)
     :dry-run?        skip ollama create
     :skip-ollama?    synonym for dry-run?
   Returns map: :alias :base :modelfilePath :profilePath :aiderSettingsPath
                :numCtx :numPredict :created? :profile"
  [{:keys [base alias num-ctx num-predict root state-dir dry-run? skip-ollama?]
    :or {num-ctx default-num-ctx num-predict default-num-predict}}]
  (let [root (or root (repo-root))
        state-dir (or state-dir
                      (System/getenv "MODEL_STEWARD_STATE_DIR")
                      (str (fs/path root ".swarmforge" "model-steward")))
        out-dir (prepared-dir state-dir)
        alias (or (not-empty alias) (sanitize-alias base))
        dry? (boolean (or dry-run? skip-ollama?))
        body (render-modelfile {:from base :num-ctx num-ctx :num-predict num-predict
                                :template-text (slurp (template-path root))})
        modelfile-path (str (fs/path out-dir (str alias ".Modelfile")))
        profile-path (str (fs/path out-dir (str alias ".profile.json")))
        aider-path (str (fs/path out-dir (str alias ".aider.model.settings.yml")))
        profile {:base base :alias alias :numCtx num-ctx :numPredict num-predict
                 :thinkOff true :preparedAt (str (java.time.Instant/now))
                 :modelfilePath modelfile-path :profilePath profile-path
                 :aiderSettingsPath aider-path}]
    (fs/create-dirs out-dir)
    (spit modelfile-path body)
    (write-aider-settings! aider-path (aider-model-ids-for alias))
    (spit profile-path (json/generate-string profile {:pretty true}))
    (let [create (sh-ok? dry? ["ollama" "create" alias "-f" modelfile-path])]
      (when-not (:ok? create)
        (throw (ex-info (str "ollama create failed for " alias ": "
                             (str/trim (str (:err create) " " (:out create))))
                        {:alias alias :exit (:exit create)})))
      (assoc profile :created? (not dry?) :dryRun? dry?
             :ollamaCreateOut (str/trim (str (:out create) " " (:err create)))))))
