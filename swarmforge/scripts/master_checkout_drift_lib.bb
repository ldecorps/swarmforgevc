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
            [clojure.string :as str]))

;; BL-967: subprocess waits are bounded at the shared chokepoint - this
;; lib runs inside handoffd's poll cycle (the heavy-bundle drift sweep), and
;; its git calls hit the shared, chronically-contended master checkout.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

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

;; ── pure: which .bb files does one script SPAWN? (BL-1022) ─────────────────
;; The load-file scan above follows one edge kind. handoffd.bb reaches
;; swarm_handoff.bb by spawning it - `sh! ["bb" (swarm-handoff-script) ...]` -
;; and a spawn edge is invisible to a load-file walk. That is why the banned
;; clojure.java.shell API sat on the daemon's critical path unseen until it
;; deadlocked production (BL-1021). A derived guard still has a DEPTH, and one
;; hop is the default nobody notices choosing.
;;
;; The spawn vector is read as Clojure data rather than matched with a regex:
;; these are real source forms, and `read-string` gets nesting and quoting
;; right where a regex guesses. Anything unreadable is reported, not skipped.

(defn- string-literals-in
  "Every string literal anywhere inside an already-read form."
  [form]
  (cond
    (string? form) [form]
    (coll? form) (mapcat string-literals-in form)
    :else []))

(defn- bb-basename
  "The bare `foo.bb` at the end of a path literal, or nil."
  [s]
  (when-let [m (re-find #"([^/\"]+\.bb)$" (str s))]
    (second m)))

(defn- resolve-spawn-target
  "The .bb basename `target-form` names, or nil if it cannot be resolved
   statically. Three shapes are resolvable, and they are the three that occur:
   a bare literal, a literal wrapped in path plumbing, and a zero-arg helper
   defined in the SAME file whose body carries the literal - which is the shape
   handoffd.bb actually uses. Anything else is deliberately nil so the caller
   can report it."
  [target-form content]
  (or (some bb-basename (string-literals-in target-form))
      ;; A zero-arg same-file helper: find `(defn <name> [] ...)` and resolve
      ;; through its body. Read the whole defn form so a multi-line body works.
      (when (and (list? target-form) (= 1 (count target-form)) (symbol? (first target-form)))
        (let [nm (name (first target-form))
              needle (str "(defn " nm " [")]
          (when-let [i (str/index-of content needle)]
            (try
              (some bb-basename (string-literals-in (read-string (subs content i))))
              (catch Exception _ nil)))))))

(defn- spawn-forms
  "Every `[\"<runtime>\" ...]` vector in `content`, read as data, paired with the
   runtime. Comment lines are blanked first so a documentation example is never
   an edge - the same rule extract-load-file-basenames applies."
  [content]
  (let [decommented (->> (str/split-lines content)
                         (map #(if (str/starts-with? (str/trim %) ";") "" %))
                         (str/join "\n"))]
    ;; Scan by POSITION, not by re-finding the matched text: several spawns in
    ;; one file share the same `["bb"` prefix, and looking each one up by its
    ;; text would read the FIRST occurrence every time - so every spawn after
    ;; the first would be silently mistaken for it. That is the same
    ;; silently-skipped-target failure this walk exists to prevent, one level
    ;; down, and it hid an unresolvable target during authoring.
    (loop [from 0 acc []]
      (if-let [i (loop [j from]
                   (when-let [k (str/index-of decommented "[\"" j)]
                     (if (re-find #"^\[\"(bb|bash|sh|zsh)\"" (subs decommented k (min (count decommented) (+ k 8))))
                       k
                       (recur (inc k)))))]
        (let [runtime (second (re-find #"^\[\"([a-z]+)\"" (subs decommented i)))
              form (try (read-string (subs decommented i)) (catch Exception _ nil))]
          (recur (inc i) (if (vector? form) (conj acc [runtime form]) acc)))
        acc))))

(defn extract-spawn-targets
  "Pure text scan of one script's source: which scripts it SPAWNS.
     :resolved   - bare .bb filenames, real edges to follow
     :unresolved - spawn targets this walk could not resolve statically,
                   as source text. Reported LOUDLY by the caller and never
                   silently dropped: a skipped target is the same class of
                   blind spot one level up.
     :non-bb     - scripts spawned under another runtime (bash). These are
                   real edges, but the Clojure subprocess-namespace ban cannot
                   speak about a shell script, so they are RECORDED to make the
                   gate's scope visible rather than left to be assumed."
  [content]
  (reduce
    (fn [acc [runtime form]]
      (let [target (second form)]
        (if (= runtime "bb")
          (if-let [b (resolve-spawn-target target content)]
            (update acc :resolved conj b)
            ;; A `bb -e "<expr>"` runs an inline expression rather than a repo
            ;; script - it has no file to reach, and the expression itself is
            ;; already inside the file being scanned.
            (if (= "-e" target)
              acc
              (update acc :unresolved conj (pr-str target))))
          (if-let [sh (some #(re-find #"[^/\"]+\.(sh|bash|zsh)$" (str %))
                            (string-literals-in target))]
            (update acc :non-bb conj (first sh))
            (update acc :unresolved conj (pr-str target))))))
    {:resolved #{} :unresolved #{} :non-bb #{}}
    (spawn-forms content)))

;; ── pure (given an injected reader): the transitive closure ────────────────

(defn resolve-daemon-reachability
  "BFS over the daemon's reachability graph from `entrypoints`, following the
   edge kinds in `edge-kinds` (default both `:load` and `:spawn`). Returns

     {:closure    #{bare .bb filenames, entrypoints included}
      :reached-by {filename #{:entrypoint | [:load from] | [:spawn from]}}
      :unresolved [{:from filename :target source-text}]
      :non-bb     #{scripts spawned under another runtime}}

   `reached-by` is what makes scenario 04 answerable: a gate that reports only
   a COUNT passes for the wrong reason when its closure silently shrinks - which
   is exactly how the old walk read green while missing the file that took
   production down.

   A filename `read-file` cannot read is still included (it contributes no
   further edges, but must not vanish from the set), matching the original
   walk's contract."
  [{:keys [entrypoints read-file edge-kinds]}]
  (let [kinds (or edge-kinds #{:load :spawn})
        read-one (fn [f] (if (map? read-file) (get read-file f) (read-file f)))]
    (loop [frontier (vec entrypoints)
           visited #{}
           reached-by (into {} (map (fn [e] [e #{:entrypoint}]) entrypoints))
           unresolved []
           non-bb #{}]
      (if-let [f (first frontier)]
        (if (contains? visited f)
          (recur (subvec frontier 1) visited reached-by unresolved non-bb)
          (let [content (read-one f)
                loads (if (and content (kinds :load)) (extract-load-file-basenames content) #{})
                spawn (if (and content (kinds :spawn)) (extract-spawn-targets content)
                          {:resolved #{} :unresolved #{} :non-bb #{}})
                spawns (:resolved spawn)]
            (recur (into (subvec frontier 1) (concat loads spawns))
                   (conj visited f)
                   (as-> reached-by rb
                     (reduce (fn [m d] (update m d (fnil conj #{}) [:load f])) rb loads)
                     (reduce (fn [m d] (update m d (fnil conj #{}) [:spawn f])) rb spawns))
                   (into unresolved (map (fn [t] {:from f :target t}) (sort (:unresolved spawn))))
                   (into non-bb (:non-bb spawn)))))
        {:closure visited
         :reached-by (select-keys reached-by visited)
         :unresolved unresolved
         :non-bb non-bb}))))

(defn resolve-daemon-executed-paths
  "BFS closure of (load-file ...) dependencies starting from `entrypoints`
   (a set of bare .bb filenames). `read-file` is (fn [bare-filename] ->
   content-string-or-nil) - injected so this stays testable with an
   in-memory map and, in production, backs onto a real disk read. Returns
   the full set of bare .bb filenames the daemon(s) execute, INCLUDING the
   entrypoints themselves. A filename `read-file` cannot read is still
   included in the result (its own drift check reports :unknown rather than
   silently vanishing from the set - see check-master-checkout-drift!) but
   contributes no further edges, since its dependencies can't be discovered.

   BL-1022: this deliberately still follows LOAD edges only. Widening what the
   master-checkout DRIFT check compares against main is a different decision
   from widening what the subprocess-API ban covers, and only the latter is
   this ticket. Callers that want spawn edges too use
   resolve-daemon-reachability directly."
  [{:keys [entrypoints read-file]}]
  (:closure (resolve-daemon-reachability
              {:entrypoints entrypoints :read-file read-file :edge-kinds #{:load}})))


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
    (let [res (daemon-cycle-guard-lib/sh! (into ["git" "-C" (str project-root)] args))]
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
