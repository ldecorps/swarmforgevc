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
            [cheshire.core :as json]
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

;; ── BL-1544: a subject that leads with a ticket id vs. one that merely
;; mentions one first ──────────────────────────────────────────────────────
;;
;; extract-ticket-id (pipeline-stage-lib, untouched, BL-897/BL-488) resolves
;; the FIRST id-shaped token ANYWHERE in a subject's text - right for the
;; "TICKET: description" convention, where that first token really is the
;; subject's own leading id, but silently right for the WRONG reason when a
;; subject merely mentions a ticket id first within ordinary prose: "Update
;; BL-967 stall-diagnosis how-to for BL-1525's chokepoint fold" (a89a03ee45,
;; 2026-09-11) names BL-967 as if it led, because it is the first token
;; found, when in fact neither id leads this subject at all - the subject
;; starts with the word "Update".
;;
;; `leading-ticket-id` asks the stricter, POSITIONAL question: does the
;; subject's own structure place an id at the very start of the line -
;; either bare ("BL-1227: ...") or after one of this codebase's own
;; short verb-prefixed bookkeeping subjects. Measured against `git log
;; origin/main --format=%s -500` (backlog/evidence/BL-1544-coder-
;; 20260912.md): of 500 subjects, "Close", "Promote" and "Approve" each
;; lead a ticket id dozens of times (the coordinator's/specifier's own
;; promote/close/approve bookkeeping commits); exactly ONE bare-word-then-id
;; subject occurs outside that set - "Update BL-967 ..." above, this
;; ticket's own motivating incident - so "Update" (and every other verb) is
;; deliberately left OUT of the allowlist rather than widened to swallow it
;; back in. Of the 500, only 4 name more than one ticket id and lead with
;; none (recorded in the evidence file).
(def ^:private leading-verb-prefixes ["close" "promote" "approve"])

(def ^:private leading-ticket-id-pattern
  (re-pattern (str "(?i)^\\s*(?:(?:" (str/join "|" leading-verb-prefixes) ")\\s+)?("
                   (str/join "|" pipeline-stage-lib/known-ticket-prefixes) ")-?(\\d+)\\b")))

(defn- leading-ticket-id
  "The ticket id `subject`'s own leading structure names at the very start
   of the line, or nil when nothing sits there. Distinct from extract-
   ticket-id's own contract (untouched): that one asks 'what id is named
   first in the text'; this one asks 'does the subject's own structure
   position an id at the start' - the two agree whenever the answer here is
   non-nil (nothing can occur earlier in the string than position 0), and
   this one alone answers nil for a subject that merely mentions an id
   first within ordinary prose."
  [subject]
  (when subject
    (when-let [[_ prefix digits] (re-find leading-ticket-id-pattern subject)]
      (str/upper-case (str prefix "-" digits)))))

(defn- subject-attribution
  "BL-1544. {:ids #{...} :ambiguous? bool} for one commit subject - the
   ownership contribution `path-owner-tickets` credits it with:

   - No id named at all: {:ids #{} :ambiguous? false} (untagged, same as
     commit-ticket-id returning nil).
   - The subject names more than one id and its own leading structure names
     NONE of them: AMBIGUOUS - {:ids (every named id) :ambiguous? true}, so
     every named id rides as an owner (the passenger/blocking-for/BL-1481
     content machinery still runs for each); own-paths, not this function,
     decides what an ambiguous path means for a land.
   - Otherwise (one id named, or several but the subject leads with one of
     them - e.g. \"BL-1524, BL-1525, BL-1526: mint ...\" leads with
     BL-1524 and is that id's alone, exactly like a single-id subject):
     {:ids #{that-one-id} :ambiguous? false}, byte-identical to what
     commit-ticket-id already returns for the same subject - the two must
     agree (task_scope_gate_lib.bb's shape-2 rule is this same leading-id
     rule and is unchanged)."
  [subject]
  (let [named (pipeline-stage-lib/extract-ticket-ids subject)
        leading (leading-ticket-id subject)]
    (cond
      (empty? named) {:ids #{} :ambiguous? false}
      (and (> (count named) 1) (nil? leading)) {:ids (set named) :ambiguous? true}
      leading {:ids #{leading} :ambiguous? false}
      :else {:ids (set named) :ambiguous? false})))

(defn- commit-subject-attribution
  "subject-attribution, read from git for `commit`. An unreadable commit
   reads as fully untagged - same fail-open posture commit-ticket-id takes
   for the identical case."
  [root commit]
  (subject-attribution (commit-subject root commit)))

;; nil (never []) signals "the walk itself failed" - same fail-open
;; contract task_scope_gate_lib.bb's own task-tagged-changed-paths uses.
;; (That contract is the nil-vs-empty one, which BL-1297's :delivered /
;; :authored split left untouched: both semantics still answer nil only when
;; the walk could not run.)
(defn- ancestry-commits
  "Every commit reachable from `commit` and not from `base` (nor from
   `exclude-also`, when given and distinct from `base`) - the FULL
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
   reproduce what the parcel put on the branch.

   BL-1446: `exclude-also` lets a caller bound the walk to `base` (a
   parcel-scoped boundary, e.g. its last hop) while STILL guaranteeing no
   commit already reachable from `exclude-also` (origin/main) is ever
   returned as a candidate - a routine post-hop `git merge origin/main`
   pulls already-landed history into `base..commit` that `base` alone
   cannot exclude, since that history postdates `base` but predates
   nothing on the parcel's own line (invariant 1)."
  ([root base commit] (ancestry-commits root base commit nil))
  ([root base commit exclude-also]
   (let [args (cond-> ["rev-list" commit (str "^" base)]
                (and exclude-also (not= exclude-also base)) (conj (str "^" exclude-also)))
         res (apply git! root args)]
     (when (zero? (:exit res))
       (remove str/blank? (str/split-lines (:out res)))))))

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
   entanglement from silence).

   BL-1432: `walk-base` is an OPTIONAL trailing parameter (defaults to
   `origin-main`, the pre-existing behavior) - the commit RANGE walked for
   candidates is bounded to it, while `origin-main` stays the tree every
   landed/unlanded verdict is read against (a narrower walk must never
   change what counts as landed, only how many commits are inspected to
   find a sibling - invariant 2).

   BL-1446: the candidate range also always excludes anything already
   reachable from `origin-main`, whatever `walk-base` is - a routine
   post-hop sync (`git merge origin/main`) pulls already-landed history
   into `walk-base..commit` that a bound to `walk-base` alone cannot
   exclude, and a landed commit is never a candidate sibling regardless of
   how it entered the range (invariant 1)."
  ([root commit task-ticket-id]
   (entangled-siblings root commit task-ticket-id nil))
  ([root commit task-ticket-id extra-paths-fn]
   (entangled-siblings root commit task-ticket-id extra-paths-fn nil))
  ([root commit task-ticket-id extra-paths-fn lines-fn]
   ;; BL-1431: this arity is a direct/standalone caller's own entry - it
   ;; resolves origin/main ONCE here and threads it, never re-resolving.
   (entangled-siblings root commit task-ticket-id extra-paths-fn lines-fn (origin-main-sha root)))
  ([root commit task-ticket-id extra-paths-fn lines-fn origin-main]
   (entangled-siblings root commit task-ticket-id extra-paths-fn lines-fn origin-main origin-main))
  ([root commit task-ticket-id extra-paths-fn lines-fn origin-main walk-base]
   ;; BL-1431: origin-main is now ALWAYS a parameter, never resolved by name
   ;; in this function body - a caller with its own already-resolved tip
   ;; (land-plan) passes it straight through, so one land-step invocation
   ;; reads one tip everywhere, immune to main moving mid-walk.
   (if-not origin-main
     {:entangled nil :warning "land-step: origin/main could not be resolved"}
     (let [walk-base (or walk-base origin-main)
           candidates (ancestry-commits root walk-base commit origin-main)]
       (if (nil? candidates)
         {:entangled nil :warning (str "land-step: could not read the commit range " walk-base ".." commit)}
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

;; ── BL-1466: a bounced, not-yet-re-fixed sibling never rides ─────────────
;; ticket-approval-state (BL-1375) reads only the backlog folder and
;; human_approval - a QA bounce (.swarmforge/bounces/<YYYY-MM>.jsonl,
;; record-bounce.js/record-qa-bounce.js) changes neither, so a sibling QA
;; bounced an hour ago still reads :approved. Until BL-1438's re-point,
;; QA's own BL-490/495 revert kept the bounced content out of its tree by
;; hand; the re-point (`git reset --hard origin/main`) drops that revert
;; with everything else local-only, so this is the one remaining check.

(defn- bounces-dir [root]
  (str (fs/path root ".swarmforge" "bounces")))

;; Only files still named *.jsonl - a quarantined corrupt file (renamed
;; with a .corrupt-quarantine suffix, the live store's own convention) is
;; deliberately already excluded, not re-detected as corruption here.
(defn- bounce-jsonl-files [root]
  (let [dir (bounces-dir root)]
    (when (fs/exists? dir)
      (->> (fs/list-dir dir)
           (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".jsonl")))))))

;; BL-1470: record-bounce.js (bounceStore.ts) writes to the SHARED TARGET
;; ROOT - the same root BL-1339 gave the land-approval store, git-common-
;; dir's parent (shared-target-root above) - never to whatever root a
;; pipeline role's own worktree resolves. A record filed under the
;; caller's own root (however that came to exist) still counts: this is a
;; union, never a narrowing. Falls back to [root] alone when git cannot
;; resolve a shared root - shared-target-root already fails closed to nil
;; for that case, mirroring origin-main-sha's own fallback posture.
(defn resolve-bounce-store-roots [root]
  (let [shared (shared-target-root root)]
    (distinct (remove nil? [shared (str root)]))))

;; Every bounce record naming `ticket-id` in ONE root, or nil when a file
;; exists but could not be read/parsed. No bounces directory at all in
;; THIS root is a real "nothing here" answer (`[]`) - the caller decides
;; whether that is "never bounced" only after checking every root.
(defn- bounce-records-in-root [root ticket-id]
  (let [files (bounce-jsonl-files root)]
    (if (nil? files)
      []
      (let [parsed (for [f files
                          line (str/split-lines (slurp (str f)))
                          :when (not (str/blank? line))]
                     (try
                       (json/parse-string line true)
                       (catch Exception _ ::unreadable)))]
        (when-not (some #(= ::unreadable %) parsed)
          (->> parsed
               (filter #(= ticket-id (:ticket %)))))))))

;; Every bounce record naming `ticket-id` across ALL of `store-roots`
;; (defaults to resolve-bounce-store-roots, above - the shared target root
;; and, when distinct, the caller's own root), newest `:at` first, or nil
;; when ANY root's store could not be read - fail closed (invariant 2): a
;; partially-read bounce history at either root must never look like a
;; clean one. No bounces directory in ANY root is the real "never
;; bounced" answer (`[]`). `store-roots` is the injection seam BL-1470's
;; runner fixtures use to drive a real linked worktree without relying on
;; this function's own git resolution.
(defn- bounce-records-for
  ([root ticket-id] (bounce-records-for root ticket-id nil))
  ([root ticket-id store-roots]
   (let [roots (or store-roots (resolve-bounce-store-roots root))
         per-root (map #(bounce-records-in-root % ticket-id) roots)]
     (if (some nil? per-root)
       nil
       (->> (apply concat per-root)
            (sort-by :at)
            reverse)))))

;; true/false on a clean read, nil (undeterminable) on anything else -
;; `git merge-base --is-ancestor` exits 0/1 for a clean yes/no and >1 for
;; an unreadable ref, which must never be read as "not an ancestor".
(defn- git-is-ancestor? [root ancestor descendant]
  (case (:exit (git! root "merge-base" "--is-ancestor" ancestor descendant))
    0 true
    1 false
    nil))

(defn- latest-handoff-commit [root ticket-id]
  (some-> (salvage-lib/latest-item-handoffs root ticket-id)
          first
          (salvage-lib/header-field "commit")))

(defn bounce-blocking-state
  "nil when the sibling's bounce history changes nothing BL-1375's own
   approval state already decided: no bounce record at all, the latest
   one's commit no longer reachable from `commit` (whatever carried it
   forward is not on this tip), or a later handoff for the sibling cites a
   commit descending from the bounced one (re-fixed). Otherwise
   `{:state :bounced :blocking? true :reason \"...\"}` naming the bounce
   and its commit, or `{:state :unreadable :blocking? true :reason
   \"...\"}` when the store or the ancestry check itself could not be
   read - fail closed, never a silent pass (invariant 2).

   BL-1470: the bounce history is read from the shared target root
   record-bounce.js actually writes to, unioned with the caller's own root
   - see resolve-bounce-store-roots above - so the answer never depends on
   which checkout asked. `store-roots` is an optional injection seam for
   tests; production callers omit it and get the real resolution."
  ([root ticket-id commit] (bounce-blocking-state root ticket-id commit nil))
  ([root ticket-id commit store-roots]
  (let [records (bounce-records-for root ticket-id store-roots)]
    (cond
      (nil? records)
      {:state :unreadable :blocking? true
       :reason (str ticket-id "'s bounce history could not be read")}

      (empty? records)
      nil

      :else
      (let [latest (first records)
            bounce-commit (:commit latest)
            reachable (git-is-ancestor? root bounce-commit commit)]
        (cond
          (nil? reachable)
          {:state :unreadable :blocking? true
           :reason (str "could not tell whether " ticket-id "'s bounced commit "
                        bounce-commit " is an ancestor of the tip")}

          (not reachable)
          nil

          :else
          (let [handoff-commit (latest-handoff-commit root ticket-id)
                refixed? (and handoff-commit
                              (not= handoff-commit bounce-commit)
                              (true? (git-is-ancestor? root bounce-commit handoff-commit)))]
            (if refixed?
              nil
              {:state :bounced :blocking? true
               :reason (str ticket-id " bounced " (:at latest) " at " bounce-commit ", not re-fixed")}))))))))

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

;; ── BL-1481: does a blocking sibling's CONTENT actually differ, or only its
;; commit history? blocking-siblings (above) answers by commit-range
;; attribution alone - which shares Specification.MD wrote every touching
;; commit's ticket tag, but never asks whether the tip's version of the path
;; actually differs from origin/main in a line the sibling owns. On
;; 2026-09-07, BL-1470's land was refused because bounced BL-1348 shared
;; Specification.MD by that reading, even though every line BL-1348 ever
;; added to that file was already on origin/main (landed there under a
;; different sha by BL-1473's own whole-path land).

(defn path-content-blocked-ids
  "Which of `candidate-ids` (already known to be commit-attribution
   co-owners of `path`, per `path-owner-tickets`) really still owe the path
   content not yet on origin/main - the SAME landed/unlanded question
   `sibling-path-landed-fn` (BL-1389) already answers for a sibling this
   ticket does not itself co-own, asked here of every commit-attribution
   blocker on a path this ticket DOES co-own too (BL-1481).

   Each id's own verdict comes from `sibling-path-verdict`, scored against
   THIS path's real lines at origin-main and at the tip, over that id's own
   tagged line changes (merges excluded - `sibling-own-line-changes`'s own
   posture, unchanged): `:landed` clears it, the shape scenario 01 names
   (every surviving line the id's own commits contributed is already on
   origin/main under whatever sha put it there). `:unlanded` or `:vacuous`
   still blocks it - UNCHANGED from before this ticket. A merge that
   resolved a real conflict between two blocking co-owners (BL-1374/05)
   leaves each co-owner `:unlanded` there (neither's own line survives to
   the tip, and neither the surviving addition nor removal is on
   origin/main either) - this narrowing changes nothing for it. The only
   new outcome is a blocker whose own lines truly already match
   origin/main.

   Returns the subset of `candidate-ids` still blocking. #{} is a real,
   positive answer: every one of them is `:landed` on this path - content-
   clear, invariant 2's own shape.

   nil when `origin-main`'s or the tip's blob could not be read, or any
   candidate's own line changes could not be read - the caller fails
   closed on nil (invariant 3): a content check that cannot complete never
   narrows a refusal, it stays exactly as blocking as the commit-
   attribution check alone already found.

   `lines-fn` (candidate id -> {path {:added :removed}}) is injected so a
   caller can reuse the SAME per-sibling read `land-plan` already computes
   for `sibling-path-landed-fn` (never a second walk over the same
   commits), and so the unreadable row is drivable in a test without
   corrupting a repository. Defaults to the real `sibling-own-line-changes`
   over `ancestry-commits root origin-main commit`."
  ([root origin-main commit path candidate-ids]
   (path-content-blocked-ids root origin-main commit path candidate-ids nil))
  ([root origin-main commit path candidate-ids lines-fn]
   (let [main-lines (blob-lines root origin-main path)
         tip-lines (blob-lines root commit path)]
     (if (or (nil? main-lines) (nil? tip-lines))
       nil
       (let [candidates (delay (ancestry-commits root origin-main commit))
             lines-fn (or lines-fn #(when @candidates (sibling-own-line-changes root @candidates %)))]
         (loop [ids (sort candidate-ids) blocked #{}]
           (if (empty? ids)
             blocked
             (let [id (first ids)
                   changes (lines-fn id)]
               (if (nil? changes)
                 nil
                 (let [verdict (sibling-path-verdict {:changes (get changes path {})
                                                       :main-lines main-lines :tip-lines tip-lines})]
                   (recur (rest ids) (cond-> blocked (not= :landed verdict) (conj id)))))))))))))

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
   `path`, run through this file's own subject-attribution (BL-1544: single-
   owner via commit-ticket-id's contract, or every named id when a subject
   is ambiguous - see subject-attribution's own docstring).
   `commits-fn` is injected (defaults to the real git walk) so the unreadable
   row is drivable in a test without corrupting a repository, the same
   posture `landed-siblings`' `paths-fn` already takes.

   nil propagates a read failure (never a silent 'no attribution'). On a
   successful read, returns {:owners #{...} :any-untagged? bool
   :any-ambiguous? bool :ambiguous [{:commit :ids} ...]}: `:owners`
   is the set of ticket ids named by a touching commit's subject (#{} is a
   real answer - every touching commit named no ticket at all, positive
   information, not blindness); `:any-untagged?` is true when at least one
   touching commit's subject named no ticket; `:any-ambiguous?` and
   `:ambiguous` (BL-1544) report a touching commit whose subject names more
   than one ticket id and leads with none - own-paths, not this function,
   decides what that means for the land.

   BL-1315 hardener finding: an untagged touch used to contribute nothing to
   `:owners`, making it indistinguishable from 'no commit touched this path'
   - so a path touched by BOTH an unlanded sibling's tagged commit and a
   later untagged own-chain commit read as 'every owner is the unlanded
   sibling' and was wrongly excluded. `:any-untagged?` lets the caller tell
   the two apart and keep the path when an untagged touch's contribution is
   unaccounted for (invariant 1).

   BL-1472: a revert or reapply commit (task-scope-gate-lib/revert-subject?
   - the same anchored-quote predicate BL-1295's send-time gate already
   reuses, never a second regex) contributes NEITHER an owner NOR an
   untagged touch of its own - it is skipped entirely, as if it had never
   touched the path. The commit it undoes or redoes is still in `commits`
   (the same path-scoped walk found it too) and attributes the path on its
   own terms. Without this, a bounce revert plus its reapply on a reviewing
   branch - both untagged - read as an untagged touch on every path the
   reverted merge carried, and own-paths then kept another ticket's
   bounced, unapproved content as the landing ticket's own (live 2026-09-07,
   backlog/evidence/BL-1463-QA-followup-two-land-step-defects-20260907.md
   D1: BL-1348's ruling-B code and tests rode into BL-1463's own-path set
   this way)."
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
                                (cond
                                  ;; BL-1472: a revert/reapply is ALWAYS a
                                  ;; single-parent commit (git revert never
                                  ;; produces a merge, even reverting one via
                                  ;; -m 1), so this check runs before, and
                                  ;; independently of, merge-commit? below.
                                  (task-scope-gate-lib/revert-subject? (commit-subject root c))
                                  acc

                                  (not (merge-commit? root c))
                                  (conj acc c)

                                  :else
                                  (if-let [wrote (merge-authored-paths* root c)]
                                    (cond-> acc (contains? wrote path) (conj c))
                                    ;; unreadable combined diff: blindness, not
                                    ;; "the merge wrote nothing"
                                    (reduced nil))))
                              []
                              commits)]
      (when attributing
        (let [per-commit (map (fn [c] (assoc (commit-subject-attribution root c) :commit c)) attributing)]
          {:owners (into #{} (mapcat :ids per-commit))
           :any-untagged? (boolean (some #(empty? (:ids %)) per-commit))
           ;; BL-1544: true when at least one attributing commit's subject
           ;; names more than one ticket id and leads with none of them.
           ;; `:ambiguous` carries the {:commit :ids} detail for each such
           ;; commit so own-paths' refusal can name it.
           :any-ambiguous? (boolean (some :ambiguous? per-commit))
           :ambiguous (into [] (comp (filter :ambiguous?) (map #(select-keys % [:commit :ids])))
                            per-commit)})))))

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

(defn- own-range-touched-paths
  "BL-1473. Every path some commit in the parcel's own range
   (`origin-main..commit`) actually touched - added, changed or deleted -
   restricting `full-delivered-paths`' two-tree diff to what the parcel
   itself is responsible for.

   A two-tree diff against origin/main also lists (a) every path
   origin/main gained after the branch forked, absent at the tip and so
   read as this ticket's deletion, (b) every path origin/main deleted
   since, present at the tip and so read as a resurrection, and (c) every
   path origin/main CHANGED since, still at its pre-fork content at the
   tip and so replayed as a silent reversion (BL-1461's replay 04049f4bb2
   erased a topic-record message this way, 2026-09-07). None of the three
   was touched by any commit of the parcel's own; intersecting against
   this set drops all three.

   Computed as `git diff --name-only <merge-base origin-main commit>
   commit` - equivalent to the union of every own-range commit's own
   changed paths (merges included via each parent, so a passenger ride or
   an early sync merge still names the path, exactly what BL-1315 needs),
   but one two-tree diff rather than one per commit.

   nil (never #{}) on an unreadable merge-base or diff - this file's
   fail-open convention throughout; the caller refuses rather than reading
   blindness as \"the parcel touched nothing\"."
  [root origin-main commit]
  (let [base-res (git! root "merge-base" origin-main commit)]
    (when (zero? (:exit base-res))
      (let [base (str/trim (:out base-res))
            diff-res (git! root "diff" "--name-only" base commit)]
        (when (zero? (:exit diff-res))
          (into #{} (remove str/blank? (str/split-lines (:out diff-res)))))))))

(defn own-paths
  "This ticket's own changed paths since origin/main - the tip-pure replay
   content (BL-1241's remedy (b)).

   BL-1315: based on the FULL origin-main..commit diff (`full-delivered-
   paths` above), not the tagged merge's first-parent :delivered diff - see
   that function's docstring for why the old base silently dropped content.
   BL-1473: that diff is then restricted to `own-range-touched-paths` -
   paths some commit in the parcel's own range actually touched - before
   anything else is decided, so a path neither this ticket nor any sibling
   ever touched (main gained, deleted or changed it after the fork) never
   reaches the exclusion logic below at all, whichever way that logic would
   have decided it. A path is then excluded only on POSITIVE attribution to
   a ticket in `unlanded-siblings` and no other id (this ticket's invariant
   2): never the landed ticket's own path (even one no commit in range tags
   with its id - invariant 1, scenario 06), and never a path attributed to
   nobody at all (absence is not evidence, same posture `sibling-landed?`
   already takes one door up).

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
   (own-paths root commit task-ticket-id unlanded-siblings commits-fn approval-fn opts origin-main origin-main))
  ;; BL-1432 attempted to bound the delivered-diff read (`full-delivered-
  ;; paths`) to `walk-base` (the parcel's last hop) instead of the whole
  ;; origin/main..tip range - BL-1446: that silently dropped every hop's
  ;; work before the last one from a replay (a replay must carry the
  ;; PARCEL'S WHOLE contribution, this function's own docstring above:
  ;; "since origin/main"). `walk-base` is accepted for arity/call-site
  ;; compatibility with `land-plan` but is never used as the diff
  ;; boundary here - only `origin-main` is, exactly as before BL-1432.
  ([root commit task-ticket-id unlanded-siblings commits-fn approval-fn opts origin-main walk-base]
   (if-not origin-main
     {:paths nil :warning "land-step: origin/main could not be resolved"}
     (if-let [delivered-all (full-delivered-paths root origin-main commit)]
       ;; BL-1473: restrict the two-tree diff to what the parcel's own range
       ;; actually touched, BEFORE any sibling-attribution decision runs - a
       ;; path neither this ticket nor any sibling ever touched is not this
       ;; ticket's to deliver, whatever its (empty) attribution would
       ;; otherwise have let through.
       (if-let [touched (own-range-touched-paths root origin-main commit)]
       (let [delivered (filterv touched delivered-all)
             ;; BL-1375: memoized so N shared paths read one sibling's ticket file
             ;; once, and so every path in one run answers from the same read.
             ;; BL-1431: when the caller supplied no approval-fn, the default reads
             ;; ticket-approval-state with THIS call's already-resolved origin-main
             ;; instead of letting it resolve a second, potentially different, tip.
             ;; BL-1466: composed with the bounce check here - the one place this
             ;; function and blocking-siblings both read a sibling's state from -
             ;; so a bounce not yet re-fixed blocks for every purpose BL-1375's
             ;; approval state serves, without a second approval-reading path.
             approval-fn (or approval-fn
                              (fn [id]
                                (let [base (ticket-approval-state root id origin-main)]
                                  (if (:blocking? base)
                                    base
                                    (or (bounce-blocking-state root id commit) base)))))
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
        (loop [remaining delivered acc [] excluded [] passengers #{} content-clear []]
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
             ;; BL-1481: :content-clear names every {:path :sibling} pair a
             ;; commit-attribution blocker was cleared of by the content
             ;; check - the report line QA gets instead of having to diff the
             ;; replayed tip by hand to see why a bounced sibling's path
             ;; still rode.
             {:paths acc :warning nil :passengers passengers :excluded excluded
              :content-clear content-clear})
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
               ;; BL-1481: commit-range attribution alone over-refuses when a
               ;; blocking sibling's actual lines already MATCH origin/main
               ;; (landed some other way, under a different sha - BL-1470's
               ;; own Specification.MD case, 2026-09-07). The content check
               ;; runs ONLY here, after blocking-for already found a blocker,
               ;; so a clean land's cheap attribution-only path is untouched.
               ;; Do NOT relax this for a sibling whose approval state is
               ;; unknown or unreadable - `blockers` already excludes any
               ;; sibling that is not blocking.
               (let [blockers (blocking-for (filter unlanded-siblings (:owners attribution)))
                     blocker-ids (into #{} (map :ticket blockers))
                     content-blocked ((or (:content-blocked-fn opts)
                                           (fn [p ids] (path-content-blocked-ids root origin-main commit p ids)))
                                       path blocker-ids)]
                 (cond
                   (nil? content-blocked)
                   {:paths nil
                    :warning (str "land-step: refusing to replay " task-ticket-id
                                  " - " path "'s content versus origin/main could not be "
                                  "attributed for shared sibling(s) "
                                  (str/join "," (sort blocker-ids))
                                  " (BL-1481: an unreadable content attribution fails closed, "
                                  "same as the commit-attribution refusal it replaces)")}

                   (seq content-blocked)
                   {:paths nil
                    :warning (str "land-step: refusing to replay " task-ticket-id
                                  " - " path " is shared with unlanded sibling(s) "
                                  (str/join "; " (map (fn [{:keys [ticket state reason]}]
                                                        (str ticket " (" (name state) ": " reason ")"))
                                                      (filter #(content-blocked (:ticket %)) blockers)))
                                  ", and the tip's content differs from origin/main in a line "
                                  "attributable to the sibling, so a replayed path is taken whole "
                                  "and would carry it into main (BL-1332/BL-1375, content-checked "
                                  "per BL-1481)")}

                   :else
                   (recur (rest remaining) (conj acc path) excluded
                          (into passengers (remove blocker-ids (filter unlanded-siblings (:owners attribution))))
                          (into content-clear (map (fn [id] {:path path :sibling id}) (sort blocker-ids))))))

               ;; BL-1544. A path whose attribution is AMBIGUOUS (some
               ;; touching commit's subject names more than one ticket id
               ;; and leads with none) is never silently excluded on the
               ;; strength of commit-range attribution alone, the way the
               ;; BL-1389 clause just below would otherwise treat it once
               ;; task-ticket-id is not among its owners. This path is
               ;; already known to genuinely differ from origin/main -
               ;; `delivered` above is a two-tree diff, so a path with no
               ;; real content difference never reaches this loop at all -
               ;; so there is no "nothing at stake" branch to special-case
               ;; here; the refusal names the ambiguous commit(s), every id
               ;; each one's subject names, and the path (never a silent
               ;; EXCLUDED_SIBLING_PATH). When task-ticket-id IS among this
               ;; path's owners (a commit that itself leads with the
               ;; landing ticket's id also touched it) this clause does not
               ;; apply and the path falls through to the ordinary keep
               ;; logic below, the named ambiguous siblings riding as
               ;; passengers exactly like any other co-owner.
               (and (:any-ambiguous? attribution)
                    (not (contains? (:owners attribution) task-ticket-id)))
               {:paths nil
                :warning (str "land-step: refusing to replay " task-ticket-id
                              " - " path "'s attribution is ambiguous: "
                              (str/join "; " (map (fn [{:keys [commit ids]}]
                                                    (str commit " names " (str/join "," (sort ids))
                                                         " and leads with neither"))
                                                  (:ambiguous attribution)))
                              ", and no commit of " task-ticket-id "'s own touches " path
                              " - never decided silently (BL-1544)")}

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
                      passengers content-clear)

               :else
               (recur (rest remaining) (conj acc path) excluded
                      ;; Every approved unlanded co-owner of an INCLUDED path
                      ;; rides. A path this ticket does not own is excluded
                      ;; above and boards nobody.
                      (if (contains? (:owners attribution) task-ticket-id)
                        (into passengers (filter unlanded-siblings (:owners attribution)))
                        passengers)
                      content-clear))))))
       {:paths nil :warning (str "land-step: could not read " task-ticket-id
                                  "'s own-range touched paths, " origin-main ".." commit)})
     {:paths nil :warning (str "land-step: could not read the delivered diff " origin-main ".." commit)}))))


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

;; BL-1474: the number of stderr characters an escalate reason will quote
;; verbatim before naming a truncation - a sane bound, not a hard limit on
;; what a refusing hook could print.
(def ^:private replay-commit-stderr-truncate-limit 2000)

(defn replay-commit-refusal-reason
  "BL-1474: the replay's escalate reason, true of the actual cause. Pure -
   takes what replay! already observed before and after the commit attempt
   (whether the scratch index was empty, and the commit's raw stderr), no
   git calls of its own, so the three cases (empty index; a refusing guard
   with a message; a refusing hook with none) are unit-testable without a
   repository.

   'nothing to commit' is reported ONLY when the index itself was empty -
   never inferred from the commit's exit code alone, which is exactly the
   bug this ticket fixes: a commit-time guard (merge-deletion, ticket-
   deletion, registration, ...) refuses a REAL, non-empty index with its
   own non-zero exit, and that refusal must never be reported as an empty
   diff (BL-1463, BL-1408, both 2026-09-07)."
  [task-ticket-id index-empty? stderr]
  (cond
    index-empty?
    (str "land-step replay: nothing to commit for " task-ticket-id " - own-paths identical to origin/main")

    (str/blank? stderr)
    (str "land-step replay: commit refused for " task-ticket-id ", no text")

    :else
    (let [trimmed (str/trim stderr)
          over-limit? (> (count trimmed) replay-commit-stderr-truncate-limit)
          body (if over-limit?
                 (str (subs trimmed 0 replay-commit-stderr-truncate-limit) " ... (truncated)")
                 trimmed)]
      (str "land-step replay: commit refused for " task-ticket-id " - " body))))

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
              (let [index-empty? (zero? (:exit (git! scratch "diff" "--cached" "--quiet")))
                    commit-res (git! scratch "-c" "user.email=t@t" "-c" "user.name=t"
                                      "commit" "-q" "-m" (str task-ticket-id ": tip-pure replay onto origin/main (BL-1241 land-step remedy)"))]
                (if-not (zero? (:exit commit-res))
                  (do (cleanup!)
                      (drop-branch!)
                      {:success false
                       :reason (replay-commit-refusal-reason task-ticket-id index-empty? (:err commit-res))})
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

;; ── BL-1447: a built replay is verified complete before land-plan ever
;;    returns :replay, reading git objects only - never the attribution
;;    that built it, so this check cannot share that attribution's blind
;;    spot (invariant 2). ─────────────────────────────────────────────────

(defn replay-missing-paths
  "Pure core of the completeness check: given `cited-blobs` and
   `replay-blobs` (path -> blob-id, ::absent for a path missing there) and
   `parcel-paths` (the paths to check), returns the sorted vector of paths
   where the two disagree - unit-testable without git, per this ticket's
   own 'How'. Empty when the replay carries the cited tip's content, byte
   for byte, at every one of `parcel-paths`."
  [{:keys [cited-blobs replay-blobs parcel-paths]}]
  (vec (sort (for [p parcel-paths
                    :let [cited (get cited-blobs p ::absent)
                          replayed (get replay-blobs p ::absent)]
                    :when (not= cited replayed)]
                p))))

;; Impure half: reads both trees' blobs at each of `parcel-paths` via the
;; same `blob-at` (::absent-on-missing) every other landed/unlanded read in
;; this file already uses, then hands plain data to the pure core above.
;; Public (not `defn-`) so BL-1447's own acceptance handler can drive the
;; SAME check land-plan runs internally against a deliberately truncated
;; replay build, without a second implementation of it.
(defn replay-completeness-offenders [root cited-commit replay-commit parcel-paths]
  (replay-missing-paths
   {:cited-blobs (into {} (map (fn [p] [p (blob-at root cited-commit p)])) parcel-paths)
    :replay-blobs (into {} (map (fn [p] [p (blob-at root replay-commit p)])) parcel-paths)
    :parcel-paths parcel-paths}))

(defn- commit-changed-paths [root commit]
  (let [res (git! root "diff-tree" "--no-commit-id" "--name-only" "-r" commit)]
    (when (zero? (:exit res)) (remove str/blank? (str/split-lines (:out res))))))

(defn- parcel-commit-paths
  "The WIDE, attribution-independent set of paths ANY of task-ticket-id's
   own commits (subject-tagged, over origin-main..commit) changed - BL-1447
   invariant 2's own 'How': `git log --format=%H ^origin/main <cited>`
   filtered to subjects naming the ticket, each commit's own diff-tree
   unioned. Deliberately the SAME subject-based attribution
   `entangled-siblings`/`commit-ticket-id` already use elsewhere in this
   file, never the `own-paths`/`delivered-attribution` walk this check
   exists to cross-check. nil (never #{}) on an unreadable range or an
   unreadable commit's diff - the caller refuses rather than reading
   blindness as \"the parcel touched nothing\"."
  [root task-ticket-id origin-main commit]
  (when-let [commits (ancestry-commits root origin-main commit)]
    (let [own (filter #(= task-ticket-id (commit-ticket-id root %)) commits)]
      (reduce (fn [acc c]
                (if-let [paths (commit-changed-paths root c)]
                  (into acc paths)
                  (reduced nil)))
              #{}
              own))))

(defn land-plan
  "The land step's own decision: {:action :land} when no entanglement is
   present (or the check could not tell - see below); {:action :replay
   :entangled #{...} :own-paths [...] :commit sha :branch name} when a
   tip-pure rebuild is the remedy - the commit is ALREADY BUILT (BL-1447:
   land-plan calls replay! itself and verifies the result before ever
   returning :replay, so the caller must publish `:commit`/`:branch`
   directly and never call replay! again, which would collide on the same
   branch name); {:action :escalate :reason \"...\"} when even the
   detection itself could not be completed, the replay failed to build, or
   the built replay is missing any path the parcel's own commits changed
   (`replay-incomplete: <path> ...`, BL-1447 invariant 1) - a check that
   cannot run, or cannot pass, refuses to bless a land, per invariant 2,
   rather than defaulting to :land or publishing an incomplete tip.
   task-ticket-id nil (task-name named no ticket) also escalates - nothing
   to compare ancestry against.

   BL-1431 invariant 1: `:origin-main` is an OPTIONAL key. When the caller
   (land_step_cli.bb) already resolved it, that exact value is threaded to
   every reader below and never re-resolved - one land-step invocation
   reads one tip, immune to main moving mid-walk. A direct/test caller that
   omits the key (the pre-existing contract, unchanged) gets it resolved
   once, here, at this function's own entry.

   BL-1432: `:base` is likewise an OPTIONAL key - the parcel's own base
   (task_scope_gate_lib.bb's own `parcel-own-base`, the same notion the
   send-time scope gate already uses), resolved and still accepted for
   call-site compatibility - but see BL-1461 below: it no longer bounds
   the entanglement candidate walk. `origin-main` itself stays exactly
   what it was: the tree every landed/unlanded and approval verdict is
   read against.

   BL-1446: `:base` does NOT bound `delivered-attribution` or `own-paths`
   (the per-path attribution and the replay's own content) - both always
   read `origin-main..commit`, whatever `:base` is. A land only ever forces
   these on the rare :replay path (never the common :land one, so this
   costs nothing there), and bounding them to the LAST hop is what silently
   dropped every earlier hop's work from a replay (the 2026-09-06 incident,
   backlog/evidence/BL-1424-land-replay-dropped-own-paths-incident-20260906.md):
   a replay must carry the parcel's WHOLE contribution, not the delta since
   whichever hop happened to record `:base`. `ancestry-commits` ALSO always
   excludes anything reachable from `origin-main` regardless of `:base`
   (invariant 1) - a routine post-hop `git merge origin/main` must never
   manufacture a candidate sibling out of already-landed history.

   BL-1461: the CANDIDATE WALK for `entangled-siblings` - the one that
   decides LAND_CLEAN vs LAND_REPLAY - also always runs `origin-main..commit`
   now, never `:base`. Bounding it to the parcel's last hop (BL-1432's
   original narrowing) made a sibling's work invisible the moment it was
   absorbed into a shared cleaner/architect/hardener/documenter branch
   BEFORE that last hop - the ordinary shape Article 2.6 describes, not an
   edge case: `land_step_cli.bb BL-1448 6c8caf27fb`/`d854af2126` both
   answered a bare LAND_CLEAN on 2026-09-07 while carrying BL-1349's
   unlanded `bounce_history`, absorbed before the documenter's last hop,
   which only a hand content-diff caught (BL-1446's own follow-up finding).
   BL-1432's original motive - avoiding a walk over the QA branch's
   forever-growing, never-landed history (1839 commits measured
   2026-09-05) - is now met a different way: BL-1438's post-land re-point
   keeps that range short (163 commits on 2026-09-07) by construction, so
   the wide walk this restores is cheap again. `:base` therefore never
   decides a verdict here; it is accepted only so an existing call site
   need not change shape."
  [{:keys [root commit task-ticket-id] :as opts}]
  (if-not task-ticket-id
    {:action :escalate :reason "land-step: task name names no ticket id"}
    ;; BL-1389: the per-PATH attribution is computed ONCE and feeds both
    ;; questions - which siblings have landed, and which paths may ride. They
    ;; used to be answered from different walks, and a path the per-path walk
    ;; credited to a sibling the per-sibling walk never reported was decided
    ;; against a verdict that had not seen it.
    (let [origin-main (if (contains? opts :origin-main) (:origin-main opts) (origin-main-sha root))
          walk-base (if (contains? opts :base)
                      (:base opts)
                      (or (task-scope-gate-lib/parcel-own-base root task-ticket-id) origin-main))
          ;; BL-1461: origin-main..commit, never walk-base - see the
          ;; docstring above. A narrower range here would silently starve
          ;; `lines-of` for exactly the pre-hop siblings the wide walk below
          ;; now reports, which would then verdict them on an empty diff
          ;; ({} from sibling-own-line-changes, never nil) instead of their
          ;; real one.
          candidates (when origin-main (ancestry-commits root origin-main commit))
          ;; One read of each sibling's own diffs, shared by the landed/unlanded
          ;; split and by the per-path exclusion below. Each is every commit
          ;; that sibling authored in range, so asking twice doubles the
          ;; slowest part of the land step.
          lines-of (memoize #(when candidates (sibling-own-line-changes root candidates %)))
          ;; Deferred: a land with no entangled sibling never forces it, and
          ;; that is the common case. Forcing it there would add one
          ;; path-scoped walk per delivered path to every clean land.
          ;;
          ;; BL-1446: reads from `origin-main`, never `walk-base` - the same
          ;; fix as `own-paths` below and for the same reason (the parcel's
          ;; WHOLE delivered diff, every hop, not just what changed since the
          ;; last one). This is the rare :replay path only (never forced when
          ;; `entangled` is empty, the common :land case), so widening it
          ;; back to `origin-main` does not reintroduce BL-1432's original
          ;; per-land cost.
          attribution (when origin-main
                        (delay (delivered-attribution root origin-main commit)))
          extra-paths-fn (when attribution
                           (fn [sibling]
                             (for [[path a] @attribution
                                   :when (and a (contains? (:owners a) sibling))]
                               path)))
          ;; BL-1461: no walk-base passed - entangled-siblings' own
          ;; 6-arg arity defaults its candidate walk to origin-main, the
          ;; wide range this ticket restores (a sibling absorbed before
          ;; the parcel's last hop is a candidate exactly like one after
          ;; it). walk-base still bounds nothing here; see the docstring.
          {:keys [entangled landed unlanded landed-paths warning]}
          (entangled-siblings root commit task-ticket-id extra-paths-fn lines-of origin-main)]
      (cond
        warning {:action :escalate :reason warning}
        (empty? entangled) {:action :land}
        :else
        (let [{:keys [paths warning passengers excluded content-clear]}
              (own-paths root commit task-ticket-id unlanded nil nil
                         {:attribution (when attribution @attribution)
                          :path-landed-fn (when origin-main
                                            (sibling-path-landed-fn root origin-main commit lines-of))
                          ;; BL-1481: reuses this SAME per-sibling read
                          ;; (`lines-of`, already computed above for the
                          ;; landed/unlanded split) rather than a second
                          ;; walk over the same commits.
                          :content-blocked-fn (when origin-main
                                                 (fn [p ids]
                                                   (path-content-blocked-ids root origin-main commit p ids lines-of)))}
                         origin-main walk-base)]
          (if (nil? paths)
            ;; BL-1463: this escalate has positive evidence of entanglement
            ;; (entangled-siblings already succeeded above; only own-paths'
            ;; own attribution read failed) - the CLI's ENTANGLED_SIBLING
            ;; lines and entanglement note read :unlanded off THIS map
            ;; exactly like the :replay map below, so an escalate never
            ;; names fewer siblings than a replay would have for the same
            ;; evidence (invariant 1). The two escalates above (an
            ;; unreadable candidate walk; no ticket id at all) have no
            ;; sibling sets to offer and stay bare.
            (merge {:action :escalate
                    :reason (or warning (str "land-step: could not compute " task-ticket-id "'s own paths to replay"))}
                   {:entangled entangled :landed landed :unlanded unlanded})
            ;; BL-1375: :passengers are the approved unlanded siblings whose
            ;; lines ride on an included shared path. replay! owes them the
            ;; tree guards before it hands QA a commit to publish.
            ;;
            ;; BL-1447: the tip-pure commit is built HERE, once, and
            ;; verified complete before land-plan ever returns :replay -
            ;; never a second build in the CLI, which would collide on the
            ;; same replay branch name `replay!` already claimed. A replay
            ;; that fails to build, or builds but is missing any of the
            ;; parcel's own paths, escalates instead - nothing is ever
            ;; published for either.
            (let [replay-result (replay! {:root root :commit commit :task-ticket-id task-ticket-id
                                           :own-paths paths :passengers (or passengers #{})
                                           :origin-main origin-main})]
              (if-not (:success replay-result)
                {:action :escalate :reason (:reason replay-result) :unlanded unlanded}
                (let [parcel-paths (parcel-commit-paths root task-ticket-id origin-main commit)]
                  (if (nil? parcel-paths)
                    (do (git! root "branch" "-q" "-D" (:branch replay-result))
                        {:action :escalate
                         :reason (str "land-step: could not read " task-ticket-id
                                      "'s own commit history to verify the replay")
                         :unlanded unlanded})
                    (let [offenders (replay-completeness-offenders root commit (:commit replay-result) parcel-paths)]
                      (if (seq offenders)
                        (do (git! root "branch" "-q" "-D" (:branch replay-result))
                            {:action :escalate
                             :reason (str "replay-incomplete: " (str/join " " offenders))
                             :unlanded unlanded})
                        {:action :replay :entangled entangled :landed landed :unlanded unlanded
                         :landed-paths (or landed-paths {})
                         :excluded (or excluded [])
                         :content-clear (or content-clear [])
                         :own-paths paths :passengers (or passengers #{})
                         :commit (:commit replay-result) :branch (:branch replay-result)}))))))))))))

;; ── BL-1432 option 1: re-point the QA branch after a successful land ─────
;; QA's branch keeps every review merge and every merge-of-main as its own
;; history forever - tip-pure replays land CONTENT under new SHAs on main,
;; so none of that history ever becomes a main ancestor and origin/main..tip
;; grows without bound (this file's own header measured 1839 commits ahead,
;; 4 behind, on 2026-09-05). Re-pointing to origin/main after each land
;; resets that growth; the human ruled this alongside the bounded-walk half
;; above (option 3, both).

(defn- log-repoint! [root entry]
  (let [log-path (fs/path root ".swarmforge" "daemon" "land-repoint.log")]
    (fs/create-dirs (fs/parent log-path))
    (spit (str log-path)
          (str (java.time.Instant/now) " " entry "\n")
          :append true)))

(defn post-land-repoint!
  "{:action :repointed :old-tip :new-tip} on success, or {:action :skipped
   :reason \"...\"} when it is not safe to run - NEVER a bare `reset --hard`
   on a tree that might hold work (invariant 3): refuses on an uncommitted
   change (`git status --porcelain` non-empty) or a parcel still in
   `in_process`, each logged by name so a skip is never silent. Only once
   both are verified clean does it move the branch AND the worktree to
   origin/main - a `reset --hard`, but one the constitution's own caution
   against that command does not forbid here: the precondition IS the
   clean-tree guarantee that command normally lacks. Both the old and the
   new tip are logged either way (repointed or skipped), so a bookkeeping
   read never has to diff the branch by hand to see what happened."
  [{:keys [root in-process-dir]}]
  (let [in-process-dir (or in-process-dir (str (fs/path root ".swarmforge" "handoffs" "inbox" "in_process")))
        old-tip (str/trim (:out (git! root "rev-parse" "HEAD")))
        status (git! root "status" "--porcelain")
        pending (when (fs/exists? in-process-dir)
                  (remove #(str/starts-with? (fs/file-name %) ".") (fs/list-dir in-process-dir)))]
    (cond
      (not (zero? (:exit status)))
      (let [r {:action :skipped :reason "land-step: could not read worktree status"}]
        (log-repoint! root r) r)

      ;; BL-1421's own ruling, same shape: in-process is checked BEFORE
      ;; dirty - an in_process parcel's own mailbox file is untracked, which
      ;; would otherwise misreport it as a generic "uncommitted change"
      ;; instead of naming the real reason.
      (seq pending)
      (let [r {:action :skipped :reason "a parcel in its in_process" :old-tip old-tip}]
        (log-repoint! root r) r)

      (not (str/blank? (:out status)))
      (let [r {:action :skipped :reason "an uncommitted change" :old-tip old-tip}]
        (log-repoint! root r) r)

      :else
      (let [origin-main (origin-main-sha root)]
        (if-not origin-main
          (let [r {:action :skipped :reason "land-step: origin/main could not be resolved" :old-tip old-tip}]
            (log-repoint! root r) r)
          (let [res (git! root "reset" "--hard" origin-main)]
            (if (zero? (:exit res))
              (let [r {:action :repointed :old-tip old-tip :new-tip origin-main}]
                (log-repoint! root r) r)
              (let [r {:action :skipped :reason "land-step: branch re-point failed" :old-tip old-tip}]
                (log-repoint! root r) r))))))))
