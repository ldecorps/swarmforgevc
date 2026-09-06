;; GH-24: the coordinator's activity surfaced as compact lines on its own
;; Telegram topic. A DETERMINISTIC surfacer - derived from the coordinator's
;; own durable traces (sent handoffs + backlog bookkeeping commits on main),
;; zero coordinator LLM tokens spent narrating itself.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "coordinator_activity_feed_lib.bb")))
;; Referred to as coordinator-activity-feed-lib/foo.
;;
;; Two independent cursors, one per trace source, rather than one unified
;; ordering: a handoff filename and a git commit sha are not comparable to
;; each other, and trying to interleave them into one global sequence would
;; only buy an approximate "who happened first" this feed does not need.
;; Each source advances its own cursor only past what has actually been
;; posted (the drop/deliver/fail three-way gate the ticket's own constraints
;; name): a failed send stops the tick immediately, so neither cursor moves
;; past the failing trace and the next tick retries it first, before any
;; later trace of either kind.
(ns coordinator-activity-feed-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; ── Cursor state ────────────────────────────────────────────────────────

(defn- read-json [path]
  (when (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true) (catch Exception _ nil))))

(defn state-path [daemon-dir]
  (str (fs/path daemon-dir "coordinator-activity-feed-state.json")))

(defn read-cursor [daemon-dir]
  (let [raw (or (read-json (state-path daemon-dir)) {})]
    {:handoff-cursor (:handoff-cursor raw)
     :commit-cursor (:commit-cursor raw)}))

(defn write-cursor! [daemon-dir cursor]
  (fs/create-dirs daemon-dir)
  (spit (state-path daemon-dir) (json/generate-string cursor)))

;; ── Pure: new-since-cursor selection ────────────────────────────────────
;; Handoff filenames are <priority>_<timestamp>_<sequence>_from_...</...>
;; (the protocol's own format) - lexical comparison of the WHOLE filename is
;; NOT a correct "newer than" test on its own, because the coordinator sends
;; at several different priorities (00/10/50 all observed in practice): a
;; priority-00 file sorts lexically before a priority-50 one regardless of
;; which was actually created later, so a plain filename compare can skip a
;; genuinely later trace forever once the cursor has passed a
;; lower-numbered-priority file from earlier. The SORT KEY drops the fixed
;; 3-character priority prefix ("NN_"), leaving <timestamp>_<sequence> -
;; correctly chronological (with the protocol's own same-second tiebreak)
;; independent of priority. The persisted cursor itself is still the full
;; filename (a stable, human-legible identifier); only the COMPARISON uses
;; the derived key.

(defn handoff-sort-key
  "The chronologically-comparable part of a sent-handoff filename - every
   caller that needs to SORT a list of these filenames (not just filter one
   against a cursor) must use this same key, or a mixed-priority list sorts
   by priority first and silently misorders same-tick posting order."
  [filename]
  (subs filename 3))

(defn new-handoffs
  "sorted-handoffs: every sent handoff for the coordinator, as {:file
   :header} maps (:file the bare filename, :header the four fields
   format-handoff-line needs), sorted ascending by handoff-sort-key. cursor:
   the last :file this feed already posted, or nil."
  [sorted-handoffs cursor]
  (vec (if cursor
         (let [cursor-key (handoff-sort-key cursor)]
           (filter #(pos? (compare (handoff-sort-key (:file %)) cursor-key)) sorted-handoffs))
         sorted-handoffs)))

(defn new-commits
  "commits: {:sha :subject} maps in OLDEST-first order (a straight git log
   --reverse walk). cursor: the last sha this feed already posted, or nil.
   drop-while stops AT the cursor commit itself when found (rest drops it
   too, leaving only what comes after); a cursor sha not found in commits
   (state predating a history rewrite, or simply not among these commits)
   falls through with an empty drop-while match, so `rest` of an empty seq
   is still empty - never silently replays the whole backlog under that
   shape either."
  [commits cursor]
  (if (nil? cursor)
    (vec commits)
    (vec (rest (drop-while #(not= (:sha %) cursor) commits)))))

;; ── Pure: bookkeeping commit subject parsing ────────────────────────────
;; The two commit shapes the coordinator's own bookkeeping produces
;; (Article 3.3 / 1.1): a close (active/ -> done/) and a promotion
;; (paused/ -> active/). Positive identification only - a subject matching
;; neither shape is not a coordinator trace at all (out of scope: this
;; feed is coordinator-only, never every commit on main).

(def ^:private close-pattern #"^Close ([A-Za-z]+-\d+): move to done\. By coordinator\.$")
(def ^:private promote-pattern #"^Promote ([A-Za-z]+-\d+): paused → active for (\S+)$")

(defn parse-bookkeeping-subject
  "The ticket id and action a coordinator bookkeeping commit subject names,
   or nil for any other subject (a different role's commit, a merge, etc.)."
  [subject]
  (when subject
    (or (when-let [[_ ticket] (re-matches close-pattern subject)]
          {:action :close :ticket ticket})
        (when-let [[_ ticket role] (re-matches promote-pattern subject)]
          {:action :promote :ticket ticket :role role}))))

;; ── Pure: trace -> compact line ──────────────────────────────────────────

(defn format-handoff-line
  "trace: {:type :to :task :message}, the same fields swarm_handoff.sh's
   own header block carries. A note's :message stands in for a
   git_handoff's :task when the latter is absent (a note carries no task
   header at all)."
  [{:keys [type to task message]}]
  (str "→ " type " → " to
       (cond
         (not (str/blank? task)) (str " (" task ")")
         (not (str/blank? message)) (str ": " message)
         :else "")))

(defn format-commit-line
  "trace: {:action :close/:promote :ticket :role}."
  [{:keys [action ticket role]}]
  (case action
    :close (str "✓ closed " ticket)
    :promote (str "↑ promoted " ticket " → " role)))

(defn format-line [trace]
  (case (:kind trace)
    :handoff (format-handoff-line trace)
    :commit (format-commit-line trace)))

;; ── Orchestration: the tick ──────────────────────────────────────────────
;; Every IO edge (reading the sent mailbox, reading git log, sending to
;; Telegram, reading/writing the cursor file) is injected, so this function
;; is exercised entirely against plain data and a stub post! in tests -
;; never live Telegram, per the ticket's own constraint.

(defn tick!
  [{:keys [daemon-dir list-sent-handoffs list-bookkeeping-commits post! read-cursor! write-cursor!]
    :or {read-cursor! read-cursor
         write-cursor! write-cursor!}}]
  (let [cursor (read-cursor! daemon-dir)
        handoff-traces (->> (new-handoffs (list-sent-handoffs) (:handoff-cursor cursor))
                             (map (fn [{:keys [file header]}]
                                    (assoc header :kind :handoff :file file))))
        commit-traces (->> (new-commits (list-bookkeeping-commits) (:commit-cursor cursor))
                            (keep (fn [c]
                                    (when-let [parsed (parse-bookkeeping-subject (:subject c))]
                                      (assoc parsed :kind :commit :sha (:sha c))))))
        ;; Handoffs first, then commits - a stable, deterministic order
        ;; within one tick (never re-derived from wall-clock timestamps,
        ;; which a filesystem/git pairing cannot promise agree on).
        traces (concat handoff-traces commit-traces)]
    (loop [remaining traces
           cur cursor
           posted 0]
      (if (empty? remaining)
        (do (write-cursor! daemon-dir cur) {:posted posted})
        (let [trace (first remaining)
              line (format-line trace)]
          (if (post! line)
            (recur (rest remaining)
                   (case (:kind trace)
                     :handoff (assoc cur :handoff-cursor (:file trace))
                     :commit (assoc cur :commit-cursor (:sha trace)))
                   (inc posted))
            (do (write-cursor! daemon-dir cur) {:posted posted :stopped-at trace})))))))

(defn- header-field [text field]
  (let [prefix (str field ": ")]
    (some (fn [line]
            (when (str/starts-with? line prefix)
              (subs line (count prefix))))
          (take-while (complement str/blank?) (str/split-lines text)))))

(defn handoff-header-from-text
  "Parses the four header fields format-handoff-line needs, from one
   handoff file's raw text - kept separate from any filesystem read so a
   test can hand it a literal string."
  [text]
  {:type (header-field text "type")
   :to (header-field text "to")
   :task (header-field text "task")
   :message (header-field text "message")})
