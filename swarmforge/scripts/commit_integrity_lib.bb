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
            [cheshire.core :as json]
            [clojure.string :as str]))

;; BL-1526: chase_sweep_lib.bb spawns commit_integrity_cli.bb, which
;; load-files this lib - handoffd.bb load-files chase_sweep_lib.bb, so a
;; plain process/sh here was a spawn-reachable banned-API offender (BL-1031's
;; ratchet), invisible until BL-1526 taught the walk to resolve that spawn
;; target. Self-load-filed rather than relying on a loader to have brought
;; it in first, same convention as every other daemon-reachable lib.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

;; BL-1475: raised from 3 attempts / a flat 50ms to a budget actually sized
;; to the guard chain every other commit on the shared checkout runs
;; (run_commit_guards.sh, up to the full property lane), which can hold
;; `.git/index.lock` for SECONDS - this budget is now also what an
;; add/commit step retries against (not only a post-commit verify
;; mismatch, see commit-with-integrity! below). Capped backoff keeps the
;; total bound well inside 30s even at max-retries (12 gaps of
;; min(attempt*250, 5000)ms sums to 19.5s).
(def default-max-retries 12)
(def default-base-retry-delay-ms 250)
(def default-max-retry-delay-ms 5000)
(def default-lock-max-attempts 100)
(def default-lock-poll-delay-ms 50)

;; BL-1497: the record-less-lock age bound, DERIVED so it can never fall
;; behind the budget it must protect: ten times the CLI's own maximum
;; bounded run - the lock wait itself (default-lock-max-attempts x
;; default-lock-poll-delay-ms = 5 s) plus the BL-1475 add/commit retry
;; budget (12 gaps of min(attempt*250, 5000)ms = 19.5 s), about 25-30 s
;; total - floored at 300000 ms (5 min) per the ticket's approval context.
;; A pre-fix holder (no owner record) still inside its own bounded budget
;; is therefore never reaped, and the floor keeps that guarantee even if
;; the constants above are later shrunk. Derivation recorded here per the
;; ticket; the property runner asserts the floor.
(def bl-1475-retry-budget-ms
  (reduce + (map #(min (* % default-base-retry-delay-ms)
                       default-max-retry-delay-ms)
                 (range 1 (inc default-max-retries)))))

(def record-less-lock-age-bound-ms
  (max (* 10 (+ (* default-lock-max-attempts default-lock-poll-delay-ms)
                bl-1475-retry-budget-ms))
       300000))

(defn- run-git [project-root args]
  (daemon-cycle-guard-lib/sh! (into ["git" "-C" (str project-root)] args)))

;; BL-1475: the ONE failure worth retrying - every other add/commit error
;; (a hook rejection, a missing path, "nothing to commit") fails at once.
(defn lock-refusal? [res]
  (boolean (and res (:err res) (re-find #"index\.lock" (:err res)))))

;; BL-1475: before reporting add-failed/commit-failed, check whether the
;; caller's OWN intended content is already on HEAD - not because this call
;; committed it, but because another writer's commit landed it in the
;; meantime (the exact 2026-09-07 race: a front-desk commit lost the lock
;; to the specifier's mint, which carried the same flip). Requires every
;; expected value to be REAL content (never nil) - a path this caller never
;; actually wrote content for (e.g. `read-fn` found nothing on disk) must
;; never be treated as "landed" merely because `show-fn` ALSO returns nil
;; for a path absent at HEAD (the identical BL-390 nil-vs-nil trap
;; gitCommitScopedFile.ts's isFileCommitted already guards against on the
;; TS side of this same ticket).
(defn- landed-sha-if-matching [project-root expected rev-parse-fn show-fn]
  (when (every? (fn [[_ content]] (some? content)) expected)
    (let [sha (rev-parse-fn project-root)]
      (when (and sha
                 (every? (fn [[path expected-content]]
                           (= expected-content (show-fn project-root sha path)))
                         expected))
        sha))))

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
(def ^:private owner-record-name "owner.json")

;; Best-effort: a record write that fails (disk full, permissions) leaves
;; this holder record-less, protected by the age bound exactly like a
;; pre-fix holder - never a thrown failure mid-acquire.
(defn- write-owner-record! [lock-dir]
  (try
    (let [role (System/getenv "SWARMFORGE_ROLE")
          record (cond-> {:pid (.pid (java.lang.ProcessHandle/current))
                          :created_at_ms (System/currentTimeMillis)}
                   role (assoc :role role))]
      (spit (str (fs/path lock-dir owner-record-name))
            (json/generate-string record)))
    (catch Exception _ nil)))

;; A record without a positive integer pid AND created_at_ms is not a
;; readable record (the caller falls to the record-less age-bound rule) -
;; the same nil-vs-nil discipline as landed-sha-if-matching above.
(defn- read-owner-record [lock-dir]
  (try
    (let [record (json/parse-string
                  (slurp (str (fs/path lock-dir owner-record-name))) true)]
      (when (and (map? record)
                 (pos-int? (:pid record))
                 (pos-int? (:created_at_ms record)))
        record))
    (catch Exception _ nil)))

;; kill -0 via the chokepoint: portable to stock macOS and Linux (never
;; /proc). Exit 0 = the pid can be signalled, i.e. is alive; anything else
;; reads as dead. Every writer on a checkout runs as the same user, so
;; kill -0's cross-user EPERM-means-alive nuance does not arise here.
(defn- pid-alive? [pid]
  (try
    (zero? (:exit (daemon-cycle-guard-lib/sh! "kill" "-0" (str pid))))
    (catch Exception _ false)))

(defn- lock-age-ms [lock-dir record]
  (let [now (System/currentTimeMillis)
        start (or (:created_at_ms record)
                  (try (.toMillis (fs/last-modified-time lock-dir))
                       (catch Exception _ nil)))]
    (max 0 (- now (or start now)))))

;; BL-1497 invariant 1 as a pure decision, so the property runner
;; (bl1497_lock_reap_property_runner.bb) can hold it against generated lock
;; states with the liveness predicate injected - no processes needed:
;;   - readable record, live owner  -> nil (never reaped, whatever the age)
;;   - readable record, dead owner  -> {:reason :dead-owner ...}
;;   - no readable record, age >= bound -> {:reason :record-less-past-bound ...}
;;   - no readable record, younger  -> nil
(defn reap-decision
  [{:keys [record age-ms alive-fn] :or {alive-fn pid-alive?}}]
  (cond
    (and record (alive-fn (:pid record))) nil
    record {:reason :dead-owner :pid (:pid record) :age_ms age-ms}
    (>= age-ms record-less-lock-age-bound-ms)
    {:reason :record-less-past-bound :pid nil :age_ms age-ms}
    :else nil))

;; The reap itself is best-effort and re-verifies immediately before
;; deleting: between this caller's decision and now, the stale lock may
;; already have been reaped and re-created by a live holder - invariant 2's
;; loser must never delete the winner's fresh lock. The re-check shrinks
;; that window to the delete call itself; fs/create-dir stays the final
;; arbiter of who actually holds the lock. Never throws: a failed delete
;; just leaves this caller polling as if the lock were held.
(defn- reap-stale-lock! [lock-dir]
  (try
    (when (fs/exists? lock-dir)
      (let [record (read-owner-record lock-dir)]
        (when (reap-decision {:record record :age-ms (lock-age-ms lock-dir record)})
          (fs/delete-tree lock-dir))))
    (catch Exception _ nil)))

(defn acquire-lock!
  "BL-1497: bounded acquire that also owns the orphan problem. On a win,
   records this process inside the lock directory (owner.json: pid,
   created_at_ms, role) before returning, so the next orphan carries a pid,
   not just an mtime. On contention, inspects the holder: a readable record
   naming a DEAD pid, or NO readable record on a directory older than
   record-less-lock-age-bound-ms, is a provably stale lock - reaped
   (delete-tree) and retried inside the same bounded loop. A lock whose
   recorded owner is alive is never removed, whatever its age (invariant
   1); a record-less lock inside the bound (a pre-fix holder still inside
   its own budget, or a fresh holder that has not yet written its record)
   is waited on, never reaped. The reap is settled by fs/create-dir alone:
   a concurrent reaper that wins the create leaves this caller treating
   the fresh lock as held (invariant 2).

   Returns {:acquired true :reaped <nil or {:pid :age_ms :reason}>} (a
   truthy map) on success and false (falsy) on timeout - the same
   truthiness contract every existing caller relies on. :reason is
   :dead-owner or :record-less-past-bound. Still bounded: max-attempts
   polls, no unbounded wait, no free-running reaper."
  ([lock-dir] (acquire-lock! lock-dir default-lock-max-attempts default-lock-poll-delay-ms))
  ([lock-dir max-attempts poll-delay-ms]
   (fs/create-dirs (fs/parent lock-dir))
   (loop [attempt 1, reaped nil]
     (if (try
           (fs/create-dir lock-dir)
           true
           (catch java.nio.file.FileAlreadyExistsException _ false))
       (do
         ;; Own the lock on record before returning: the next orphan must
         ;; carry a pid, not just an mtime (BL-1497 scenario 04).
         (write-owner-record! lock-dir)
         {:acquired true :reaped reaped})
       (let [record (read-owner-record lock-dir)
             decision (reap-decision {:record record
                                      :age-ms (lock-age-ms lock-dir record)})]
         (if decision
           ;; Provably stale: reap, then let the loop's next create-dir
           ;; decide between this caller and any concurrent reaper. The
           ;; retry consumes the next attempt like any other poll - the
           ;; wait stays bounded.
           (do (reap-stale-lock! lock-dir)
               (if (< attempt max-attempts)
                 (recur (inc attempt) (or reaped decision))
                 false))
           (if (< attempt max-attempts)
             (do (Thread/sleep poll-delay-ms) (recur (inc attempt) reaped))
             false)))))))

(defn release-lock! [lock-dir]
  ;; BL-1497: the directory now carries owner.json, so a bare fs/delete
  ;; (Files.delete) would throw DirectoryNotEmptyException, be swallowed by
  ;; this catch, and leak a live-owned lock every later caller must wait
  ;; out - delete-tree removes record and directory together.
  (try (fs/delete-tree lock-dir) (catch Exception _ nil)))

(defn commit-with-integrity!
  "Commits `paths` (repo-relative pathspecs whose on-disk content the
   caller has already written) into `project-root`'s checkout, serialized
   against every other caller of this helper for the SAME physical git
   directory, pathspec-scoped so no unrelated staged path is ever swept
   in, and verified+retried against a dropped/clobbered edit.

   Required opts: :project-root, :paths (non-empty seq of repo-relative
   pathspecs), :message. Optional: :max-retries (default 12 - i.e. up to 13
   total attempts, BL-1475) and injectable seams (:add-fn!, :commit-fn!,
   :rev-parse-fn, :show-fn, :read-fn, :git-dir-fn, :lock-fn!, :unlock-fn!,
   :retry-delay-fn!, :snapshot-index-fn, :restore-index-fn!), each
   defaulting to the real git-backed implementation above.

   BL-856: every failure path AFTER staging restores the index for `paths`
   to exactly what it held at entry (a snapshot taken once, right after the
   lock is acquired) - a caller's own pre-staged change (e.g. a `git mv`
   rename) survives a failure untouched; a plain unstaged edit is left
   unstaged again. If the restore itself cannot complete, the result carries
   `:index-left-dirty true` rather than silently reporting a clean failure.

   BL-1475: an add/commit failure that looks like a transient
   `.git/index.lock` refusal (lock-refusal?) is retried within max-retries,
   same as a verify mismatch - every OTHER add/commit failure (a hook
   rejection, a missing path) fails at once. Before reporting either
   failure, checks whether the caller's own intended content already
   matches HEAD (landed-sha-if-matching): true means another writer's
   commit already landed it, reported as success with :reason
   :landed-elsewhere and the landing :sha, never as a failure needing
   manual intervention. A genuine failure's result also carries :stderr
   (the failing step's own git stderr, never discarded).

   Returns {:success true :sha <str> :attempts n [:reason :landed-elsewhere]
            [:reaped-lock {:pid :age_ms :reason}]}
        or {:success false :reason kw :attempts n [:stderr <str>]
            [:mismatched-paths [...]] [:index-left-dirty true]}
   BL-1497: a success that first reaped a provably stale checkout lock
   (dead owner, or record-less past the age bound) also carries
   :reaped-lock, which the CLI's JSON line surfaces verbatim.
   `:reason` is one of :no-git-dir, :lock-timeout, :add-failed,
   :commit-failed, :verify-mismatch (failure), or :landed-elsewhere
   (success). Never throws for an ordinary git failure - only for a
   caller-shape error (a missing/blank required option)."
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
         retry-delay-fn! (fn [attempt] (Thread/sleep (min (* attempt default-base-retry-delay-ms) default-max-retry-delay-ms)))
         snapshot-index-fn default-snapshot-index
         restore-index-fn! default-restore-index!}}]
  (when (or (str/blank? project-root) (empty? paths) (str/blank? message))
    (throw (ex-info "commit-with-integrity!: project-root, paths, and message are all required"
                     {:project-root project-root :paths paths :message message})))
  (let [git-dir (git-dir-fn project-root)]
    (if-not git-dir
      {:success false :reason :no-git-dir :attempts 0}
      (let [lock-dir (str (fs/path git-dir "swarmforge-commit-integrity.lock"))
            expected (into {} (map (fn [p] [p (read-fn project-root p)])) paths)
            ;; BL-1497: the default lock-fn! returns {:acquired true
            ;; :reaped {...}} on success and false on timeout; injected
            ;; seams may still return a bare boolean - (:reaped true) is
            ;; nil, so both shapes read the same here.
            lock-result (lock-fn! lock-dir)
            reaped-lock (:reaped lock-result)]
        (if-not lock-result
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
                    (if (and (lock-refusal? add-res) (< attempt (inc max-retries)))
                      (do (retry-delay-fn! attempt) (recur (inc attempt)))
                      (if-let [sha (landed-sha-if-matching project-root expected rev-parse-fn show-fn)]
                        (do (restore-index-fn! project-root paths pre-add-snapshot)
                            (cond-> {:success true :reason :landed-elsewhere :sha sha :attempts attempt}
                              reaped-lock (assoc :reaped-lock reaped-lock)))
                        (fail-restoring :add-failed attempt pre-add-snapshot (when (:err add-res) {:stderr (:err add-res)}))))
                    (let [commit-res (commit-fn! project-root message paths)]
                      (if-not (zero? (:exit commit-res))
                        (if (and (lock-refusal? commit-res) (< attempt (inc max-retries)))
                          (do (retry-delay-fn! attempt) (recur (inc attempt)))
                          (if-let [sha (landed-sha-if-matching project-root expected rev-parse-fn show-fn)]
                            (do (restore-index-fn! project-root paths pre-add-snapshot)
                                (cond-> {:success true :reason :landed-elsewhere :sha sha :attempts attempt}
                                  reaped-lock (assoc :reaped-lock reaped-lock)))
                            (fail-restoring :commit-failed attempt pre-add-snapshot (when (:err commit-res) {:stderr (:err commit-res)}))))
                        (let [post-commit-snapshot (snapshot-index-fn project-root paths)
                              sha (rev-parse-fn project-root)
                              mismatched (vec (keep (fn [[path expected-content]]
                                                       (when (not= expected-content (show-fn project-root sha path))
                                                         path))
                                                     expected))]
                          (if (empty? mismatched)
                            (cond-> {:success true :sha sha :attempts attempt}
                              reaped-lock (assoc :reaped-lock reaped-lock))
                            (if (< attempt (inc max-retries))
                              (do (retry-delay-fn! attempt)
                                  (recur (inc attempt)))
                              (fail-restoring :verify-mismatch attempt post-commit-snapshot {:mismatched-paths mismatched}))))))))))
            (finally (unlock-fn! lock-dir))))))))
