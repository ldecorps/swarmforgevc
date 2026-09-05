;; BL-1370: the per-pass orphan check, as a tool instead of a ritual.
;;
;; QA's prompt states the gate exactly: no leftover test or mutation processes
;; BEFORE verification, because a run on top of one skews results and pins
;; cores; none alive AFTER it, because an orphaned run reparents to the OS and
;; burns cores for hours; and stragglers are reaped by process GROUP
;; (`kill -- -<pgid>`), never by pid. Every clause is mechanical, and until now
;; none of it had an entry point: 326 evidence files record this check in
;; almost as many different wordings, which is the signature of a step composed
;; from scratch each pass rather than emitted.
;;
;; This is NOT the background janitor and does not replace it. The janitor
;; reclaims what nobody is watching, on its own cadence, with deliberately
;; conservative predicates. This answers a different question - "is MY pass
;; clean, right now" - and it is the one that had no tool.
;;
;; The dangerous part is scope, not detection: get "mine" wrong in the killing
;; direction and this destroys a colleague's running suite. So scope is not
;; decided here. It delegates to process_table_lib's `project-scoped-process?`,
;; the same classifier the orphan janitor and the handoffd supervisor defer to
;; so they "can never disagree" (BL-887). A second notion of what is mine is
;; the one change that would make this tool unsafe.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "worktree_stray_lib.bb")))
;; Referred to as worktree-stray-lib/foo.
(ns worktree-stray-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "process_table_lib.bb")))

(def job-process-pattern
  "The long-running job processes this gate is about: Stryker mutation roots,
   `node --test` batches, and the property-lane vitest tree. MIRRORED from
   handoffd_supervisor.bb's `job-process-pattern`, which cannot be loaded to
   read it (that script's top level exits with usage). BL-897 binds a constant
   mirrored across two files to a test asserting both literals agree:
   test_bl1370_worktree_strays.sh does exactly that and refuses if they drift."
  #"(?i)stryker|node --test|vitest\.properties\.config\.mjs|\bnpm exec vitest\b|\bnpx vitest\b|\(vitest")

(defn job-process?
  "True when a cmdline is one of the job processes above."
  [cmdline]
  (boolean (re-find job-process-pattern (or cmdline ""))))

(defn stray?
  "A process is THIS worktree's stray when it is a job process AND the shared
   classifier says it is scoped to this root. Both halves are required: the
   pattern alone matches a colleague's legitimate suite, and the scope alone
   matches every ordinary process in the checkout."
  [{:keys [cmdline cwd]} root]
  (and (job-process? cmdline)
       (process-table-lib/project-scoped-process? cmdline cwd [root])))

(defn strays
  "Every stray for `root` in `processes`, each with the process GROUP that
   reaping needs. `processes` is [{:pid :cmdline :cwd :pgid}] - the caller
   supplies them so this stays pure and testable without a process table.
   Self and ancestors are excluded by the caller (a check that reported itself
   could never be clean)."
  [processes root]
  (vec (filter #(stray? % root) processes)))

(defn result-line
  "The ONE wording a pass records, so 326 hand-written variants become one
   line. Stable for a given state: same inputs, same bytes."
  [strays scanned root]
  (if (seq strays)
    (str "WORKTREE_STRAYS: " (count strays) " stray job process(es) in " root
         " — " (str/join ", " (map (fn [{:keys [pid pgid cmdline]}]
                                     (str "pid=" pid " pgid=" (or pgid "?")
                                          " " (subs (or cmdline "") 0 (min 60 (count (or cmdline ""))))))
                                   strays))
         " (reap by process group: kill -- -<pgid>)")
    (str "WORKTREE_STRAYS: none in " root " (" scanned " process(es) scanned"
         ", patterns: stryker, node --test, property-lane vitest)")))

(defn reap-targets
  "The process GROUPS to signal, deduplicated. Reaping is by group and never by
   pid: an orphaned run reparents to the OS and its children outlive a bare pid
   kill (invariant 2). A stray whose pgid could not be read is reported rather
   than killed - a kill aimed at `nil` is how a tool like this takes out the
   wrong thing."
  [strays]
  (let [{:keys [with without]} (group-by #(if (:pgid %) :with :without) strays)]
    {:pgids (vec (distinct (keep :pgid with)))
     :unreapable (vec (or without []))}))
