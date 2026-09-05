;; land_step_lib.bb — BL-1241: the land step's own remedy for an entangled
;; tip, replacing "bounce it to the author" (an outcome no role can act on:
;; no role can remove commits that are ancestors of its own branch).
;;
;; A parcel's cited commit routinely has OTHER tickets' unlanded work as an
;; ancestor - ordinary pipelining on a long-lived role branch,
;; not misconduct. Landing it as-is would put that unreviewed sibling work
;; on `main` (the BL-506 refusal); bouncing it back to the author fixes
;; nothing, since the author cannot un-ancestor commits already on their own
;; branch. Five bounces in two days (BL-1227/1192/1201, then BL-1238/1247)
;; each stalled with no move available to anyone.
;;
;; Ruling (specifier, 2026-08-29, swarmforge/roles/QA.prompt): QA itself
;; replays only the cited ticket's own paths onto current `origin/main` and
;; lands THAT commit, recording `abandoned_commits:` on the ticket - never a
;; bounce. This lib provides the DETECTION half (is the tip entangled, with
;; whom) and the REPLAY-BUILD half (construct the tip-pure commit as a local
;; git object, never pushed - landing `main`/pushing origin stays QA's own
;; final, human-observed action per Article 1.8, same posture as every other
;; gate lib in this file's family that decides but never pushes).
;;
;; Reuses task_scope_gate_lib.bb's OWN already-shipped, already-tested walk
;; (task-tagged-changed-paths, BL-1192) for "this ticket's own paths" -
;; never a second implementation of that walk, invariant 2's own shape
;; applied one door down. BL-1297: that walk answers two questions and this
;; step asks it for :delivered at every call site, explicitly. The
;; sibling-detection walk below is NEW (a
;; different range: origin/main..commit, unfiltered, to see who ELSE is in
;; there) but shares the SAME ticket-id extractor
;; (pipeline-stage-lib/extract-ticket-id) - the "small live-glue duplicated
;; across independent pure libs, one shared extractor" posture
;; chase_sweep_lib.bb's own header already documents for this exact shape.

(ns land-step-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_scope_gate_lib.bb")))
;; BL-1375: "is this sibling approved?" is promotion_gates_lib.bb's OWN
;; already-shipped question (read-human-approval, and the backlog-schema rule
;; that an absent field means "no approval needed"). Loading it costs a
;; handful of pure libs and buys the guarantee this file never grows a second
;; YAML-field parser whose comment/quote handling can drift from the one the
;; promotion gate decides on.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "promotion_gates_lib.bb")))

;; This lib's own directory, captured at load time: the tree guards the land
;; step runs (BL-1375 invariant 2) are its siblings, and *file* is no longer
;; this file once a caller is running.
(def ^:private script-dir (str (fs/parent (fs/canonicalize *file*))))

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

;; nil signals "origin/main could not be resolved" - the caller's fail-open,
;; mirroring task_scope_gate_lib.bb's own origin-main-sha exactly (never a
;; guessed sha).
(defn origin-main-sha [root]
  (let [res (git! root "rev-parse" "-q" "--verify" "origin/main^{commit}")]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn- commit-subject [root commit]
  (let [res (git! root "log" "-1" "--format=%s" commit)]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn commit-ticket-id
  "The ticket id this commit's own subject names (pipeline-stage-lib's
   single-match, first-token-wins extractor - the same one task_scope_gate_
   lib.bb's commit-message-names-task? and this repo's other commit-
   attribution guards already share). nil when the subject names none, or
   the commit cannot be read - never guessed."
  [root commit]
  (when-let [subject (commit-subject root commit)]
    (pipeline-stage-lib/extract-ticket-id subject)))

;; nil (never []) signals "the walk itself failed" - same fail-open
;; contract task_scope_gate_lib.bb's own task-tagged-changed-paths uses.
;; (That contract is the nil-vs-empty one, which BL-1297's :delivered /
;; :authored split left untouched: both semantics still answer nil only when
;; the walk could not run.)
(defn- ancestry-commits
  "Every commit reachable from `commit` and not from `base` - the FULL
   ancestry, deliberately not a `--first-parent` walk.

   BL-1308, invariant 2: this set must include every commit the replay's
   own-path diff can draw content from. That diff asks
   `own-commit-changed-paths` for `:delivered`, which for a merge is its
   change against its FIRST parent - a real two-tree diff, so it returns
   everything the merge's SECOND parent brought in, whoever authored it.
   A `--first-parent` walk never reaches those commits, so a sibling ticket
   whose untagged work rode into a forward-merge on the second parent had
   its paths enter the replay while its id never reached the report: the
   detector under-included in exactly the place the path set over-includes.
   Observed 2026-08-30 on BL-1307's documenter tip, which carried four
   unlanded BL-1300 files past a pending human approval while the report
   named BL-1288/1293/1299 and never BL-1300.

   Only DETECTION widens here. `own-commit-changed-paths` and
   `task-tagged-changed-paths` are untouched: the replay must still
   reproduce what the parcel put on the branch."
  [root base commit]
  (let [res (git! root "rev-list" (str base ".." commit))]
    (when (zero? (:exit res))
      (remove str/blank? (str/split-lines (:out res))))))

(defn- blob-at
  "The blob id `rev` holds at `path`, or ::absent when it holds none. A path
   absent on BOTH sides is byte-identical in the only sense that matters here:
   a sibling whose landed content was a deletion really is landed."
  [root rev path]
  (let [res (git! root "rev-parse" "--verify" "-q" (str rev ":" path))]
    (if (zero? (:exit res)) (str/trim (:out res)) ::absent)))

(defn- blob-lines
  "The set of lines `rev` holds at `path`. #{} when the path is absent there -
   a real answer (a sibling whose landed content was a deletion really is
   landed), never a read failure. nil when the blob exists but could not be
   read, which the caller must fail closed on."
  [root rev path]
  (let [blob (blob-at root rev path)]
    (if (= ::absent blob)
      #{}
      (let [res (git! root "cat-file" "blob" blob)]
        (when (zero? (:exit res))
          (into #{} (str/split-lines (:out res))))))))

(defn diff-line-changes
  "Parse one unified diff into {path {:added #{lines} :removed #{lines}}}.

   Pure over the diff text so the parse itself is pinnable without a
   repository. `--- `/`+++ ` are read as file headers ONLY outside a hunk: a
   removed content line can itself begin `--- ` once git's own `-` prefix is
   applied, and misreading that as a header would silently re-point every
   following line at the wrong file."
  [diff-text]
  (loop [lines (str/split-lines (or diff-text "")) cur nil in-hunk? false acc {}]
    (if (empty? lines)
      acc
      (let [line (first lines) rest-lines (rest lines)]
        (cond
          (str/starts-with? line "diff --git ")
          (recur rest-lines nil false acc)

          (str/starts-with? line "@@")
          (recur rest-lines cur true acc)

          (and (not in-hunk?) (str/starts-with? line "--- "))
          (let [p (subs line 4)]
            (recur rest-lines (when-not (= p "/dev/null") (str/replace-first p #"^a/" "")) false acc))

          (and (not in-hunk?) (str/starts-with? line "+++ "))
          (let [p (subs line 4)]
            (recur rest-lines
                   (if (= p "/dev/null") cur (str/replace-first p #"^b/" ""))
                   false acc))

          (and in-hunk? cur (str/starts-with? line "+"))
          (recur rest-lines cur in-hunk? (update-in acc [cur :added] (fnil conj #{}) (subs line 1)))

          (and in-hunk? cur (str/starts-with? line "-"))
          (recur rest-lines cur in-hunk? (update-in acc [cur :removed] (fnil conj #{}) (subs line 1)))

          :else (recur rest-lines cur in-hunk? acc))))))

(defn- merge-commit? [root commit]
  (let [res (git! root "rev-list" "--no-walk" "--parents" "-1" commit)]
    (and (zero? (:exit res))
         (> (count (str/split (str/trim (:out res)) #"\s+")) 2))))

(defn- commit-line-changes
  "{path {:added #{} :removed #{}}} for one commit's own first-parent diff -
   the SAME view `own-commit-changed-paths :delivered` attributes paths by, so
   a path the attribution credits to a sibling always has its lines read from
   the same edge. nil (never {}) when the diff could not be read."
  [root commit]
  (let [res (git! root "log" "-1" "--format=" "-p" "--unified=0" "--first-parent" commit)]
    (when (zero? (:exit res))
      (diff-line-changes (:out res)))))

(defn sibling-own-line-changes
  "The line changes `sibling-id`'s OWN commits among `candidates` made, merged
   across those commits: {path {:added #{} :removed #{}}}.

   MERGE commits are skipped: a merge authors no lines of its own, while its
   first-parent diff is everything its second parent brought in, whoever wrote
   it (`ancestry-commits`' own docstring, from the other side). Crediting a
   merge's passengers to whichever ticket its subject names is how the landing
   ticket's OWN unlanded lines got charged to sibling BL-1341 and made it read
   unlanded - the very confusion this ticket exists to end.

   nil when ANY of those commits' diffs could not be read - a partially-read
   attribution must never be scored as if it were whole (invariant 1, the same
   posture `attribution-complete?` already takes one door up)."
  [root candidates sibling-id]
  (let [own (->> candidates
                 (filter #(= sibling-id (commit-ticket-id root %)))
                 (remove #(merge-commit? root %)))
        diffs (map #(commit-line-changes root %) own)]
    (when (every? some? diffs)
      (reduce (fn [acc d]
                (reduce-kv (fn [a p {:keys [added removed]}]
                             (-> a
                                 (update-in [p :added] (fnil into #{}) (or added #{}))
                                 (update-in [p :removed] (fnil into #{}) (or removed #{}))))
                           acc d))
              {} diffs))))

(defn sibling-path-verdict
  "Pure over the injected facts: what does ONE attributed path say about
   whether this sibling has landed? `:landed`, `:unlanded`, or `:vacuous` -
   the sibling has nothing left to land there, so the path is silent rather
   than an obstacle (its content at the tip owes the sibling nothing; a ticket
   file the sibling later moved away is the everyday case). A sibling every
   one of whose paths is vacuous still reports unlanded: `landed-siblings`
   drops the vacuous ones and `sibling-landed?`s empty-paths row then fails
   closed, so silence is never scored as evidence.

   BL-1354. The predicate this replaces compared the path's WHOLE blob, so a
   file several tickets touch was judged by every co-owner at once and a
   sibling whose own lines were all landed still read unlanded whenever any
   co-owner's were not. Six-for-six on `docs/reference/Specification.MD`
   during BL-1332's own land.

   Scored against what SURVIVES at the tip (`tip-lines`), not against every
   intermediate state the sibling passed through: a line one of its commits
   added and a later commit rewrote is not part of what this parcel would
   land, and demanding it on origin/main reports a landed sibling as unlanded
   for the second time in the same defect's shape. Measured on BL-1271's real
   attribution, where a superseded `abandoned_commits:` line was the sole
   miss.

   Fail-closed, unchanged from BL-1272 invariant 1: an unread diff
   (`changes` nil), an unread blob (`main-lines` or `tip-lines` nil), and a
   surviving contribution of nothing at all (only blank lines, or every change
   reverted before the tip) each answer false. Landed stays a POSITIVE
   finding - every surviving line the sibling added is present, and every line
   it removed is still absent."
  [{:keys [changes main-lines tip-lines]}]
  (if-not (and changes main-lines tip-lines)
    :unlanded
    (let [added (into #{} (remove str/blank?) (:added changes))
          removed (into #{} (remove str/blank?) (:removed changes))
          ;; What the sibling actually contributes to this tip: added lines
          ;; still standing there, removed lines still gone from there.
          surviving-added (filter tip-lines (remove removed added))
          surviving-removed (remove tip-lines (remove added removed))]
      (cond
        (and (empty? surviving-added) (empty? surviving-removed)) :vacuous
        (and (every? main-lines surviving-added)
             (not-any? main-lines surviving-removed)) :landed
        :else :unlanded))))

(defn sibling-landed?
  "Pure over the injected facts: is this sibling's attributed content ALREADY
   on origin/main? `same-content?` answers that for one attributed path;
   BL-1354 made what it asks the sibling's OWN lines rather than the path's
   whole blob, which on a shared file was decided by every co-owner at once.

   BL-1272, invariant 1: landed is a POSITIVE finding, never an inference from
   silence. `paths` nil (the attribution walk could not run) and `paths` empty
   (nothing was attributed to the sibling at all) both mean the question was
   not answered, and an unanswered question reports the sibling as entangled -
   the same fail-closed posture entangled-siblings' own warning path takes.

   Deliberately NOT a subject grep over origin/main's history: a mint or spec
   commit names a ticket while its pipeline work is still unlanded, so a
   subject match would suppress a REAL entanglement and turn a fail-closed
   check fail-open."
  [{:keys [paths complete? same-content?]}]
  (boolean (and complete? (seq paths) (every? same-content? paths))))

;; BL-1297: asks readability through the SAME walk the attribution itself
;; uses (task_scope_gate_lib.bb's own-commit-changed-paths), never a second
;; invocation of git. A probe that reads a commit differently from the walk
;; it is vouching for can call a commit readable whose paths the walk then
;; silently drops - which is exactly the merge blind spot this ticket fixes.
;;
;; :delivered is passed EXPLICITLY, not inherited from the helper's default.
;; The land step is the caller that wants delivered content, and saying so
;; here means a future change to that default cannot silently re-point this
;; probe at a question it is not vouching for.
(defn- diff-readable? [root commit]
  (some? (task-scope-gate-lib/own-commit-changed-paths root commit :delivered)))

(defn attribution-complete?
  "Every commit in `candidates` that names `sibling-id` can actually be
   diffed.

   This is not belt-and-braces. task-tagged-changed-paths signals failure with
   nil ONLY when the commit walk itself fails; a single commit whose diff
   cannot be computed silently contributes no paths, shrinking the attributed
   set instead of emptying it. Without this probe a sibling whose READABLE
   half is already on origin/main would be reported as landed on a check that
   never saw its other half - invariant 1's \"partial\" row, fail-open."
  [root candidates sibling-id]
  (every? (fn [c]
            (or (not= sibling-id (commit-ticket-id root c))
                (diff-readable? root c)))
          candidates))

(defn landed-sibling-verdicts
  "BL-1389. Per sibling: `{:landed? bool :deciding-path path :paths [...]}`.

   `landed-siblings` returned a bare set, so a verdict a human wanted to check
   could only be re-derived by hand - which is exactly what QA had to do on
   2026-09-04 to find that BL-1367 had been called landed while its handler and
   a source file were absent from origin/main. The verdict now names the path
   it rests on: for an UNLANDED sibling that is the first attributed path whose
   own lines are not there (the one that decided it); for a LANDED one the
   verdict rests on every attributed path, and the last in sorted order is
   named as the one that completed it.

   `extra-paths-fn` (BL-1389, invariant 2) supplies paths attributed to this
   sibling by the per-PATH walk that the per-SIBLING walk did not report. The
   two walks do not see the same set - a merge the path-scoped walk credits to
   a ticket contributes no path to `task-tagged-changed-paths` - and a verdict
   computed from the smaller set is what let an unlanded sibling read landed.
   nil (the default) keeps the pre-BL-1389 attributed set exactly.

   Attribution reuses task_scope_gate_lib.bb's own walk (BL-1192), the same one
   `own-paths` delegates to - never a second implementation. `paths-fn` and
   `lines-fn` are injected so the walk-failed and unreadable-diff rows are
   drivable without corrupting a repository."
  ([root commit origin-main candidates siblings]
   (landed-sibling-verdicts root commit origin-main candidates siblings nil))
  ([root commit origin-main candidates siblings paths-fn]
   (landed-sibling-verdicts root commit origin-main candidates siblings paths-fn nil))
  ([root commit origin-main candidates siblings paths-fn lines-fn]
   (landed-sibling-verdicts root commit origin-main candidates siblings paths-fn lines-fn nil))
  ([root commit origin-main candidates siblings paths-fn lines-fn extra-paths-fn]
   (let [walk (or paths-fn
                  #(task-scope-gate-lib/task-tagged-changed-paths root origin-main commit % :delivered))
         lines (or lines-fn #(sibling-own-line-changes root candidates %))
         main-lines (memoize #(blob-lines root origin-main %))
         tip-lines (memoize #(blob-lines root commit %))]
     (into {}
           (for [sibling siblings]
             (let [changes (lines sibling)
                   ;; BL-1354: the content question is asked per SIBLING, not
                   ;; per path alone. A shared path's blob is decided by every
                   ;; co-owner at once; this sibling's own lines are not.
                   ;;
                   ;; A path the shipped attribution walk credits to this
                   ;; sibling only through a MERGE carries no line the sibling
                   ;; authored - `{}`, a real answer, not the unread `nil` that
                   ;; fails the whole sibling closed.
                   verdict (memoize
                            #(if (nil? changes)
                               :unlanded
                               (sibling-path-verdict
                                {:changes (get changes % {})
                                 :main-lines (main-lines %)
                                 :tip-lines (tip-lines %)})))
                   walked (walk sibling)
                   attributed (when walked
                                (distinct (concat walked (when extra-paths-fn
                                                           (extra-paths-fn sibling)))))
                   considered (when attributed
                                (vec (sort (remove #(= :vacuous (verdict %)) attributed))))
                   landed? (sibling-landed?
                            {:paths considered
                             :complete? (attribution-complete? root candidates sibling)
                             :same-content? #(= :landed (verdict %))})]
               [sibling
                {:landed? landed?
                 :paths (vec (or considered []))
                 :deciding-path (if landed?
                                  (last considered)
                                  (first (remove #(= :landed (verdict %))
                                                 (or considered []))))}]))))))

(defn landed-siblings
  "The subset of `siblings` whose OWN attributed line changes between
   origin/main and `commit` are already reflected in origin/main's tree
   (BL-1354 - never the whole blob of a path they merely share).

   The verdicts themselves, with the path each rests on, are
   `landed-sibling-verdicts` (BL-1389); this is that answer as the set every
   caller before it expected."
  ([root commit origin-main candidates siblings]
   (landed-siblings root commit origin-main candidates siblings nil))
  ([root commit origin-main candidates siblings paths-fn]
   (landed-siblings root commit origin-main candidates siblings paths-fn nil))
  ([root commit origin-main candidates siblings paths-fn lines-fn]
   (landed-siblings root commit origin-main candidates siblings paths-fn lines-fn nil))
  ([root commit origin-main candidates siblings paths-fn lines-fn extra-paths-fn]
   (->> (landed-sibling-verdicts root commit origin-main candidates siblings
                                 paths-fn lines-fn extra-paths-fn)
        (keep (fn [[sibling {:keys [landed?]}]] (when landed? sibling)))
        set)))

(defn entangled-siblings
  "{:entangled #{ticket-ids} :landed #{...} :unlanded #{...} :warning nil} on a
   clean read, or {:entangled nil :warning \"...\"} when the walk could not be
   completed -
   never a silent empty set standing in for 'could not check' (this
   ticket's own invariant 2: a commit must not land while another ticket's
   unreviewed work is an ancestor of it - a check that could not run must
   never be read as 'nothing found'). Every commit in origin/main..commit
   whose OWN subject names a DIFFERENT ticket than task-ticket-id counts;
   a commit naming no ticket at all is not counted (positive identification
   only, task_scope_gate_lib.bb's own posture - never guessed as
   entanglement from silence)."
  ([root commit task-ticket-id]
   (entangled-siblings root commit task-ticket-id nil))
  ([root commit task-ticket-id extra-paths-fn]
   (entangled-siblings root commit task-ticket-id extra-paths-fn nil))
  ([root commit task-ticket-id extra-paths-fn lines-fn]
   ;; BL-1431: this arity is a direct/standalone caller's own entry - it
   ;; resolves origin/main ONCE here and threads it, never re-resolving.
   (entangled-siblings root commit task-ticket-id extra-paths-fn lines-fn (origin-main-sha root)))
  ([root commit task-ticket-id extra-paths-fn lines-fn origin-main]
   ;; BL-1431: origin-main is now ALWAYS a parameter, never resolved by name
   ;; in this function body - a caller with its own already-resolved tip
   ;; (land-plan) passes it straight through, so one land-step invocation
   ;; reads one tip everywhere, immune to main moving mid-walk.
   (if-not origin-main
     {:entangled nil :warning "land-step: origin/main could not be resolved"}
     (let [candidates (ancestry-commits root origin-main commit)]
       (if (nil? candidates)
         {:entangled nil :warning (str "land-step: could not read the commit range origin/main.." commit)}
         (let [siblings (->> candidates
                             (keep #(commit-ticket-id root %))
                             (remove #(= % task-ticket-id))
                             set)
               ;; BL-1389: the verdicts carry the path each rests on, so the
               ;; report can say WHY a sibling reads landed instead of leaving
               ;; a human to diff the tip for it.
               verdicts (landed-sibling-verdicts root commit origin-main candidates siblings
                                                 nil lines-fn extra-paths-fn)
               landed (->> verdicts (keep (fn [[s v]] (when (:landed? v) s))) set)]
           ;; :entangled stays the FULL set - it is what land-plan decides on,
           ;; and BL-1272 invariant 2 keeps that decision unchanged. :landed and
           ;; :unlanded are the reporting split: a sibling's original commit is
           ;; still an ancestor after its replay lands, and may carry content
           ;; the replay deliberately excluded, so landing as cited would
           ;; resurrect exactly what the replay severed.
           {:entangled siblings
            :landed landed
            :unlanded (into #{} (remove landed siblings))
            ;; BL-1389 invariant 3: {sibling deciding-path} for the landed ones.
            :landed-paths (into {} (for [[s v] verdicts :when (:landed? v)]
                                     [s (:deciding-path v)]))
            :warning nil}))))))


;; ── BL-1375: is an unlanded sibling APPROVED, or is it withheld? ─────────
;; BL-1332 refused every shared path with an unlanded co-owner. That is
;; circular when several APPROVED tickets share one path: each refuses
;; because the others are unlanded, and no order lets any go first (four
;; deadlocked on specs/pipeline/steps/index.js, 2026-09-03). The human's
;; ruling narrows the refusal to a sibling that is WITHHELD, awaiting
;; approval, or whose approval state cannot be read.
;;
;; Every unknown is a BLOCKING state. The narrowing may only ever be applied
;; on a POSITIVE reading of "this sibling is approved" - absence, ambiguity
;; and an unreadable file all keep the old refusal, which is the posture
;; sibling-landed? already takes one door up (invariant 1: nothing the human
;; has not approved reaches main, and a check that could not run is never
;; collected as a pass).

(def ^:private backlog-folders ["active" "paused" "hold" "done" "archive"])

(defn- ticket-file-name?
  "`<id>.yaml` or `<id>-<slug>.yaml`, matched exactly so BL-90020's file never
   answers for BL-9002."
  [ticket-id file-name]
  (some? (re-matches (re-pattern (str "^" (java.util.regex.Pattern/quote (str ticket-id)) "(-[^/]*)?\\.yaml$"))
                     (str file-name))))

(defn- worktree-ticket-sources
  "The ticket's backlog files as the checkout the land is running from has
   them: {:where \"the worktree\" :folder \"active\" :content \"...\"}."
  [root ticket-id]
  (->> backlog-folders
       ;; RECURSIVELY: backlog/done/ nests by milestone
       ;; (backlog/done/M8/BL-....yaml), so listing only the immediate folder
       ;; finds nothing for every landed sibling.
       (mapcat (fn [folder]
                 (let [dir (fs/path root "backlog" folder)]
                   (when (fs/directory? dir)
                     (->> (file-seq (fs/file dir))
                          (filter #(.isFile %))
                          (filter #(ticket-file-name? ticket-id (.getName %)))
                          (map (fn [f]
                                 {:where "the worktree"
                                  :folder folder
                                  :content (try (slurp f) (catch Exception _ nil))})))))))
       vec))

(defn- main-ticket-sources
  "The same, as origin/main has them.

   Reading BOTH trees is not belt-and-braces. A sibling's ticket file MOVES
   between backlog folders on main - a landed one is in backlog/done/ there
   while the branch the land runs from still predates the move, or never
   carried the file at all. Reading only the checkout would report `unreadable`
   for tickets that are approved and already landed, and the deadlock this
   ticket exists to clear would stay shut for a second reason (measured
   2026-09-03 against the live jam: BL-1328, BL-1346 and BL-1351 all read
   unreadable from the QA tip while their work was on main).

   nil signals the tree could not be listed at all, which the caller treats as
   no source rather than as an answer.

   BL-1431: origin-main is a parameter (resolved once by ticket-approval-
   state's own entry, or threaded from land-plan's single resolution),
   never resolved by name here."
  ([root ticket-id] (main-ticket-sources root ticket-id (origin-main-sha root)))
  ([root ticket-id origin-main]
   (when origin-main
     (->> backlog-folders
         (mapcat (fn [folder]
                   ;; -r for the same reason worktree-ticket-sources walks:
                   ;; backlog/done/ nests by milestone.
                   (let [listed (git! root "ls-tree" "-r" "--name-only" origin-main (str "backlog/" folder "/"))]
                     (when (zero? (:exit listed))
                       (->> (str/split-lines (str/trim (:out listed)))
                            (remove str/blank?)
                            (filter #(ticket-file-name? ticket-id (fs/file-name %)))
                            (map (fn [path]
                                   (let [shown (git! root "show" (str origin-main ":" path))]
                                     {:where "origin/main"
                                      :folder folder
                                      :content (when (zero? (:exit shown)) (:out shown))}))))))))
         vec))))

(defn- source-verdict
  "One tree's answer about one ticket."
  [ticket-id {:keys [where folder content]}]
  (cond
    (nil? content)
    {:state :unreadable :blocking? true
     :reason (str ticket-id "'s ticket file could not be read in " where)}

    ;; The FOLDER decides ahead of the field: a held ticket can still read
    ;; `human_approval: approved` from before a human pulled it, and the hold
    ;; is the later, stronger statement.
    (= "hold" folder)
    {:state :withheld :blocking? true
     :reason (str ticket-id " is withheld in backlog/hold (" where ")")}

    :else
    (let [approval (promotion-gates-lib/read-human-approval content)]
      (if (or (nil? approval) (= "approved" approval))
        {:state :approved :blocking? false
         :reason (str ticket-id " is approved" (when (nil? approval) " (no approval required)"))}
        {:state :awaiting-approval :blocking? true
         :reason (str ticket-id "'s human_approval is " approval ", not approved (" where ")")}))))

(defn ticket-approval-state
  "{:state :approved|:withheld|:awaiting-approval|:unreadable :blocking? bool
   :reason \"...\"} for one sibling ticket id.

   :approved (the ONLY non-blocking answer) needs the ticket to be found in at
   least one tree, filed unambiguously in each tree that has it, outside
   backlog/hold, with human_approval either the literal `approved` or absent.
   Absent is not a gap being waved through: backlog-schema.md defines it as
   \"no approval needed\" and promotion_gates_lib.bb's own human_approval gate
   already passes it, so a sibling with no approval field is neither withheld
   nor awaiting one. read-human-approval is that gate's own reader, reused
   rather than re-implemented, so an inline comment or a quoted value cannot
   be read differently here than at promotion.

   BOTH the worktree and origin/main are consulted (see main-ticket-sources),
   and EITHER of them saying blocking blocks. That needs no judgment about
   which tree is fresher - the question here is only ever whether anything
   says this sibling may not ride, and nothing one tree says can read away a
   hold the other is carrying.

   :unreadable - found in no tree, filed in more than one folder within a
   tree, or a file that could not be read. Two copies in different folders is
   a state nobody can act on, and guessing which is current is precisely how a
   withheld ticket would ride.

   BL-1431: origin-main is a parameter, resolved once by this function's own
   entry when a caller does not already have it (own-paths threads its own
   single resolution here instead)."
  ([root ticket-id] (ticket-approval-state root ticket-id (origin-main-sha root)))
  ([root ticket-id origin-main]
   (let [worktree (worktree-ticket-sources root ticket-id)
         on-main (or (main-ticket-sources root ticket-id origin-main) [])
         ambiguous (->> [worktree on-main]
                        (filter #(> (count %) 1))
                        first)]
     (cond
       ambiguous
       {:state :unreadable :blocking? true
        :reason (str ticket-id " is filed in more than one backlog folder in "
                     (:where (first ambiguous)) " ("
                     (str/join ", " (sort (map :folder ambiguous))) ")")}

       (empty? (concat worktree on-main))
       {:state :unreadable :blocking? true
        :reason (str "no backlog ticket file found for " ticket-id)}

       :else
       (let [verdicts (map #(source-verdict ticket-id %) (concat worktree on-main))]
         (or (first (filter :blocking? verdicts))
             (first verdicts)))))))

(defn blocking-siblings
  "The subset of `sibling-ids` whose approval state still blocks a land,
   each with the reason, sorted so a refusal reads the same twice.
   `approval-fn` is injected for tests; it defaults to the real read."
  ([root sibling-ids] (blocking-siblings root sibling-ids nil))
  ([root sibling-ids approval-fn]
   (let [read-state (or approval-fn #(ticket-approval-state root %))]
     (->> (sort sibling-ids)
          (keep (fn [id]
                  (let [state (read-state id)]
                    (when (:blocking? state) (assoc state :ticket id)))))
          vec))))

(defn- full-delivered-paths
  "The two-tree diff between origin-main and commit - literally 'what
   differs between origin/main's tree and this tip's tree', the ticket's
   whole contribution across the FULL origin/main..tip range rather than any
   one commit's diff against a parent.

   BL-1315: this is the fix's base-of-the-set half. The tagged merge's own
   :delivered diff (against its single first parent) drops the ticket's own
   content whenever that content reached the branch BEFORE its own tagged
   merge did - which is exactly what a sibling's passenger ride does to it
   (verified live on BL-1303's QA tip ab8d10a8b3). A straight two-tree diff
   against origin/main cannot lose that content, because it never depended
   on which commit's first-parent edge carried it.

   nil (never []) on an unreadable diff, this file's own fail-open
   convention throughout."
  [root origin-main commit]
  (let [res (git! root "diff" "--name-only" origin-main commit)]
    (when (zero? (:exit res))
      (remove str/blank? (str/split-lines (:out res))))))

(defn- path-attributing-commits
  "Commits in origin-main..commit that changed `path`, via git's own
   path-scoped history walk - which already elides a merge that is TREESAME
   to a parent on that specific path, attributing the change to whichever
   commit actually introduced it rather than to whatever forward-merge
   happened to carry it along. nil signals the read itself failed; the
   caller must refuse rather than read that as 'nothing touched this path'."
  [root origin-main commit path]
  (let [res (git! root "log" "--format=%H" (str origin-main ".." commit) "--" path)]
    (when (zero? (:exit res))
      (remove str/blank? (str/split-lines (:out res))))))

(defn- merge-authored-paths
  "BL-1374: the paths a MERGE actually wrote a line at - the paths its dense
   combined diff produces a PATCH for.

   Not its `--cc --name-only` list, which is a different question and the one
   that misleads. `--name-only` names every path whose result differs from all
   parents, and a clean auto-merge of two sides' edits to different parts of
   one file does that without the merger writing anything: every line came
   from one side or the other. Dense simplification drops exactly those hunks,
   so the patch is empty while the name list is not.

   Measured on the tip that produced this ticket's report (5d4486eb08, \"Merge
   main into swarmforge-QA for BL-1309 human_approval restore\"): the name list
   holds BL-1296's and BL-1309's ticket files; the patch holds not one hunk.
   BL-1309's own commits never touched BL-1296's file, and the replay refused
   its land over that.

   `diff --cc <path>` for a two-parent merge, `diff --combined <path>` for an
   octopus. nil (never #{}) when the read failed - this file's fail-open
   convention throughout, and the caller refuses rather than reading blindness
   as \"the merge wrote nothing\"."
  [root commit]
  (let [res (git! root "diff-tree" "--no-commit-id" "--cc" "-r" commit)]
    (when (zero? (:exit res))
      (into #{}
            (keep #(second (re-matches #"^diff --(?:cc|combined) (.+)$" %)))
            (str/split-lines (:out res))))))

;; Memoized per (root, commit). `path-owner-tickets` is asked once per
;; delivered path, and a tip with many paths and a few merges would otherwise
;; recompute the same whole-merge combined diff dozens of times - on the land
;; step's critical path, which the BL-1309 ruling already made the everyday
;; one. Same posture as `own-paths`' own memoized `blocking-for`.
(def ^:private merge-authored-paths* (memoize merge-authored-paths))

(defn- path-owner-tickets
  "The attribution of `path`'s changes: every commit `commits-fn` reports for
   `path`, run through this file's own commit-ticket-id extractor.
   `commits-fn` is injected (defaults to the real git walk) so the unreadable
   row is drivable in a test without corrupting a repository, the same
   posture `landed-siblings`' `paths-fn` already takes.

   nil propagates a read failure (never a silent 'no attribution'). On a
   successful read, returns {:owners #{...} :any-untagged? bool}: `:owners`
   is the set of ticket ids named by a touching commit's subject (#{} is a
   real answer - every touching commit named no ticket at all, positive
   information, not blindness); `:any-untagged?` is true when at least one
   touching commit's subject named no ticket.

   BL-1315 hardener finding: an untagged touch used to contribute nothing to
   `:owners`, making it indistinguishable from 'no commit touched this path'
   - so a path touched by BOTH an unlanded sibling's tagged commit and a
   later untagged own-chain commit read as 'every owner is the unlanded
   sibling' and was wrongly excluded. `:any-untagged?` lets the caller tell
   the two apart and keep the path when an untagged touch's contribution is
   unaccounted for (invariant 1)."
  [root origin-main commit path commits-fn]
  (when-let [commits (commits-fn root origin-main commit path)]
    ;; BL-1374. git's path-scoped walk already elides a merge TREESAME to a
    ;; parent on this path, so a sync merge that merely carried a passenger
    ;; through is invisible here. What it does NOT elide is the clean
    ;; auto-merge: both sides changed the same file in different places, the
    ;; result differs from both parents, and the merge's subject then decides
    ;; the owner of content its merger never wrote. `sibling-own-line-changes`
    ;; skips merges outright for exactly this reason ("a merge authors no lines
    ;; of its own"); the delivered side keeps the one exception a merge really
    ;; can author - a conflict it resolved - because invariant 3 forbids
    ;; dropping any path this ticket's own work changed.
    (let [attributing (reduce (fn [acc c]
                                (if-not (merge-commit? root c)
                                  (conj acc c)
                                  (if-let [wrote (merge-authored-paths* root c)]
                                    (cond-> acc (contains? wrote path) (conj c))
                                    ;; unreadable combined diff: blindness, not
                                    ;; "the merge wrote nothing"
                                    (reduced nil))))
                              []
                              commits)]
      (when attributing
        (let [ids (map #(commit-ticket-id root %) attributing)]
          {:owners (into #{} (remove nil? ids))
           :any-untagged? (boolean (some nil? ids))})))))

(defn delivered-attribution
  "BL-1389. Every delivered path in origin/main..commit, with the attribution
   of its changes: {path {:owners #{...} :any-untagged? bool}}. A nil VALUE is
   that one path's attribution being unreadable, which the caller refuses on
   by name; nil overall is the delivered diff itself being unreadable.

   Computed once and shared, because two consumers ask the same question and
   used to answer it from different walks: `own-paths` decides each path from
   the per-PATH attribution, while the landed/unlanded split was computed from
   the per-SIBLING walk alone. A path the first credits to a sibling and the
   second never reports is a path decided against a verdict that never saw it -
   the BL-1389 defect."
  ([root origin-main commit]
   (delivered-attribution root origin-main commit path-attributing-commits))
  ([root origin-main commit commits-fn]
   (when-let [delivered (full-delivered-paths root origin-main commit)]
     (into {} (for [p delivered]
                [p (path-owner-tickets root origin-main commit p commits-fn)])))))

(defn sibling-path-landed-fn
  "BL-1389. (sibling, path) -> is THAT sibling's own contribution to THAT path
   already on origin/main? The per-path half of BL-1354's own-lines question,
   asked where the exclusion decision is actually made rather than once per
   ticket.

   Fail-closed throughout: an unreadable commit range, an unreadable diff, an
   unreadable blob, and a sibling with no surviving lines on the path all
   answer false. Landed stays a POSITIVE finding (BL-1272 invariant 1)."
  ([root origin-main commit] (sibling-path-landed-fn root origin-main commit nil))
  ([root origin-main commit lines-fn]
  (let [candidates (ancestry-commits root origin-main commit)
        ;; `lines-fn` is shared with landed-sibling-verdicts when land-plan
        ;; drives both, so one sibling's diffs are read once per land rather
        ;; than once per question. Each of those reads is every commit that
        ;; sibling authored in range.
        changes-of (or lines-fn
                       (memoize #(when candidates (sibling-own-line-changes root candidates %))))
        main-lines (memoize #(blob-lines root origin-main %))
        tip-lines (memoize #(blob-lines root commit %))]
    (fn [sibling path]
      (let [changes (changes-of sibling)]
        (boolean
         (and (some? changes)
              (= :landed (sibling-path-verdict {:changes (get changes path {})
                                                :main-lines (main-lines path)
                                                :tip-lines (tip-lines path)})))))))))

(defn own-paths
  "This ticket's own changed paths since origin/main - the tip-pure replay
   content (BL-1241's remedy (b)).

   BL-1315: based on the FULL origin-main..commit diff (`full-delivered-
   paths` above), not the tagged merge's first-parent :delivered diff - see
   that function's docstring for why the old base silently dropped content.
   A path is then excluded only on POSITIVE attribution to a ticket in
   `unlanded-siblings` and no other id (this ticket's invariant 2): never
   the landed ticket's own path (even one no commit in range tags with its
   id - invariant 1, scenario 06), and never a path attributed to nobody at
   all (absence is not evidence, same posture `sibling-landed?` already
   takes one door up).

   {:paths [...] :warning nil} on success. paths [] is a real answer ONLY
   when the tip is identical to origin/main - nothing was delivered, so
   nothing is left to replay. BL-1343: an empty set reached the OTHER way,
   with paths delivered and every one of them subtracted as a sibling's,
   is a refusal that names the paths, this ticket and the siblings they were
   credited to - never a silent no-op, which replay! would then report in
   the same words a completed land produces.

   {:paths nil :warning \"...\"} on that refusal, and when a diff
   could not be read - origin/main unresolved, the full diff itself
   unreadable, or one path's attribution unreadable, NAMED in the warning
   text so a caller's refusal can say what it could not read (invariant 2's
   refuse-rather-than-narrow half; scenario 04).

   Two arities: given `unlanded-siblings` explicitly (what `land-plan`
   passes, already computed by the same run's `entangled-siblings` call, so
   the walk is never duplicated), or without it, in which case this
   function computes it itself via `entangled-siblings` - so a caller that
   asks this function in isolation (a test, a future direct caller) gets the
   same answer the land step's own decision would reach, never a
   half-applied one that skips exclusion entirely.

   BL-1431: origin-main is resolved ONCE, either by this function's own
   entry (the first arity below, or the 7-arg arity when no caller has
   already resolved it) or threaded in by land-plan's single resolution
   (the 8-arg arity) - never re-resolved by name mid-walk, which is what let
   a mint landing between two reads desync the attribution map this
   function reads from the walk that built it."
  ([root commit task-ticket-id]
   (let [origin-main (origin-main-sha root)
         {:keys [unlanded warning]} (entangled-siblings root commit task-ticket-id nil nil origin-main)]
     (if warning
       {:paths nil :warning warning}
       (own-paths root commit task-ticket-id (or unlanded #{}) path-attributing-commits nil nil origin-main))))
  ([root commit task-ticket-id unlanded-siblings]
   (own-paths root commit task-ticket-id unlanded-siblings path-attributing-commits))
  ([root commit task-ticket-id unlanded-siblings commits-fn]
   (own-paths root commit task-ticket-id unlanded-siblings commits-fn nil))
  ([root commit task-ticket-id unlanded-siblings commits-fn approval-fn]
   (own-paths root commit task-ticket-id unlanded-siblings commits-fn approval-fn nil))
  ([root commit task-ticket-id unlanded-siblings commits-fn approval-fn opts]
   (own-paths root commit task-ticket-id unlanded-siblings commits-fn approval-fn opts (origin-main-sha root)))
  ([root commit task-ticket-id unlanded-siblings commits-fn approval-fn opts origin-main]
   (if-not origin-main
     {:paths nil :warning "land-step: origin/main could not be resolved"}
     (if-let [delivered (full-delivered-paths root origin-main commit)]
       ;; BL-1375: memoized so N shared paths read one sibling's ticket file
       ;; once, and so every path in one run answers from the same read.
       ;; BL-1431: when the caller supplied no approval-fn, the default reads
       ;; ticket-approval-state with THIS call's already-resolved origin-main
       ;; instead of letting it resolve a second, potentially different, tip.
       (let [approval-fn (or approval-fn (fn [id] (ticket-approval-state root id origin-main)))
             blocking-for (memoize #(blocking-siblings root % approval-fn))
             ;; BL-1389. `:attribution` and `:path-landed-fn` are injected by
             ;; land-plan so the same reads serve the landed/unlanded split and
             ;; this decision; absent, they are computed here so a direct
             ;; caller reaches the same answer.
             attribution-of (let [m (:attribution opts)
                                  walk (or commits-fn path-attributing-commits)]
                              (if m
                                #(get m %)
                                #(path-owner-tickets root origin-main commit % walk)))
             path-landed? (or (:path-landed-fn opts)
                              (sibling-path-landed-fn root origin-main commit))]
        (loop [remaining delivered acc [] excluded [] passengers #{}]
         (if (empty? remaining)
           ;; BL-1343. An empty set is two different answers wearing the same
           ;; face. With nothing delivered, the tip IS origin/main and "nothing
           ;; left to replay" is true (scenario 05). With paths delivered and
           ;; every one of them subtracted, the landing ticket's whole
           ;; contribution has just been credited to somebody else - and
           ;; replay! would report that as "nothing to commit", the very words
           ;; a completed land produces. So the exclusion speaks: it refuses,
           ;; and names the path, the landing ticket and the sibling it was
           ;; credited to (invariant 2), rather than letting an approved parcel
           ;; land nothing while reading as complete.
           (if (and (empty? acc) (seq delivered))
             {:paths nil
              :warning (str "land-step: refusing to replay " task-ticket-id
                            " - every delivered path was attributed to an unlanded sibling, "
                            "leaving nothing of this ticket's own contribution to land: "
                            (str/join "; " (map (fn [{:keys [path owners]}]
                                                  (str path " -> " (str/join "," (sort owners))))
                                                excluded)))}
             ;; BL-1375: :passengers is the set of APPROVED unlanded siblings
             ;; whose own lines ride into main on a path this replay includes.
             ;; The caller owes them the tree guard before publish (invariant
             ;; 2) and owes QA their names either way.
             ;; BL-1389 invariant 3: what was excluded, and to whom it was
             ;; credited, rides with the success answer - not only with the
             ;; refusal. QA had to diff the replayed tip by hand to see it.
             {:paths acc :warning nil :passengers passengers :excluded excluded})
           (let [path (first remaining)
                 attribution (attribution-of path)]
             (cond
               (nil? attribution)
               {:paths nil :warning (str "land-step: could not read " path "'s attribution")}

               ;; BL-1332, human ruling option 1. A path BOTH this ticket and
               ;; an unlanded sibling own cannot be separated by a per-path
               ;; decision: write-tree-from-paths! takes the WHOLE blob at the
               ;; cited commit, so including it ships the sibling's lines and
               ;; excluding it drops this ticket's. On 2026-09-02 the first of
               ;; those put an unlanded ticket's require(...) into
               ;; specs/pipeline/steps/index.js on origin/main and the
               ;; registration guard then refused every role's commit on main
               ;; until a human adjudicated. So it refuses, naming the path,
               ;; the landing ticket and the sibling - never silently shipping
               ;; either ticket's version of the file. Splitting the file
               ;; per-hunk is the better end state and is ruling option 2's
               ;; follow-up slice, not this one.
               ;; BL-1332, as narrowed by BL-1375's human ruling. A path
               ;; BOTH this ticket and an unlanded sibling own cannot be
               ;; separated by a per-path decision: write-tree-from-paths!
               ;; takes the WHOLE blob at the cited commit, so including it
               ;; ships the sibling's lines and excluding it drops this
               ;; ticket's. BL-1332 refused outright. That is circular when
               ;; the co-owners are all APPROVED - each refuses because the
               ;; others are unlanded and none can go first - so the refusal
               ;; now asks WHICH sibling rides: one that is withheld,
               ;; awaiting approval, or unreadable still refuses, naming
               ;; itself and its reason; approved ones ride as passengers and
               ;; the caller runs the tree guards against the replayed tree
               ;; before publish (invariant 2, the BL-1324 shape).
               (and (contains? (:owners attribution) task-ticket-id)
                    (some unlanded-siblings (:owners attribution))
                    (seq (blocking-for (filter unlanded-siblings (:owners attribution)))))
               (let [blockers (blocking-for (filter unlanded-siblings (:owners attribution)))]
                 {:paths nil
                  :warning (str "land-step: refusing to replay " task-ticket-id
                                " - " path " is shared with unlanded sibling(s) "
                                (str/join "; " (map (fn [{:keys [ticket state reason]}]
                                                      (str ticket " (" (name state) ": " reason ")"))
                                                    blockers))
                                ", and a replayed path is taken whole, so landing it would carry "
                                "the sibling's lines into main (BL-1332/BL-1375)")})

               ;; BL-1389, invariant 1. The question is asked of THIS PATH,
               ;; never of the owner's ticket-level verdict: the two walks
               ;; attribute different sets, so a sibling whose per-sibling set
               ;; happened to be all-landed left `unlanded-siblings` while a
               ;; path credited to it alone was still absent from origin/main -
               ;; and every such path was then kept and rode into the replay
               ;; under the landing ticket's approval (2026-09-04, BL-1367's
               ;; handler and source in BL-1386's replay). A path no owner can
               ;; be SHOWN to have landed is excluded, whatever any owner's
               ;; approval or ticket-level verdict reads.
               (and (seq (:owners attribution))
                    (not (:any-untagged? attribution))
                    (not (contains? (:owners attribution) task-ticket-id))
                    (or
                     ;; The pre-BL-1389 answer, unchanged and asked first: it
                     ;; needs no diff read, and every owner being a known
                     ;; unlanded sibling already settles the path.
                     (every? unlanded-siblings (:owners attribution))
                     ;; BL-1389: only when the ticket-level verdict says the
                     ;; owners have landed is the per-path question asked - and
                     ;; then it is asked of THIS path, because the two walks
                     ;; attribute different sets and the verdict may never have
                     ;; seen this one.
                     (not-any? #(path-landed? % path) (:owners attribution))))
               (recur (rest remaining) acc
                      (conj excluded {:path path :owners (:owners attribution)})
                      passengers)

               :else
               (recur (rest remaining) (conj acc path) excluded
                      ;; Every approved unlanded co-owner of an INCLUDED path
                      ;; rides. A path this ticket does not own is excluded
                      ;; above and boards nobody.
                      (if (contains? (:owners attribution) task-ticket-id)
                        (into passengers (filter unlanded-siblings (:owners attribution)))
                        passengers)))))))
       {:paths nil :warning (str "land-step: could not read the delivered diff " origin-main ".." commit)}))))

(defn land-plan
  "The land step's own decision: {:action :land} when no entanglement is
   present (or the check could not tell - see below); {:action :replay
   :entangled #{...} :own-paths [...]} when a tip-pure rebuild is the
   remedy; {:action :escalate :reason \"...\"} when even the detection
   itself could not be completed - a check that cannot run refuses to bless
   a land, per invariant 2, rather than defaulting to :land.
   task-ticket-id nil (task-name named no ticket) also escalates - nothing
   to compare ancestry against.

   BL-1431 invariant 1: `:origin-main` is an OPTIONAL key. When the caller
   (land_step_cli.bb) already resolved it, that exact value is threaded to
   every reader below and never re-resolved - one land-step invocation
   reads one tip, immune to main moving mid-walk. A direct/test caller that
   omits the key (the pre-existing contract, unchanged) gets it resolved
   once, here, at this function's own entry."
  [{:keys [root commit task-ticket-id] :as opts}]
  (if-not task-ticket-id
    {:action :escalate :reason "land-step: task name names no ticket id"}
    ;; BL-1389: the per-PATH attribution is computed ONCE and feeds both
    ;; questions - which siblings have landed, and which paths may ride. They
    ;; used to be answered from different walks, and a path the per-path walk
    ;; credited to a sibling the per-sibling walk never reported was decided
    ;; against a verdict that had not seen it.
    (let [origin-main (if (contains? opts :origin-main) (:origin-main opts) (origin-main-sha root))
          candidates (when origin-main (ancestry-commits root origin-main commit))
          ;; One read of each sibling's own diffs, shared by the landed/unlanded
          ;; split and by the per-path exclusion below. Each is every commit
          ;; that sibling authored in range, so asking twice doubles the
          ;; slowest part of the land step.
          lines-of (memoize #(when candidates (sibling-own-line-changes root candidates %)))
          ;; Deferred: a land with no entangled sibling never forces it, and
          ;; that is the common case. Forcing it there would add one
          ;; path-scoped walk per delivered path to every clean land.
          attribution (when origin-main
                        (delay (delivered-attribution root origin-main commit)))
          extra-paths-fn (when attribution
                           (fn [sibling]
                             (for [[path a] @attribution
                                   :when (and a (contains? (:owners a) sibling))]
                               path)))
          {:keys [entangled landed unlanded landed-paths warning]}
          (entangled-siblings root commit task-ticket-id extra-paths-fn lines-of origin-main)]
      (cond
        warning {:action :escalate :reason warning}
        (empty? entangled) {:action :land}
        :else
        (let [{:keys [paths warning passengers excluded]}
              (own-paths root commit task-ticket-id unlanded nil nil
                         {:attribution (when attribution @attribution)
                          :path-landed-fn (when origin-main
                                            (sibling-path-landed-fn root origin-main commit lines-of))}
                         origin-main)]
          (if (nil? paths)
            {:action :escalate
             :reason (or warning (str "land-step: could not compute " task-ticket-id "'s own paths to replay"))}
            ;; BL-1375: :passengers are the approved unlanded siblings whose
            ;; lines ride on an included shared path. replay! owes them the
            ;; tree guards before it hands QA a commit to publish.
            {:action :replay :entangled entangled :landed landed :unlanded unlanded
             :landed-paths (or landed-paths {})
             :excluded (or excluded [])
             :own-paths paths :passengers (or passengers #{})}))))))

(defn entanglement-note
  "The text QA sends when replay itself cannot be completed cleanly (BL-1241
   qa_e2e_procedure / QA.prompt step 3: a note to the specifier, priority
   00, never a bounce to the parcel's author) - names every sibling ticket
   that is STILL unlanded, the actionable content invariant 1 requires.
   BL-1272: a sibling whose work is already on origin/main is not an
   adjudication request, so naming it would send the specifier to settle
   something already settled."
  [task-name unlanded]
  (if (seq unlanded)
    (format "%s: entangled tip - sibling ticket(s) %s unlanded as ancestors, tip-pure replay could not complete cleanly; specifier adjudication needed."
            task-name (str/join "," (sort unlanded)))
    (format "%s: entangled tip - every ancestor sibling ticket has already landed, but the tip-pure replay could not complete cleanly; specifier adjudication needed."
            task-name)))

;; ── replay: build the tip-pure commit as a local git object ──────────────
;; Never pushes, never fast-forwards `main`/origin - QA's own land action
;; (Article 1.8) stays the human-observed final step. This only produces
;; the commit for QA to review and then land itself.

(defn- write-tree-from-paths! [root cited-commit paths]
  "Applies each path's content AT cited-commit onto the CURRENT index/
   worktree - `git checkout <cited-commit> -- <path>` per path (also
   handles deletions: a path task-tagged-changed-paths names but no longer
   present at cited-commit is removed). Returns true on success."
  (let [ok (atom true)]
    (doseq [p paths]
      (let [show (git! root "cat-file" "-e" (str cited-commit ":" p))]
        (if (zero? (:exit show))
          (let [res (git! root "checkout" cited-commit "--" p)]
            (when-not (zero? (:exit res)) (reset! ok false)))
          (let [res (git! root "rm" "-q" "--ignore-unmatch" "--" p)]
            (when-not (zero? (:exit res)) (reset! ok false))))))
    @ok))

(defn git-common-dir
  "The repository's real git directory, absolute, as git itself reports it.

   BL-1298: `.git` is a DIRECTORY only in the MAIN checkout. In a linked
   worktree - the only place a pipeline role ever stands - it is a FILE
   holding `gitdir: ...`, so a path built by joining \".git\" onto the root
   names a child of a regular file and `git worktree add` fails outright
   (\"could not create worktree ... off origin/main\", measured 2026-08-30
   landing BL-1295). `--git-common-dir` answers correctly from either
   checkout, and answers the SAME from both, which is what makes the replay
   independent of who invoked it. It is relative to the root git resolved it
   from, so it is absolutized here rather than trusted as given.

   nil signals \"git could not answer\" - the caller refuses rather than
   building a path from a guess, the same fail-closed posture as
   origin-main-sha above."
  [root]
  (let [res (git! root "rev-parse" "--git-common-dir")]
    (when (zero? (:exit res))
      (let [reported (str/trim (:out res))]
        (when (seq reported)
          (str (fs/absolutize (fs/path root reported))))))))

(defn shared-target-root
  "BL-1339: the ONE root a land-approval record belongs at - git-common-dir's
   parent, which answers the same from the main checkout and from any linked
   worktree.

   A pipeline role only ever stands in a linked worktree, so `git rev-parse
   --show-toplevel` (what the CLI resolves) answers `.worktrees/<role>` and a
   record written there reaches no consumer: handoffd's push sweep, the
   babysitter's Article 4.2 sweep and the deploy freshness gate all resolve
   the store from the target root. BL-1334 therefore shipped fully gated and
   inert.

   nil when git cannot answer - the caller refuses rather than guessing, since
   a silent fallback to the caller's directory is precisely this defect."
  [root]
  (when-let [common (git-common-dir root)]
    (str (fs/parent common))))

(defn- append-land-approval! [root c src task-ticket-id]
  (let [dir (fs/path root ".swarmforge" "land-approvals")
        month (subs (str (java.time.Instant/now)) 0 7)
        file (fs/path dir (str month ".jsonl"))
        line (str "{\"at\":\"" (str (java.time.Instant/now)) "\""
                  ",\"ticket\":\"" (or task-ticket-id "") "\""
                  ",\"commit\":\"" c "\""
                  ",\"source\":\"" src "\"}\n")]
    (fs/create-dirs dir)
    ;; append, never truncate - a second land this month must not erase the
    ;; first and stop the predicate approving everything landed earlier.
    (spit (str file) line :append true)
    {:ok? true :file (str file)}))

(defn record-land-approval!
  "BL-1334: record that `commit` (the tip-pure replay this land step is about
   to publish onto main) stands in for `source` - the QA-approved commit the
   parcel was cited on.

   WHY A RECORD AND NOT A REF BUMP. The land step publishes a NEW commit to
   main and nothing advances swarmforge-QA, so at the instant QA's own
   approved work lands it is not in the QA ref's ancestry and every
   ancestry-based consumer reads main as carrying unapproved pipeline code
   until some unrelated later merge closes the window. The other shape - have
   this tool advance swarmforge-QA - would hand a script write access to the
   ref that DEFINES approval, and BL-952 is on record that reachability from
   that ref is not approval. Recording the mapping leaves the ref semantics
   untouched; is_qa_ancestor.sh resolves it, and grants nothing unless the
   SOURCE is itself approved, so approval cannot spread to whatever happens
   to be written here.

   Appends one JSON line to <shared-target-root>/.swarmforge/land-approvals/<YYYY-MM>.jsonl.
   BL-1339: the SHARED root, not the caller's - see shared-target-root above
   for why the caller's own worktree reaches no reader.

   Refuses (and writes nothing) when either sha is missing: the predicate
   reads a record with no source as corrupt and fails CLOSED, so writing one
   would jam the gate rather than open it. Returns {:ok? bool} and never
   throws - a land must not die because its bookkeeping did, and an
   unrecorded land degrades to exactly today's behaviour (the override),
   never to a wrong approval."
  [{:keys [root commit source task-ticket-id]}]
  (let [short (fn [sha] (when (and sha (>= (count (str sha)) 7))
                          (subs (str sha) 0 (min 10 (count (str sha))))))
        c (short commit)
        src (short source)]
    (if (or (nil? c) (nil? src))
      {:ok? false :reason "land-approval record needs both a replay commit and an approved source"}
      (try
        ;; BL-1339 invariant 1: exactly ONE location, the shared target root,
        ;; whichever checkout the land step ran from. Invariant 3: an
        ;; unresolvable root writes nothing and says so - never a guessed path,
        ;; and the land still succeeds on the sanctioned override.
        (if-let [shared (shared-target-root root)]
          (append-land-approval! shared c src task-ticket-id)
          {:ok? false
           :reason (str "land-approval record not written: the shared target root could not be resolved from "
                        root " - refusing to guess a path (BL-1339)")})
        (catch Exception e
          {:ok? false :reason (str "land-approval record could not be written: " (.getMessage e))})))))


;; ── BL-1375 invariant 2: the replayed tree is guarded BEFORE publish ─────
;; The human's rider on the option-1 ruling: "approved" means approved to be
;; WORKED, not landed. A passenger's shared-path content may ride into main
;; only if the replayed tree is SELF-CONSISTENT there. This is the BL-1324
;; shape - on 2026-09-02 an approved, mid-pipeline sibling's require(...)
;; line rode into specs/pipeline/steps/index.js ahead of the handler file it
;; requires, and the registration guard then refused every role's commit on
;; main until a human adjudicated. The narrowing above must not re-enable it.
;;
;; Only TREE guards belong here. The rest of run_commit_guards.sh's chain
;; reads the git INDEX at commit time and has no question to ask of a tree
;; that already exists; check_feature_handler_registration.sh reads the tree,
;; which is why the rider names it. The list is a def so a second tree guard
;; is one entry, never a second call site.
;;
;; BL-1242/BL-1252: a chain of N independent guards must not short-circuit on
;; the first failure - every guard runs and every refusal is reported in one
;; answer (Article 4.4's shape in a gate). Running them as separate processes
;; and collecting each status individually is that rule satisfied; no guard's
;; exit aborts another.

(def ^:private replayed-tree-guards
  [{:script "check_feature_handler_registration.sh"
    :why "a feature file whose step handler is not registered on the replayed tree (BL-1303/BL-1324)"}
   ;; BL-1385: registration is not loadability. Since BL-1371 a handler
   ;; registers by EXISTING, and the registry requires every discovered
   ;; handler eagerly - so one handler whose require names a module living
   ;; only on an unlanded parcel makes EVERY acceptance run throw. The
   ;; registration guard above checks a handler is registered and reachable
   ;; and never loads one, which is why a93aa4a18f landed on 2026-09-04 with
   ;; 947 handlers, 1 unloadable, 0 features runnable.
   {:script "check_handler_module_graph.sh"
    :why "a discovered step handler whose module graph does not resolve on the replayed tree (BL-1385)"}
   ;; BL-1395: a handler graph is not a Babashka script. SCI analyses each defn
   ;; eagerly, so a forward reference or a runtime require in a .bb fails at
   ;; LOAD - three reached main in eight days, the last crash-looping the live
   ;; daemon from 18:20Z on 2026-09-04. A hand-built land that skips the replay
   ;; meets this guard through run_commit_guards.sh; a replay meets it here.
   {:script "check_bb_scripts_load.sh"
    :why "a Babashka script on the replayed tree that fails SCI analysis, or a handoffd that will not boot (BL-1395)"}])

(defn run-replayed-tree-guards
  "Runs every tree guard against `tree-root` and returns a vector of refusal
   strings - empty means every guard passed.

   `--assume-main` is passed because the replay stands on a scratch branch
   while being exactly the tree about to become main's tip; without it the
   guard's own branch gate exits 0 and collects a pass it never performed.

   A guard that cannot be RUN is a refusal, not a skip: an uncompiled checker
   or a missing script would otherwise silently re-open the very window this
   invariant closes."
  [tree-root]
  (->> replayed-tree-guards
       (keep (fn [{:keys [script why]}]
               (let [path (str (fs/path script-dir script))]
                 (if-not (fs/exists? path)
                   (str script " could not be run against the replayed tree: " path " is missing")
                   (let [res (daemon-cycle-guard-lib/sh! "bash" path (str tree-root) "--assume-main")]
                     (when-not (zero? (:exit res))
                       (str script " refused the replayed tree (" why "): "
                            (str/trim (str (:err res) " " (:out res))))))))))
       vec))

(defn replay!
  "Builds a tip-pure commit for task-ticket-id's own-paths, on top of
   origin/main, in a DEDICATED linked worktree
   (<git-common-dir>/land-replay-worktrees/<task-ticket-id>-<short
   cited-commit> - git's own answer for where the git directory is, which is
   NOT <root>/.git in a linked worktree (BL-1298), off
   a scratch branch land-replay/<task-ticket-id>-<short cited-commit>) -
   never a checkout in the caller's own worktree, which may be mid-work
   with real uncommitted changes QA cannot risk disturbing. Returns
   {:success true :commit sha :branch name} or {:success false :reason
   \"...\"} - never throws. The scratch worktree is always removed before
   returning, success or failure alike; the branch itself survives success
   (QA's own land action reads it) and is deleted on EVERY failure - including
   a failure to create the checkout, which `worktree add -b` reaches only
   after it has already made the branch (BL-1298).

   BL-1431: `:origin-main` is an optional key, the same threading contract
   as land-plan's - land_step_cli.bb passes the SAME sha it gave land-plan,
   so the worktree this builds is created off the exact tip own-paths was
   decided against, not a tip main may have moved to since."
  [{:keys [root commit task-ticket-id own-paths passengers tree-guards-fn] :as opts}]
  (let [origin-main (if (contains? opts :origin-main) (:origin-main opts) (origin-main-sha root))
        common-dir (git-common-dir root)
        run-guards (or tree-guards-fn (fn [tree-root _] (run-replayed-tree-guards tree-root)))]
    (cond
      (nil? origin-main)
      {:success false :reason "land-step replay: could not resolve origin/main"}

      (nil? common-dir)
      {:success false :reason (str "land-step replay: could not resolve the git directory of " root)}

      :else
      (let [branch (str "land-replay/" task-ticket-id "-" (subs commit 0 (min 10 (count commit))))
            scratch (str (fs/path common-dir "land-replay-worktrees" (str task-ticket-id "-" (subs commit 0 (min 10 (count commit))))))
            cleanup! (fn []
                       (git! root "worktree" "remove" "-f" scratch)
                       (fs/delete-tree scratch {:force true}))
            ;; `worktree add -b` creates the branch even when it then fails to
            ;; make the checkout, so every failure path deletes it - including
            ;; this one, which used to return early and leak it. Deleting a
            ;; branch that was never created is not itself a failure: git!
            ;; reports a status and the status is deliberately ignored.
            drop-branch! (fn [] (git! root "branch" "-q" "-D" branch))
            create (git! root "worktree" "add" "-q" "-b" branch scratch origin-main)]
        (if-not (zero? (:exit create))
          (do (cleanup!)
              (drop-branch!)
              {:success false :reason (str "land-step replay: could not create worktree " scratch " off origin/main")})
          (let [applied? (write-tree-from-paths! scratch commit own-paths)]
            (if-not applied?
              (do (cleanup!)
                  (drop-branch!)
                  {:success false :reason (str "land-step replay: could not apply " task-ticket-id "'s own paths from " commit)})
              (let [commit-res (git! scratch "-c" "user.email=t@t" "-c" "user.name=t"
                                      "commit" "-q" "-m" (str task-ticket-id ": tip-pure replay onto origin/main (BL-1241 land-step remedy)"))]
                (if-not (zero? (:exit commit-res))
                  (do (cleanup!)
                      (drop-branch!)
                      {:success false :reason (str "land-step replay: nothing to commit for " task-ticket-id " - own-paths identical to origin/main")})
                  (let [sha (str/trim (:out (git! scratch "rev-parse" "HEAD")))
                        ;; BL-1375 invariant 2. Run ONLY when a passenger's
                        ;; lines actually ride: with nothing riding, the tree
                        ;; is this ticket's own content on origin/main, and a
                        ;; main that is already inconsistent would otherwise
                        ;; start refusing every land - a second deadlock in
                        ;; place of the one this ticket dissolves.
                        refusals (if (seq passengers) (run-guards scratch passengers) [])]
                    (cleanup!)
                    (if (seq refusals)
                      (do (drop-branch!)
                          {:success false
                           :reason (str "land-step replay: refusing to publish " task-ticket-id
                                        " - the replayed tree is not self-consistent with passenger sibling(s) "
                                        (str/join "," (sort passengers))
                                        " riding on a shared path (BL-1375 invariant 2 / BL-1324): "
                                        (str/join "; " refusals))})
                      {:success true :commit sha :branch branch :passengers (set passengers)})))))))))))
