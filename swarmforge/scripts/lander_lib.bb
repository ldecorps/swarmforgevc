;; BL-1872: the lander daemon lands what QA approves. QA's last act on a
;; parcel is one queue command (lander_queue.bb --enqueue); handoffd's lander
;; sweep calls tick! each cycle, which runs land_merge_path.bb (BL-1901: a
;; clean line lands as a merge of origin/main, any other through
;; land_main_publish.sh --land) for
;; the oldest queued approval in a worktree of its own (.worktrees/lander,
;; never QA's), one at a time, then reads the outcome on a later tick: a land
;; sends the coordinator QA's bookkeeping note; any refusal or failure goes
;; back to QA with the land step's own reason and is never retried.
;;
;; Pure decisions (entry-id, next-action, outcome, outcome-note) plus thin
;; impure edges (enqueue!, read-entries, tick!). Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "lander_lib.bb")))
;; and referred to as lander-lib/foo.

(ns lander-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.edn :as edn]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(def ^:private script-dir (str (fs/parent (fs/canonicalize *file*))))

(load-file (str (fs/path script-dir "ceremony_handoff_lib.bb")))

;; A run still going past an hour is reported to QA once and left alone:
;; never wrapped in `timeout`, because a kill mid re-point leaves a branch
;; half-moved (operator memory, 2026-10-01).
(def overdue-ms (* 60 60 1000))

;; handoff-protocol.md's cap for a note message (ceremony_handoff_lib's).
(def ^:private message-max ceremony-handoff-lib/message-max-chars)

;; ── pure ─────────────────────────────────────────────────────────────────

(defn entry-id
  "One entry per approval: the same task and commit queued twice is one entry."
  [task commit]
  (str task "-" (subs commit 0 (min 10 (count commit)))))

(defn- ticket-of [task]
  (or (re-find #"^(?:BL|GH)-\d+" (str task)) (str task)))

(defn next-action
  "The sweep's one decision per tick over every entry. A running land blocks
   every start (one at a time); once its exit is known it is finished; past
   overdue-ms it is reported once. Otherwise the oldest queued entry starts.
   Landed and refused entries are terminal."
  [entries now-ms]
  (if-let [running (first (filter #(= :running (:status %)) entries))]
    (cond
      (some? (:exit running)) {:action :finish :id (:id running)}
      (and (not (:overdue-reported? running))
           (> (- now-ms (or (:started-at running) now-ms)) overdue-ms))
      {:action :report-overdue :id (:id running)}
      :else {:action :wait :id (:id running)})
    (if-let [oldest (first (sort-by (juxt :enqueued-at :id) (filter #(= :queued (:status %)) entries)))]
      {:action :start :id (:id oldest)}
      {:action :idle})))

(defn- line-after [lines pred]
  (second (drop-while (complement pred) lines)))

(defn outcome
  "A finished run's outcome from its log and exit code: {:status :landed :sha}
   only for exit 0 with a LAND_PUBLISHED line; otherwise {:status :refused
   :reason} carrying the land step's own words."
  [log exit]
  (let [lines (str/split-lines (str log))
        published (some #(second (re-find #"^LAND_PUBLISHED ([0-9a-f]{7,40})" %)) lines)
        tagged (fn [tag] (when (some #(= tag (str/trim %)) lines)
                           (str/trim (str tag " " (or (line-after lines #(= tag (str/trim %))) "")))))]
    (cond
      (and (zero? exit) published) {:status :landed :sha (subs published 0 (min 10 (count published)))}
      (tagged "ENTANGLED_SIBLING_BLOCK") {:status :refused :reason (tagged "ENTANGLED_SIBLING_BLOCK")}
      (tagged "LAND_ESCALATE") {:status :refused :reason (tagged "LAND_ESCALATE")}
      (some #(str/starts-with? % "LAND_STOPPED") lines)
      {:status :refused :reason (str/trim (first (filter #(str/starts-with? % "LAND_STOPPED") lines)))}
      (zero? exit) {:status :refused :reason "land_main_publish.sh exited 0 with no LAND_PUBLISHED"}
      :else {:status :refused :reason (str "land_main_publish.sh exited " exit)})))

(defn- cap [s]
  (if (> (count s) message-max) (subs s 0 message-max) s))

(defn outcome-note
  "The note a finished run sends: QA's own bookkeeping note to the coordinator
   for a land (composed by ceremony_handoff_lib, never retyped), or a note to
   QA naming the ticket and the land step's reason for a refusal."
  [entry {:keys [status sha reason]}]
  (let [ticket (ticket-of (:task entry))]
    (if (= :landed status)
      (let [{:keys [to message]} (ceremony-handoff-lib/compose {:ceremony "bookkeep" :ticket ticket :commit sha})]
        {:to to :message message})
      {:to ["QA"] :message (cap (str ticket " land refused: " reason))})))

(defn overdue-note [entry]
  {:to ["QA"] :message (cap (str (ticket-of (:task entry)) " land still running past an hour; left alone"))})

(defn draft-lines [{:keys [to message]}]
  ["type: note" (str "to: " (str/join "," to)) "priority: 00" (str "message: " message)])

;; ── impure ───────────────────────────────────────────────────────────────

(defn lander-dir [root] (fs/path root ".swarmforge" "lander"))
(defn- queue-dir [root] (fs/path (lander-dir root) "queue"))
(defn- entry-file [root id] (fs/path (queue-dir root) (str id ".edn")))

(defn- write-entry! [root entry]
  (fs/create-dirs (queue-dir root))
  (let [f (entry-file root (:id entry))
        tmp (fs/path (queue-dir root) (str "." (:id entry) ".tmp"))]
    (spit (str tmp) (pr-str (dissoc entry :exit)))
    (fs/move tmp f {:replace-existing true :atomic-move true})))

(defn- exit-file [root id] (fs/path (lander-dir root) (str id ".exit")))
(defn- log-file [root id] (fs/path (lander-dir root) (str id ".log")))

(defn read-entries
  "Every queue entry, with :exit filled from a running land's exit file."
  [root]
  (let [dir (queue-dir root)]
    (if-not (fs/exists? dir)
      []
      (vec (for [f (fs/glob dir "*.edn")
                 :let [entry (try (edn/read-string (slurp (str f))) (catch Exception _ nil))]
                 :when entry]
             (let [ef (exit-file root (:id entry))]
               (cond-> entry
                 (and (= :running (:status entry)) (fs/exists? ef))
                 (assoc :exit (parse-long (str/trim (slurp (str ef))))))))))))

(defn enqueue!
  "QA's queue command: one entry under .swarmforge/lander/queue, nothing else.
   Never fetches, builds or pushes (BL-1872 invariant 2)."
  [root task commit issue now-ms]
  (let [id (entry-id task commit)]
    (if (fs/exists? (entry-file root id))
      {:result :already :id id}
      (do (write-entry! root {:id id :task task :commit commit :issue issue
                              :status :queued :enqueued-at now-ms})
          {:result :queued :id id}))))

(defn- git! [dir & args]
  (apply sh/sh "git" "-C" (str dir) args))

(defn lander-worktree
  "The lander's own worktree (.worktrees/lander on branch swarmforge-lander),
   created from origin/main on first use. Never QA's."
  [root]
  (let [wt (fs/path root ".worktrees" "lander")]
    (when-not (fs/exists? wt)
      (git! root "fetch" "-q" "origin")
      (let [r (git! root "worktree" "add" "-q" "-B" "swarmforge-lander" (str wt) "origin/main")]
        (when-not (zero? (:exit r))
          (throw (ex-info (str "lander worktree: " (str/trim (:err r))) {})))))
    (str wt)))

(defn land-command
  "The shell command one land runs. :merge (the default, BL-1901) runs
   land_merge_path.bb, which lands a clean line as a merge of origin/main and
   hands every other line to land_main_publish.sh --land unchanged; :land-step
   runs land_main_publish.sh --land directly (a caller testing the land step's
   own behaviour, BL-1872)."
  [land-path wt entry]
  (let [[runner script args] (if (= :land-step land-path)
                               ["bash" "land_main_publish.sh" [wt "--land" (:task entry) (:commit entry)]]
                               ["bb" "land_merge_path.bb" [wt (:task entry) (:commit entry)]])
        args (cond-> args (not (str/blank? (:issue entry))) (conj (:issue entry)))]
    (str runner " " (pr-str (str (fs/path script-dir script))) " " (str/join " " (map pr-str args)))))

(defn- launch! [root entry land-path]
  (let [wt (lander-worktree root)
        cmd (str (land-command land-path wt entry)
                 " > " (pr-str (str (log-file root (:id entry)))) " 2>&1; echo $? > "
                 (pr-str (str (exit-file root (:id entry)))))]
    ;; Detached: the land outlives this tick (and a test's bb process).
    (process/process ["setsid" "bash" "-c" cmd] {:out :discard :err :discard :in :inherit})))

(defn tick!
  "One sweep step. deps: {:send-note! (fn [note]) :now-ms long, optional
   :land-path (:merge, the default, or :land-step; see land-command)}.
   Returns the decision taken."
  [root {:keys [send-note! now-ms land-path] :or {land-path :merge}}]
  (let [entries (read-entries root)
        by-id (into {} (map (juxt :id identity) entries))
        decision (next-action entries now-ms)
        entry (by-id (:id decision))]
    (case (:action decision)
      :start
      (do (fs/create-dirs (lander-dir root))
          (fs/delete-if-exists (exit-file root (:id entry)))
          (write-entry! root (assoc entry :status :running :started-at now-ms
                                    :log (str (log-file root (:id entry)))))
          (launch! root entry land-path))
      :finish
      (let [log (try (slurp (str (log-file root (:id entry)))) (catch Exception _ ""))
            result (outcome log (:exit entry))]
        (write-entry! root (merge entry result {:finished-at now-ms}))
        (send-note! (outcome-note entry result)))
      :report-overdue
      (do (write-entry! root (assoc entry :overdue-reported? true))
          (send-note! (overdue-note entry)))
      nil)
    decision))
