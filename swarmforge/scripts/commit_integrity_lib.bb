#!/usr/bin/env bb
;; BL-419: shared commit-integrity helper for writers on a checkout that may
;; be concurrently committed to by other processes (most acutely the shared
;; master checkout, where coordinator bookkeeping, the BL-topic-record
;; writer, QA's fast-forward, the specifier, and operator_file_question.bb
;; all commit into ONE git index with no isolation).
;;
;; Twice in production a writer's OWN staged edit was silently missing from
;; the commit that claimed to carry it (`git show <new-sha>:<path>`
;; afterward read the PRE-edit content) - confirmed as a shared-index race:
;; a bare `git commit` with no pathspec commits the WHOLE index, and a
;; concurrent writer's add/commit landing in the gap between THIS process's
;; own add and commit can either clear this process's staged change or
;; sweep it into an unrelated commit.
;;
;; Two defenses, applied together (systemic first, defense-in-depth
;; second):
;;  1. SERIALIZE the stage->commit window behind a lock scoped to the
;;     checkout's own git directory (`git rev-parse --absolute-git-dir`),
;;     so every writer that routes through this helper for the SAME
;;     physical checkout (e.g. every master-resident writer, which all
;;     share ONE physical checkout with no isolation) never interleaves
;;     its add/commit with another. A linked worktree's git-dir is its own
;;     per-worktree subdirectory, so this naturally does NOT serialize
;;     writers in different worktrees against each other - they were never
;;     racing on the same index to begin with.
;;  2. PATHSPEC-SCOPE every add/commit to exactly the caller's own paths
;;     (`git commit -- <path>...`), so an unrelated concurrent commit can
;;     never sweep this writer's paths into ITS message/sha, and this
;;     writer's own commit can never carry an unrelated path.
;; On top of both, VERIFY the committed content against what the caller
;; actually staged (read from disk right before staging) via `git show
;; <sha>:<path>`, and on a mismatch RE-STAGE AND RE-COMMIT (a fresh
;; commit, never an amend) within a bounded retry budget - the
;; defense-in-depth half, for whatever race the lock+pathspec pair does
;; not fully close (chiefly a same-path writer not yet routed through this
;; helper). Exhausting the budget FAILS LOUDLY (returns :success false)
;; rather than ever reporting a dropped edit as a successful commit.
;;
;; The lock acquisition itself is BOUNDED the same way: it polls, never
;; blocks forever, and gives up with a loud :lock-timeout failure rather
;; than hanging - an unbounded wait here would let one process that dies
;; mid-lock (kill -9, OOM, host reboot) orphan the lock and freeze every
;; future caller permanently, which is worse than the bug this helper
;; exists to fix.

(ns commit-integrity-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def default-max-retries 3)
(def default-retry-delay-ms 50)
(def default-lock-max-attempts 100)
(def default-lock-poll-delay-ms 50)

(defn- run-git [project-root args]
  (process/sh (into ["git" "-C" (str project-root)] args)))

(defn absolute-git-dir
  "The real, per-checkout git directory - `.git` for an ordinary checkout,
   or a linked worktree's own `.git/worktrees/<name>` subdirectory. Returns
   nil (never throws) when project-root is not inside a git working tree at
   all, so callers can fail loudly instead of locking somewhere
   meaningless."
  [project-root]
  (let [res (run-git project-root ["rev-parse" "--absolute-git-dir"])]
    (when (zero? (:exit res)) (str/trim (:out res)))))

;; A path a prior `git mv`/`git rm` already removed from BOTH the working
;; tree and the index (the common case for a caller that renames a file
;; before calling this helper, e.g. the coordinator's active/->done/ move)
;; is not resolvable by `git add` AT ALL - not on disk, and no longer in
;; the index for `git add` to notice a missing-on-disk entry against
;; (unlike a path merely `rm`ed without `git rm`, which IS still in the
;; index and DOES resolve). `git add` also fails its ENTIRE pathspec
;; atomically on one such unresolvable entry ("did not match any files"),
;; so passing every path through unconditionally would abort staging the
;; OTHER, perfectly good paths too. Filtering to paths that still exist on
;; disk is safe: a path already fully staged by the caller's own git
;; mv/rm needs no re-adding, and the verify step below still catches a
;; genuinely wrong/missing outcome (the committed content would mismatch
;; `expected`) rather than silently trusting an unstaged deletion.
(defn default-add! [project-root paths]
  (let [existing (filter #(fs/exists? (fs/path project-root %)) paths)]
    (if (empty? existing)
      {:exit 0 :out "" :err ""}
      (run-git project-root (into ["add" "--"] existing)))))

(defn default-commit! [project-root message paths]
  (run-git project-root (into ["commit" "-m" message "--"] paths)))

(defn default-rev-parse-head [project-root]
  (let [res (run-git project-root ["rev-parse" "HEAD"])]
    (when (zero? (:exit res)) (str/trim (:out res)))))

(defn default-show [project-root sha path]
  (let [res (run-git project-root ["show" (str sha ":" path)])]
    (when (zero? (:exit res)) (:out res))))

(defn default-read [project-root path]
  (let [f (str (fs/path project-root path))]
    (when (fs/exists? f) (slurp f))))

;; BL-856: the caller's own index entries for `paths`, captured at entry so
;; any failure AFTER staging can restore exactly that pre-call state - not
;; a blanket unstage, which would silently discard a caller's own
;; deliberately pre-staged change (a `git mv` rename, the coordinator's own
;; promotion shape - see default-add!'s comment above). A path present in
;; the returned map WAS staged (at this mode+blob); a path absent from it
;; was not in the index at all (untracked, or already removed) - both are
;; exact, replayable facts, never inferred against HEAD.
(defn default-snapshot-index [project-root paths]
  (let [res (run-git project-root (into ["ls-files" "--stage" "--"] paths))]
    (if-not (zero? (:exit res))
      {}
      (into {}
            (keep (fn [line]
                    (when-not (str/blank? line)
                      (let [[meta path] (str/split line #"\t" 2)
                            [mode sha] (str/split meta #" ")]
                        [path {:mode mode :sha sha}]))))
            (str/split-lines (:out res))))))

;; Restores the index entries for `paths` to exactly `snapshot`
;; (default-snapshot-index's own output, taken before this call staged
;; anything): every path currently staged for `paths` is cleared first
;; (`update-index --force-remove`, index-only - never touches the working
;; tree), then every path `snapshot` says WAS staged is re-registered at
;; its captured mode+blob (`update-index --add --cacheinfo`) - a path
;; snapshot never mentions stays cleared, i.e. unstaged, which is correct
;; for a plain unstaged-on-disk edit. Scoped strictly to `paths`: never
;; reads or writes any entry outside them, so a concurrent writer's own
;; staged path is untouched. Returns true on full success, false the
;; moment any step fails - the caller turns that into a loud
;; `:index-left-dirty` result field rather than swallowing it.
(defn default-restore-index! [project-root paths snapshot]
  (let [current (default-snapshot-index project-root paths)
        to-clear (filter #(contains? current %) paths)
        clear-res (if (seq to-clear)
                    (run-git project-root (into ["update-index" "--force-remove" "--"] to-clear))
                    {:exit 0})]
    (if-not (zero? (:exit clear-res))
      false
      (reduce (fn [ok? [path {:keys [mode sha]}]]
                (if-not ok?
                  false
                  (zero? (:exit (run-git project-root ["update-index" "--add" "--cacheinfo" (str mode "," sha "," path)])))))
              true
              snapshot))))

;; `fs/create-dir` is atomic (a bare mkdir syscall): exactly one concurrent
;; caller wins the create, every other caller gets a
;; FileAlreadyExistsException and spins. Mirrors swarm_handoff.bb's own
;; `next-sequence` lock convention exactly - no new locking primitive
;; introduced into this codebase.
;;
;; BOUNDED per the project's retry/backoff rule: an unbounded spin here
;; would mean a process that dies (kill -9, OOM, host reboot) while
;; holding the lock orphans the lock directory forever, and every
;; subsequent caller of this helper for the same checkout hangs
;; indefinitely - a worse, silent failure mode than the dropped-commit bug
;; this helper exists to fix. Gives up and returns false after
;; `max-attempts` polls rather than blocking forever; the caller turns
;; that into a loud, non-throwing failure (:lock-timeout).
(defn acquire-lock!
  ([lock-dir] (acquire-lock! lock-dir default-lock-max-attempts default-lock-poll-delay-ms))
  ([lock-dir max-attempts poll-delay-ms]
   (fs/create-dirs (fs/parent lock-dir))
   (loop [attempt 1]
     (if (try
           (fs/create-dir lock-dir)
           true
           (catch java.nio.file.FileAlreadyExistsException _ false))
       true
       (if (< attempt max-attempts)
         (do (Thread/sleep poll-delay-ms) (recur (inc attempt)))
         false)))))

(defn release-lock! [lock-dir]
  (try (fs/delete lock-dir) (catch Exception _ nil)))

(defn commit-with-integrity!
  "Commits `paths` (repo-relative pathspecs whose on-disk content the
   caller has already written) into `project-root`'s checkout, serialized
   against every other caller of this helper for the SAME physical git
   directory, pathspec-scoped so no unrelated staged path is ever swept
   in, and verified+retried against a dropped/clobbered edit.

   Required opts: :project-root, :paths (non-empty seq of repo-relative
   pathspecs), :message. Optional: :max-retries (default 3 - i.e. up to 4
   total attempts) and injectable seams (:add-fn!, :commit-fn!,
   :rev-parse-fn, :show-fn, :read-fn, :git-dir-fn, :lock-fn!, :unlock-fn!,
   :retry-delay-fn!, :snapshot-index-fn, :restore-index-fn!), each
   defaulting to the real git-backed implementation above.

   BL-856: every failure path AFTER staging restores the index for `paths`
   to exactly what it held at entry (a snapshot taken once, right after the
   lock is acquired) - a caller's own pre-staged change (e.g. a `git mv`
   rename) survives a failure untouched; a plain unstaged edit is left
   unstaged again. If the restore itself cannot complete, the result carries
   `:index-left-dirty true` rather than silently reporting a clean failure.

   Returns {:success true :sha <str> :attempts n}
        or {:success false :reason kw :attempts n [:mismatched-paths [...]]
            [:index-left-dirty true]}
   `:reason` is one of :no-git-dir, :lock-timeout, :add-failed,
   :commit-failed, :verify-mismatch. Never throws for an ordinary git
   failure - only for a caller-shape error (a missing/blank required
   option)."
  [{:keys [project-root paths message max-retries
           add-fn! commit-fn! rev-parse-fn show-fn read-fn
           git-dir-fn lock-fn! unlock-fn! retry-delay-fn!
           snapshot-index-fn restore-index-fn!]
    :or {max-retries default-max-retries
         add-fn! default-add!
         commit-fn! default-commit!
         rev-parse-fn default-rev-parse-head
         show-fn default-show
         read-fn default-read
         git-dir-fn absolute-git-dir
         lock-fn! acquire-lock!
         unlock-fn! release-lock!
         retry-delay-fn! (fn [attempt] (Thread/sleep (* attempt default-retry-delay-ms)))
         snapshot-index-fn default-snapshot-index
         restore-index-fn! default-restore-index!}}]
  (when (or (str/blank? project-root) (empty? paths) (str/blank? message))
    (throw (ex-info "commit-with-integrity!: project-root, paths, and message are all required"
                     {:project-root project-root :paths paths :message message})))
  (let [git-dir (git-dir-fn project-root)]
    (if-not git-dir
      {:success false :reason :no-git-dir :attempts 0}
      (let [lock-dir (str (fs/path git-dir "swarmforge-commit-integrity.lock"))
            expected (into {} (map (fn [p] [p (read-fn project-root p)])) paths)]
        (if-not (lock-fn! lock-dir)
          {:success false :reason :lock-timeout :attempts 0}
          (try
            (let [fail-restoring (fn [reason attempt attempt-snapshot extra]
                                    (let [restored? (restore-index-fn! project-root paths attempt-snapshot)]
                                      (merge {:success false :reason reason :attempts attempt}
                                             extra
                                             (when-not restored? {:index-left-dirty true}))))]
              ;; Two distinct snapshot points, not one shared "before the
              ;; loop" snapshot - they answer different questions:
              ;;  - pre-add-snapshot (before THIS attempt's own add-fn!):
              ;;    what the caller had staged before this attempt touched
              ;;    anything. Used for :add-failed/:commit-failed, where
              ;;    staging happened but no real commit ever landed - the
              ;;    caller's paths must go back to exactly this.
              ;;  - post-commit-snapshot (right after commit-fn! SUCCEEDS,
              ;;    before verify runs): a successful commit already synced
              ;;    the index to its own new HEAD, so this snapshot IS that
              ;;    synced state. Used for :verify-mismatch after retries
              ;;    are exhausted - restoring to it is a true no-op (nothing
              ;;    mutates the index between this snapshot and the failure
              ;;    return, only a read-only verify). Restoring to the
              ;;    ORIGINAL pre-call snapshot instead would drag the index
              ;;    backward to a blob that no longer matches the
              ;;    just-created HEAD - a spurious index/HEAD/worktree
              ;;    three-way mismatch ("MM" status), not "exactly as it
              ;;    found it": the content is not dangling-staged here, it
              ;;    is already committed (to a verify-rejected sha).
              (loop [attempt 1]
                (let [pre-add-snapshot (snapshot-index-fn project-root paths)
                      add-res (add-fn! project-root paths)]
                  (if-not (zero? (:exit add-res))
                    (fail-restoring :add-failed attempt pre-add-snapshot {})
                    (let [commit-res (commit-fn! project-root message paths)]
                      (if-not (zero? (:exit commit-res))
                        (fail-restoring :commit-failed attempt pre-add-snapshot {})
                        (let [post-commit-snapshot (snapshot-index-fn project-root paths)
                              sha (rev-parse-fn project-root)
                              mismatched (vec (keep (fn [[path expected-content]]
                                                       (when (not= expected-content (show-fn project-root sha path))
                                                         path))
                                                     expected))]
                          (if (empty? mismatched)
                            {:success true :sha sha :attempts attempt}
                            (if (< attempt (inc max-retries))
                              (do (retry-delay-fn! attempt)
                                  (recur (inc attempt)))
                              (fail-restoring :verify-mismatch attempt post-commit-snapshot {:mismatched-paths mismatched}))))))))))
            (finally (unlock-fn! lock-dir))))))))
