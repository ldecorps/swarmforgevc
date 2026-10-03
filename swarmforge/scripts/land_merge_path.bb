#!/usr/bin/env bb
;; BL-1901: the lander's land for one queued approval.
;;
;; Usage: land_merge_path.bb <lander-worktree> <task> <approved-commit> [<issue-ref>]
;;
;; A line from origin/main to the queued commit that carries only the landing
;; ticket's commits (and merges of origin/main) lands as ONE merge of
;; origin/main - none when the commit already contains it - and a fast-forward
;; push. The land record names the queued commit as its source and the path
;; `merge`. Any other line, a merge that conflicts, or a push that loses the
;; race twice, runs land_main_publish.sh --land exactly as before (which
;; records the path `land-step`). Nothing is pushed before the fallback, so a
;; line is never half-landed (invariant 2); the push is never forced, so
;; origin/main only moves by fast-forward (invariant 1).
;;
;; Prints LAND_PATH merge|land-step and, on a merge-path land,
;; LAND_PUBLISHED <sha> (the line lander_lib's outcome reads).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
;; Loads land_step_lib.bb too (record-land-approval!, the registry pass).
(load-file (str (fs/path script-dir "land_merge_path_lib.bb")))

(defn- git [wt & args]
  (let [{:keys [exit out err]} (process/sh (into ["git" "-C" wt] args))]
    {:exit exit :out (str/trim out) :err (str/trim err)}))

(defn- git-out [wt & args]
  (let [{:keys [exit out]} (apply git wt args)]
    (when (zero? exit) out)))

(defn- say [& xs] (println (apply str xs)) (flush))

(defn- ticket-of [task]
  (or (re-find #"^(?:BL|GH)-\d+" (str task)) (str task)))

(defn- on-origin-main? [wt sha]
  (case (:exit (git wt "merge-base" "--is-ancestor" sha "origin/main"))
    0 true
    1 false
    nil))

(defn- line-commits
  "The line from origin/main to `commit`, oldest first, each with what
   line-verdict needs."
  [wt commit]
  (when-let [out (git-out wt "rev-list" "--reverse" "--format=%H%x09%P%x09%s" "--no-commit-header"
                          (str "origin/main.." commit))]
    (vec (for [line (remove str/blank? (str/split-lines out))
               :let [[sha parents subject] (str/split line #"\t" 3)
                     ps (str/split (str parents) #" ")]]
           (cond-> {:sha sha :subject (str subject) :parents ps}
             (> (count ps) 1)
             (assoc :merge-parents-on-main?
                    (let [answers (map #(on-origin-main? wt %) (rest ps))]
                      (cond (every? true? answers) true
                            (some nil? answers) nil
                            :else false))))))))

(defn- land-script [] (str (fs/path script-dir "land_main_publish.sh")))

(defn- lock! [wt]
  ;; The land step's own lock, bounded the same way (LAND_LOCK_WAIT_SECONDS).
  (let [deadline (+ (System/currentTimeMillis)
                    (* 1000 (or (some-> (System/getenv "LAND_LOCK_WAIT_SECONDS") parse-long) 120)))]
    (loop []
      (let [{:keys [exit]} (process/sh ["bash" (land-script) wt "--acquire-lock"])]
        (cond
          (zero? exit) true
          (>= (System/currentTimeMillis) deadline) false
          :else (do (Thread/sleep 2000) (recur)))))))

(defn- unlock! [wt]
  (process/sh ["bash" (land-script) wt "--release-lock"]))

(defn- has-ancestor? [wt ancestor sha]
  (zero? (:exit (git wt "merge-base" "--is-ancestor" ancestor sha))))

(defn- build!
  "The commit to publish for `commit` on the CURRENT origin/main: `commit`
   itself when it already contains origin/main, else a merge of origin/main
   into it, made with `git merge` on a detached HEAD so the commit-msg hooks
   run as on any merge. {:sha s}, or {:decline reason} when the checkout of
   `commit` fails (never merging into whatever HEAD was left, QA D1) or the
   merge conflicts (merge aborted)."
  [wt ticket commit]
  (if-let [origin (git-out wt "rev-parse" "origin/main")]
    (cond
      (has-ancestor? wt origin commit) {:sha commit}
      (not (zero? (:exit (git wt "checkout" "-q" "--detach" commit))))
      {:decline "the queued commit could not be checked out in the lander worktree"}
      :else
      (let [r (git wt "merge" "--no-ff" "-q" "-m" (land-merge-path-lib/merge-message ticket origin) origin)]
        (if (zero? (:exit r))
          {:sha (git-out wt "rev-parse" "HEAD")}
          (do (git wt "merge" "--abort")
              {:decline "merging origin/main into the line conflicts"}))))
    {:decline "origin/main does not resolve in the lander worktree"}))

(defn- registry-decline
  "The decline reason when the land step's registry pass would change the
   tree of `sha` (checked out here, so open tickets read from its own
   backlog), else nil. Fails closed on an unreadable register."
  [wt ticket sha]
  (if-not (zero? (:exit (git wt "checkout" "-q" "--detach" sha)))
    "the built commit could not be checked out to read its registers"
    (let [reads (for [{:keys [path]} land-step-lib/registry-specs]
                  [path (land-step-lib/git-show wt "origin/main" path) (land-step-lib/git-show wt sha path)])]
      (if-let [[path] (first (remove (fn [[_ o t]] (and (:ok? o) (:ok? t))) reads))]
        (str "could not read " path " to check the land step's registry pass")
        (land-merge-path-lib/registry-decline-reason
         (land-merge-path-lib/registry-pass-changes
          {:ticket ticket
           :open-ids (qa-hold-lib/open-ticket-ids-for wt)
           :contents (into {} (for [[path o t] reads] [path {:origin (:content o) :tree (:content t)}]))}))))))

(defn- record! [wt published commit ticket]
  (let [rec (land-step-lib/record-land-approval!
             {:root wt :commit published :source commit :task-ticket-id ticket :path "merge"})]
    (when-not (:ok? rec)
      (binding [*out* *err*] (println (str "LAND_APPROVAL_UNRECORDED " (:reason rec)))))))

(defn- push! [wt sha]
  ;; Never --force: a non-fast-forward is rejected and the caller rebuilds.
  (zero? (:exit (git wt "push" "-q" "origin" (str sha ":refs/heads/main")))))

(defn- merge-land!
  "Lock, build, record, push; one rebuild if the push loses a race. Returns
   the published sha, or {:decline reason} with nothing pushed."
  [wt ticket commit]
  (if-not (lock! wt)
    {:decline "the land lock is held"}
    (let [home (or (git-out wt "symbolic-ref" "-q" "HEAD") (git-out wt "rev-parse" "HEAD"))]
      (try
        (loop [attempt 1]
          (let [{:keys [sha decline]} (build! wt ticket commit)]
            (cond
              decline {:decline decline}
              ;; Whatever build! made, it is published only when it carries
              ;; both the queued commit and origin/main (QA D1).
              (not (and sha (has-ancestor? wt commit sha) (has-ancestor? wt "origin/main" sha)))
              {:decline "the built commit does not contain both the queued commit and origin/main"}
              ;; QA spec-gap note 003735: the land step owns the register
              ;; rules until BL-1870 moves them, so a land that would need
              ;; them goes there.
              :else
              (if-let [reason (registry-decline wt ticket sha)]
                {:decline reason}
                ;; Recorded BEFORE the push (BL-1872 item 5's order): a record
                ;; naming a commit main never carries grants nothing, but a
                ;; published commit with no record reads as unapproved.
                (do (record! wt sha commit ticket)
                    (cond
                      (push! wt sha) sha
                      (< attempt 2) (do (git wt "fetch" "-q" "origin") (recur (inc attempt)))
                      :else {:decline "the fast-forward push lost the race twice"}))))))
        (finally
          (git wt "checkout" "-q" (str/replace (str home) #"^refs/heads/" ""))
          (unlock! wt))))))

(defn- fallback! [wt task commit issue reason]
  (say "LAND_PATH land-step: " reason)
  (let [{:keys [exit]} @(process/process (cond-> ["bash" (land-script) wt "--land" task commit]
                                           (not (str/blank? issue)) (conj issue))
                                         {:out :inherit :err :inherit})]
    (System/exit exit)))

(defn -main [[wt task commit issue]]
  (when-not (and wt task commit)
    (binding [*out* *err*]
      (println "usage: land_merge_path.bb <lander-worktree> <task> <approved-commit> [<issue-ref>]"))
    (System/exit 2))
  (let [wt (str (fs/canonicalize wt))
        ticket (ticket-of task)]
    (git wt "fetch" "-q" "origin")
    (let [full (git-out wt "rev-parse" "-q" "--verify" (str commit "^{commit}"))
          commits (when full (line-commits wt full))
          verdict (cond
                    (nil? full) {:clean? false :reason (str commit " does not resolve")}
                    (nil? commits) {:clean? false :reason "the line could not be read"}
                    (seq (git-out wt "status" "--porcelain" "--untracked-files=no"))
                    {:clean? false :reason "the lander worktree has uncommitted changes"}
                    :else (land-merge-path-lib/line-verdict ticket commits))]
      (if-not (:clean? verdict)
        (fallback! wt task commit issue (:reason verdict))
        (let [result (merge-land! wt ticket full)]
          (if (map? result)
            (fallback! wt task commit issue (:decline result))
            (do (say "LAND_PATH merge")
                (say "LAND_PUBLISHED " result)
                (when-not (str/blank? issue)
                  (let [done (str (fs/path script-dir "issue_done.sh"))]
                    (if (fs/exists? done)
                      (when-not (zero? (:exit (process/sh ["bash" done issue result])))
                        (say "LAND_ISSUE_SKIPPED: issue_done.sh could not close " issue "; the land itself stands."))
                      (say "LAND_ISSUE_SKIPPED: no issue_done.sh in this target."))))
                (System/exit 0))))))))

(-main *command-line-args*)
