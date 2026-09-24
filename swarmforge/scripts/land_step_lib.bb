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
;; BL-1604: open-ticket-ids-for - the ONE reading of "which tickets are
;; still open" (backlog/paused + backlog/active basenames), never a second
;; reader here.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "qa_hold_lib.bb")))
;; BL-1650: read-abandoned-commits is pre_qa_gate_lib.bb's own already-
;; shipped `abandoned_commits:` reader - never a second YAML-list parser
;; here.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_lib.bb")))

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

;; ── BL-1650 item 0: a candidate commit a sibling's OWN ticket already
;; disclaims (any backlog lane's `abandoned_commits:`) is neither a
;; candidate for content attribution nor a reason to print
;; ENTANGLED_SIBLING - the same posture BL-1546/BL-1272 already take for
;; every other "this content is already accounted for" case.
;;
;; `ticket-abandoned-commits` itself is defined further down, after
;; `worktree-ticket-sources`/`main-ticket-sources` (BL-1375's own backlog
;; source readers) - it reuses them, never a second ticket-file reader. ──

(defn- abandoned-commit-sha? [sha abandoned]
  (some #(str/starts-with? sha %) abandoned))

(declare ticket-abandoned-commits)

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
   (let [;; BL-1650 item 0: scored over the SAME candidate commits the
         ;; entangled detector found for this sibling (`candidates`, the
         ;; FULL ancestry `ancestry-commits` already walked) - never
         ;; `task-tagged-changed-paths`'s own `--first-parent` walk, which
         ;; never visits a commit that rode in on a non-first-parent merge
         ;; (the everyday pipeline shape: cleaner/architect/hardener/
         ;; documenter each receive by `git merge <hash>`). A candidate
         ;; commit the sibling's own ticket already lists under
         ;; `abandoned_commits:` is excluded - it is not evidence the
         ;; sibling is entangled, per that ticket's own disclaimer.
         walk (or paths-fn
                  (fn [sibling]
                    (let [abandoned (ticket-abandoned-commits root sibling origin-main)]
                      (->> candidates
                           (remove #(merge-commit? root %))
                           (filter #(= sibling (commit-ticket-id root %)))
                           (remove #(abandoned-commit-sha? % abandoned))
                           (mapcat #(task-scope-gate-lib/own-commit-changed-paths root % :delivered))
                           (remove nil?)
                           distinct
                           vec))))
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
                             distinct
                             ;; BL-1650 item 0: a sibling every one of whose
                             ;; own candidate commits is listed in its OWN
                             ;; ticket's abandoned_commits is not entangled
                             ;; at all - never printed ENTANGLED_SIBLING,
                             ;; never scored, exactly as if it had no
                             ;; candidate commit here.
                             (remove (fn [sid]
                                       (let [own (filter #(= sid (commit-ticket-id root %)) candidates)
                                             abandoned (ticket-abandoned-commits root sid origin-main)]
                                         (and (seq own)
                                              (every? #(abandoned-commit-sha? % abandoned) own)))))
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

(defn ticket-abandoned-commits
  "Every `abandoned_commits:` entry recorded for `ticket-id`, unioned across
   every backlog source (worktree and origin/main, any lane) that has a file
   for it. #{} when no source names any - the everyday case, never nil (an
   unreadable/ambiguous ticket file is not this function's own question;
   ticket-approval-state already decides that one door up)."
  [root ticket-id origin-main]
  (let [sources (concat (worktree-ticket-sources root ticket-id)
                         (or (main-ticket-sources root ticket-id origin-main) []))]
    (into #{}
          (mapcat (fn [{:keys [content]}]
                    (when content
                      (:items (pre-qa-gate-lib/read-abandoned-commits content)))))
          sources)))

(defn- closed-on-main?
  "BL-1546. A positive finding: `ticket-id`'s file is found under
   backlog/done/ on `origin-main` and under no other backlog folder there -
   reusing `main-ticket-sources` (it already walks the nested
   backlog/done/<milestone>/ layout) rather than a second ls-tree.

   nil (never true) when origin-main's tree could not be listed at all;
   false when the ticket has no file there, or is filed under any other
   folder there too (found in both done and active, say - genuinely
   ambiguous, not a positive `done` reading). Fail-closed throughout, the
   same posture ticket-approval-state already takes for an unreadable or
   ambiguous ticket file (BL-1272 invariant 1)."
  [root origin-main ticket-id]
  (when-let [sources (main-ticket-sources root ticket-id origin-main)]
    (= #{"done"} (into #{} (map :folder) sources))))

;; ── BL-1650 items 1-2: a closed-owner stray whose EVERY path is pure
;; evidence/documentation may be landed by this step itself, never
;; escalated - the everyday shape a closed sibling's incident evidence,
;; committed on a role's own long-lived branch after the sibling moved on,
;; produces (BL-831/BL-1636). BL-1546's refusal stands unchanged for
;; anything wider than this narrow set. ────────────────────────────────

(def ^:private stray-pure-evidence-prefixes ["backlog/evidence/" "docs/"])

(defn pure-evidence-or-docs-paths?
  "Pure over a path list: every one of `paths` sits under backlog/evidence/
   or docs/, and there is at least one path (an empty diff is never a
   reason to land anything). Never under extension/, swarmforge/, specs/,
   android/, pwa/, or any backlog/{paused,active,done,hold} ticket file or
   backlog/*.tsv/*.yaml - one path outside the allowlist fails the whole
   set, per this ticket's invariant 1."
  [paths]
  (boolean
   (and (seq paths)
        (every? (fn [p] (some #(str/starts-with? p %) stray-pure-evidence-prefixes)) paths))))

(defn closed-owner-pure-evidence-stray?
  "BL-1650 item 1. `{:sha commit :paths [...]}` when `commit` is a stray
   this land step may cherry-pick and land itself without escalation: its
   own subject names a sibling ticket (never `task-ticket-id` itself) that
   is CLOSED on origin/main (`closed-on-main?`), and every path its own
   :delivered diff touches is pure evidence/documentation
   (`pure-evidence-or-docs-paths?`). nil otherwise, or when the sibling's
   closed state or the commit's own diff could not be read - fail-closed,
   the same posture `closed-on-main?` and BL-1546's refusal already take
   for every case this one narrows."
  [root origin-main commit task-ticket-id]
  (when-let [sibling (commit-ticket-id root commit)]
    (when-not (= sibling task-ticket-id)
      (when (true? (closed-on-main? root origin-main sibling))
        (when-let [paths (task-scope-gate-lib/own-commit-changed-paths root commit :delivered)]
          (when (pure-evidence-or-docs-paths? paths)
            {:sha commit :sibling sibling :paths paths}))))))

(defn stray-evidence-commits
  "The candidates BL-1650 item 1 may land on its own, oldest first (so the
   cherry-picks below apply in authored order): every commit in
   `candidates` that is a `closed-owner-pure-evidence-stray?`, merge
   commits excluded (a merge authors no stray content of its own -
   `ancestry-commits`'/`sibling-own-line-changes`'s own posture, unchanged
   here)."
  [root origin-main task-ticket-id candidates]
  (->> candidates
       (remove #(merge-commit? root %))
       (keep #(closed-owner-pure-evidence-stray? root origin-main % task-ticket-id))
       reverse
       vec))

;; BL-1650 QA bounce (D1 rework, 2026-09-20 tip-content ruling): "byte-
;; identical to origin/main" names the REPLAY TIP's content at a path, never
;; the historical stray commit's own diff. A stray's own patch can be a
;; strict subset of how far main's copy has since grown (BL-1639's evidence
;; file: the stray added 9 lines, main now carries those and 31 more) -
;; attempting `git cherry-pick -x` there produces a genuine add/add conflict
;; on content the tip does not even own, not the empty-patch shape
;; `cherry-pick-already-applied?` already handles. When the tip already
;; carries, byte for byte, what main carries at every one of the stray's
;; paths, there is nothing left for this stray to land - skip the cherry-
;; pick attempt entirely rather than let git discover the same conclusion by
;; failing.
;;
;; Narrowed to the shape a plain cherry-pick attempt cannot already resolve
;; on its own: when the stray's OWN post-image at a path already equals
;; origin/main's (the everyday "hand-landed once already" shape QA bounce
;; D1's `cherry-pick-already-applied?` exists for - scenario 05), the
;; attempt is left to run and report LAND_STRAY_EVIDENCE_ALREADY_LANDED as
;; before; skipping it here too would silently swallow that distinct,
;; equally-auditable report line. This function fires only when the tip has
;; moved PAST what the stray commit itself would produce.
(defn stray-tip-already-landed?
  "True when EVERY one of `paths` already holds, on the replay tip
   (`commit`, the commit actually being landed), identical content to
   `origin-main` - AND the stray commit's (`sha`) own post-image there
   differs from `origin-main`'s, so a cherry-pick attempt would not merely
   find an empty patch (that shape is `cherry-pick-already-applied?`'s to
   report) but a genuine conflict against content the tip does not own."
  [root origin-main commit sha paths]
  (boolean
   (and (seq paths)
        (every? (fn [p]
                  (let [main-blob (blob-at root origin-main p)]
                    (and (= (blob-at root commit p) main-blob)
                         (not= (blob-at root sha p) main-blob))))
                paths))))

;; ── BL-1670: a pure-evidence/doc stray whose cherry-pick genuinely
;; conflicts is not always a reason to abort the whole replay - a stray
;; superseded by main's own later, more complete text carries nothing left
;; to land, and the escalation loop this ticket exists to end (BL-1657,
;; BL-1661, BL-1667, BL-1664 all queued behind exactly this shape on
;; 2026-09-20) is pure noise. Two grounds, either sufficient: (a) the
;; stray's own post-image at these paths is a strict content subset of
;; origin/main's current one - nothing added (be826a2060's shape, added
;; 0/removed 109); or (b) origin/main's own conflicting lines were LAST
;; WRITTEN by a landed commit whose own subject names exactly the stray's
;; sibling ticket - its own later rebuild superseded it
;; (5dbfd9b6a6/8fad11b0dc's shape). A conflict whose HEAD-side lines trace
;; to any OTHER ticket, to an untagged commit, or to one not (yet) on
;; origin/main, or a diff that would drop a line origin/main lacks, fails
;; BOTH grounds and the caller escalates by name exactly as before - this
;; narrows nothing wider than these two provable shapes.

(defn- rev-range-line-changes
  "{path {:added #{} :removed #{}}} for the diff turning `base` into `rev`,
   restricted to `paths` - the same parser every other line-level read in
   this file already shares (`diff-line-changes`). nil when the diff could
   not be read."
  [root base rev paths]
  (let [res (apply git! root "diff" "--unified=0" base rev "--" paths)]
    (when (zero? (:exit res))
      (diff-line-changes (:out res)))))

(defn stray-content-subset-of-origin-main?
  "Ground (a). `sha`'s own post-image at `paths`, diffed FROM origin-main,
   adds no line - sha introduces nothing origin-main lacks there (main may
   still carry lines sha lacks; that is a removal, never an addition). nil
   (the diff itself unreadable) fails closed - never superseded on missing
   evidence."
  [root origin-main sha paths]
  (when-let [changes (rev-range-line-changes root origin-main sha paths)]
    (every? (fn [p] (empty? (:added (get changes p)))) paths)))

(defn- conflict-marker-ours-blocks
  "Pure. The 'ours' (HEAD-side) line blocks a conflict-marked file's own
   text carries between each `<<<<<<< ` and its matching `=======` -
   never the 'theirs' side, which git's own convention places AFTER the
   `=======` separator. A file can hold more than one conflict region;
   one block vector per region, in order. Git's own conflict rendering
   keeps 'ours' text verbatim even when nothing about the SURROUNDING
   line count changed (an adjacent insert-only diff against HEAD, not a
   replacement) - this reads the markers directly instead of trying to
   infer the region from a line-count diff, which the insert-only shape
   defeats."
  [file-text]
  (loop [lines (str/split-lines (or file-text "")) in-ours? false cur [] acc []]
    (if (empty? lines)
      acc
      (let [line (first lines) rest-lines (rest lines)]
        (cond
          (str/starts-with? line "<<<<<<< ")
          (recur rest-lines true [] acc)

          (and in-ours? (str/starts-with? line "======="))
          (recur rest-lines false [] (conj acc cur))

          in-ours?
          (recur rest-lines true (conj cur line) acc)

          :else
          (recur rest-lines false cur acc))))))

(defn- subsequence-index
  "Pure. The 0-based index in `haystack` where `needle` (a non-empty
   vector) occurs contiguously, or nil when it does not - absent, or
   found more than once, which is ambiguous and fails closed rather than
   guessing which occurrence is the real one."
  [haystack needle]
  (when (seq needle)
    (let [haystack (vec haystack) needle (vec needle)
          n (count needle) h (count haystack)]
      (when (<= n h)
        (let [hits (for [i (range 0 (inc (- h n)))
                          :when (= needle (subvec haystack i (+ i n)))]
                      i)]
          (when (= 1 (count hits)) (first hits)))))))

(defn- head-blob-lines-ordered
  "`path`'s own lines at HEAD, in order (unlike `blob-lines`'s set, order
   is exactly what a contiguous-subsequence search needs). nil when the
   blob is absent or unreadable."
  [scratch path]
  (let [blob (blob-at scratch "HEAD" path)]
    (when-not (= ::absent blob)
      (let [res (git! scratch "cat-file" "blob" blob)]
        (when (zero? (:exit res)) (str/split-lines (:out res)))))))

(defn- conflict-hunk-head-ranges
  "[[start len] ...] - the HEAD-side line ranges (1-based, git blame's own
   convention) of `path`'s merge-conflict hunk(s) in `scratch`'s current
   working tree: where each 'ours' block the conflict markers carry
   occurs, contiguously and unambiguously, within HEAD's own ordered
   lines at `path`. A block that cannot be placed there this way - empty
   (HEAD contributed nothing, a delete-side conflict), absent, or
   ambiguous - is left out; there is no HEAD-side line to blame for it, so
   ground (b) fails closed rather than guessing."
  [scratch path]
  (let [head-lines (head-blob-lines-ordered scratch path)
        wt-path (str (fs/path scratch path))]
    (when (and head-lines (fs/exists? wt-path))
      (into []
            (keep (fn [block]
                    (when-let [idx (subsequence-index head-lines block)]
                      [(inc idx) (count block)])))
            (conflict-marker-ours-blocks (slurp wt-path))))))

(defn- blame-line-shas
  "The full commit shas `git blame --porcelain` names across `ranges` of
   `path` at HEAD - one header line per blamed line, always leading with
   the full 40-char sha regardless of whether the metadata block after it
   was elided for a commit repeated within this same blame call
   (porcelain's own contract)."
  [scratch path ranges]
  (into #{}
        (mapcat (fn [[start len]]
                  (let [res (git! scratch "blame" "--porcelain" "-L" (str start ",+" len) "HEAD" "--" path)]
                    (when (zero? (:exit res))
                      (keep #(second (re-find #"^([0-9a-f]{40})\s" %)) (str/split-lines (:out res)))))))
        ranges))

(defn stray-superseded-verdict
  "nil, or {:reason \"...\"} - whether this stray's cherry-pick CONFLICT (a
   real one, not `cherry-pick-already-applied?`'s empty-patch shape) is
   superseded on either provable ground, checked in order:

   (a) content-subset: `stray-content-subset-of-origin-main?` - the reason
       is a fixed, self-explanatory tag (no single sha decides this one;
       it is a property of the whole diff).
   (b) rewritten-by-owner: every HEAD-side conflicting line across `paths`
       was last written by a commit on origin/main whose own subject
       names EXACTLY `owner` - the reason names those commits' own short
       shas (QA's own by-hand evidence already reads this way: 8fad11b0dc).

   Must be called BEFORE the caller aborts the cherry-pick - ground (b)
   reads the conflict-marked working tree the abort would erase. nil when
   neither ground holds: the caller aborts and escalates by name exactly
   as before."
  [{:keys [root scratch origin-main sha owner paths]}]
  (cond
    (stray-content-subset-of-origin-main? root origin-main sha paths)
    {:reason "content-subset-of-origin-main"}

    :else
    (let [shas (into #{}
                      (mapcat (fn [p] (blame-line-shas scratch p (conflict-hunk-head-ranges scratch p))))
                      paths)]
      (when (and (seq shas)
                 (every? #(zero? (:exit (git! root "merge-base" "--is-ancestor" % origin-main))) shas)
                 (= #{owner} (into #{} (map #(commit-ticket-id root %)) shas)))
        {:reason (str/join "," (sort (map #(subs % 0 (min 10 (count %))) shas)))}))))

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
   origin/main under whatever sha put it there). BL-1594: `:vacuous` also
   clears it - the id's own contribution to this path is entirely reverted
   at the tip (surviving-added and surviving-removed both empty), so the
   path owes it nothing and content it never contributed cannot block it;
   `sibling-path-verdict`'s own docstring already calls this case silent,
   not an obstacle. `:unlanded` still blocks it - UNCHANGED from before
   this ticket: a partly-reverted removal (one of the id's removed lines
   still absent) or a real unresolved conflict between two blocking
   co-owners (BL-1374/05) leaves it owing content the tip does not have.

   Returns the subset of `candidate-ids` still blocking. #{} is a real,
   positive answer: every one of them is `:landed` or `:vacuous` on this
   path - content-clear, invariant 2's own shape. The returned set carries
   `{:verdicts {id verdict}}` metadata (every checked id, `:landed`,
   `:unlanded` or `:vacuous` - never present for an id whose own changes
   could not be read) so a caller that wants to report WHICH of the two
   cleared an id (BL-1594's own CLI line) can look it up without a second
   walk; a caller that only cares whether an id blocks reads the set
   exactly as before, metadata is invisible to `contains?`/`seq`/`empty?`.

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
         (loop [ids (sort candidate-ids) blocked #{} verdicts {}]
           (if (empty? ids)
             (with-meta blocked {:verdicts verdicts})
             (let [id (first ids)
                   changes (lines-fn id)]
               (if (nil? changes)
                 nil
                 (let [verdict (sibling-path-verdict {:changes (get changes path {})
                                                       :main-lines main-lines :tip-lines tip-lines})]
                   (recur (rest ids)
                          (cond-> blocked (not (contains? #{:landed :vacuous} verdict)) (conj id))
                          (assoc verdicts id verdict))))))))))))

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
                              (sibling-path-landed-fn root origin-main commit))
             ;; BL-1650 items 1-2: paths land-plan already decided to
             ;; cherry-pick itself, as closed-owner pure-evidence strays -
             ;; BL-1546's refusal below must not fire for these; they are
             ;; excluded from THIS ticket's own-paths (never folded into its
             ;; tip-pure commit, which would lose the stray's own author/
             ;; subject) and land separately, ahead of it.
             stray-paths (or (:stray-paths opts) #{})]
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
                   ;; BL-1594: each cleared id's own verdict (:landed or
                   ;; :vacuous) rides along via path-content-blocked-ids'
                   ;; own :verdicts metadata - never a second content check
                   ;; for the sole purpose of labelling the CLI's report line.
                   (recur (rest remaining) (conj acc path) excluded
                          (into passengers (remove blocker-ids (filter unlanded-siblings (:owners attribution))))
                          (into content-clear
                                (map (fn [id]
                                       {:path path :sibling id
                                        :verdict (get (:verdicts (meta content-blocked)) id)})
                                     (sort blocker-ids))))))

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

               ;; BL-1650 items 1-2: a path BL-1546's clause below would
               ;; otherwise refuse on, but land-plan has already found a
               ;; closed-owner pure-evidence stray commit that delivers it
               ;; and will cherry-pick it onto the replay branch itself -
               ;; excluded here (never folded into this ticket's own tip),
               ;; never a refusal.
               (and (seq (:owners attribution))
                    (not (:any-untagged? attribution))
                    (not (contains? (:owners attribution) task-ticket-id))
                    (contains? stray-paths path))
               (recur (rest remaining) acc
                      (conj excluded {:path path :owners (:owners attribution)})
                      passengers content-clear)

               ;; BL-1546. A path whose every owner is CLOSED on origin/main
               ;; (backlog/done/ there) is never silently excluded on the
               ;; BL-1389 clause below's strength alone: an owner's own-
               ;; authored commit's lines can never read as "landed" (they
               ;; are the parcel's own new work, sibling-path-landed? asks
               ;; whether the OWNER's lines are already on origin/main, and
               ;; a closed owner's commit is never an ancestor of the branch
               ;; that authored it) - so a closed owner's path would exclude
               ;; forever under BL-1389's rule, and no parcel of a closed
               ;; ticket could ever land its own content again (2026-09-12,
               ;; BL-1537's 5dbd34f27f dropped this way). When a commit that
               ;; leads with the landing ticket's own id also touches this
               ;; path, task-ticket-id is among :owners and this clause does
               ;; not apply - the path falls through to the ordinary keep
               ;; logic below, the closed sibling(s) riding as passengers
               ;; exactly like any other co-owner. Otherwise it refuses,
               ;; naming the path and the closed owner(s) - never a silent
               ;; EXCLUDED_SIBLING_PATH.
               ;;
               ;; BL-1315's own guard is reused unchanged: an untagged touch
               ;; is skipped here exactly as it is below, since it may be
               ;; the landing ticket's own uncredited work - "closed" never
               ;; overrides that uncertainty, it only sharpens what happens
               ;; once the BL-1389 clause below would otherwise apply.
               (and (seq (:owners attribution))
                    (not (:any-untagged? attribution))
                    (not (contains? (:owners attribution) task-ticket-id))
                    (every? #(closed-on-main? root origin-main %) (:owners attribution)))
               {:paths nil
                :warning (str "land-step: refusing to replay " task-ticket-id
                              " - " path "'s only owner(s) "
                              (str/join "," (sort (:owners attribution)))
                              " are closed on origin/main (backlog/done/) and no commit of "
                              task-ticket-id "'s own touches " path
                              " - never decided silently (BL-1546)")}

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

;; ── BL-1604: a tip-pure replay never un-owns another open ticket's row ───
;; write-tree-from-paths! above takes each own-path WHOLE from the cited
;; commit - for a shared registry file (backlog/standing-reds.tsv,
;; swarmforge/scripts/property_suite_standing_allowlist.tsv) that means the
;; tip's row set REPLACES origin/main's. A row that went missing on the
;; branch for any reason (a merge on a batch branch, a conflict resolution,
;; a stale worktree - never a deliberate drain) is deleted from main by
;; whichever parcel lands next, whatever that parcel is about (BL-1548's
;; land silently un-owned BL-1595's row this way on 2026-09-16). This
;; restores every origin/main row an OPEN ticket other than the landing one
;; owns and the replay tree lacks - the landing ticket's own rows, and any
;; row a CLOSED ticket owned, are left exactly as the tip decided (the
;; drain rule, and stale-row retirement, are both unaffected).

(def register-row-restored-prefix
  "The one spelling of the line land_step_cli.bb prints per restored row -
   defined here, not duplicated at the print site, so REGISTER_ROW_RESTORED
   names exactly one literal in the codebase (BL-1235)."
  "REGISTER_ROW_RESTORED")

(def register-row-retired-prefix
  "BL-1631: the mirror of register-row-restored-prefix - the one spelling of
   the line land_step_cli.bb prints per row this land retires because its
   own owner column is the landing ticket."
  "REGISTER_ROW_RETIRED")

(def ^:private registry-specs
  "Row identity is the `file` column; owner is column 3 (standing-reds.tsv),
   the `owner BL-<n>` token in the rationale column (the allowlist -
   BL-1428's mirror shape), or column 2 (the pole register, BL-1598's own
   shape - `file ticket first_seen measured_ms note`). tsv-cols never
   re-splits per caller.

   BL-1631: `:retirable?-fn` (absent = always retirable) is the one place a
   registry can except a row from `rows-to-retire` regardless of owner - the
   pole register's accepted-pole row (BL-1629's disposition, spelled in its
   own note column, no dedicated column exists) is the one case today."
  [{:path "backlog/standing-reds.tsv"
    :row-key-fn (fn [line] (nth (str/split line #"\t" -1) 1 nil))
    :owner-fn (fn [line] (nth (str/split line #"\t" -1) 2 nil))}
   {:path "swarmforge/scripts/property_suite_standing_allowlist.tsv"
    :row-key-fn (fn [line] (nth (str/split line #"\t" -1) 0 nil))
    :owner-fn (fn [line] (second (re-find #"owner (BL-\d+)" (nth (str/split line #"\t" -1) 2 ""))))}
   {:path "backlog/suite-poles.tsv"
    :row-key-fn (fn [line] (nth (str/split line #"\t" -1) 0 nil))
    :owner-fn (fn [line] (nth (str/split line #"\t" -1) 1 nil))
    :retirable?-fn (fn [line] (not (re-find #"(?i)accepted pole" line)))}])

(defn- non-data-line?
  [line]
  (or (str/blank? line) (str/starts-with? line "#")))

(defn- registry-data-lines
  "Non-blank, non-comment lines - a registry's own header/comment lines
   never carry an owner (owner-fn returns nil for them), but skipping them
   up front keeps rows-to-restore's candidate set exactly the rows that
   could ever match."
  [content]
  (remove non-data-line? (str/split-lines (or content ""))))

(defn- rebuild-registry-content
  "BL-1631: reconstructs a registry file's full text after retiring rows -
   the original header/comment lines verbatim and in place, followed by the
   data lines still kept (original order), followed by any restored rows
   (origin order, BL-1604's own contract unchanged). Empty when nothing
   survives (never leaves a dangling trailing newline with no content)."
  [original-content kept-data restored]
  (let [header (filter non-data-line? (if (str/blank? (or original-content "")) [] (str/split-lines original-content)))
        all (concat header kept-data restored)]
    (if (seq all) (str (str/join "\n" all) "\n") "")))

(defn rows-to-restore
  "Pure (BL-654-style property target): origin-lines (raw TSV lines, as
   registry-data-lines already filtered) whose owner is OPEN and not
   task-ticket-id, and whose row-key row-key-fn reads is absent from
   replay-keys (the SET of row-keys row-key-fn reads off the replay tree's
   own current lines) - in origin order, so a restored file's row order
   stays origin/main's for every row this ticket did not itself touch."
  [{:keys [origin-lines replay-keys row-key-fn owner-fn task-ticket-id open-ticket-ids]}]
  (vec
   (for [line origin-lines
         :let [owner (owner-fn line)
               k (row-key-fn line)]
         :when (and owner k
                    (not= owner task-ticket-id)
                    (contains? open-ticket-ids owner)
                    (not (contains? replay-keys k)))]
     line)))

(defn rows-to-retire
  "Pure sibling of rows-to-restore (BL-654-style property target): lines
   (registry-data-lines-filtered, from whichever tree's content the caller
   is checking) whose owner-fn reads task-ticket-id AND retirable?-fn (a
   row's own line, defaulting to always-retirable) says yes - the landing
   ticket's own rows leave in its own land, except a row a registry marks
   as never-retire-by-this-rule (the pole register's accepted disposition)."
  [{:keys [lines owner-fn task-ticket-id retirable?-fn]}]
  (let [retirable? (or retirable?-fn (constantly true))]
    (vec
     (for [line lines
           :let [owner (owner-fn line)]
           :when (and owner (= owner task-ticket-id) (retirable? line))]
       line))))

(defn- git-show [root ref path]
  "{:ok? bool :content string-or-nil}. :ok? false when ref itself cannot be
   resolved (a genuine read failure, not the ordinary case of the path
   simply not existing at a valid ref - a registry file that has never
   been created, or one this ticket's own tip legitimately deletes) OR
   when the blob exists at ref but could not be read."
  (if-not (zero? (:exit (git! root "cat-file" "-e" ref)))
    {:ok? false :content nil}
    (let [{:keys [exit out]} (git! root "show" (str ref ":" path))]
      (if (zero? exit)
        {:ok? true :content out}
        (if (zero? (:exit (git! root "cat-file" "-e" (str ref ":" path))))
          {:ok? false :content nil}
          {:ok? true :content nil})))))

(defn restore-other-tickets-registry-rows!
  "Impure orchestrator: for each registry-specs entry, reads origin/main's
   and the replay tree's (scratch, already carrying task-ticket-id's own
   paths from write-tree-from-paths!) own copies, computes rows-to-restore
   AND rows-to-retire (BL-1631 - a row's own owner is guaranteed never
   task-ticket-id for a restore candidate, so the two never contend for the
   same row), then rewrites the replay tree's file to carry the kept rows
   plus the restored ones (creating it if task-ticket-id's own tip deleted
   it outright, since a deletion can still need to carry another open
   ticket's row). Returns {:ok? true :restored [{:registry :file :owner}
   ...] :retired [{:registry :file :owner} ...]} or {:ok? false :reason
   \"...\"} (fail closed on an unreadable registry file on either side -
   never guess)."
  [{:keys [root scratch origin-main task-ticket-id]}]
  (let [open-ids (qa-hold-lib/open-ticket-ids-for scratch)]
    (loop [specs registry-specs
           restored []
           retired []]
      (if (empty? specs)
        {:ok? true :restored restored :retired retired}
        (let [{:keys [path row-key-fn owner-fn retirable?-fn]} (first specs)
              origin-read (git-show root origin-main path)
              replay-path (fs/path scratch path)
              replay-content (try (when (fs/exists? replay-path) (slurp (str replay-path)))
                                   (catch Exception _ ::unreadable))]
          (cond
            (not (:ok? origin-read))
            {:ok? false :reason (str "land-step replay: could not read " path " at origin/main " origin-main)}

            (= ::unreadable replay-content)
            {:ok? false :reason (str "land-step replay: could not read the replayed " path)}

            :else
            (let [origin-lines (registry-data-lines (:content origin-read))
                  replay-lines (registry-data-lines replay-content)
                  replay-keys (set (keep row-key-fn replay-lines))
                  restore (rows-to-restore {:origin-lines origin-lines
                                             :replay-keys replay-keys
                                             :row-key-fn row-key-fn
                                             :owner-fn owner-fn
                                             :task-ticket-id task-ticket-id
                                             :open-ticket-ids open-ids})
                  retire (rows-to-retire {:lines replay-lines
                                          :owner-fn owner-fn
                                          :task-ticket-id task-ticket-id
                                          :retirable?-fn retirable?-fn})
                  retire-set (set retire)
                  kept-data (remove retire-set replay-lines)]
              (when (or (seq restore) (seq retire))
                (fs/create-dirs (fs/parent replay-path))
                (spit (str replay-path) (rebuild-registry-content replay-content kept-data restore)))
              (recur (rest specs)
                     (into restored
                           (map (fn [line] {:registry path :file (row-key-fn line) :owner (owner-fn line)}) restore))
                     (into retired
                           (map (fn [line] {:registry path :file (row-key-fn line) :owner (owner-fn line)}) retire))))))))))

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

;; BL-1650 QA bounce (D1, 2026-09-20): `git cherry-pick -x` on a commit
;; whose content is ALREADY present on the target tree (a distinct commit,
;; identical diff - the everyday shape once a stray has been hand-landed
;; once, per the ticket's own FIRM constraint on the sibling-scoring side)
;; exits non-zero with "The previous cherry-pick is now empty ..." on
;; stderr and leaves a pending CHERRY_PICK_HEAD - git's own signal that
;; there is nothing to commit, not a conflict. Treating this identically
;; to a real conflict (the pre-fix behaviour) escalates every future
;; parcel whose ancestry carries an already-landed stray of this shape -
;; observed live landing BL-1650's own approved commit. Detected on stderr
;; text (git's own message, stable across the versions this project
;; targets) rather than tree/index state, which a real conflict can also
;; leave clean once resolved.
(defn cherry-pick-already-applied?
  [cherry-pick-result]
  (boolean (re-find #"previous cherry-pick is now empty" (str (:err cherry-pick-result)))))

;; ── BL-1716: a replay killed mid-build leaves its scratch worktree and
;;    branch behind - `cleanup!`/`drop-branch!` run on every exit path
;;    replay! itself reaches, but a SIGTERM/SIGKILL/host-restart reaches
;;    none of them. The next replay of the SAME ticket+commit must then
;;    tell a scratch a dead run left behind (safe to clear) apart from one
;;    a still-live run owns (FIRM: never touched) or one no record can
;;    place at all (BL-1385/BL-1390's posture: reap only what is provably
;;    dead, never what merely looks idle). ──────────────────────────────

(defn process-start-ms
  "Epoch ms of pid's CURRENT start time, or nil when pid is not running or
   its start time cannot be determined. Recomputing this for the same
   still-running pid always answers the same value - a process's start
   time never changes over its own lifetime - which is what lets a REUSED
   pid be told apart from the run that actually owns a leftover scratch."
  [pid]
  (try
    (when-let [ph (.orElse (java.lang.ProcessHandle/of (long pid)) nil)]
      (when (.isAlive ph)
        (some-> (.orElse (.startInstant (.info ph)) nil) (.toEpochMilli))))
    (catch Exception _ nil)))

(defn replay-scratch-owner-record-path
  "Where a scratch's owning run's {pid, start-ms} is recorded - a SIBLING
   of the scratch worktree directory (never inside it), so it is never
   mistaken for parcel-authored content and survives long enough for THIS
   same cleanup pass to remove it explicitly after `fs/delete-tree`
   clears the directory itself."
  [common-dir id]
  (str (fs/path common-dir "land-replay-worktrees" (str id ".owner.json"))))

(defn write-replay-scratch-owner-record!
  [path pid start-ms]
  (try
    (fs/create-dirs (fs/parent path))
    (spit path (json/generate-string {:pid pid :start-ms start-ms}))
    true
    (catch Exception _ false)))

(defn read-replay-scratch-owner-record
  "The {:pid :start-ms} a scratch's owner record holds, or nil when the
   record is missing, unreadable, or malformed - never thrown, matching
   replay!'s own no-throw contract."
  [path]
  (try
    (when (fs/exists? path)
      (json/parse-string (slurp path) true))
    (catch Exception _ nil)))

(defn stale-scratch-age-bound-ms []
  (let [hours (or (some-> (System/getenv "SWARMFORGE_LAND_REPLAY_STALE_SCRATCH_HOURS")
                          (Double/parseDouble))
                  2.0)]
    (long (* hours 3600000))))

(defn- scratch-age-ms!
  [scratch]
  (try
    (- (System/currentTimeMillis) (.toMillis (fs/last-modified-time scratch)))
    (catch Exception _ 0)))

(defn- branch-ref-age-ms!
  "Age of a branch's own loose ref file - the only age signal available
   for a branch that survives with no scratch directory (a past success's
   own worktree cleanup, or a `worktree add -b` interrupted after writing
   the ref but before finishing the checkout). 0 (never past any bound)
   when the ref has been packed into packed-refs or is otherwise
   unreadable - FIRM: an age this function cannot establish is never
   mistaken for staleness."
  [common-dir branch]
  (try
    (- (System/currentTimeMillis)
       (.toMillis (fs/last-modified-time (fs/path common-dir "refs" "heads" branch))))
    (catch Exception _ 0)))

(defn stale-scratch-decision
  "Pure: whether a pre-existing replay scratch (a worktree directory
   already sitting at this run's own scratch path - a leftover from an
   earlier attempt at the SAME ticket+commit) may be cleared before this
   run builds its own.

   :exists? - false trivially proceeds; there is nothing to reap.
   :record - the {:pid :start-ms} owner record read back for the scratch,
     or nil when none was ever written (a scratch predating this fix, or
     one whose owning run died between `worktree add` and the write).
   :owner-alive? - true only when :record is present AND a live process
     with that EXACT pid+start-ms is running right now - irrelevant, and
     never read, when :record is nil; a reused pid is never mistaken for
     the run that actually made this scratch.
   :age-past-bound? - true when a RECORDLESS scratch is older than the
     stale-scratch age bound - irrelevant, and never read, when :record
     is present, since a record's own liveness is authoritative over age.

   Returns {:action :proceed} (nothing to reap, or a dead leftover - safe
   to clear and continue) or {:action :refuse :owner-pid pid-or-nil} -
   FIRM: a live or an unestablished owner is never touched."
  [{:keys [exists? record owner-alive? age-past-bound?]}]
  (cond
    (not exists?) {:action :proceed}
    (and record owner-alive?) {:action :refuse :owner-pid (:pid record)}
    record {:action :proceed}
    age-past-bound? {:action :proceed}
    :else {:action :refuse :owner-pid nil}))

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
  [{:keys [root commit task-ticket-id own-paths passengers tree-guards-fn stray-commits] :as opts}]
  (let [origin-main (if (contains? opts :origin-main) (:origin-main opts) (origin-main-sha root))
        common-dir (git-common-dir root)
        run-guards (or tree-guards-fn (fn [tree-root _] (run-replayed-tree-guards tree-root)))]
    (cond
      (nil? origin-main)
      {:success false :reason "land-step replay: could not resolve origin/main"}

      (nil? common-dir)
      {:success false :reason (str "land-step replay: could not resolve the git directory of " root)}

      :else
      (let [id (str task-ticket-id "-" (subs commit 0 (min 10 (count commit))))
            branch (str "land-replay/" id)
            scratch (str (fs/path common-dir "land-replay-worktrees" id))
            owner-record-path (replay-scratch-owner-record-path common-dir id)
            ;; Split so the SUCCESS path (below) can remove only the
            ;; worktree directory - the branch AND its owner record both
            ;; survive success on purpose (the branch for QA's own land
            ;; action; the record so a LATER re-land attempt for the SAME
            ;; ticket+commit can tell this now-ownerless branch apart from
            ;; one a still-running replay owns, rather than reading "no
            ;; record" and waiting out the age bound on a branch that is
            ;; provably done, not merely idle).
            remove-worktree-dir! (fn []
                                    (git! root "worktree" "remove" "-f" scratch)
                                    (fs/delete-tree scratch {:force true}))
            remove-owner-record! (fn [] (fs/delete-if-exists owner-record-path))
            ;; Used to abandon a build attempt outright (a failure, or
            ;; reaping a confirmed-dead leftover before starting a fresh
            ;; one) - both the directory and the record go together.
            cleanup! (fn [] (remove-worktree-dir!) (remove-owner-record!))
            ;; `worktree add -b` creates the branch even when it then fails to
            ;; make the checkout, so every failure path deletes it - including
            ;; this one, which used to return early and leak it. Deleting a
            ;; branch that was never created is not itself a failure: git!
            ;; reports a status and the status is deliberately ignored.
            drop-branch! (fn [] (git! root "branch" "-q" "-D" branch))
            branch-exists? (zero? (:exit (git! root "show-ref" "--verify" "--quiet" (str "refs/heads/" branch))))
            dir-exists? (fs/directory? scratch)
            ;; A branch can survive with NO directory - a past SUCCESSFUL
            ;; replay's own worktree cleanup removes the directory but
            ;; (as of this fix) never the branch, and a `worktree add -b`
            ;; interrupted mid-checkout can leave the branch ref written
            ;; (near-instant) without ever finishing the working tree (git's
            ;; own pre-existing failure shape this file's own comment above
            ;; already documents). Either way it is a leftover to classify,
            ;; not something a directory-only check would ever see.
            leftover? (or dir-exists? branch-exists?)
            record (when leftover? (read-replay-scratch-owner-record owner-record-path))
            owner-alive? (boolean
                          (when record
                            (= (:start-ms record) (process-start-ms (:pid record)))))
            leftover-age-ms (cond
                               dir-exists? (scratch-age-ms! scratch)
                               branch-exists? (branch-ref-age-ms! common-dir branch)
                               :else 0)
            age-past-bound? (and leftover? (not record)
                                 (>= leftover-age-ms (stale-scratch-age-bound-ms)))
            decision (stale-scratch-decision {:exists? leftover? :record record
                                               :owner-alive? owner-alive?
                                               :age-past-bound? age-past-bound?})]
        (if (= :refuse (:action decision))
          {:success false
           :reason (str "land-step replay: scratch " scratch
                        (if-let [pid (:owner-pid decision)]
                          (str " is owned by a live run (pid " pid ") - refusing to touch it")
                          " has an unestablished owner - refusing to touch it"))}
        (do
          (when leftover? (cleanup!) (drop-branch!))
          (let [create (git! root "worktree" "add" "-q" "-b" branch scratch origin-main)]
        (if-not (zero? (:exit create))
          (do (cleanup!)
              (drop-branch!)
              {:success false :reason (str "land-step replay: could not create worktree " scratch
                                            " off origin/main: " (str/trim (or (:err create) "")))})
          (do
            (write-replay-scratch-owner-record!
             owner-record-path
             (.pid (java.lang.ProcessHandle/current))
             (process-start-ms (.pid (java.lang.ProcessHandle/current))))
          ;; BL-1650 items 1-2: any closed-owner pure-evidence strays are
          ;; cherry-picked (`-x`, keeping the stray's own author/subject)
          ;; onto the scratch branch BEFORE the parcel's own tip-pure
          ;; commit, in authored order - "lands on main before the
          ;; parcel's replay" per the ticket's FIRM constraint. A failed
          ;; cherry-pick aborts the whole replay (fail-closed) UNLESS
          ;; BL-1670's stray-superseded-verdict finds the conflict itself
          ;; superseded - nothing is ever published half-landed either way.
          (let [stray-failure (atom nil)
                stray-landed (atom [])]
            (doseq [{:keys [sha sibling paths]} stray-commits]
              (when-not @stray-failure
                (let [cp (git! scratch "cherry-pick" "-x" sha)]
                  (cond
                    (zero? (:exit cp))
                    (swap! stray-landed conj
                           {:sha sha :sibling sibling :paths paths
                            :landed-sha (str/trim (:out (git! scratch "rev-parse" "HEAD")))})

                    ;; BL-1650 D1: already on the target tree under a
                    ;; different sha - skip the empty patch (clears the
                    ;; pending CHERRY_PICK_HEAD) and record it as landed
                    ;; at the tree's CURRENT tip, never as a failure.
                    (cherry-pick-already-applied? cp)
                    (do (git! scratch "cherry-pick" "--skip")
                        (swap! stray-landed conj
                               {:sha sha :sibling sibling :paths paths
                                :landed-sha (str/trim (:out (git! scratch "rev-parse" "HEAD")))
                                :already-applied? true}))

                    ;; BL-1670: a real conflict is checked against both
                    ;; superseded grounds BEFORE the abort below erases the
                    ;; conflict-marked working tree ground (b) reads.
                    :else
                    (let [superseded (stray-superseded-verdict
                                       {:root root :scratch scratch :origin-main origin-main
                                        :sha sha :owner sibling :paths paths})]
                      (git! scratch "cherry-pick" "--abort")
                      (if superseded
                        (swap! stray-landed conj
                               {:sha sha :sibling sibling :paths paths
                                :superseded? true :reason (:reason superseded)})
                        (reset! stray-failure
                                (str "land-step replay: could not cherry-pick stray evidence commit " sha))))))))
          (if @stray-failure
            (do (cleanup!)
                (drop-branch!)
                {:success false :reason @stray-failure})
          (let [applied? (write-tree-from-paths! scratch commit own-paths)]
            (if-not applied?
              (do (cleanup!)
                  (drop-branch!)
                  {:success false :reason (str "land-step replay: could not apply " task-ticket-id "'s own paths from " commit)})
              ;; BL-1604: restores another open ticket's registry row BEFORE
              ;; the index is read/committed - a row it restores rides the
              ;; SAME land, never a second commit.
              (let [restore-result (restore-other-tickets-registry-rows!
                                     {:root root :scratch scratch :origin-main origin-main
                                      :task-ticket-id task-ticket-id})]
                (if-not (:ok? restore-result)
                  (do (cleanup!)
                      (drop-branch!)
                      {:success false :reason (:reason restore-result)})
                  (do
                    (doseq [registry (into #{} (map :registry) (concat (:restored restore-result) (:retired restore-result)))]
                      (git! scratch "add" "--" registry))
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
                          ;; Directory only here - a TRUE success (below)
                          ;; leaves the branch AND its owner record both
                          ;; surviving on purpose (see the comment above
                          ;; `remove-worktree-dir!`'s definition).
                          (remove-worktree-dir!)
                          (if (seq refusals)
                            (do (drop-branch!)
                                (remove-owner-record!)
                                {:success false
                                 :reason (str "land-step replay: refusing to publish " task-ticket-id
                                              " - the replayed tree is not self-consistent with passenger sibling(s) "
                                              (str/join "," (sort passengers))
                                              " riding on a shared path (BL-1375 invariant 2 / BL-1324): "
                                              (str/join "; " refusals))})
                            {:success true :commit sha :branch branch :passengers (set passengers)
                             :restored-registry-rows (:restored restore-result)
                             :retired-registry-rows (:retired restore-result)
                             :stray-landed @stray-landed}))))))))))))))))))))

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

;; ── BL-1678 item 3: the publish step's own backstop ───────────────────────
;;
;; land-plan/land_step_cli.bb already build a genuinely tip-pure commit for
;; every verdict now (the fix one door up in this same file) - a caller that
;; only ever publishes what THIS land step handed it never needs this check
;; to refuse anything. It exists for the caller that does not: 2026-09-21's
;; incident was QA pushing its OWN branch tip (`git push origin HEAD:main`),
;; never routed through land_step_cli.bb at all, after an earlier, now-stale
;; LAND_CLEAN check on a narrower commit. This is the independent check
;; land_main_publish.sh runs on whatever sha it is about to push, whoever
;; built it and however it got there - defense in depth, not a second
;; decision-maker QA is meant to consult instead of land-plan.
(defn verify-push-safe
  "{:safe? true} when `commit` is fit to push to origin/main as-is:
   exactly one parent, its own subject names a ticket, and every path its
   diff against `origin-main` touches is attributed either to that same
   ticket or to a ticket already closed on origin/main (`closed-on-main?`
   - the same landed/unlanded distinction BL-1546's refusal and land-plan
   itself already use).

   {:safe? false :reason \"...\"} otherwise, naming: a merge commit (more
   than one parent - invariant 2, 'a land never pushes a merge commit as
   main'); a commit whose own subject names no ticket (nothing to call
   its own paths against); or the first (sorted) offending path and the
   unapproved ticket id it is attributed to (invariant 1). Fail-closed
   throughout: an unreadable parent list, an unresolved origin-main, or an
   unreadable attribution walk all refuse rather than pass a check that
   could not actually run."
  [{:keys [root commit origin-main]}]
  (let [origin-main (or origin-main (origin-main-sha root))]
    (if-not origin-main
      {:safe? false :reason "land-step: origin/main could not be resolved"}
      (let [parents-res (git! root "rev-list" "--parents" "-n1" commit)]
        (if-not (zero? (:exit parents-res))
          {:safe? false :reason (str "land-step: could not read " commit "'s parents")}
          (let [tokens (remove str/blank? (str/split (str/trim (:out parents-res)) #"\s+"))
                parent-count (dec (count tokens))]
            (cond
              (> parent-count 1)
              {:safe? false :reason "a merge commit is never pushed as main"}

              :else
              (let [task-ticket-id (commit-ticket-id root commit)]
                (if-not task-ticket-id
                  {:safe? false
                   :reason (str commit " names no ticket in its own subject - refusing to push it as a land")}
                  (let [attribution (delivered-attribution root origin-main commit)]
                    (if (nil? attribution)
                      {:safe? false
                       :reason (str "land-step: could not read " commit "'s attribution against origin/main")}
                      (let [offenders (sort
                                       (for [[path {:keys [owners]}] attribution
                                             :when (seq owners)
                                             owner owners
                                             :when (and (not= owner task-ticket-id)
                                                        (not (true? (closed-on-main? root origin-main owner))))]
                                         [path owner]))]
                        (if (seq offenders)
                          (let [[path owner] (first offenders)]
                            {:safe? false
                             :reason (str path " attributed to the unapproved " owner)})
                          {:safe? true})))))))))))))

;; ── BL-1713: a land never blesses a range with none of the ticket's own
;; work ─────────────────────────────────────────────────────────────────
;;
;; A citation that resolves to origin/main itself, or to a tip whose own
;; new commits never name the landing ticket, has nothing of that ticket's
;; to land - the only thing land-plan's own build could previously do with
;; such a range was retire the ticket's standing-red register rows and
;; print LAND_CLEAN for an otherwise-empty diff (BL-1691/BL-1694,
;; 2026-09-24: QA's own citation-mismatch bug, BL-1713's other half,
;; produced exactly this range in both cases). Reuses the SAME subject
;; attribution `commit-subject-attribution` already reads per-commit and
;; the SAME candidate walk `land-plan` already computes (`ancestry-commits
;; root origin-main commit`) - never a second notion of "names the ticket".
(defn- range-credits-ticket?
  "True when at least one commit in `candidates` (origin-main..commit,
   already walked) is subject-attributed to `task-ticket-id` - an ordinary
   land's common case. False for an empty range (commit resolves to
   origin-main itself) or a range whose own commits never name this
   ticket, whatever else they name."
  [root task-ticket-id candidates]
  (boolean (some #(contains? (:ids (commit-subject-attribution root %)) task-ticket-id) candidates)))

(defn land-plan
  "The land step's own decision: {:action :land :own-paths [...] :commit sha
   :branch name} when no entanglement is present; {:action :replay
   :entangled #{...} :own-paths [...] :commit sha :branch name} when a
   tip-pure rebuild is the remedy - EITHER WAY the commit is ALREADY BUILT
   (BL-1447: land-plan calls replay! itself and verifies the result before
   ever returning :land or :replay, so the caller must publish
   `:commit`/`:branch` directly and never call replay! again, which would
   collide on the same branch name; BL-1678: :land used to mean 'publish
   the cited commit unchanged' - it now means exactly what :replay always
   meant, own-paths built fresh off origin-main, only ever excluding
   nothing because :unlanded was empty. A caller that read `:commit` only
   on :replay and re-used the caller's own cited commit on :land publishes
   the wrong sha now); {:action :escalate :reason \"...\"} when even the
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
          (entangled-siblings root commit task-ticket-id extra-paths-fn lines-of origin-main)
          ;; BL-1650 items 1-2: closed-owner pure-evidence strays this land
          ;; step may land itself, computed over the SAME full-ancestry
          ;; `candidates` the detection above already walked - never a
          ;; second candidate walk.
          stray-commits (when candidates
                          (stray-evidence-commits root origin-main task-ticket-id candidates))
          ;; BL-1650 QA bounce (D1 rework, tip-content ruling): split off
          ;; every stray whose paths are ALREADY byte-identical between the
          ;; tip and origin/main - these need no cherry-pick attempt at all
          ;; (scenario 06) and land only in the sense that nothing is left
          ;; to land; the rest still go through replay!'s cherry-pick loop
          ;; exactly as before.
          already-landed-strays (filter #(stray-tip-already-landed? root origin-main commit (:sha %) (:paths %))
                                         stray-commits)
          strays-to-cherry-pick (remove #(stray-tip-already-landed? root origin-main commit (:sha %) (:paths %))
                                         stray-commits)
          already-landed-stray-ids (into #{} (map :sibling) already-landed-strays)
          ;; Both groups' paths are excluded from this ticket's own-paths
          ;; alike (own-paths' :stray-paths clause) - unchanged union.
          stray-paths (into #{} (mapcat :paths) stray-commits)]
      (cond
        warning {:action :escalate :reason warning}

        ;; BL-1713 invariant 1: checked BEFORE any replay is built - a
        ;; range with nothing of the ticket's own in it has no work to
        ;; publish, whatever else `entangled-siblings`/`stray-commits`
        ;; above found reading it. `candidates` nil (the walk itself could
        ;; not run) is left to the existing downstream fail-open paths,
        ;; unchanged - this only ever fires on a range it COULD read.
        (and candidates (not (range-credits-ticket? root task-ticket-id candidates)))
        {:action :escalate
         :reason (str "land-step: " origin-main ".." commit
                      " holds no commit credited to " task-ticket-id)}

        :else
        ;; BL-1678: a clean tip (no entangled sibling found) used to
        ;; return bare {:action :land} here - the caller then published
        ;; `commit` exactly as cited, whatever else had ridden onto the
        ;; branch it came from since the citation was made (invariant 2's
        ;; TOCTOU gap: a re-merge after the LAND_CLEAN check, never
        ;; re-checked, reached origin/main verbatim on 2026-09-21). A
        ;; clean tip now builds the SAME tip-pure own-paths/replay! commit
        ;; the entangled branch always built - :unlanded is empty, so
        ;; nothing is excluded and the build reproduces the delivered diff
        ;; exactly, but it is a FRESH single-parent commit off origin-main,
        ;; never the cited commit itself, so a merge commit (or anything
        ;; else not this ticket's own paths) can never be what gets
        ;; published just because it happened to be the tip asked about.
        (let [clean? (empty? entangled)
              {:keys [paths warning passengers excluded content-clear]}
              (own-paths root commit task-ticket-id unlanded nil nil
                         {:attribution (when attribution @attribution)
                          :stray-paths stray-paths
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
                                           :origin-main origin-main
                                           :stray-commits strays-to-cherry-pick})]
              (if-not (:success replay-result)
                {:action :escalate :reason (:reason replay-result) :unlanded unlanded}
                (let [parcel-paths (parcel-commit-paths root task-ticket-id origin-main commit)]
                  (if (nil? parcel-paths)
                    (do (git! root "branch" "-q" "-D" (:branch replay-result))
                        {:action :escalate
                         :reason (str "land-step: could not read " task-ticket-id
                                      "'s own commit history to verify the replay")
                         :unlanded unlanded})
                    ;; BL-1604: the two registry files are EXEMPT from the
                    ;; byte-identity completeness check - restore-other-
                    ;; tickets-registry-rows! above deliberately makes the
                    ;; replay's copy diverge from the cited tip's (adding
                    ;; back rows the tip legitimately never carried, another
                    ;; open ticket's own), the sanctioned exception this
                    ;; ticket exists to create. Every other own-path keeps
                    ;; the full byte-for-byte check unchanged.
                    (let [registry-paths (set (map :path registry-specs))
                          offenders (replay-completeness-offenders
                                     root commit (:commit replay-result)
                                     (remove registry-paths parcel-paths))]
                      (if (seq offenders)
                        (do (git! root "branch" "-q" "-D" (:branch replay-result))
                            {:action :escalate
                             :reason (str "replay-incomplete: " (str/join " " offenders))
                             :unlanded unlanded})
                        ;; BL-1650 items 1-2: every sibling whose stray
                        ;; commit was just cherry-picked onto this replay
                        ;; branch really did land here - moved from
                        ;; :unlanded/:entangled reporting into :landed,
                        ;; never left printed ENTANGLED_SIBLING for content
                        ;; this same replay just published. A sibling whose
                        ;; stray needed no cherry-pick at all (tip already
                        ;; byte-identical to origin/main, scenario 06) is
                        ;; folded in exactly the same way, by the same
                        ;; posture - it never rode a fresh LAND_STRAY_
                        ;; EVIDENCE_LANDED line because nothing was landed
                        ;; for it, but it is still LANDED_SIBLING, not
                        ;; entangled.
                        (let [stray-landed-ids (into #{} (map :sibling) (:stray-landed replay-result))
                              all-stray-landed-ids (into stray-landed-ids already-landed-stray-ids)
                              unlanded (into #{} (remove all-stray-landed-ids) unlanded)
                              landed (into (or landed #{}) all-stray-landed-ids)]
                          {:action (if clean? :land :replay)
                           :entangled entangled :landed landed :unlanded unlanded
                           :landed-paths (or landed-paths {})
                           :excluded (or excluded [])
                           :content-clear (or content-clear [])
                           :own-paths paths :passengers (or passengers #{})
                           :commit (:commit replay-result) :branch (:branch replay-result)
                           :restored-registry-rows (:restored-registry-rows replay-result)
                           :retired-registry-rows (:retired-registry-rows replay-result)
                           :stray-landed (:stray-landed replay-result)})))))))))))))

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

;; ── BL-1467: the re-point keeps QA's bookkeeping for OTHER tickets ───────
;;
;; The reset above moves the branch/worktree to origin/main; anything
;; local-only on the old tip that is not superseded by the just-landed
;; ticket's own replay is either bookkeeping for a DIFFERENT ticket (a
;; bounce's evidence file and bounce_history edit, a follow-up finding -
;; QA's own record of work on that OTHER ticket, never captured by this
;; land's own-paths walk) or genuinely local-only content this land never
;; owned (a revert of a bounced merge, an unrelated code commit) - the
;; 2026-09-07 incident (BL-1450's revert and evidence commits, dropped
;; silently, survived only in the reflog and the coder's own branch).

(def ^:private repoint-bookkeeping-path-pattern
  ;; backlog/evidence/<id>-*, backlog/<active|paused|done|hold|archive>[/<milestone>]/<id>-*.yaml,
  ;; backlog/topics/<id>.json - the same shapes the ticket's own "How"
  ;; names, keyed to whichever ticket id the commit's own subject names.
  (fn [id]
    (let [q (java.util.regex.Pattern/quote (str id))]
      (re-pattern (str "^backlog/(?:evidence/" q "-[^/]*"
                       "|(?:active|paused|done|hold|archive)(?:/[^/]+)?/" q "-[^/]*\\.yaml"
                       "|topics/" q "\\.json)$")))))

(defn- repoint-bookkeeping-path? [id path]
  (boolean (re-matches (repoint-bookkeeping-path-pattern id) path)))

;; {:disposition :keep :sha :subject} or {:disposition :drop :sha :subject
;; :reason "..."} - never nil, so every candidate is accounted for one way
;; or the other (this ticket's invariant 1: named, not silently lost).
(defn- classify-repoint-candidate [root commit landed-task-ticket-id]
  (let [subject (or (commit-subject root commit) "")]
    (cond
      (merge-commit? root commit)
      {:disposition :drop :sha commit :subject subject :reason "merge"}

      (task-scope-gate-lib/revert-subject? subject)
      {:disposition :drop :sha commit :subject subject :reason "revert"}

      :else
      (let [id (commit-ticket-id root commit)
            paths (commit-changed-paths root commit)]
        (cond
          (nil? id)
          {:disposition :drop :sha commit :subject subject :reason "names no ticket"}

          (= id landed-task-ticket-id)
          {:disposition :drop :sha commit :subject subject
           :reason (str "already carried by " landed-task-ticket-id "'s own land")}

          (nil? paths)
          {:disposition :drop :sha commit :subject subject :reason "could not read its own diff"}

          (and (seq paths) (every? #(repoint-bookkeeping-path? id %) paths))
          {:disposition :keep :sha commit :subject subject}

          :else
          {:disposition :drop :sha commit :subject subject :reason "not bookkeeping"})))))

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
   read never has to diff the branch by hand to see what happened.

   BL-1467: `:landed-task-ticket-id` is an OPTIONAL key - the ticket this
   land just published, so a local-only commit that is itself that
   ticket's own bookkeeping (already carried by its own replay) is dropped
   as redundant rather than re-applied a second time. Omitted (an old
   caller, or a hand-run repoint with no ticket in view), every local-only
   commit is judged purely on shape - the same guards, unchanged.

   Every commit reachable from `old-tip` and not from `origin-main` is
   enumerated BEFORE the reset and classified: a commit whose own subject
   is a revert/reapply, a merge, names no ticket, or names the landed
   ticket itself is DROPPED; a commit naming a DIFFERENT ticket whose
   every changed path is that ticket's own bookkeeping shape
   (`backlog/evidence/<id>-*`, a `backlog/**/<id>-*.yaml` ticket file, or
   `backlog/topics/<id>.json`) is KEPT - re-applied, oldest first, onto
   the new tip after the reset. A kept commit that conflicts is aborted
   and re-classified DROPPED with reason \"conflict\", leaving the
   worktree clean at whatever already applied; one whose patch is already
   empty against the new tip is recorded kept (`:already-applied? true`),
   never dropped - its content is already there. Every drop names its sha
   and subject (invariant 1: nothing is silently lost - it is either on
   the new tip or named here).

   The candidate walk runs before the reset only to decide WHAT to keep;
   nothing about it prevents the enumeration also succeeding after (the
   old tip's own history does not move). A walk that cannot be read at
   all skips the WHOLE re-point rather than resetting blind (fail-closed,
   the same posture this ticket's invariant 1 takes everywhere else) -
   BL-1438's own promise stands regardless: a skip never fails the land."
  [{:keys [root in-process-dir landed-task-ticket-id]}]
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
          (let [candidates (ancestry-commits root origin-main old-tip)]
            (if (nil? candidates)
              (let [r {:action :skipped
                       :reason (str "land-step: could not read " old-tip "'s own local-only history against " origin-main)
                       :old-tip old-tip}]
                (log-repoint! root r) r)
              ;; Oldest first: `ancestry-commits` (rev-list) answers
              ;; newest-first, and a cherry-pick replay must apply in
              ;; authored order.
              (let [classified (mapv #(classify-repoint-candidate root % landed-task-ticket-id)
                                     (reverse candidates))
                    reset-res (git! root "reset" "--hard" origin-main)]
                (if-not (zero? (:exit reset-res))
                  (let [r {:action :skipped :reason "land-step: branch re-point failed" :old-tip old-tip}]
                    (log-repoint! root r) r)
                  (let [kept (atom [])
                        dropped (atom (into [] (comp (filter #(= :drop (:disposition %)))
                                                     (map #(select-keys % [:sha :subject :reason])))
                                            classified))]
                    (doseq [{:keys [disposition sha subject]} classified
                            :when (= disposition :keep)]
                      (let [cp (git! root "cherry-pick" sha)]
                        (cond
                          (zero? (:exit cp))
                          (swap! kept conj {:sha sha :subject subject})

                          (cherry-pick-already-applied? cp)
                          (do (git! root "cherry-pick" "--skip")
                              (swap! kept conj {:sha sha :subject subject :already-applied? true}))

                          :else
                          (do (git! root "cherry-pick" "--abort")
                              (swap! dropped conj {:sha sha :subject subject :reason "conflict"})))))
                    (let [new-tip (str/trim (:out (git! root "rev-parse" "HEAD")))
                          r {:action :repointed :old-tip old-tip :new-tip new-tip
                             :kept @kept :dropped @dropped}]
                      (log-repoint! root r) r)))))))))))
