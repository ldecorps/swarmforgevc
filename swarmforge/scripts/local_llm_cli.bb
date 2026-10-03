#!/usr/bin/env bb
;; BL-1861: the IO layer behind local_llm.sh remove - roster surgery
;; (reusing retire_seat_lib.bb's row filtering, never a second filter),
;; the .swarmforge/local-llm/removed.json record, the Ollama HTTP unload
;; with its bounded wait, the parcel report, and the GPU memory line. The
;; pure decisions (which rows are local-model, the bare-seat refusal, the
;; record shape, the launch-script parse) live in local_llm_lib.bb; this
;; file only gathers facts and acts.

(ns local-llm-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "local_llm_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "retire_seat_lib.bb")))

(def wait-seconds
  (let [v (System/getenv "SWARMFORGE_LOCAL_LLM_UNLOAD_WAIT_SECONDS")]
    (or (try (Long/parseLong (str/trim (str v))) (catch Exception _ nil)) 30)))

(def poll-ms
  (let [v (System/getenv "SWARMFORGE_LOCAL_LLM_UNLOAD_POLL_MS")]
    (or (try (Long/parseLong (str/trim (str v))) (catch Exception _ nil)) 300)))

(defn- slurp-safe
  "slurp, but \"\" on any failure (missing file, permission) rather than
   a throw. Always via (str path) - bb's slurp does not accept a
   babashka.fs Path object directly."
  [path]
  (try (slurp (str path)) (catch Exception _ "")))

(defn- exists? [path]
  (.exists (java.io.File. (str path))))

(defn- now-iso []
  (str (java.time.Instant/now)))

;; ── Ollama HTTP ──────────────────────────────────────────────────────────

(defn- fetch-api-ps
  "Already-decoded /api/ps body (KEYWORD keys - local-llm-lib's own
   loaded-model-names/models-for-seats both read :models/:name/:model/
   :size_vram), or nil on any failure - unreachable endpoint, non-2xx,
   unparseable body. The caller treats nil as \"nothing known is
   loaded\", never a crash."
  [base-url]
  (try
    (let [{:keys [exit out]} (process/sh "curl" "-sS" "-m" "5" (str base-url "/api/ps"))]
      (when (zero? exit)
        (json/parse-string out true)))
    (catch Exception _ nil)))

(defn- request-unload!
  "POST /api/generate {model, keep_alive: 0} - Ollama's own unload call.
   Swallows any failure (unreachable, non-2xx); the caller's own /api/ps
   poll is what actually decides whether the unload took."
  [base-url model]
  (try
    (process/sh "curl" "-sS" "-m" "5" "-X" "POST" (str base-url "/api/generate")
                "-d" (json/generate-string {:model model :keep_alive 0}))
    (catch Exception _ nil)))

(defn- still-loaded?
  [base-url model]
  (let [body (fetch-api-ps base-url)]
    (contains? (local-llm-lib/loaded-model-names body) model)))

(defn- unload-with-wait!
  "Unloads model from base-url, polling /api/ps for up to wait-seconds
   (poll-ms apart) until it drops off. Returns true once confirmed gone,
   false if the wait bound passed with it still listed."
  [base-url model]
  (request-unload! base-url model)
  (let [deadline (+ (System/currentTimeMillis) (* wait-seconds 1000))]
    (loop []
      (if-not (still-loaded? base-url model)
        true
        (if (>= (System/currentTimeMillis) deadline)
          false
          (do (Thread/sleep (long poll-ms))
              (recur)))))))

;; ── GPU memory (item 7) - bounded via a future, portable (no reliance on
;; a `timeout` binary existing on the host) ───────────────────────────────

(defn- report-gpu-memory! []
  (let [result (try
                 (deref (future
                          (try
                            (process/sh "nvidia-smi" "--query-gpu=memory.used" "--format=csv,noheader,nounits")
                            (catch Exception _ nil)))
                        2000 ::timeout)
                 (catch Exception _ nil))
        mib (when (and (map? result) (zero? (:exit result 1)))
              (let [line (str/trim (first (str/split-lines (str (:out result)))))]
                (when (re-matches #"\d+" line) line)))]
    (println (str "GPU_MEMORY_MIB: " (or mib "unknown")))))

;; ── roster surgery (BL-1861 item 4) - same order/copies as retire_seat.sh,
;; reusing retire-seat-lib's own row filtering ─────────────────────────────

(defn- remove-seats-from-text [text seat-ids col-idx]
  (reduce (fn [t id] (retire-seat-lib/filter-out-seat-rows t id col-idx)) text seat-ids))

(defn- roster-surgery! [root seat-ids original-roles]
  (let [roles-file (str (fs/path root ".swarmforge" "roles.tsv"))
        sessions-file (str (fs/path root ".swarmforge" "sessions.tsv"))
        worktree-paths (retire-seat-lib/worktree-paths original-roles)]
    (spit roles-file (str (remove-seats-from-text original-roles seat-ids 0) "\n"))
    (when (exists? sessions-file)
      (spit sessions-file (str (remove-seats-from-text (slurp-safe sessions-file) seat-ids 1) "\n")))
    (doseq [wt worktree-paths]
      (let [wt-roles (str (fs/path wt ".swarmforge" "roles.tsv"))]
        (when (and (not= wt root) (exists? wt-roles))
          (spit wt-roles (str (remove-seats-from-text (slurp-safe wt-roles) seat-ids 0) "\n")))))))

(defn- kill-sessions! [root seat-id->session]
  (let [sock-file (str (fs/path root ".swarmforge" "tmux-socket"))]
    (when (exists? sock-file)
      (let [sock (str/trim (slurp sock-file))]
        (doseq [[_ session] seat-id->session]
          (when-not (str/blank? session)
            (try (process/sh "tmux" "-S" sock "kill-session" "-t" session)
                 (catch Exception _ nil))))))))

;; ── parcel report (item 6) - reads, moves nothing ─────────────────────────

(defn- ticket-of [handoff-file]
  (let [m (re-find #"(?m)^task:\s*(\S+)" (slurp-safe handoff-file))]
    (or (second m) "(unknown)")))

(defn- report-parcels! [seat-id worktree]
  (doseq [mailbox ["new" "in_process"]]
    (let [dir (fs/path worktree ".swarmforge" "handoffs" "inbox" mailbox)]
      (when (fs/exists? dir)
        (doseq [f (sort (fs/list-dir dir))]
          (when (str/ends-with? (str f) ".handoff")
            (println (str "LOCAL_LLM_SEAT_PARCEL: " seat-id " " mailbox " "
                          (ticket-of (str f)) " " (str f)))))))))

;; ── roles.tsv row lookups (by seat id, original pre-surgery text) ────────

(defn- row-field [roles-text seat-id col-idx]
  (some (fn [line]
          (let [cols (str/split line #"\t")]
            (when (= seat-id (first cols)) (nth cols col-idx nil))))
        (remove str/blank? (str/split-lines (or roles-text "")))))

;; ── remove (the full flow) ─────────────────────────────────────────────────

(defn- unload-and-report! [model->facts]
  (let [outcomes (for [[model {:strs [endpoint]}] model->facts]
                    (if (str/blank? (str endpoint))
                      (do (println (str "LOCAL_LLM_MODEL_UNLOAD_SKIPPED: " model " - no endpoint known"))
                          true)
                      (if (unload-with-wait! endpoint model)
                        (do (println (str "LOCAL_LLM_MODEL_UNLOADED: " model)) true)
                        (do (println (str "LOCAL_LLM_MODEL_STILL_LOADED: " model
                                          " - run local_llm.sh remove again to retry the unload"))
                            false))))]
    (report-gpu-memory!)
    (every? true? outcomes)))

(defn- do-fresh-remove! [root roles-text sessions-text seat-ids]
  (let [launch-dir (fs/path root ".swarmforge" "launch")
        seat->facts (into {} (map (fn [id]
                                     [id (local-llm-lib/parse-launch-script
                                          (slurp-safe (fs/path launch-dir (str id ".sh"))))])
                                   seat-ids))
        endpoints (->> (vals seat->facts) (map :endpoint) (remove str/blank?) distinct)
        ps-bodies (map fetch-api-ps endpoints)
        merged-ps {:models (mapcat :models ps-bodies)}
        model-facts-kw (local-llm-lib/models-for-seats seat->facts merged-ps)
        ;; JSON round-trip once, so every downstream map (written to the
        ;; record and used by the unload loop) is the same string-keyed
        ;; shape - no keyword/string ambiguity between the two call sites.
        model-facts (json/parse-string (json/generate-string model-facts-kw))
        record (local-llm-lib/build-removed-record roles-text sessions-text seat-ids model-facts-kw (now-iso))
        record-dir (fs/path root ".swarmforge" "local-llm")
        record-file (fs/path record-dir "removed.json")
        seat->session (into {} (map (fn [id] [id (row-field roles-text id 3)]) seat-ids))]
    (fs/create-dirs record-dir)
    (spit (str record-file) (local-llm-lib/record->json record))
    (doseq [id seat-ids] (println (str "LOCAL_LLM_REMOVED: " id)))
    (println (str "LOCAL_LLM_RECORD: " record-file))
    (roster-surgery! root seat-ids roles-text)
    (kill-sessions! root seat->session)
    (doseq [id seat-ids]
      (report-parcels! id (row-field roles-text id 2)))
    (if (unload-and-report! model-facts)
      0
      1)))

(defn- do-retry-or-report! [root]
  (let [record-file (fs/path root ".swarmforge" "local-llm" "removed.json")
        record (when (fs/exists? record-file) (local-llm-lib/parse-record (slurp-safe record-file)))]
    (if (nil? record)
      (do (println "LOCAL_LLM: no local-model seat") 0)
      (let [models (get record "models" {})]
        (if (unload-and-report! models)
          (do (println "LOCAL_LLM: already removed") 0)
          1)))))

(defn remove! [root]
  (let [roles-file (fs/path root ".swarmforge" "roles.tsv")]
    (when-not (fs/exists? roles-file)
      (println (str "local_llm: refusing - no roles.tsv at " roles-file))
      (System/exit 1))
    (let [roles-text (slurp (str roles-file))
          sessions-file (fs/path root ".swarmforge" "sessions.tsv")
          sessions-text (slurp-safe sessions-file)
          seat-ids (local-llm-lib/local-model-seat-ids roles-text)]
      (if (seq seat-ids)
        (if-let [bare (local-llm-lib/first-bare-seat seat-ids)]
          (do (println (str "LOCAL_LLM_REFUSED: '" bare
                            "' is a bare seat (no @) - stage addressing and the coordinator's pane need it; changing nothing"))
              (System/exit 1))
          (System/exit (do-fresh-remove! root roles-text sessions-text seat-ids)))
        (System/exit (do-retry-or-report! root))))))

(let [[verb root] *command-line-args*]
  (case verb
    "remove" (remove! root)
    (do (println "Usage: local_llm_cli.bb remove <project-root>") (System/exit 1))))
