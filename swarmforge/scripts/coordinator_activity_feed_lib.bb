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

;; ── Config kill switch ───────────────────────────────────────────────────
;; Human request 2026-09-07: this feed floods the coordinator's Telegram
;; topic (one line per handoff/bookkeeping commit, effectively every
;; coordinator action) - useful when actually investigating something, pure
;; noise otherwise. Mirrors master_main_reconcile_lib.bb's own
;; parse-enabled? exactly: absent, empty, malformed, and "false" all fall
;; through the same check to disabled - there is no separate "explicitly
;; off" state, and only the literal "true" turns the feed on.

(defn parse-enabled?
  "Pure: `config coordinator_activity_feed_enabled <value>` from conf text.
   Only the exact value \"true\" enables the feed - the line must tokenize
   to exactly 3 whitespace-separated tokens (`config`, the key, one value
   token); trailing garbage after the value ('true true') is malformed, not
   an affirmative, and falls through to disabled like any other malformed
   line."
  [conf-text]
  (boolean
   (when-let [line (some->> (str/split-lines (or conf-text ""))
                             (filter #(str/starts-with? % "config coordinator_activity_feed_enabled"))
                             first)]
     (let [tokens (str/split (str/trim line) #"\s+")]
       (and (= 3 (count tokens)) (= "true" (nth tokens 2)))))))

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
  "BL-1454 invariant 3: sorted-names is a list of bare sent-handoff FILENAME
   strings (never a header - the caller must not have opened/slurped a
   single file to build this list), sorted ascending by handoff-sort-key.
   cursor: the last filename this feed already posted, or nil (every
   filename is new). The comparison is pure name-vs-name; the header for a
   survivor is read by the caller only AFTER this filter runs, so a tick's
   I/O scales with the count returned here, never with (count sorted-names)."
  [sorted-names cursor]
  (vec (if cursor
         (let [cursor-key (handoff-sort-key cursor)]
           (filter #(pos? (compare (handoff-sort-key %) cursor-key)) sorted-names))
         sorted-names)))

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
;; Every IO edge (listing the sent mailbox, reading one handoff's header,
;; reading git log, sending to Telegram, the clock, reading/writing the
;; cursor file) is injected, so this function is exercised entirely against
;; plain data and stub seams in tests - never live Telegram, never a real
;; daemon, per the ticket's own constraint.

;; BL-1454 direction defaults - a tick never posts more than this many lines
;; nor runs longer than this many ms, whatever the size of coordinator/sent/
;; or of the git log. handoffd.bb's own defs additionally clamp the deadline
;; to at most one quarter of SUPERVISOR_IN_SWEEP_BUDGET_MS (invariant 1);
;; these are just the library's own sane defaults for a bare call.
(def default-post-cap 20)
(def default-tick-deadline-ms 30000)

(defn- seed-cursor
  "BL-1454: the FIRST tick ever (no cursor file, i.e. both sub-cursors nil)
   seeds each cursor at the newest existing trace of its kind and posts
   NOTHING historical - this feed is a live log from the moment it starts,
   never a backfill (firm, per the ticket's approval_context). sorted-names
   is ascending, so the newest is the last; commits is oldest-first, same."
  [sorted-names commits]
  {:handoff-cursor (last sorted-names)
   :commit-cursor (:sha (last commits))})

(defn tick!
  [{:keys [daemon-dir list-sent-handoff-names read-handoff-header
           list-bookkeeping-commits post! read-cursor! write-cursor!
           now-ms post-cap deadline-ms]
    :or {read-cursor! read-cursor
         write-cursor! write-cursor!
         now-ms #(System/currentTimeMillis)
         post-cap default-post-cap
         deadline-ms default-tick-deadline-ms}}]
  (let [cursor (read-cursor! daemon-dir)]
    (if (and (nil? (:handoff-cursor cursor)) (nil? (:commit-cursor cursor)))
      (let [seeded (seed-cursor (list-sent-handoff-names) (list-bookkeeping-commits))]
        (write-cursor! daemon-dir seeded)
        {:posted 0 :seeded true})
      (let [deadline (+ (now-ms) deadline-ms)
            ;; Invariant 3: the name filter runs BEFORE any header is read -
            ;; read-handoff-header is called only for survivors, so a tick's
            ;; I/O is proportional to what is new, never to the total count
            ;; of sent handoffs.
            new-names (new-handoffs (list-sent-handoff-names) (:handoff-cursor cursor))
            handoff-traces (->> new-names
                                 (map (fn [name]
                                        (assoc (read-handoff-header name) :kind :handoff :file name))))
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
          (cond
            (empty? remaining)
            {:posted posted}

            (>= posted post-cap)
            {:posted posted :capped true}

            (>= (now-ms) deadline)
            {:posted posted :deadline-reached true}

            :else
            (let [trace (first remaining)
                  line (format-line trace)]
              (if (post! line)
                ;; Invariant 2: the cursor is persisted after EVERY
                ;; successful post, not only when the loop ends - a tick
                ;; killed mid-batch (process kill, thrown exception) leaves
                ;; the disk cursor lagging the last successful post by at
                ;; most one trace, so a restart re-posts nothing already
                ;; sent.
                (let [next-cur (case (:kind trace)
                                  :handoff (assoc cur :handoff-cursor (:file trace))
                                  :commit (assoc cur :commit-cursor (:sha trace)))]
                  (write-cursor! daemon-dir next-cur)
                  (recur (rest remaining) next-cur (inc posted)))
                (do (write-cursor! daemon-dir cur) {:posted posted :stopped-at trace})))))))))

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
