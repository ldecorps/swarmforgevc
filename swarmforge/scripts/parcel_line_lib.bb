;; BL-1871: a role takes up a ticket on that ticket's own line. Instead of
;; merging a parcel's commit into a long-lived role branch (which carried
;; every ticket that ever passed through the role), ready_for_next_task.bb
;; moves the role's worktree onto the parcel's commit, and the coder starts
;; a new ticket from its newest handed-off commit or else from origin/main.
;; Pure decisions (parcel-intent, move-decision) plus one thin impure
;; take-up!. Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "parcel_line_lib.bb")))
;; and referred to as parcel-line-lib/foo.

(ns parcel-line-lib
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "salvage_lib.bb")))

(defn- role-stage
  "coder@2 -> coder: a seat takes up parcels the way its stage does."
  [role]
  (first (str/split (str role) #"@")))

(defn parcel-intent
  "What the in-process parcel asks of the role's worktree, from facts only:
   {:intent :take-up :commit C} for a forwarding git_handoff,
   {:intent :start :ticket X} for a coordinator Work note to the coder, and
   {:intent :skip :reason kw} otherwise. A master-resident role (the shared
   checkout on main) or a role whose row is unknown (:master? nil) never
   moves; a non-forwarding copy and every other note carry no work to move
   onto."
  [{:keys [master? role type non-forwarding? commit work-ticket task]}]
  (cond
    (nil? master?) {:intent :skip :reason :unknown-role}
    master? {:intent :skip :reason :master-checkout}
    (= type "git_handoff")
    (cond
      non-forwarding? {:intent :skip :reason :non-forwarding}
      (str/blank? commit) {:intent :skip :reason :no-commit}
      ;; BL-1887: the ticket rides along, so a take-up at a commit already
      ;; on origin/main (a route, not a build) can start it fresh.
      :else {:intent :take-up :commit commit
             :ticket (re-find #"^(?:BL|GH)-\d+" (str task))})
    (and (= type "note") work-ticket (= "coder" (role-stage role)))
    {:intent :start :ticket work-ticket}
    :else {:intent :skip :reason :no-work}))

(defn move-decision
  "Whether to move onto target. Stays when nothing is resolved, when HEAD
   is already at (or, for a handed-off parcel, past) the target, or when
   the line already carries the ticket's own unlanded work. Never moves a
   worktree with uncommitted tracked changes: {:action :blocked :paths}."
  [{:keys [target at-or-past-target? own-line? dirty-paths]}]
  (cond
    (nil? target) {:action :stay}
    at-or-past-target? {:action :stay}
    own-line? {:action :stay}
    (seq dirty-paths) {:action :blocked :paths (vec dirty-paths)}
    :else {:action :move :target target}))

(defn subject-names-only?
  "True when the commit subject names ticket and no other ticket id."
  [subject ticket]
  (= #{ticket} (set (re-seq #"\b(?:BL|GH)-\d+\b" (str subject)))))

(defn task-matches?
  "A task header names ticket exactly (bare, or ticket followed by a slug)."
  [task ticket]
  (boolean (and task (or (= task ticket) (str/starts-with? task (str ticket "-"))))))

;; ── impure ────────────────────────────────────────────────────────────────

(defn- git [root & args]
  (apply sh/sh "git" "-C" (str root) args))

(defn- git-out [root & args]
  (let [r (apply git root args)]
    (when (zero? (:exit r)) (str/trim (:out r)))))

(defn- resolve-commit [root rev]
  (git-out root "rev-parse" "-q" "--verify" (str rev "^{commit}")))

(defn- ancestor? [root a b]
  (zero? (:exit (git root "merge-base" "--is-ancestor" a b))))

(defn dirty-tracked-paths
  "Tracked files with uncommitted changes (staged or not); untracked files
   travel with any checkout untouched, so they never block a move."
  [root]
  (->> (str/split-lines (:out (git root "status" "--porcelain" "--untracked-files=no")))
       (remove str/blank?)
       (mapv #(str/trim (subs % (min 3 (count %)))))))

(defn newest-handoff-commit
  "The commit of the newest forwarding git_handoff recorded for ticket
   across every role's completed/abandoned mailbox, or nil."
  [project-root ticket]
  (some (fn [f]
          (when (and (task-matches? (salvage-lib/header-field f "task") ticket)
                     (= "git_handoff" (salvage-lib/header-field f "type"))
                     (not= "true" (salvage-lib/header-field f "non-forwarding")))
            (salvage-lib/header-field f "commit")))
        (salvage-lib/latest-item-handoffs project-root ticket)))

(defn- own-line?
  "Every commit the line carries beyond origin/main names ticket and no
   other: unlanded work a re-sent Work note must not strand. Measured from
   the merge base, so origin/main moving on after the line was cut does not
   disown it (BL-1887 scenario 04, coder note 002330)."
  [root origin-main ticket]
  (boolean
   (when-let [base (and origin-main (git-out root "merge-base" origin-main "HEAD"))]
     (let [subjects (remove str/blank? (str/split-lines
                                        (or (git-out root "log" "--format=%s" (str base "..HEAD")) "")))]
       (and (seq subjects) (every? #(subject-names-only? % ticket) subjects))))))

(defn backup-ref [role stamp]
  (str "refs/swarmforge/parcel-backup/" role "/" stamp))

(defn- utc-stamp []
  (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss.SSS'Z'")
           (.atZone (java.time.Instant/now) java.time.ZoneOffset/UTC)))

(defn- start-target
  "A fresh start for ticket: its newest handed-off commit, else origin/main.
   Never \"past\" origin/main: a long-lived branch descends from it and would
   wrongly stay; only the ticket's own unlanded line stays (own-line?)."
  [root project-root head ticket]
  (git root "fetch" "-q" "origin")
  (let [origin-main (resolve-commit root "origin/main")
        handed (some->> (newest-handoff-commit project-root ticket) (resolve-commit root))
        target (or handed origin-main)]
    {:target target
     :at-or-past-target? (= head target)
     :own-line? (own-line? root origin-main ticket)}))

(defn- on-origin-main? [root sha]
  (boolean (when-let [om (resolve-commit root "origin/main")] (ancestor? root sha om))))

(defn- resolve-target
  "{:target sha :at-or-past-target? bool :own-line? bool} for the intent."
  [{:keys [root project-root intent]}]
  (let [head (resolve-commit root "HEAD")]
    (case (:intent intent)
      :take-up
      (let [target (resolve-commit root (:commit intent))]
        ;; BL-1887: a git_handoff at a commit already on origin/main is a
        ;; route, not a build - start its ticket fresh, as a Work note does.
        ;; Checked against the local origin/main first; a target HEAD already
        ;; holds that is not on it stays without a fetch (re-prints are
        ;; cheap); anything else fetches once and asks again.
        (cond
          (and target (:ticket intent) (on-origin-main? root target))
          (start-target root project-root head (:ticket intent))

          (and target head (ancestor? root target head))
          {:target target :at-or-past-target? true}

          (and target (:ticket intent)
               (do (git root "fetch" "-q" "origin") (on-origin-main? root target)))
          (start-target root project-root head (:ticket intent))

          :else {:target target :at-or-past-target? false}))
      :start
      (start-target root project-root head (:ticket intent)))))

(defn take-up!
  "Moves the worktree at :root onto the parcel's line per :intent (from
   parcel-intent). Prints one PARCEL_LINE line when it moves or refuses;
   silent when it stays or skips. Keeps the head it leaves under a
   parcel-backup ref first, and never moves a dirty worktree."
  [{:keys [root role intent] :as facts}]
  (when (#{:take-up :start} (:intent intent))
    (let [resolved (resolve-target facts)
          decision (move-decision (assoc resolved :dirty-paths (dirty-tracked-paths root)))]
      (case (:action decision)
        :stay nil
        :blocked
        (println (str "PARCEL_LINE: uncommitted changes to tracked files ("
                      (str/join ", " (:paths decision))
                      "); the parcel was not taken up. Commit or restore them and ask again."))
        :move
        (let [head (resolve-commit root "HEAD")
              branch (git-out root "symbolic-ref" "--short" "-q" "HEAD")]
          (if (str/blank? branch)
            (println "PARCEL_LINE: detached HEAD; the parcel was not taken up.")
            (do
              (when head (git root "update-ref" (backup-ref role (utc-stamp)) head))
              (let [r (git root "switch" "-q" "-C" branch (:target decision))]
                (if (zero? (:exit r))
                  (println (str "PARCEL_LINE: moved " branch " onto " (subs (:target decision) 0 10)
                                (when head (str " (left " (subs head 0 10) " under refs/swarmforge/parcel-backup/" role "/)"))))
                  (println (str "PARCEL_LINE: move failed; the parcel was not taken up: "
                                (str/trim (:err r)))))))))))))
