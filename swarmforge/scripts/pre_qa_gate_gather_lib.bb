#!/usr/bin/env bb
;; BL-531: the git/fs gathering layer for the pre-QA durability and wiring
;; gate. Turns a project checkout + a ticket id + a cited commit into the
;; plain-data facts pre_qa_gate_lib.bb's `evaluate` decides over. Split out
;; of pre_qa_gate_cli.bb (mirroring commit_integrity_lib.bb /
;; commit_integrity_cli.bb) so this file has no top-level `-main` call and
;; can be load-file'd directly by both swarm_handoff.bb (the live QA-edge
;; call site) and test/step-handler code, without ever triggering a CLI
;; exit as a load-time side effect.
;;
;; Fail-open on infrastructure: any git/fs read that cannot complete (a
;; missing worktree, an unreadable roles.tsv, an absent main ref) is
;; recorded as a warning and that ONE check is skipped - never blocks the
;; send. The one fail-closed case is a required_wiring entry that cannot be
;; parsed (pre_qa_gate_lib.bb's own :manifest finding).

(ns pre-qa-gate-gather-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

;; ── small git helpers ────────────────────────────────────────────────────

(defn- run-git [project-root args]
  (process/sh (into ["git" "-C" (str project-root)] args)))

(defn- git-ok? [res] (zero? (:exit res)))

(defn ref-exists? [project-root ref]
  (git-ok? (run-git project-root ["rev-parse" "--verify" "-q" ref])))

(defn- ancestor-of? [project-root sha ref]
  (and (ref-exists? project-root ref)
       (git-ok? (run-git project-root ["merge-base" "--is-ancestor" sha ref]))))

;; ── condition 5: does a candidate carry dropped work? ────────────────────
;; A merge commit (2+ parents) that introduces no content beyond the union
;; of its parents, or a non-merge commit whose tree is identical to the
;; cited commit, carries no unique content and must not survive as an
;; ancestry finding (architect rule_proposal, b7dd7276d; widened by
;; architect send-back 4da499ea3b) - see aca611925c ("merge coder work for
;; BL-531", empty functional diff) and 3a57a807fe (an ordinary role
;; ticket-naming merge - e.g. an architect's own review-merge of the cited
;; commit into a branch tip that carries unrelated prior content, whose
;; first-parent diff is the WHOLE incoming parcel and whose tree is NOT
;; identical to the cited commit's) for the two false positives this
;; excludes. A literal empty first-parent diff is the degenerate case of the
;; same underlying test: a merge introduces nothing of its own exactly when
;; its combined diff against every parent (`git diff-tree -m --cc`) is
;; empty - if the first-parent diff is empty, that combined diff is
;; necessarily empty too, so the general check subsumes it.

(defn- commit-parents
  "Full-length parent shas of full-sha, oldest-first-parent-first, or nil if
   the commit cannot be read."
  [project-root full-sha]
  (let [res (run-git project-root ["show" "-s" "--format=%P" full-sha])]
    (when (git-ok? res)
      (remove str/blank? (str/split (str/trim (:out res)) #"\s+")))))

(defn- tree-of
  "The tree sha ref^{tree} resolves to, or nil when the ref cannot be read."
  [project-root ref]
  (let [res (run-git project-root ["rev-parse" (str ref "^{tree}")])]
    (when (git-ok? res) (str/trim (:out res)))))

(defn- merge-introduces-nothing-unique?
  "True when full-sha is a merge whose combined diff against ALL of its
   parents (`git diff-tree -m --cc`, which prunes any hunk that matches at
   least one parent) is empty - i.e. every line of its tree already exists
   in some parent, so the merge itself resolved no conflicts and added no
   content of its own. This is the general form of \"empty diff against the
   first parent\": a trivial/clean merge, whichever parent(s) it agrees
   with. Fails closed to false when the git invocation itself fails (an
   unreadable commit still gets full ancestry scrutiny)."
  [project-root full-sha]
  (let [res (run-git project-root ["diff-tree" "-m" "--cc" "--no-commit-id" full-sha])]
    (and (git-ok? res) (str/blank? (str/trim (:out res))))))

(defn no-dropped-work?
  "True when full-sha carries no content the cited commit does not already
   have: a merge (2+ parents) that introduces nothing beyond the union of
   its parents, or a non-merge commit whose tree is identical to the cited
   commit's tree. Fails closed to false (a candidate whose parents/tree
   cannot be read, or a merge diff-tree cannot compute, is NOT excluded -
   an unreadable commit still gets full ancestry scrutiny)."
  [project-root full-sha cited-commit]
  (let [parents (commit-parents project-root full-sha)]
    (boolean
     (or (and parents
              (>= (count parents) 2)
              (merge-introduces-nothing-unique? project-root full-sha))
         (let [candidate-tree (tree-of project-root full-sha)
               cited-tree (tree-of project-root cited-commit)]
           (and candidate-tree cited-tree (= candidate-tree cited-tree)))))))

(defn branch-of-worktree
  "The branch currently checked out at worktree-path, or nil (never throws)
   when the path is missing or not a readable git worktree."
  [worktree-path]
  (when (and worktree-path (fs/exists? (fs/path worktree-path)))
    (let [res (run-git worktree-path ["rev-parse" "--abbrev-ref" "HEAD"])]
      (when (git-ok? res) (str/trim (:out res))))))

;; A runtime-built separator (never a raw control byte sitting literally in
;; this source file - fragile across editors/encodings) shared between the
;; git --format arg and the split regex, so the two can never drift apart.
(def ^:private field-sep (str (char 1)))

(defn- branch-commits
  "Every commit reachable from `branch` as [{:sha :message}] (full 40-char
   sha), or nil when the branch itself cannot be read."
  [project-root branch]
  (let [res (run-git project-root ["log" (str "--format=%H" field-sep "%s") branch])]
    (when (git-ok? res)
      (vec (for [line (remove str/blank? (str/split-lines (:out res)))
                 :let [[sha message] (str/split line (re-pattern field-sep) 2)]]
             {:sha sha :message (or message "")})))))

;; ── role-branch discovery (roles.tsv) ────────────────────────────────────

(defn role-branches
  "{:branches {branch-name -> worktree-path} :warnings [...]} for every
   NON-master pipeline-role row in roles.tsv (master-resident rows share
   the coordinator/specifier checkout and contribute nothing - BL-531's own
   scope). A row whose worktree cannot be read yields a warning, never a
   thrown exception - fail-open."
  [project-root]
  (let [tsv (fs/path project-root ".swarmforge" "roles.tsv")]
    (if-not (fs/exists? tsv)
      {:branches {} :warnings ["roles.tsv: not found"]}
      (let [roles (handoff-lib/load-all-roles project-root)
            pipeline-roles (remove #(= "master" (:worktree-name %)) roles)]
        (reduce
         (fn [acc {:keys [role worktree-path]}]
           (if-let [branch (branch-of-worktree worktree-path)]
             (assoc-in acc [:branches branch] worktree-path)
             (update acc :warnings conj (format "role-branch:%s worktree unreadable (%s)" role worktree-path))))
         {:branches {} :warnings []}
         pipeline-roles)))))

;; ── ancestry fact-gathering ───────────────────────────────────────────────

(defn gather-ancestry-facts
  "role-branch-commits/main-reachable-set/cited-ancestors-set/warnings, all
   keyed on a 10-char sha abbreviation (this project's standard commit
   header length, e.g. abandoned_commits prefix matching). Only commits
   whose message already references ticket-id are carried past this
   function - the same commits pre_qa_gate_lib.bb's evaluate would keep
   anyway, kept small here purely to bound the number of merge-base calls."
  [project-root ticket-id cited-commit]
  (let [{:keys [branches warnings]} (role-branches project-root)
        gathered
        (reduce
         (fn [acc [branch _worktree]]
           (if-let [commits (branch-commits project-root branch)]
             (let [matching (->> commits
                                  (filter #(pre-qa-gate-lib/message-references-ticket? (:message %) ticket-id))
                                  (map (fn [{:keys [sha message]}]
                                         {:sha (subs sha 0 10) :full-sha sha :message message})))]
               (-> acc
                   (assoc-in [:role-branch-commits branch] (mapv #(dissoc % :full-sha) matching))
                   (update :candidates into matching)))
             (update acc :warnings conj (format "role-branch:%s commit log unreadable" branch))))
         {:role-branch-commits {} :warnings (vec warnings) :candidates []}
         branches)
        candidates (:candidates gathered)
        main-reachable-set (set (keep (fn [{:keys [sha full-sha]}]
                                         (when (or (ancestor-of? project-root full-sha "main")
                                                   (ancestor-of? project-root full-sha "origin/main"))
                                           sha))
                                       candidates))
        cited-ancestors-set (set (keep (fn [{:keys [sha full-sha]}]
                                          (when (ancestor-of? project-root full-sha cited-commit) sha))
                                        candidates))
        no-dropped-work-set (set (keep (fn [{:keys [sha full-sha]}]
                                          (when (no-dropped-work? project-root full-sha cited-commit) sha))
                                        candidates))]
    {:role-branch-commits (:role-branch-commits gathered)
     :main-reachable-set main-reachable-set
     :cited-ancestors-set cited-ancestors-set
     :no-dropped-work-set no-dropped-work-set
     :warnings (:warnings gathered)}))

;; ── ticket YAML + wiring-target fact-gathering ───────────────────────────

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn find-ticket-yaml-content
  "The raw content of ticket-id's own backlog YAML, searched across
   active/paused/done (nested-under-milestone included) on THIS checkout -
   nil when not found here. required_wiring/abandoned_commits are read from
   the sender's own checkout deliberately (only the wiring TARGET file's
   content is pinned to the cited commit - decision 3)."
  [project-root ticket-id]
  (some (fn [dir]
          (when (fs/exists? dir)
            (some (fn [f]
                    (let [content (slurp (str f))]
                      (when (= ticket-id (read-yaml-field content "id"))
                        content)))
                  (fs/glob dir "**.yaml"))))
        [(fs/path project-root "backlog" "active")
         (fs/path project-root "backlog" "paused")
         (fs/path project-root "backlog" "done")]))

(defn gather-wiring-facts
  "file-contents map (path -> content at cited-commit), one `git show` per
   distinct parsed path. A path absent from the map means either malformed
   (never queried) or genuinely missing at that commit - pre_qa_gate_lib.bb
   tells those apart via parse-wiring-entry, not this map."
  [project-root cited-commit wiring-entries]
  (let [paths (->> wiring-entries
                   (keep pre-qa-gate-lib/parse-wiring-entry)
                   (map :path)
                   distinct)]
    (into {}
          (keep (fn [path]
                  (let [res (run-git project-root ["show" (str cited-commit ":" path)])]
                    (when (git-ok? res) [path (:out res)]))))
          paths)))

;; ── top-level: gather + evaluate for a git_handoff draft ─────────────────

(defn findings-for-git-handoff
  "The one entry point swarm_handoff.bb's validate calls. `to` is the raw
   comma-separated recipients header; `task-name` is the draft's task
   header; `cited-commit` is the already-canonicalized (10-char) commit.
   Returns {:findings [...] :warnings [...]}. Skips silently (no findings,
   no warnings, no work done) when the gate does not arm or the task name
   carries no extractable ticket id."
  [project-root {:keys [to task-name cited-commit]}]
  (if-not (pre-qa-gate-lib/gate-armed? {:type "git_handoff" :to to})
    {:findings [] :warnings []}
    (let [ticket-id (pipeline-stage-lib/extract-ticket-id task-name)]
      (if-not ticket-id
        {:findings [] :warnings []}
        (let [ancestry (gather-ancestry-facts project-root ticket-id cited-commit)
              yaml-content (find-ticket-yaml-content project-root ticket-id)
              ticket-warnings (if yaml-content [] [(format "ticket-yaml:%s not found on this checkout" ticket-id)])
              wiring-field (when yaml-content (pre-qa-gate-lib/read-required-wiring yaml-content))
              abandoned-field (when yaml-content (pre-qa-gate-lib/read-abandoned-commits yaml-content))
              wiring-entries (if (:present? wiring-field) (or (:items wiring-field) []) [])
              field-level-manifest-finding
              (when (and (:present? wiring-field) (nil? (:items wiring-field)))
                [{:class :manifest :ticket-id ticket-id
                  :detail "required_wiring: field is present but could not be parsed (expected a flow-style [a, b] or block-style - a / - b list)"}])
              abandoned-commits (if (:present? abandoned-field) (or (:items abandoned-field) []) [])
              file-contents (gather-wiring-facts project-root cited-commit wiring-entries)
              result (pre-qa-gate-lib/evaluate
                      {:type "git_handoff" :to to :ticket-id ticket-id :cited-commit cited-commit
                       :role-branch-commits (:role-branch-commits ancestry)
                       :main-reachable-set (:main-reachable-set ancestry)
                       :cited-ancestors-set (:cited-ancestors-set ancestry)
                       :no-dropped-work-set (:no-dropped-work-set ancestry)
                       :wiring-entries wiring-entries
                       :file-contents file-contents
                       :abandoned-commits abandoned-commits})]
          {:findings (vec (concat (:findings result) field-level-manifest-finding))
           :warnings (vec (concat (:warnings ancestry) ticket-warnings))})))))
