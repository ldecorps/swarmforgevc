;; merge_drop_guard_lib.bb — BL-1576: refuses a git_handoff whose branch
;; carries a merge (received..forwarded) that resolved a conflicted path by
;; taking one side verbatim, silently discarding hunks the OTHER side had
;; the only claim to - distinct from a genuine same-line conflict pick,
;; which is always the resolver's to make.
;;
;; On 2026-09-15 the documenter's merge 4566a68955 ("Merge hardender
;; 6cf853db7f into documenter.") resolved a conflict on
;; backlog/standing-reds.tsv by keeping its own side verbatim: the
;; hardener's uncontested removal of six rows (base lines 33-38) came back,
;; while main's adjacent edit (base lines 39-40, disjoint from the six) was
;; kept intact. Git raised the conflict because the two sides' edits are
;; ADJACENT, not because they overlap - a correct resolution keeps both.
;; BL-1213's rollback gate reads only the paths the RECEIVED commit itself
;; touched and fires only on a byte-identical tip; this merge's tip matched
;; no earlier blob (it carried main's edits too), so nothing spoke until QA
;; caught it by hand (BL-1486 bounce).
;;
;; Discriminator (invariant 2): parse `git diff -U0 <base> <side> -- <path>`
;; into hunks carrying their base line range. A hunk is CONTESTED when its
;; base range overlaps a hunk the OTHER side made to the same path, or both
;; sides insert at the same base position - adjacent ranges (33-38 vs
;; 39-39) are never contested, the whole discriminator: git conflicts on
;; adjacency, a correct resolver keeps both. For each side's UNCONTESTED
;; hunks, a finding is a `+` line in diff(side, mergeCommit) equal to a
;; line that side itself removed (resurrection), or a `-` line equal to a
;; line that side itself added (drop) - the merge lost content that side
;; alone had the claim to. A `This reverts commit <sha>` reachable from the
;; forwarded commit, naming a commit in base..side that touched the path,
;; excuses it (BL-490/BL-495 convention, exactly as BL-1213 honours it).
;;
;; Fail-open on unreadable facts (no recorded received commit at all is
;; silent - the ordinary case; a recorded-but-unresolvable commit or merge
;; list warns and sends), same posture as every other send-time gate in
;; swarm_handoff.bb. Bounded to merges reachable from the forwarded commit
;; and not from the received one, and to the paths those merges' parents
;; changed since their own merge base - never a full-tree walk, never past
;; the received commit, never a merge the sender did not make.
;;
;; Not in scope (ticket CONSTRAINTS): re-tuning BL-1213/BL-1242/BL-1098/
;; BL-1205; a commit-msg hook variant; a full-tree freshness walk; ancestry
;; as a criterion (the dropped content's absence, not its ancestor status,
;; is what matters - the BL-1211/BL-1213 lesson).

(ns merge-drop-guard-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
;; received-commit-for-task: no second reader of the same in_process
;; "commit" header - reuse BL-806's own reader rather than a third copy of
;; parcel_rollback_guard_lib.bb's received-parcel-commit-for-task.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "review_forward_evidence_gate_lib.bb")))

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

;; ── pure hunk parsing ────────────────────────────────────────────────────

(def ^:private hunk-header-re
  #"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*")

(defn parse-hunks
  "Pure: parses `git diff -U0 <base> <side> -- <path>` (or any two-ref -U0
   diff of one path) into hunks {:base-start :base-count :removed [...]
   :added [...]}, base/old-side numbering only - the new side's numbers are
   never needed by this gate. Ignores the diff/index/---/+++ header lines
   and a trailing '\\ No newline at end of file' marker. Multiple hunks per
   file are each their own map, in order."
  [diff-text]
  (loop [lines (str/split-lines (or diff-text ""))
         hunks []
         current nil]
    (if (empty? lines)
      (vec (cond-> hunks current (conj current)))
      (let [line (first lines)
            m (re-matches hunk-header-re line)]
        (cond
          m
          (let [[_ base-start base-count] m]
            (recur (rest lines)
                   (cond-> hunks current (conj current))
                   {:base-start (parse-long base-start)
                    :base-count (if base-count (parse-long base-count) 1)
                    :removed []
                    :added []}))

          (and current (str/starts-with? line "-") (not (str/starts-with? line "---")))
          (recur (rest lines) hunks (update current :removed conj (subs line 1)))

          (and current (str/starts-with? line "+") (not (str/starts-with? line "+++")))
          (recur (rest lines) hunks (update current :added conj (subs line 1)))

          :else
          (recur (rest lines) hunks current))))))

(defn- hunk-range
  "[start end] inclusive, base/old numbering. A pure insertion (base-count
   0) is a single point at base-start - the base position after which
   lines were inserted, per git's own hunk-header convention."
  [{:keys [base-start base-count]}]
  (if (pos? base-count)
    [base-start (+ base-start base-count -1)]
    [base-start base-start]))

(defn contested?
  "True when hunk-a and hunk-b's base ranges overlap, including two
   insertions at the same base position (invariant 2, second clause).
   Adjacent ranges (one hunk's end one less than the other's start) never
   overlap - the incident's own 33-38-vs-39-39 shape, and the whole
   discriminator this gate exists to draw: git raises a conflict on
   adjacency alone, but a correct resolution keeps both sides."
  [hunk-a hunk-b]
  (let [[s1 e1] (hunk-range hunk-a)
        [s2 e2] (hunk-range hunk-b)]
    (<= (max s1 s2) (min e1 e2))))

(defn uncontested-hunks
  "hunks (one side's own, from base->side) minus any hunk CONTESTED by some
   hunk the other side made to the same path (other-hunks, also base->side)."
  [hunks other-hunks]
  (vec (remove (fn [h] (some #(contested? h %) other-hunks)) hunks)))

(defn- non-blank [lines]
  (remove str/blank? lines))

(defn lines-lost
  "Pure (BL-654-style property target, invariant 2's whole discriminator):
   given one side's own UNCONTESTED hunks (from base->side) and the +/-
   lines of diff(side, mergeCommit) for the same path, the lines that side
   alone owned and the merge lost - a `+` line in diff(side,M) equal to a
   line that side itself removed (a resurrection: the side's own deletion
   was undone by the merge), or a `-` line equal to a line that side
   itself added (a drop: the side's own addition never reached the merge).
   Blank lines never count toward a finding (constraints: ignore blank
   lines) - both as candidates and as the thing they might match."
  [{:keys [own-uncontested-hunks diff-plus diff-minus]}]
  (let [own-removed (set (non-blank (mapcat :removed own-uncontested-hunks)))
        own-added (set (non-blank (mapcat :added own-uncontested-hunks)))
        resurrected (filter own-removed (non-blank diff-plus))
        dropped (filter own-added (non-blank diff-minus))]
    (vec (concat resurrected dropped))))

;; ── impure git reads ─────────────────────────────────────────────────────

(defn- full-sha [root ref]
  (let [{:keys [exit out]} (git! root "rev-parse" ref)]
    (when (zero? exit) (str/trim out))))

(defn- merge-commits
  "Merge commits reachable from forwarded and from NEITHER received NOR
   head (when the caller has a stamp), oldest first, so a finding names
   the earliest offending merge when several exist. nil (unreadable) on a
   git failure; an empty vector (scenario 06: a forward that made no
   merge) is a real, successful answer, never nil.

   BL-1610 amended 2026-09-17: received and head (when present) are BOTH
   always excluded together, as two separate negative refs - never head
   alone. A head-only bound (this function's pre-amendment shape) re-admits
   any merge reachable from received's own ancestry that head does not
   itself dominate (measured on the documenter's shape: head 073a34b5e1
   does not reach the cleaner's merge 6e5087cd43, which sits in received
   4356ab57c1's own ancestry instead - `head..forwarded` alone named it,
   `forwarded ^head ^received` does not). head nil (an older, stampless
   parcel) falls back to exactly the prior received..forwarded scan."
  [root received forwarded head]
  (let [negatives (remove nil? [(str "^" received) (when (not-empty head) (str "^" head))])
        {:keys [exit out]} (apply git! root (concat ["rev-list" "--merges" "--reverse"] negatives [forwarded]))]
    (when (zero? exit)
      (vec (non-blank (str/split-lines out))))))

(defn- parents [root commit]
  (let [{:keys [exit out]} (git! root "rev-parse" (str commit "^@"))]
    (when (zero? exit) (vec (non-blank (str/split-lines out))))))

(defn- merge-base-of [root p1 p2]
  (let [{:keys [exit out]} (git! root "merge-base" p1 p2)]
    (when (zero? exit) (str/trim out))))

(defn- changed-paths [root base side]
  (let [{:keys [exit out]} (git! root "diff" "--name-only" base side)]
    (when (zero? exit) (vec (non-blank (str/split-lines out))))))

;; BL-1683: `-M` (git's own default similarity threshold), `--name-status`
;; so a rename row carries BOTH paths - old first, new second - rather than
;; the new name alone (`--name-only` in a `-M` diff prints only the new
;; name, which is why the plain `changed-paths` above is blind to renames
;; at all: the promotion's OLD path, backlog/paused/<id>-*.yaml, never
;; appears in its output, so `diff-u0` below ran the rest of this gate
;; against a path the forwarded side simply does not have - reading it as
;; every line dropped, whether or not the rename kept them). Each entry:
;; {:status "R100" (etc.) :old-path :new-path} for a rename, {:status "A"|
;; "M"|"D"|... :old-path p :new-path p} otherwise (:new-path is always
;; the path git names, :old-path is what it names for a non-rename row
;; too - same value, so a caller keying on :old-path alone still finds
;; every changed path exactly as `changed-paths` above does).
(defn- changed-paths-status [root base side]
  (let [{:keys [exit out]} (git! root "diff" "-M" "--name-status" base side)]
    (when (zero? exit)
      (vec (keep (fn [line]
                   (let [fields (str/split line #"\t")]
                     (when (>= (count fields) 2)
                       (if (and (str/starts-with? (first fields) "R") (>= (count fields) 3))
                         {:status (first fields) :old-path (nth fields 1) :new-path (nth fields 2)}
                         {:status (first fields) :old-path (nth fields 1) :new-path (nth fields 1)}))))
                 (non-blank (str/split-lines out)))))))

;; {old-path new-path} for every RENAME row only - a caller resolves a
;; path through this map (falling back to the path itself) to find where
;; that side's content actually lives in a tree that postdates `side`.
(defn- rename-map [entries]
  (into {} (keep (fn [{:keys [old-path new-path]}]
                   (when (not= old-path new-path) [old-path new-path])))
        entries))

(defn- diff-u0 [root from to path]
  (let [{:keys [exit out]} (git! root "diff" "-U0" from to "--" path)]
    (when (zero? exit) out)))

;; BL-1683: diffs one side's OWN content at `side-path` (base/old numbering,
;; unaffected by any rename - a side's own hunks are always relative to
;; where IT made them) against `merge-path` as `merge-commit` itself holds
;; it - the NEW path when either side renamed it, the same path otherwise.
;; Two colon-refs (`<commit>:<path>`), never a `-- <path>` filter: that
;; syntax requires ONE path shared by both sides of the diff, which a
;; rename by definition does not have.
(defn- diff-u0-refs [root from-commit from-path to-commit to-path]
  (let [{:keys [exit out]} (git! root "diff" "-U0"
                                  (str from-commit ":" from-path)
                                  (str to-commit ":" to-path))]
    (when (zero? exit) out)))

(defn- ancestor? [root ancestor descendant]
  (zero? (:exit (git! root "merge-base" "--is-ancestor" ancestor descendant))))

(defn- side-label
  "Which parent is the received side (the one the received commit is on,
   or an ancestor of), which is the sender's own. Received an ancestor of
   BOTH (a later sync merge, after an earlier one already folded it in) or
   of NEITHER (unreadable git state) falls back to labelling p1 received -
   out of the single-merge shape this ticket's incident, feature, and
   invariants describe."
  [root p1 p2 received]
  (cond
    (ancestor? root received p1) {:received p1 :sender p2}
    (ancestor? root received p2) {:received p2 :sender p1}
    :else {:received p1 :sender p2}))

(defn- plus-minus [root from-commit from-path to-commit to-path]
  (let [hunks (parse-hunks (diff-u0-refs root from-commit from-path to-commit to-path))]
    {:plus (mapcat :added hunks) :minus (mapcat :removed hunks)}))

(defn- revert-excuses?
  "True when some commit in base..side that touched path is named by a
   `This reverts commit <full-sha>` body reachable from forwarded - the
   BL-490/BL-495 bounce-revert convention BL-1213 also honours. -F (fixed
   string) against each candidate commit's own full sha, never a regex
   compile of commit text. A git failure resolves to false, the more
   cautious side for a guard protecting landed work."
  [root forwarded base side path]
  (let [{:keys [exit out]} (git! root "log" "--format=%H" (str base ".." side) "--" path)]
    (and (zero? exit)
         (boolean
          (some (fn [c]
                  (let [{:keys [exit out]} (git! root "log" (str c ".." forwarded)
                                                  (str "--grep=This reverts commit " c)
                                                  "-F" "--format=%H")]
                    (and (zero? exit) (not (str/blank? (str/trim out))))))
                (non-blank (str/split-lines out)))))))

(defn- findings-for-side
  "BL-1683: `merge-path` is where `merge-commit` itself holds this path's
   content - the NEW path when either side renamed it since `base`, the
   same `path` otherwise. `path` (base/old numbering) still decides the
   side's OWN uncontested hunks and the revert-excuse read (both are
   about what THIS side did, always relative to base, never affected by
   a rename); only the comparison against merge-commit's own tree follows
   the rename. A real drop at a renamed path is reported AT THE NEW path
   (`:path merge-path`), never the vanished old one, so the message names
   somewhere the reader can actually look."
  [{:keys [root forwarded base side-commit side-hunks other-hunks side-name path merge-path merge-commit]}]
  (let [merge-path (or merge-path path)
        own-uncontested (uncontested-hunks side-hunks other-hunks)
        {:keys [plus minus]} (plus-minus root side-commit path merge-commit merge-path)
        lost (lines-lost {:own-uncontested-hunks own-uncontested :diff-plus plus :diff-minus minus})]
    (when (and (seq lost) (not (revert-excuses? root forwarded base side-commit path)))
      [{:merge merge-commit :path merge-path :side side-name :lines (count lost)}])))

(defn- findings-for-merge
  "Every dropped-hunk finding for one merge commit - impure (git reads) but
   delegates every decision to the pure functions above. An octopus merge
   (not exactly two parents) or an unreadable merge-base is silent, out of
   the two-sided shape this gate answers."
  [root forwarded received merge-commit]
  (let [ps (parents root merge-commit)]
    (if (not= 2 (count ps))
      []
      (let [[p1 p2] ps
            base (merge-base-of root p1 p2)]
        (if-not base
          []
          (let [{:keys [received sender]} (side-label root p1 p2 received)
                received-entries (changed-paths-status root base received)
                sender-entries (changed-paths-status root base sender)
                received-renames (rename-map received-entries)
                sender-renames (rename-map sender-entries)
                ;; BL-1683: a path renamed by EITHER side resolves to its
                ;; new name in merge-commit's own tree - sender checked
                ;; first only because the incident's own shape (a
                ;; promotion merged in via the sender's own sync) is the
                ;; common case; a real double-rename of the same old path
                ;; by both sides is outside this gate's two-sided shape
                ;; either way.
                renames (merge received-renames sender-renames)
                paths (distinct (concat (map :old-path received-entries) (map :old-path sender-entries)))]
            (vec
             (mapcat
              (fn [path]
                ;; BL-1683: a side's OWN hunks (used both as its
                ;; uncontested content AND as the OTHER side's contest
                ;; check) are read at THAT SIDE's own new path when IT
                ;; renamed `path` - never the naive base->side diff at
                ;; the now-vanished old path, which reads as "every line
                ;; deleted" and would spuriously CONTEST the other side's
                ;; genuine edit at the same base position (the rename's
                ;; own diff artifact, not a real content edit).
                (let [received-path (get received-renames path path)
                      sender-path (get sender-renames path path)
                      received-hunks (parse-hunks (diff-u0-refs root base path received received-path))
                      sender-hunks (parse-hunks (diff-u0-refs root base path sender sender-path))
                      merge-path (get renames path path)]
                  (concat
                   (findings-for-side {:root root :forwarded forwarded :base base
                                        :side-commit received :side-hunks received-hunks
                                        :other-hunks sender-hunks :side-name "received"
                                        :path path :merge-path merge-path :merge-commit merge-commit})
                   (findings-for-side {:root root :forwarded forwarded :base base
                                        :side-commit sender :side-hunks sender-hunks
                                        :other-hunks received-hunks :side-name "sender"
                                        :path path :merge-path merge-path :merge-commit merge-commit}))))
              paths))))))))

;; BL-1610 invariant 2: a finding whose path's blob at forwarded equals its
;; blob at received carries nothing the forward could lose - the sender's
;; own tree at that path never changed across the send at all, whatever a
;; stale merge earlier in its history once did. `git rev-parse
;; <commit>:<path>` on a path absent at both commits fails identically for
;; both sides (nil = nil), which correctly reads as identical too - a path
;; neither commit carries has nothing to drop.
(defn- blob-sha [root commit path]
  (let [{:keys [exit out]} (git! root "rev-parse" (str commit ":" path))]
    (when (zero? exit) (str/trim out))))

;; Blob identity between received and forwarded ALONE over-excuses: a merge
;; that itself resolves a path by taking the received side verbatim also
;; leaves blob(forwarded)==blob(received) for that path (BL-1576's own
;; "taking the received side verbatim" scenario, which must stay refused -
;; the sender's own dropped addition never rides the forward EITHER, but it
;; is dropped BY THIS SEND, not superseded before it - there, merge-commit
;; IS forwarded, nothing sits between them). The real BL-1606 shape is
;; structurally different: forwarded is a LATER commit than the offending
;; merge - whatever the merge itself resolved the path to, forwarded is
;; downstream of it (by many commits in the real incident), so testing
;; whether forwarded's blob differs from the merge's own output cannot
;; discriminate the two cases (a real BL-1606 finding's path can rest at
;; the SAME value the merge itself produced, if nothing else ever touched
;; it again - exactly what happened for two of the six merges). The
;; discriminator is commit identity, not a further blob change: excused
;; only when the offending merge is NOT itself the commit being forwarded
;; (something, even nothing, comes after it) AND the forward's blob
;; matches what was received.
(defn- excused-by-blob-identity? [root received forwarded merge-commit path]
  (and (not= (full-sha root merge-commit) (full-sha root forwarded))
       (= (blob-sha root received path) (blob-sha root forwarded path))))

(defn findings-between
  "The one fs-touching entry point safe to call directly with raw refs
   (branch names, short or full shas, tags) - used both by the read-only
   CLI below and by findings-for-git-handoff once it has resolved the
   mailbox header. nil when the merge list itself could not be read
   (unreadable received/forwarded); an empty vector is a genuine answer
   (no merges, or merges with nothing lost). Every finding carries
   :excused (BL-1610 invariant 2) - true when the forward carries no
   version of the finding's path that differs from what was received,
   so nothing dropped can ride it; `blocked?`/`refusal-message` only act
   on the non-excused ones, but an excused finding still comes back for a
   caller that wants to report it (the read-only CLI does).

   BL-1610: the 4-arity form bounds the merge scan to merges reachable
   from forwarded and from NEITHER received NOR head (the sender's
   received_at_head stamp, when it has one) - the merges the sender made
   since receipt, with a merge arriving through the received commit's own
   ancestry never scanned regardless of head (amended 2026-09-17). The
   3-arity form (every pre-BL-1610 caller, and this arity's own fallback
   when a caller has no stamp to pass) keeps its exact prior scan
   (received..forwarded)."
  ([root received forwarded] (findings-between root received forwarded nil))
  ([root received forwarded head]
   (when-let [merges (merge-commits root received forwarded head)]
     (mapv (fn [f] (assoc f :excused (excused-by-blob-identity? root received forwarded (:merge f) (:path f))))
           (mapcat #(findings-for-merge root forwarded received %) merges)))))

(defn findings-for-git-handoff
  "The send-time entry point (called from swarm_handoff.bb, same posture
   as parcel_rollback_guard_lib.bb's namesake): {:findings [...]} on a
   clean read (possibly empty), or {:warning \"...\"} when a recorded
   received commit exists but could not be resolved - never both. No
   recorded received commit at all (a fresh task, nothing yet received) is
   silent, not a warning - the ordinary case, the same convention BL-1213
   and BL-806 both follow."
  [{:keys [root sender task-name canonical]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
        received (review-forward-evidence-gate-lib/received-commit-for-task root sender task-name)
        ;; BL-1610: the sender's HEAD at the moment it dequeued this task's
        ;; parcel, when the dequeue stamped one - nil on an older parcel,
        ;; falling through to findings-between's own received..forwarded
        ;; fallback.
        head (review-forward-evidence-gate-lib/received-at-head-for-task root sender task-name)
        unreadable-warning (delay {:warning (str "merge-drop check could not run for " task-ticket-id
                                                  " (received commit " received " unreadable) - send allowed, unverified (BL-1576)")})]
    (if-not received
      {:findings []}
      (if-let [received-full (full-sha root received)]
        (if-let [findings (findings-between root received-full canonical head)]
          {:findings findings}
          @unreadable-warning)
        @unreadable-warning))))

;; BL-1610: an excused finding (invariant 2) never blocks - the forward
;; carries no version of its path that differs from what was received.
(defn blocking-findings [findings]
  (remove :excused findings))

(defn blocked? [{:keys [findings]}]
  (boolean (seq (blocking-findings findings))))

(defn refusal-message
  [{:keys [task-name findings]}]
  (let [describe (fn [{:keys [merge path side lines]}]
                    (format "merge %s dropped %d line%s of the %s side's uncontested hunks in %s"
                            merge lines (if (= 1 lines) "" "s") side path))]
    (format (str "Cannot send git_handoff for %s: %s - a one-sided merge resolution "
                 "discarded uncontested work (BL-1576). If this is a deliberate "
                 "BL-490/BL-495 bounce revert, carry a proper revert of the commit "
                 "that authored the dropped hunk; otherwise redo the merge resolution "
                 "to keep both sides before sending.")
            task-name (str/join "; " (map describe (blocking-findings findings))))))

;; ── read-only CLI (qa_e2e_procedure step 2): ────────────────────────────
;;   bb merge_drop_guard_lib.bb <project-root> <received-commit> <forwarded-commit>
;; prints one JSON line per finding and exits 0 - answers from git objects
;; alone, no mailbox, no fixture.

(defn -main [args]
  ;; BL-1610: an optional 4th arg (head) drives the bounded scan directly,
  ;; same shape the qa_e2e_procedure's own bb -e reproduction uses.
  (let [[root received forwarded head] args]
    (if (or (str/blank? root) (str/blank? received) (str/blank? forwarded))
      (do (binding [*out* *err*]
            (println "usage: merge_drop_guard_lib.bb <project-root> <received-commit> <forwarded-commit> [head-commit]"))
          (System/exit 2))
      (doseq [f (or (findings-between root received forwarded head) [])]
        (println (json/generate-string f))))))

;; Safe to load-file (a pure library load); runs -main only when this file
;; is the one bb was invoked with directly, same guard convention as
;; availability_ledger_lib.bb's own no-op-load line, inverted for a file
;; that DOES have a CLI.
(when (= *file* (System/getProperty "babashka.file"))
  (-main *command-line-args*))
