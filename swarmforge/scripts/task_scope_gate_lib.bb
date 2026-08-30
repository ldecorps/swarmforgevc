;; task_scope_gate_lib.bb — BL-1192: refuses a git_handoff whose cited
;; commit's diff against origin/main carries a path that POSITIVELY belongs
;; to a DIFFERENT ticket than the one the handoff's task: names.
;;
;; The 2026-08-27 shift logged ten `behavior` QA bounces; the measured
;; subset (BL-596, BL-754, BL-780, BL-980, BL-1173, BL-1174) shared one
;; meta-cause: a handoff naming ticket A cited a commit whose tree diff vs
;; origin/main also included another ticket's backlog YAML or feature
;; file - an entangled tip, caught only by QA's manual BL-506 inventory
;; five stages later. BL-531 already refuses this shape at the
;; documenter→QA edge; this gate arms the SAME question on every
;; `type: git_handoff` hop (cleaner, architect, hardener, documenter, QA
;; alike), so an entangled tip is refused where it first appears instead of
;; riding the pipeline to QA.
;;
;; POSITIVE IDENTIFICATION ONLY (invariant 1's "only a positive foreign-
;; ticket path overlap may refuse" - the mirror of invariant 1's own
;; fail-open-is-absolute half): a changed path counts only when its OWN
;; basename names a ticket id, via pipeline-stage-lib/extract-ticket-id -
;; the same exact-id-equality extractor task_commit_coherence_gate_lib.bb
;; (BL-953) already uses, never a second parser (invariant 2). This
;; deliberately covers backlog/**/*.yaml, backlog/evidence/*.md,
;; specs/features/*.feature and docs/how-to/*.md - the artifact shapes
;; that actually carry a ticket id in their own name, and the exact
;; shapes the six measured bounces entangled. A functional code path
;; (extension/src/foo.ts) has no deterministic id in its own name and is
;; never flagged by this gate - that silence is not evidence of clean
;; scope, only of "this gate cannot see it," which is why invariant 1's
;; fail-open covers it structurally rather than this gate guessing.
;;
;; FAIL-OPEN IS ABSOLUTE: origin/main unreadable, the diff itself
;; unreadable, the task name resolving to no ticket, or every changed path
;; resolving to no ticket (or only the task's own) - every one of these
;; accepts, same posture as BL-953/BL-972.

(ns task-scope-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "salvage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "landed_ticket_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_gather_lib.bb")))

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

;; BL-1192 architect bounce D1 (2026-08-28): the literal origin/main...commit
;; range explodes into a false-positive avalanche on this repo's real git
;; topology - a role's own branch legitimately accumulates many OTHER,
;; already-forwarded tickets' commits (batch roles process several tickets
;; per turn; origin/main lags local work by design) long before origin/main
;; catches up. A first-parent-single-commit range (the previous attempt)
;; under-reaches instead, missing entanglement introduced across a chain of
;; this task's OWN commits.
;;
;; Scope actually implemented: the UNION of each commit's own tree diff,
;; walked first-parent from "the commit most recently handed off for this
;; exact task" (salvage-lib/latest-item-handoffs - the authoritative,
;; already-recorded boundary, never grepped/guessed) up to the cited commit,
;; but ONLY for commits whose own message names this task's ticket id. A
;; batch role's sibling-ticket commits interleaved in the same turn (each
;; tagged with THEIR OWN ticket id, never this one) contribute nothing -
;; this is what solves the accumulation problem empirically (verified
;; against this repo's own real cleaner batch turn, commit b033583c08:
;; origin/main...commit showed 64 paths across ~6 tickets; this scope
;; shows 1, the task's own evidence file). A commit that genuinely IS
;; tagged for this task but ALSO touches a foreign ticket's path is still
;; caught in full - the gate's actual purpose survives.
;;
;; No prior handoff recorded for this task (its very first hop) - the
;; candidate is the cited commit alone, nothing to walk back through.

;; Evidence-only paths under backlog/evidence/<task-id>-* for the NAMED
;; task never count as foreign overlap (they are the task's own
;; paperwork, not entanglement) - checked before the general id-mismatch
;; test so a task's own evidence file, which by construction names its
;; own id, is never mistaken for anything else either.
(defn- own-evidence-path? [path task-ticket-id]
  (and (str/starts-with? path "backlog/evidence/")
       (str/starts-with? (fs/file-name path) (str task-ticket-id "-"))))

(defn ticket-id-for-path
  "Positive path→ticket-id mapping (direction, per the ticket's own How
   section): the id named in this path's OWN basename, restricted to the
   artifact shapes that actually carry one - backlog/**, specs/features/**,
   and docs/how-to/** - never a functional code path, which has no
   deterministic id in its own name. nil (never a guess) for everything
   else."
  [path]
  (when (or (str/starts-with? path "backlog/")
            (str/starts-with? path "specs/features/")
            (str/starts-with? path "docs/how-to/"))
    (pipeline-stage-lib/extract-ticket-id (fs/file-name path))))

;; ── BL-1276: a ticket's own declared acceptance contract is not foreign ──
;;
;; The specifier writes `acceptance: specs/features/BL-<other>-....feature`
;; deliberately: a defect filed against a shipped check amends the durable
;; contract for that check rather than forking it in two. Before this, the one
;; file such a ticket MUST edit was the one file this gate read as foreign, and
;; every move its author had was worse than the block - a tip-pure commit drops
;; the scenarios the ticket exists to add, BL-1241's rebuild hatch replays
;; exactly the path set that excludes the file, and a re-labelled commit
;; subject passes by pretending the work belongs to someone else. That is the
;; refusal-with-no-available-action shape of BL-1237/BL-1240/BL-1241, and
;; BL-1246 is the live instance it was found on.
;;
;; The exemption is EXACT and derived, never a pairing table: only the literal
;; path string the ticket declares, read from the ticket's own landed YAML. Any
;; OTHER path belonging to that same foreign ticket - its backlog YAML, its
;; how-to - is still reported. A declaration that cannot be read grants no
;; exemption at all, and the refusal says so, because a refusal that silently
;; skipped the exemption would send its recipient off to rebuild a commit that
;; did not need rebuilding: the very shape this fix removes.

(defn- unquote-value [value]
  (str/replace (str/trim value) #"^[\"']|[\"']$" ""))

(defn- plain-scalar
  "The value of a single-line scalar field, or nil for a block scalar. A
   block form (`acceptance: |`) declares no path this gate can compare
   against - BL-922's known unreadable shape - and correctly grants nothing."
  [value]
  (let [v (str/trim value)]
    (when (and (seq v)
               (not (str/starts-with? v "|"))
               (not (str/starts-with? v ">")))
      (unquote-value v))))

(defn declared-acceptance-path
  "Pure: the path a ticket's own YAML declares in its `acceptance:` field, or nil."
  [ticket-yaml]
  (some (fn [line]
          (when (str/starts-with? line "acceptance:")
            (plain-scalar (subs line (count "acceptance:")))))
        (str/split-lines (or ticket-yaml ""))))

(defn declared-retires-paths
  "Pure: the paths a ticket's own YAML declares in its `retires:` list.
   BL-1276's amendment: a retirement ticket by construction edits the
   SUPERSEDED ticket's .feature file - BL-1006 requires exactly that ('retire,
   never reword') - so without this the gate refuses a constitutionally
   mandated edit. Entries are read raw, one path per line, same caution as
   required_wiring:. The `RETIRE-WITH: <id>` comment convention inside a
   feature file is documentation only and is deliberately NOT read here."
  [ticket-yaml]
  (let [lines (str/split-lines (or ticket-yaml ""))]
    (loop [remaining (drop-while #(not (str/starts-with? % "retires:")) lines)
           collected []
           in-list? false]
      (if (empty? remaining)
        collected
        (let [line (first remaining)]
          (cond
            (and (not in-list?) (str/starts-with? line "retires:"))
            ;; `retires: path` (inline single) or `retires:` opening a list.
            (if-let [inline (plain-scalar (subs line (count "retires:")))]
              (recur (rest remaining) (conj collected inline) true)
              (recur (rest remaining) collected true))

            ;; A list entry belonging to this field: an indented `- value`.
            (and in-list? (re-matches #"^\s+-\s+\S.*$" line))
            (recur (rest remaining)
                   (conj collected (unquote-value (str/replace line #"^\s+-\s+" "")))
                   true)

            ;; A blank or comment line inside the block does not end it.
            (and in-list? (or (str/blank? line) (re-matches #"^\s*#.*$" line)))
            (recur (rest remaining) collected true)

            ;; Anything else at column 0 ends the field.
            :else collected))))))

(defn declared-exempt-paths
  "Every path the ticket declares as part of its OWN deliverable, across every
   declaring field. ONE accessor on purpose (the amendment's own wording): a
   third declaring field later is one line here, never a new branch at the
   call site."
  [ticket-yaml]
  (vec (remove nil? (cons (declared-acceptance-path ticket-yaml)
                          (declared-retires-paths ticket-yaml)))))

(defn foreign-scope-findings
  "Pure (BL-654-style property target): given the task's own ticket id and
   the set of changed paths, every {:path :ticket-id} pair whose path
   positively belongs to a DIFFERENT ticket - own-evidence paths for the
   task excluded, and (BL-1276) the exact path the task's own ticket declares
   as its acceptance contract. Empty when task-ticket-id is nil (nothing to
   compare against) - the caller's own fail-open, not re-derived here."
  ([task-ticket-id changed-paths] (foreign-scope-findings task-ticket-id changed-paths nil))
  ([task-ticket-id changed-paths declared]
   (let [declared-set (set (cond
                             (nil? declared) []
                             (string? declared) [declared]
                             :else declared))]
     (if-not task-ticket-id
       []
       (vec (for [path changed-paths
                  :let [id (ticket-id-for-path path)]
                  :when (and id
                             (not= id task-ticket-id)
                             (not (own-evidence-path? path task-ticket-id))
                             (not (contains? declared-set path)))]
              {:path path :ticket-id id}))))))

(defn- last-handoff-commit
  "The commit most recently handed off for this exact task, per the
   durable handoff archive (completed/abandoned across every role) -
   nil when this is the task's first hop, never guessed via commit-message
   grep (BL-1192 D1: a loose grep over-matches unrelated commits that
   merely mention the ticket id in passing, e.g. a batch intake note)."
  [root task-ticket-id]
  (some-> (salvage-lib/latest-item-handoffs root task-ticket-id)
          first
          (salvage-lib/header-field "commit")))

;; BL-1192 architect bounce round 2 D1 (2026-08-28): a deliberate rebuild-off-
;; main (BL-1241's own escape hatch for an entangled tip) does not descend
;; from the previously-cited commit by construction - the whole point of the
;; rebuild is to drop it. Left unhandled, `last-handoff-commit` still returns
;; that dropped commit as `base`, and `rev-list base..commit` either errors
;; (no merge base) or silently omits the rebuild's own real diff. The ticket's
;; own remedy: when `base` is recorded in the task's `abandoned_commits`
;; field, the walk starts from `origin/main` instead - the same documented
;; override `pre_qa_gate_lib.bb`'s `read-abandoned-commits` /
;; `abandoned-sha?` shape already implements for the ancestry check, reused
;; here (never a second parser) via `pre_qa_gate_gather_lib.bb`'s
;; `find-ticket-yaml-content`.
(defn- abandoned-sha? [sha abandoned]
  (some #(str/starts-with? sha %) abandoned))

(defn- abandoned-commits-for-ticket [root task-ticket-id]
  (when-let [yaml-content (pre-qa-gate-gather-lib/find-ticket-yaml-content root task-ticket-id)]
    (let [field (pre-qa-gate-lib/read-abandoned-commits yaml-content)]
      (when (:present? field) (or (:items field) [])))))

;; nil (never a sha) signals "origin/main could not be resolved" - the
;; caller's fail-open, not re-derived here.
(defn- origin-main-sha [root]
  (let [res (git! root "rev-parse" "-q" "--verify" "origin/main^{commit}")]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn- effective-base
  "Returns {:base sha-or-nil} on success, or {:unreadable? true} when the
   base is abandoned but origin/main cannot be resolved - the caller must
   fail open, never silently fall back to the abandoned (wrong) base."
  [root task-ticket-id base]
  (if-not base
    {:base nil}
    (let [abandoned (or (abandoned-commits-for-ticket root task-ticket-id) [])]
      (if (abandoned-sha? base abandoned)
        (if-let [origin-main (origin-main-sha root)]
          {:base origin-main}
          {:unreadable? true})
        {:base base}))))

;; BL-1295: `git revert` writes the subject `Revert "<original subject>"`,
;; so a revert inherits the reverted commit's ticket id VERBATIM. A revert
;; of a MERGE undoes everything that merge carried, so its diff names every
;; path the merge touched - including other tickets' files - and the gate
;; refused the send on the strength of a commit that only REMOVED content.
;; Observed live on BL-1240, blocked at the documenter to QA hop by
;; `3825f91cd Revert "Merge documenter BL-1240 0ca3bc03c0 into QA. By QA."`,
;; whose diff names docs/how-to/BL-973-....md. No ticket field could exempt
;; it: abandoned_commits rewrites the walk's BASE only when the base itself
;; is listed, and the acceptance/retires path exemptions would have to claim
;; scope the ticket does not own.
;;
;; The QUOTING is the signal, not the word. A hand-written subject that
;; merely begins with "Revert" is a real commit by whoever wrote it and
;; stays attributed - exempting too broadly would let genuine foreign scope
;; through, which is the failure direction that actually matters here.
(defn revert-subject? [subject]
  (boolean (and subject (re-find #"(?i)^\s*revert\s+\"" subject))))

;; Pure half of commit-message-names-task? below, so the attribution rule is
;; asserted directly on subjects rather than only through a git fixture.
(defn subject-names-task? [subject task-ticket-id]
  (and (not (revert-subject? subject))
       (= task-ticket-id (pipeline-stage-lib/extract-ticket-id subject))))

(defn- commit-message-names-task? [root commit task-ticket-id]
  ;; SUBJECT-only, PRIMARY (first-mentioned) ticket id only - via
  ;; pipeline-stage-lib's single-match extract-ticket-id, never
  ;; extract-ticket-ids' every-mention variant. Two over-match shapes,
  ;; both caught live sending this very rebuild: (1) a full-body
  ;; substring/grep matches a commit whose SUBJECT belongs to one ticket
  ;; but whose body prose merely mentions this task's id in passing (e.g.
  ;; "decouple unlanded BL-1192 gate wiring" inside a BL-1227-subject
  ;; commit) - fixed by reading %s, not %B. (2) even SUBJECT-only,
  ;; extract-ticket-ids' every-id-in-text behavior still matches a
  ;; subject like "BL-1227: ...decouple unlanded BL-1192 gate wiring",
  ;; which names BL-1227 as its own commit's ticket but mentions BL-1192
  ;; in passing within the same line - fixed by using the single-match,
  ;; first-token-wins extractor (the PRIMARY id a "TICKET: description"
  ;; subject names), matching this task_commit_coherence_gate_lib.bb's own
  ;; different, multi-id "does the subject name several tickets"
  ;; question intentionally does NOT reuse.
  ;; BL-1295 is the THIRD over-match shape (see revert-subject? above):
  ;; a revert's inherited subject.
  (let [subj (git! root "log" "-1" "--format=%s" commit)]
    (and (zero? (:exit subj))
         (subject-names-task? (:out subj) task-ticket-id))))

(defn own-commit-changed-paths
  "The paths a commit changed of its own - under one of TWO semantics, which
   are the same answer everywhere except on a merge:

     :delivered  what content this commit puts on the branch - its change
                 against its FIRST parent. \"What did receiving this parcel
                 bring in?\"  The land step's replay asks this.

     :authored   what the person making this commit actually wrote - what
                 differs from EVERY parent (`--cc`). For a merge that is only
                 a conflict resolution or an evil merge, and it is empty for
                 an ordinary clean receive-merge, whose content was authored
                 upstream and is already attributed to the commits that made
                 it. The send-time scope gate and the unregistered-test gate
                 ask this, because both judge the parcel's AUTHOR.

   Defaults to :delivered, which is the shape BL-1241's readability probe in
   land_step_lib.bb already depends on.

   nil (never []) when the commit or its diff could not be read, so a caller
   reads blindness as blindness rather than as a clean commit. Under
   :authored an EMPTY answer is a real answer - the merge resolved nothing
   itself - and that distinction is the whole point of returning nil for
   failure.

   BL-1297: the previous invocation was
   `diff-tree --no-commit-id --name-only -r --first-parent <commit>`, which
   reports NOTHING for a merge. git suppresses a merge's diff entirely
   unless -m or -c/--cc is given, and --first-parent is a log/rev-list
   traversal flag with no effect on diff-tree's own diff output. A merge is
   the normal shape of a role's own commit - every stage does
   `git merge <hash>` to receive a handoff, then forwards - so a parcel
   whose only task-tagged commit was that merge reported an empty change
   set, and empty reads as \"no foreign paths\", which PASSES. The gate
   approved parcels it never inspected, and the land step's replay reported
   nothing to commit on the one shape it is always given.

   BL-1297 amended: the first version of this fix answered :delivered for all
   three callers, and that refused every forward in the pipeline the moment a
   branch had synced main - which is always. Measured on one real
   receive-merge: 25 delivered paths spanning 8 unrelated tickets, 1 authored
   path, and that one was this ticket's own file. The two questions are kept
   apart here rather than at the call sites so no caller can invent a third.

   `-m` answers neither: it unions the per-parent diffs, attributing the
   merged-in branch's work to the merging role - a stricter gate than any
   caller asked for.

   A ROOT commit has no parent at all, so every path in it is both delivered
   and authored (`--root`), never nothing - answering nothing there would
   pass the gate open on a foreign path exactly as the merge blind spot did."
  ([root commit] (own-commit-changed-paths root commit :delivered))
  ([root commit semantic]
   (let [parent (git! root "rev-parse" "-q" "--verify" (str commit "^1^{commit}"))
         diff (if (zero? (:exit parent))
                (if (= semantic :authored)
                  (git! root "diff-tree" "--no-commit-id" "--cc" "--name-only" "-r" commit)
                  (git! root "diff-tree" "--no-commit-id" "--name-only" "-r"
                        (str/trim (:out parent)) commit))
                ;; No first parent: either a root commit (diff against the
                ;; empty tree) or an unreadable commit, which must stay nil.
                (let [resolves (git! root "rev-parse" "-q" "--verify" (str commit "^{commit}"))]
                  (if (zero? (:exit resolves))
                    (if (= semantic :authored)
                      (git! root "diff-tree" "--no-commit-id" "--cc" "--name-only" "-r" "--root" commit)
                      (git! root "diff-tree" "--no-commit-id" "--name-only" "-r" "--root" commit))
                    resolves)))]
     (when (zero? (:exit diff))
       (remove str/blank? (str/split-lines (:out diff)))))))

;; nil (never []) distinctly signals "the walk itself failed" - collapsing
;; that into the fail-open empty-findings shape would silently accept an
;; unreadable range instead of warning about it.
;;
;; BL-1241: public (not `defn-`) so land_step_lib.bb can reuse this EXACT
;; walk with base=origin/main to compute "this task's own paths to replay"
;; for its tip-pure rebuild - never a second implementation of the same
;; walk. Behavior and signature unchanged from BL-1192's own shipped shape;
;; only the `-` is dropped.
(defn task-tagged-changed-paths
  ([root base commit task-ticket-id]
   (task-tagged-changed-paths root base commit task-ticket-id :delivered))
  ;; BL-1297: the semantic travels with the caller, not with the walk. The
  ;; land step reads :delivered (what the parcel puts on the branch); the two
  ;; send-time gates read :authored (what the parcel's author wrote).
  ([root base commit task-ticket-id semantic]
   (let [candidates (if base
                       (let [log (git! root "rev-list" "--first-parent" (str base ".." commit))]
                         (when (zero? (:exit log))
                           (remove str/blank? (str/split-lines (:out log)))))
                       [commit])]
     (when candidates
       (->> candidates
            (filter #(commit-message-names-task? root % task-ticket-id))
            (mapcat #(own-commit-changed-paths root % semantic))
            (remove nil?)
            distinct
            vec)))))

(defn parcel-own-changed-paths
  "BL-1240: the paths THIS parcel's own work changed — the walk above, from
   the boundary this task last handed off at. nil (never []) when the range
   could not be read, so a caller fails open rather than reading blindness as
   a clean parcel.

   Public because BL-1240's unregistered-test gate asks the same question of
   the same parcel and must never answer it differently: two notions of \"what
   this parcel changed\" on the same send path would disagree exactly where it
   matters, on the entangled tip neither could see.

   BL-1297: both send-time gates judge the parcel's AUTHOR, so this reads
   :authored. A clean receive-merge - which every stage is required to make,
   plus the routine main syncs the constitution requires - authored nothing,
   and must not be charged with the tickets that rode in on it. The land
   step's replay is the caller that wants :delivered, and it asks
   task-tagged-changed-paths for it directly."
  [root task-ticket-id commit]
  (let [raw-base (last-handoff-commit root task-ticket-id)
        {:keys [base unreadable?]} (effective-base root task-ticket-id raw-base)]
    (when-not unreadable?
      (task-tagged-changed-paths root base commit task-ticket-id :authored))))

(defn findings-for-git-handoff
  "The one impure entry point. Returns {:findings [{:path :ticket-id}]} on
   a clean read (possibly empty), or {:warning \"...\"} when the walk could
   not be read - never both, mirroring parcel_rollback_guard_lib.bb's own
   contract exactly."
  [{:keys [root task-name commit]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        unreadable-warning (delay {:warning (str "task-scope check could not run for " task-name
                                                  " (the commit history for " commit
                                                  " unreadable) - send allowed, unverified (BL-1192)")})]
    (if-not task-ticket-id
      {:findings []}
      (let [commit-check (git! root "rev-parse" "-q" "--verify" (str commit "^{commit}"))]
        (if-not (zero? (:exit commit-check))
          @unreadable-warning
          ;; BL-1240: the same walk, through the one public seam both send-time
          ;; gates share - an unreadable base and an unreadable range are the
          ;; same nil, and were already the same warning here.
          (let [changed-paths (parcel-own-changed-paths root task-ticket-id commit)]
                (if (nil? changed-paths)
                  @unreadable-warning
                  ;; BL-1276: the declaration is read HERE, at the one impure
                  ;; entry point both callers share (this gate's send-time
                  ;; caller in swarm_handoff.bb and BL-1257's review-time CLI),
                  ;; so the two can never answer the same commit differently.
                  ;; Read from the ticket's landed YAML, never the sender's
                  ;; working copy: an amendment the specifier landed on main is
                  ;; then honoured without the sender merging first.
                  (let [ticket-yaml (landed-ticket-lib/active-ticket-yaml-content root task-ticket-id)
                        declared (declared-exempt-paths ticket-yaml)
                        findings (foreign-scope-findings task-ticket-id changed-paths declared)]
                    (cond-> {:findings findings}
                      ;; No ticket to read means the exemption could not be
                      ;; evaluated at all. It grants nothing - and the refusal
                      ;; SAYS so, rather than sending its recipient off to
                      ;; rebuild a commit that may not have needed it.
                      (nil? ticket-yaml) (assoc :acceptance-unreadable? true))))))))))

(defn blocked? [{:keys [findings]}]
  (boolean (seq findings)))

(defn refusal-message
  [{:keys [task-name findings acceptance-unreadable?]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        ticket-ids (distinct (map :ticket-id findings))
        paths (map :path findings)]
    (str
     (format (str "Cannot send git_handoff for %s: this task's own commits since its last "
                  "handoff carry %s (%s) belonging to %s, not to %s - the tip is entangled with "
                  "another ticket's work (BL-1192/BL-506). Rebuild or cherry-pick a tip-pure "
                  "commit for %s and re-send.")
             task-name
             (if (= 1 (count paths)) "a path" (format "%d paths" (count paths)))
             (str/join ", " paths)
             (str/join "," ticket-ids)
             task-ticket-id
             task-ticket-id)
     ;; BL-1276: never let this refusal look like a plain entanglement when
     ;; the one exemption that could have cleared it was never evaluated.
     (when acceptance-unreadable?
       (format (str " NOTE: the declared-path exemption could not be evaluated - %s's own ticket "
                    "could not be read on main, origin/main, or in backlog/active/, so a path it "
                    "declares for itself (acceptance:/retires:) was not recognised. Check the "
                    "ticket is present and landed before rebuilding anything.")
               task-ticket-id)))))
