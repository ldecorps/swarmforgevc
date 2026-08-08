;; BL-839: detects when the master checkout's working tree - the tree the
;; daemons actually EXECUTE (`bb <repo>/swarmforge/scripts/handoffd.bb` runs
;; whatever bytes are on disk, not a committed ref) - no longer agrees with
;; `main`. On 2026-08-06 a complete, staged reversion of BL-835's shipped fix
;; sat in the master checkout for hours: `main` carried the fix, the file the
;; daemon loaded carried the pre-fix text, and nothing anywhere said so. This
;; is the detector. Report only - see the ticket's approval_context for why
;; not auto-repair (an auto-restore would discard uncommitted work without
;; asking, the exact "surfaced, not swept" failure the constitution forbids).
;;
;; "Daemon-executed" is DERIVED, not hand-listed: starting from a small seed
;; of known daemon entrypoints (handoffd.bb, handoffd_supervisor.bb),
;; resolve-daemon-executed-paths walks the SAME `(load-file ...)` calls those
;; scripts themselves use to pull in their own dependencies (flow_watchdog_lib,
;; handoff_lib, and so on, transitively) - a real BFS over the actual code the
;; daemon loads, not a snapshot that silently goes stale as those scripts'
;; dependencies change. A ticket YAML under backlog/ or a scratch file is
;; never in this set by construction - the walk only ever follows load-file
;; edges rooted at the entrypoints.
;;
;; Two declared invariants (BL-654, coder-authored property tests in
;; test/bl839_master_checkout_drift_property_runner.bb):
;;   1. The check never writes - every git call below is read-only plumbing
;;      (`show`, `rev-parse --verify`) and every filesystem call is a read
;;      (`slurp`/`fs/exists?`) - never `checkout`, `reset`, `add`, `stash`,
;;      or `commit`.
;;   2. A check that cannot run says so - every IO result carries an
;;      explicit `-ok?` flag rather than using nil-as-sentinel (nil is a
;;      legitimate empty-file content), and ANY false `-ok?` anywhere -
;;      failing to resolve `main`, to read a script off disk, or to read
;;      its committed/staged content - forces the verdict to :unknown,
;;      which aggregate-verdict then ranks ABOVE :drift and :no-drift so
;;      one unreadable file can never be masked by the rest reading clean.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "master_checkout_drift_lib.bb")))
;; and referred to as master-checkout-drift-lib/foo.

(ns master-checkout-drift-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def default-entrypoints
  "The daemons this check covers: handoffd.bb (delivery/chase/flow-watchdog/
   every sweep in the main cadence loop) and handoffd_supervisor.bb (its
   restarter). Both are started together by start_handoff_daemon.sh and are
   the always-on swarm-coordination daemons the constitution and BL-839's
   own repro (`pgrep` showing the live handoffd.bb process) are about.
   Growing this to the bridge/front-desk/cursor supervisors or
   operator_runtime.bb is a one-line addition to this set, not a redesign -
   deliberately left out of this slice to keep it small and reviewable."
  #{"handoffd.bb" "handoffd_supervisor.bb"})

(def default-scripts-subdir "swarmforge/scripts")

;; ── pure: which .bb files does one script's source (load-file ...)? ────────

(defn extract-load-file-basenames
  "Pure text scan of one script's own source: the set of bare .bb filenames
   it (load-file ...)s from its own directory. A commented-out line (trimmed
   text starting with `;`) is never treated as a real dependency - several
   production scripts carry a documentation comment showing the exact
   load-file incantation a caller would use, and that must not be read as
   an edge in the dependency graph."
  [content]
  (->> (str/split-lines content)
       (remove #(str/starts-with? (str/trim %) ";"))
       (filter #(str/includes? % "load-file"))
       (keep (fn [line]
               (when-let [matches (seq (re-seq #"\"([^\"]+\.bb)\"" line))]
                 (second (last matches)))))
       (into #{})))

;; ── pure (given an injected reader): the transitive closure ────────────────

(defn resolve-daemon-executed-paths
  "BFS closure of (load-file ...) dependencies starting from `entrypoints`
   (a set of bare .bb filenames). `read-file` is (fn [bare-filename] ->
   content-string-or-nil) - injected so this stays testable with an
   in-memory map and, in production, backs onto a real disk read. Returns
   the full set of bare .bb filenames the daemon(s) execute, INCLUDING the
   entrypoints themselves. A filename `read-file` cannot read is still
   included in the result (its own drift check reports :unknown rather than
   silently vanishing from the set - see check-master-checkout-drift!) but
   contributes no further edges, since its dependencies can't be discovered."
  [{:keys [entrypoints read-file]}]
  (loop [frontier (set entrypoints)
         visited #{}]
    (if-let [next-file (first frontier)]
      (if (contains? visited next-file)
        (recur (disj frontier next-file) visited)
        (let [content (read-file next-file)
              deps (if content (extract-load-file-basenames content) #{})]
          (recur (into (disj frontier next-file) deps)
                 (conj visited next-file))))
      visited)))

;; ── pure: per-file drift classification ─────────────────────────────────────

(defn classify-drift
  "Given one script's three independent readings - the content landed on
   `main`, the staged/index content, and the working-tree content on disk,
   each with its own -ok? flag - decide the drift verdict:
     :unknown              - any of the three reads failed; cannot compare
     :staged-for-reversion - the INDEX differs from main (one `git commit`
                              away from landing on main - the BL-835
                              incident's own shape, checked first as the
                              more urgent case)
     :uncommitted-edit     - the index matches main but the WORKING TREE
                              does not (a plain unstaged edit)
     :no-drift              - all three agree
   Explicit -ok? flags, not nil-as-sentinel, because nil is also legitimate
   content (an empty file) - conflating the two would misreport a read
   failure as a genuinely empty, matching file."
  [{:keys [main-content main-ok?
           index-content index-ok?
           worktree-content worktree-ok?]}]
  (cond
    (not (and main-ok? index-ok? worktree-ok?)) :unknown
    (not= index-content main-content) :staged-for-reversion
    (not= worktree-content main-content) :uncommitted-edit
    :else :no-drift))

;; ── pure: roll many per-file verdicts into one ──────────────────────────────

(defn aggregate-verdict
  "Roll up a map of relative-path -> drift verdict into one overall verdict.
   :unknown outranks :drift outranks :no-drift, so a single file the check
   could not read is never masked by every other file reading clean
   (invariant 2), and real drift on one file is never masked by the rest
   being clean."
  [per-file]
  (let [verdicts (vals per-file)]
    (cond
      (some #{:unknown} verdicts) :unknown
      (some #{:staged-for-reversion :uncommitted-edit} verdicts) :drift
      :else :no-drift)))

;; ── pure: alarm text ─────────────────────────────────────────────────────────

(defn- drift-line [[path verdict]]
  (case verdict
    :staged-for-reversion
    (str "  - " path ": STAGED (index) content differs from main - one `git commit` away from landing the reversion on main")
    :uncommitted-edit
    (str "  - " path ": working-tree content differs from main (uncommitted)")
    :unknown
    (str "  - " path ": could not be read to compare against main")
    nil))

(defn format-alarm-text
  "Renders the alarm text for a check result ({:overall ... :per-file ...}),
   or nil when there is nothing to alarm on (:no-drift). Never phrases the
   :unknown case as clean - it states plainly that drift could not be
   determined, distinct from both :drift and :no-drift wording."
  [{:keys [overall per-file]}]
  (case overall
    :no-drift nil

    :unknown
    (str "MASTER CHECKOUT DRIFT CHECK COULD NOT RUN: unable to determine whether "
         "the master checkout's daemon-executed scripts match main. This is "
         "reported as UNKNOWN, not as no-drift.\n"
         (str/join "\n" (keep drift-line (filter (fn [[_ v]] (= v :unknown)) per-file))))

    :drift
    (str "MASTER CHECKOUT DRIFT: the code the daemons are RUNNING is not the code "
         "that LANDED on main. A QA-approved, merged fix can be silently not in "
         "effect while its ticket sits closed.\n"
         (str/join "\n" (keep drift-line (remove (fn [[_ v]] (= v :no-drift)) per-file))))))

;; ── impure: real git/filesystem IO (read-only) ──────────────────────────────

(defn- run-git
  "Read-only git plumbing only (show / rev-parse --verify) - never a git
   call that can mutate the working tree or index."
  [project-root args]
  (try
    (let [res (process/sh (into ["git" "-C" (str project-root)] args))]
      (if (zero? (:exit res))
        {:ok? true :content (:out res)}
        {:ok? false :content nil}))
    (catch Exception _
      {:ok? false :content nil})))

(defn- read-disk [project-root scripts-subdir bare-name]
  (try
    (let [p (fs/path project-root scripts-subdir bare-name)]
      (if (fs/exists? p)
        {:ok? true :content (slurp (str p))}
        {:ok? false :content nil}))
    (catch Exception _
      {:ok? false :content nil})))

;; ── impure: orchestration ────────────────────────────────────────────────────

(defn check-master-checkout-drift!
  "Runs the drift check over the daemon-executed scripts and, when there is
   anything to report (:drift or :unknown), calls (emit-alarm! text) - never
   for :no-drift. Returns {:overall ... :per-file ...}.

   `run-git*`/`read-disk*` default to the real, read-only git/filesystem IO
   above; tests inject fakes (a plain map lookup) so the unit-test runner
   stays instant and the property runner can additionally exercise the real
   IO path against real fixture git repos."
  [{:keys [project-root scripts-subdir entrypoints emit-alarm! run-git* read-disk*]
    :or {scripts-subdir default-scripts-subdir
         entrypoints default-entrypoints
         run-git* run-git
         read-disk* read-disk}}]
  (let [main-ok? (:ok? (run-git* project-root ["rev-parse" "--verify" "main"]))]
    (if-not main-ok?
      (let [result {:overall :unknown :per-file {}}]
        (when emit-alarm! (emit-alarm! (format-alarm-text result)))
        result)
      (let [read-file (fn [bare-name]
                         (let [r (read-disk* project-root scripts-subdir bare-name)]
                           (when (:ok? r) (:content r))))
            paths (resolve-daemon-executed-paths {:entrypoints entrypoints :read-file read-file})
            per-file
            (into {}
                  (for [bare paths]
                    (let [repo-rel (str scripts-subdir "/" bare)
                          main (run-git* project-root ["show" (str "main:" repo-rel)])
                          index (run-git* project-root ["show" (str ":" repo-rel)])
                          disk (read-disk* project-root scripts-subdir bare)]
                      [repo-rel (classify-drift
                                 {:main-content (:content main) :main-ok? (:ok? main)
                                  :index-content (:content index) :index-ok? (:ok? index)
                                  :worktree-content (:content disk) :worktree-ok? (:ok? disk)})])))
            overall (aggregate-verdict per-file)
            result {:overall overall :per-file per-file}]
        (when (and emit-alarm! (not= overall :no-drift))
          (emit-alarm! (format-alarm-text result)))
        result))))
