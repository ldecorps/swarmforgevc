#!/usr/bin/env bb
;; Mono-router resume: pick the role that holds the NEWEST live parcel for an
;; active ticket (inbox/new OR inbox/in_process by created_at), then rotate the
;; resident pane there. Prevents a pack relaunch from always restarting at
;; coder-home and re-doing earlier stages — and avoids stale upstream
;; in_process claims (e.g. old QA/architect) outranking a later handoff.
;;
;; Usage:
;;   mono_router_resume.bb <project-root> [--dry-run]
;;
;; Exit 0 always after a best-effort resume (or no-op). Exit 2 on usage error.

(ns mono-router-resume
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "pipeline_stage_lib.bb")))
(load-file (str (fs/path script-dir "handoff_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: mono_router_resume.bb <project-root> [--dry-run]"))
  (System/exit 2))

(def args *command-line-args*)
(when (or (empty? args) (#{"-h" "--help"} (first args))) (usage))
(def project-root (first args))
(def dry-run? (boolean (some #{"--dry-run"} (rest args))))

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn- active-ticket-ids []
  (let [dir (fs/path project-root "backlog" "active")]
    (if (fs/exists? dir)
      (set (keep #(some-> (read-yaml-field (slurp (str %)) "id") str/upper-case)
                 (fs/glob dir "**.yaml")))
      #{})))

(defn- list-handoff-files [dir]
  (if-not (fs/exists? dir)
    []
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
         (map str))))

(defn- list-batch-dirs [dir]
  (if-not (fs/exists? dir)
    []
    (->> (fs/list-dir dir)
         (filter #(and (fs/directory? %) (str/starts-with? (fs/file-name %) "batch_")))
         (map str))))

(defn- list-handoff-files-with-batches [dir]
  (concat (list-handoff-files dir) (mapcat list-handoff-files (list-batch-dirs dir))))

(defn- read-header-field [file-path field]
  (let [header (first (str/split (slurp file-path) #"\n\n" 2))
        prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (subs line (count prefix))))
          (str/split-lines header))))

(defn- role-holdings
  "Every live parcel in new/ or in_process/ for pipeline roles, with ticket id
   and created_at (ISO string; missing sorts as oldest)."
  []
  (let [roles (remove #(= "coordinator" (:role %))
                      (handoff-lib/load-all-roles project-root))
        active (active-ticket-ids)]
    (for [role-info roles
          dir [(str (handoff-lib/mailbox-dir role-info :new))
               (str (handoff-lib/mailbox-dir role-info :in_process))]
          f (list-handoff-files-with-batches dir)
          :let [task (read-header-field f "task")
                message (read-header-field f "message")
                ticket-id (pipeline-stage-lib/ticket-id-from-headers
                           {:task task :message message})]
          :when (and ticket-id (contains? active ticket-id))]
      {:role (:role role-info)
       :ticket-id ticket-id
       :created-at (or (read-header-field f "created_at") "")
       :path f})))

(defn compute-resume-map
  "Board-shaped map: one role per ticket. Uses the role that holds the
   NEWEST parcel for that ticket (created_at), not merely the furthest
   pipeline stage — stale upstream in_process claims must not outrank a
   later downstream handoff after a bounce/relaunch."
  []
  (let [holdings (role-holdings)
        by-ticket (group-by :ticket-id holdings)]
    (into {}
          (for [[ticket-id hs] by-ticket
                :let [newest (last (sort-by :created-at hs))]]
            [ticket-id (:role newest)]))))

(defn home-role
  "First non-coordinator role in roles.tsv — mono-router resident home."
  []
  (some (fn [r] (when (not= "coordinator" (:role r)) (:role r)))
        (handoff-lib/load-all-roles project-root)))

(defn choose-resume-role [stage-map]
  (let [home (home-role)
        ;; Among tickets, prefer the role holding the globally newest parcel
        ;; (same created_at rule as compute-resume-map), falling back to the
        ;; furthest stage-map role, then home.
        holdings (role-holdings)
        newest (when (seq holdings) (last (sort-by :created-at holdings)))]
    (or (when newest (:role newest))
        (let [roles (vals stage-map)
              role-order (mapv :role (remove #(= "coordinator" (:role %))
                                             (handoff-lib/load-all-roles project-root)))
              rank (fn [role] (.indexOf ^java.util.List (vec role-order) role))]
          (when (seq roles) (last (sort-by rank roles))))
        home)))

(defn resident-session [home]
  (str "swarmforge-" home))

(defn launch-script [role]
  (str (fs/path project-root ".swarmforge" "launch" (str role ".sh"))))

(defn tmux-socket []
  (str/trim (slurp (str (fs/path project-root ".swarmforge" "tmux-socket")))))

(defn provider-env-args []
  (cond-> []
    (not (str/blank? (System/getenv "MISTRAL_API_KEY")))
    (concat ["-e" (str "MISTRAL_API_KEY=" (System/getenv "MISTRAL_API_KEY"))])
    (not (str/blank? (System/getenv "OPENAI_API_KEY")))
    (concat ["-e" (str "OPENAI_API_KEY=" (System/getenv "OPENAI_API_KEY"))])
    (not (str/blank? (System/getenv "GEMINI_API_KEY")))
    (concat ["-e" (str "GEMINI_API_KEY=" (System/getenv "GEMINI_API_KEY"))])
    (not (str/blank? (System/getenv "PERPLEXITY_API_KEY")))
    (concat ["-e" (str "PERPLEXITY_API_KEY=" (System/getenv "PERPLEXITY_API_KEY"))])
    (not (str/blank? (System/getenv "DEEPSEEK_API_KEY")))
    (concat ["-e" (str "DEEPSEEK_API_KEY=" (System/getenv "DEEPSEEK_API_KEY"))])))

(defn respawn-resident! [home target-role]
  (let [socket (tmux-socket)
        script (launch-script target-role)
        session (resident-session home)]
    (when-not (fs/exists? script)
      (binding [*out* *err*]
        (println "mono-router-resume: missing launch script" script))
      (System/exit 3))
    (let [args (concat ["tmux" "-S" socket "respawn-pane" "-k"]
                       (provider-env-args)
                       ["-t" session (str "zsh '" script "'")])]
      (apply process/shell {:out :string :err :string :continue true} args))))

(defn sync-stage-map! []
  (process/shell {:out :string :err :string :continue true}
                 "bb" (str (fs/path script-dir "pipeline_stage_cli.bb"))
                 project-root "sync"))

(defn -main []
  (when-not (fs/directory? project-root)
    (binding [*out* *err*] (println "not a directory:" project-root))
    (System/exit 2))
  (let [home (home-role)
        stage-map (compute-resume-map)
        target (choose-resume-role stage-map)
        summary {:home home
                 :stageMap stage-map
                 :resumeRole target
                 :rotated (and (not dry-run?) (not= target home))}]
    (println (json/generate-string summary))
    (when (and (not dry-run?) target (not= target home))
      (respawn-resident! home target)
      (sync-stage-map!)
      (binding [*out* *err*]
        (println (str "mono-router-resume: rotated resident " home " pane -> " target))))))

(-main)
