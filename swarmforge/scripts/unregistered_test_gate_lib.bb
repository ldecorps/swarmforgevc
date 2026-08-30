#!/usr/bin/env bb
;; unregistered_test_gate_lib.bb — BL-1240: refuses a git_handoff whose own
;; parcel adds a file under the bb test tree with no row in
;; `suite-manifest.tsv`.
;;
;; BL-973's inventory gate asks the right question at the wrong moment. It
;; compares the WHOLE tree against the manifest when `run_bb_suite.sh` runs,
;; so the author of an unregistered file is never told and the refusal
;; surfaces later, to whoever next runs the full suite — in practice QA, on a
;; parcel that did not cause it, holding a list of other tickets' omissions it
;; cannot reasonably author rows for: choosing `standing` versus `excluded`
;; needs the reason the test was written, which lives with its author.
;;
;; Measured over the five days after that gate landed, files accumulated
;; unregistered at roughly six a day (4, 7, 6, 12, 5, 3) and the suite went
;; from runnable to refusing outright with 39 names in the failure. Not one of
;; those days produced a signal to the person who created the drift.
;;
;; PARCEL-SCOPED, and that is the load-bearing property (scenario 03). The
;; question asked is only ever "does THIS parcel's own work add an
;; unregistered test file", never "is the tree clean" — a tree-scoped copy
;; would refuse every parcel on drift its author did not create, which is the
;; problem this gate exists to end rather than to relocate. The parcel's own
;; paths come from task_scope_gate_lib's already-shipped walk (the commits
;; since this task's last handoff whose own subject names this task's ticket),
;; never a second notion of "what this parcel changed".
;;
;; ONE NOTION OF REGISTERED. What counts as a test file and what a manifest
;; row says are both asked of suite_inventory_lib.bb — the same code
;; `suite_inventory_cli.bb` runs. Two notions of registration would drift
;; apart exactly the way the runner list and the manifest once did.
;;
;; FAIL-OPEN IS ABSOLUTE, same posture as BL-953/BL-1192/BL-1213: an
;; unreadable commit range, an unresolvable task id, or an unreadable manifest
;; all WARN and send. A gate on the send path that fails closed on its own
;; blindness stops the pipeline over its own bugs.

(ns unregistered-test-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "test" "suite_inventory_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_scope_gate_lib.bb")))

(def test-dir
  "The one tree this manifest governs. The TypeScript and Gherkin lanes have
   their own tooling and are explicitly out of scope."
  "swarmforge/scripts/test")

(defn parcel-test-file
  "The test-tree file name a changed path names, or nil for everything else.

   Not recursive, matching `discover-test-files`: `test/lib/` holds shared
   helpers, not tests, and a helper registered as a test would be a standing
   false red. The shape test is suite-inventory-lib's own `test-file?`, so a
   property runner (its own lane, never a suite member) is nil here too."
  [path]
  (let [prefix (str test-dir "/")]
    (when (str/starts-with? (str path) prefix)
      (let [rest (subs (str path) (count prefix))]
        (when (and (not (str/includes? rest "/"))
                   (suite-inventory-lib/test-file? rest))
          rest)))))

(defn suggested-row
  "The row the refusal quotes. `standing` is offered because it is the answer
   for a test that should run; the author is the only one who can say whether
   it is really an `excluded` with a date and a reason, so the message says
   both rather than deciding for them."
  [file]
  (str file "\tstanding\t\t"))

(defn unregistered-findings
  "Pure: the parcel's own added-or-present test files with no manifest row.

   `exists?` is injected (a path predicate) so the decision is testable
   without a tree. A path the parcel DELETED is not a finding — it no longer
   exists, and its stale row is the tree-wide check's business, not this
   parcel's."
  [{:keys [changed-paths manifest-rows exists?]}]
  (let [registered (set (map :file manifest-rows))
        exists? (or exists? (constantly true))]
    (vec
     (for [path (sort (distinct (or changed-paths [])))
           :let [file (parcel-test-file path)]
           :when (and file (exists? path) (not (contains? registered file)))]
       {:path path :file file :row (suggested-row file)}))))

(defn blocked? [{:keys [findings]}] (boolean (seq findings)))

(defn refusal-message
  "Names the file AND the row it needs — the whole point of moving the check
   here is that the person reading it can act on it in one edit."
  [{:keys [task-name findings]}]
  (let [files (map :file findings)]
    (str
     (format (str "Cannot send git_handoff for %s: this parcel adds %s under %s/ with no row in %s "
                  "(BL-1240). An unregistered test file is invisible to the standing suite, and the "
                  "refusal would otherwise land on QA instead of here.")
             task-name
             (if (= 1 (count files)) (str "a test file (" (first files) ")")
                 (format "%d test files (%s)" (count files) (str/join ", " files)))
             test-dir
             suite-inventory-lib/manifest-name)
     (format " Add to %s/%s:\n%s\n...or, if it should not run on every parcel, lane `excluded` with a YYYY-MM-DD date and the reason."
             test-dir suite-inventory-lib/manifest-name
             (str/join "\n" (map :row findings))))))

(defn manifest-rows-at
  "The parsed manifest under `root`, or nil (never []) when it cannot be read
   — the caller's fail-open distinguishes 'no rows' from 'no manifest'."
  [root]
  (let [manifest (fs/path (str root) test-dir suite-inventory-lib/manifest-name)]
    (when (fs/exists? manifest)
      (suite-inventory-lib/parse-manifest (slurp (str manifest))))))

(defn findings-for-git-handoff
  "The one impure entry point. {:findings [...]} on a clean read (possibly
   empty), or {:warning \"...\"} when the parcel's own paths or the manifest
   could not be read — never both, mirroring task_scope_gate_lib exactly."
  [{:keys [root task-name commit]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)]
    (if-not task-ticket-id
      {:findings []}
      (let [changed-paths (task-scope-gate-lib/parcel-own-changed-paths root task-ticket-id commit)
            rows (manifest-rows-at root)]
        (cond
          (nil? changed-paths)
          {:warning (str "unregistered-test check could not run for " task-name
                         " (the commit history for " commit
                         " unreadable) - send allowed, unverified (BL-1240)")}
          (nil? rows)
          {:warning (str "unregistered-test check could not run for " task-name
                         " (no readable " suite-inventory-lib/manifest-name " under " test-dir
                         ") - send allowed, unverified (BL-1240)")}
          :else
          {:findings (unregistered-findings
                      {:changed-paths changed-paths
                       :manifest-rows rows
                       :exists? #(fs/exists? (fs/path (str root) %))})})))))
