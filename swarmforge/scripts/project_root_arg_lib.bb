#!/usr/bin/env bb
;; project_root_arg_lib.bb — BL-1517: a positional project-root/fixture-root
;; argument is a repository (or, for a plain-directory harness, an existing
;; directory) before it is bound and canonicalised - never a flag word, a
;; blank, or an absent argument silently resolved against the process's own
;; cwd. Several Babashka CLIs and test harnesses bound their root as
;; `(first args)` / `(or (first args) ".")` with no check at all: a flag in
;; the root position, or an absent argument in a harness invoked bare,
;; became a real directory created under cwd (main_sync_status_cli.bb wrote
;; --help/.swarmforge/daemon/, 2026-09-04; a sweep harness invoked bare
;; delivered two real notes into the live coordinator inbox, 2026-08-14).
;;
;; check-root does the IO its own job requires (fs/directory?, and for
;; :repository strictness, a real `git -C <arg> rev-parse --git-common-dir`)
;; - there is no way to answer "is this a repository" without asking git.
;; Everything else here (reason text, the refusal line) is pure formatting.

(ns project-root-arg-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(defn- reason-text [reason]
  (case reason
    :blank "no project-root argument given"
    :flag-shaped "looks like a flag, not a path"
    :not-a-directory "not an existing directory"
    :not-a-repository "not inside a git checkout (git -C <arg> rev-parse --git-common-dir failed)"
    (name reason)))

(defn- repository? [dir]
  (let [{:keys [exit]} (process/sh {:dir (str dir) :continue true}
                                    "git" "-C" (str dir) "rev-parse" "--git-common-dir")]
    (zero? exit)))

(defn check-root
  "Validates a raw project-root/fixture-root positional argument.

   strictness :repository (default) - the argument must be an existing
   directory that is also a git checkout (`git -C <arg> rev-parse
   --git-common-dir` succeeds).
   strictness :directory - the argument must be an existing directory;
   no git requirement.

   Returns {:ok true :root <canonicalised-str>} on success, or
   {:ok false :reason <keyword> :arg <raw-arg-str>} on refusal - never
   throws, never creates or touches anything under the argument."
  [raw-arg & {:keys [strictness] :or {strictness :repository}}]
  (let [arg (str (or raw-arg ""))]
    (cond
      (str/blank? arg)
      {:ok false :reason :blank :arg arg}

      (str/starts-with? arg "-")
      {:ok false :reason :flag-shaped :arg arg}

      (not (fs/directory? arg))
      {:ok false :reason :not-a-directory :arg arg}

      (and (= strictness :repository) (not (repository? arg)))
      {:ok false :reason :not-a-repository :arg arg}

      :else
      {:ok true :root (str (fs/canonicalize arg))})))

(defn refusal-line
  "The uniform stderr line every wiring site prints on refusal: 'REFUSED
   project-root <arg verbatim>: <reason text>'."
  [{:keys [arg reason]}]
  (str "REFUSED project-root " arg ": " (reason-text reason)))

(defn refuse-and-exit!
  "Prints usage-line (if given, non-blank) then the refusal line to
   stderr, and exits 2 - the ONE IO+exit convenience every wiring site
   would otherwise hand-roll identically. check must be a check-root
   failure map ({:ok false ...})."
  [usage-line check]
  (binding [*out* *err*]
    (when (and usage-line (not (str/blank? (str usage-line))))
      (println usage-line))
    (println (refusal-line check)))
  (System/exit 2))

;; ── The durable half (BL-1517 scenario 06) ──────────────────────────────
;; A hardcoded list of "the harnesses we fixed" only protects against the
;; population at fix time - a harness added later with the same unguarded
;; shape ships the hazard again unless something ENUMERATES the directory
;; every time. harness-root-binding-files does that enumeration (a real
;; fs/list-dir over the given dir, never a stub); missing-fixture-root?
;; then behaviourally proves - by actually running the file bare, from a
;; scratch cwd - whether it refuses or falls back to cwd, so a harness
;; with SOME guard that is nonetheless broken is still caught (this is
;; not "does the fix's marker text appear", it is "does it actually
;; refuse").

;; Specifically a `project-root` BINDING that is ALSO argv-derived, not
;; any first-positional read - several harnesses read *command-line-args*
;; for an unrelated first argument (a JSON scenario blob, an email
;; address, a ticket id) that has nothing to do with a filesystem root;
;; textually matching every such read would flag those as false
;; positives for a hazard class they are not in. `(def project-root` must
;; start an actual source line (optional leading whitespace only) - a
;; test file that merely CONTAINS that text as part of a string literal
;; it is writing out (this ticket's own lib test runner builds fixture
;; sources exactly like the real thing) never has it at true line-start,
;; since it sits after an opening quote or an escaped-newline mid-string.
;; The two substrings are otherwise checked independently (never one
;; combined regex requiring exact adjacency) so a GUARDED file - whose
;; `(def project-root ...)` now wraps `(first *command-line-args*)`
;; inside project-root-arg-lib's own check-root call, rather than binding
;; it directly - still matches both: the guard must keep working, not
;; merely stop looking guarded. The three in-scope harnesses, and the two
;; already-out-of-scope ones the ticket names
;; (bl619_token_burn_briefing_harness.bb, commit_integrity_test_cli.bb -
;; both throw on a missing arg already), all name the bound var exactly
;; `project-root` at true line-start.
(def ^:private project-root-def-pattern #"(?m)^\s*\(def project-root\b")

(defn- binds-project-root-from-argv? [source]
  (and (re-find project-root-def-pattern source)
       (str/includes? source "*command-line-args*")))

(defn harness-root-binding-files
  "Every .bb file directly under dir (non-recursive) whose source binds a
   `project-root` var that is argv-derived - the shape this ticket guards
   against (guarded or not - see binds-project-root-from-argv?'s own
   comment). Sorted, absolute paths."
  [dir]
  (->> (fs/list-dir dir)
       (filter #(str/ends-with? (str (fs/file-name %)) ".bb"))
       (map str)
       (filter #(binds-project-root-from-argv? (slurp %)))
       sort
       vec))

(defn missing-fixture-root?
  "True when running harness-file bare (no arguments), from a fresh
   scratch cwd containing no .swarmforge, does NOT refuse: it exits zero,
   or it creates a .swarmforge directory in that scratch cwd (the BL-889
   hazard - a real parcel/state write against a directory nobody asked
   for). The scratch dir is removed after, on every path."
  [harness-file]
  (let [scratch (str (fs/create-temp-dir {:prefix "bl1517-missing-root-check-"}))]
    (try
      (let [{:keys [exit]} (process/sh {:dir scratch :continue true} "bb" harness-file)]
        (boolean (or (zero? exit) (fs/exists? (fs/path scratch ".swarmforge")))))
      (finally
        (fs/delete-tree scratch)))))

;; Documented, ticketed debt this check's own build exposed but does not
;; own (BL-1630's own precedent: "each entry names a reason and an owning
;; ticket", checked only for a file the behavioral probe already flagged
;; - a file that clears on its own is never even looked up). BL-1517's
;; own description named bl619_token_burn_briefing_harness.bb as already
;; out of scope on the theory that `(nth *command-line-args* 0)` throws
;; on a missing arg; empirically (this ticket's own build) it does not -
;; babashka's *command-line-args* is nil, not an empty seq, when no
;; argument is given at all, and `(nth nil 0)` returns nil rather than
;; throwing (it throws only once some earlier index has consumed a
;; shorter-than-expected real seq). With project-root and mode both nil,
;; this harness's own `(when (= mode "success") ...)` guard means the
;; nil root is in practice never used destructively - it is inert, just
;; silently rather than with a REFUSED line. The SCOPE decision (this
;; file is out of scope for BL-1517) stands either way; only the stated
;; mechanism was wrong.
(def allowlist
  {"bl619_token_burn_briefing_harness.bb"
   {:ticket "BL-1517"
    :reason "nth on a nil *command-line-args* returns nil rather than throwing; the guard's own bare-invocation path never uses the nil root destructively (mode is also nil), so it is inert but silent rather than REFUSED - ticket's own text scoped this file out already, on a mechanism this finding corrects"}})

(defn missing-fixture-root-check
  "Runs missing-fixture-root? over every harness-root-binding-files result
   under dir. {:examined [<absolute paths>] :offenders [<absolute paths,
   subset of :examined, minus any allowlist entry>]} - :offenders empty
   means every examined harness refuses a missing root, or is a
   documented, ticketed exception; a newly added, unguarded harness under
   dir lands in :examined (enumeration reaches it) and :offenders (it
   accepts the missing root, and is not on the allowlist) both."
  [dir]
  (let [files (harness-root-binding-files dir)
        flagged (filter missing-fixture-root? files)]
    {:examined files
     :offenders (vec (remove #(contains? allowlist (str (fs/file-name %))) flagged))}))
