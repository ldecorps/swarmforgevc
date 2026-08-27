;; babysitter_assess_lib.bb — pure BL-528 claim-progress risk scan for the hawk.
;;
;; The cheap babysitter runtime calls scan-claim-risks! each tick; when a role
;; is heading for bounce/halt with HEAD unchanged, it enqueues a structured wake
;; so the LLM can nudge a commit, archive a stale claim, or file a defect
;; before kill_all_swarm runs.

(ns babysitter-assess-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "claim_progress_lib.bb")))

(def default-warn-reclaims 4)
(def default-critical-reclaims 6)

(defn parse-roles-tsv
  "Returns [{:role ... :worktree-path ...}] from .swarmforge/roles.tsv."
  [roles-file]
  (when (fs/exists? roles-file)
    (->> (str/split-lines (slurp (str roles-file)))
         (remove str/blank?)
         (mapv (fn [line]
                 (let [[role _worktree-name worktree-path & _] (str/split line #"\t")]
                   {:role role :worktree-path worktree-path}))))))

(defn read-sidecar [path]
  (try
    (json/parse-string (slurp path) true)
    (catch Exception _ nil)))

(defn sidecar-handoff-path [sidecar-path]
  (str/replace (str sidecar-path) #"\.claim-progress\.json$" ""))

(defn worktree-head-commit-10
  "10-char HEAD of a worktree, or \"\" on error. Uses process/sh (captures
   stdout by default) rather than process/shell, which without :out :string
   inherits stdout — leaking the raw hash to the console — and leaves :out a
   NullInputStream, so (str/trim out) threw into the catch and this always
   returned nil, even on a successful read (BL-809)."
  [worktree-dir]
  (try
    (let [{:keys [out exit]} (process/sh ["git" "rev-parse" "--short=10" "HEAD"]
                                         {:dir worktree-dir})]
      (if (zero? exit) (str/trim out) ""))
    (catch Exception _ "")))

;; BL-646: daemon-death/alarm test fixtures that leaked into worktree roots.
(def known-fixture-file-names
  #{"calls.log" "email-text.txt" "failure.log" "status.json"})

(defn parse-untracked-paths
  "Extract untracked paths from `git status --porcelain` output."
  [porcelain]
  (->> (str/split-lines (str/trim (or porcelain "")))
       (filter #(str/starts-with? % "??"))
       (map (fn [line] (str/trim (subs line 3))))
       vec))

(defn list-untracked-files
  "Untracked paths in a worktree, or [] on error. Same BL-809 fix as
   worktree-head-commit-10: process/shell without :out :string inherits
   stdout (leaking the porcelain listing) and leaves :out a NullInputStream,
   so parse-untracked-paths threw into the catch and untracked was always 0
   — the exact call this ticket's own untracked-list path depends on."
  [worktree-dir]
  (try
    (let [{:keys [out exit]} (process/sh ["git" "status" "--porcelain"]
                                         {:dir worktree-dir})]
      (if (zero? exit)
        (parse-untracked-paths out)
        []))
    (catch Exception _ [])))

(defn count-untracked-files [worktree-dir]
  (count (list-untracked-files worktree-dir)))

(defn only-known-fixture-droppings?
  "True when every untracked path is one of the four known alarm-test fixture
   names at the worktree root (BL-646 tool droppings, not role work)."
  [untracked-paths]
  (and (seq untracked-paths)
       (every? #(contains? known-fixture-file-names %) untracked-paths)))

(defn find-claim-sidecars [worktree-path]
  (let [ip (fs/path worktree-path ".swarmforge" "handoffs" "inbox" "in_process")]
    (when (fs/exists? ip)
      (->> (fs/glob ip "*.claim-progress.json")
           (map str)
           vec))))

(defn assess-one-claim
  [{:keys [role worktree-path sidecar-path progress now-ms config untracked-paths head-commit]}]
  (let [cfg (merge claim-progress-lib/default-config config)
        reclaims (long (or (:reclaims progress) 0))
        claim-at (long (or (:claimAtMs progress) 0))
        elapsed-ms (max 0 (- now-ms claim-at))
        idle-ms (claim-progress-lib/resolve-claim-idle-timeout-ms role cfg)
        head (or head-commit (worktree-head-commit-10 worktree-path))
        claim-commit (or (:claimCommit progress) "")
        head-unchanged? (and (not (str/blank? head))
                             (not (str/blank? claim-commit))
                             (= head claim-commit))
        untracked-list (or untracked-paths
                           (if head-unchanged? (list-untracked-files worktree-path) []))
        untracked (count untracked-list)
        fixture-droppings? (and head-unchanged?
                                (only-known-fixture-droppings? untracked-list))
        reclaims-to-bounce (max 0 (- (:bounce-threshold cfg) reclaims))
        reclaims-to-halt (max 0 (- (:halt-threshold cfg) reclaims))
        elapsed-pct (if (pos? idle-ms) (/ (double elapsed-ms) idle-ms) 0.0)
        severity (cond
                   (>= reclaims (:halt-threshold cfg)) :halt-imminent
                   (>= reclaims (:bounce-threshold cfg)) :critical
                   (>= reclaims default-warn-reclaims) :warn
                   (and head-unchanged? fixture-droppings?) :warn-fixture-droppings
                   (and head-unchanged?
                        (>= elapsed-pct 0.75)
                        (pos? untracked)) :warn-uncommitted
                   (and head-unchanged? (>= elapsed-pct 0.75)) :watch
                   :else :ok)
        hint (cond
               fixture-droppings?
               (str "HEAD still " head " but " untracked
                    " untracked test-fixture droppings (calls.log, email-text.txt, failure.log, status.json) — do NOT git add/commit; fix the leaking test suite.")

               (and (pos? untracked) head-unchanged?)
               (str "HEAD still " head " but " untracked
                    " untracked file(s) — nudge role to git add/commit before BL-528 halt.")

               (>= reclaims default-warn-reclaims)
               (str "reclaims=" reclaims ", ~" reclaims-to-halt " until halt — investigate claim-without-progress.")

               (>= elapsed-pct 0.75)
               (str "idle " (quot elapsed-ms 60000) "m on claim with no commit yet.")

               :else nil)]
    {:role role
     :severity (name severity)
     :reclaims reclaims
     :reclaims-to-bounce reclaims-to-bounce
     :reclaims-to-halt reclaims-to-halt
     :elapsed-ms elapsed-ms
     :head-commit head
     :claim-commit claim-commit
     :untracked-files untracked
     :handoff (sidecar-handoff-path sidecar-path)
     :sidecar sidecar-path
     :hint hint}))

(defn alert-severity?
  "Severities that should wake the babysitter LLM."
  [severity]
  (#{"warn" "warn-uncommitted" "warn-fixture-droppings" "critical" "halt-imminent"} severity))

(defn scan-claim-risks
  "Scan every role worktree for in_process claim-progress sidecars.
   Returns a vector of assessments with severity != :ok."
  [project-root & {:keys [now-ms config]}]
  (let [now-ms (or now-ms (System/currentTimeMillis))
        roles-file (fs/path project-root ".swarmforge" "roles.tsv")
        roles (or (parse-roles-tsv roles-file) [])]
    (->> roles
         (mapcat (fn [{:keys [role worktree-path]}]
                   (map (fn [sidecar]
                          (when-let [progress (read-sidecar sidecar)]
                            (assess-one-claim {:role role
                                               :worktree-path worktree-path
                                               :sidecar-path sidecar
                                               :progress progress
                                               :now-ms now-ms
                                               :config config})))
                        (find-claim-sidecars worktree-path))))
         (remove nil?)
         (filter #(alert-severity? (:severity %)))
         vec)))

(defn claim-progress-wake-event [assessment]
  (assoc assessment :type "claim-progress" :from "runtime"))

(defn format-assessment-line [a]
  (str "- " (:role a) " " (:severity a)
       " reclaims=" (:reclaims a)
       " halt-in=" (:reclaims-to-halt a)
       (when (pos? (long (:untracked-files a)))
         (str " untracked=" (:untracked-files a)))
       (when-let [h (:hint a)] (str " — " h))))
