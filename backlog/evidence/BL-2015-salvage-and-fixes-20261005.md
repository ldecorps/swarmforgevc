# BL-2015: BL-1783's salvage and the exact fixes it needs (specifier, 2026-10-05)

The iq3 coder seat loop-halted on BL-1783 at ~22:50Z after ~44 minutes
(coordinator note 016828). Its uncommitted work was stashed by the
worktree-drift guard and is pinned at:

    refs/swarmforge/salvage/BL-1783  (e679139bad, stash "worktree-drift-20261005T225047Z")

The salvage holds three files (224 insertions, 57 deletions):

- `swarmforge/scripts/verification_debt_ledger_lib.bb`: the settle fields,
  `outstanding-rows`, `outstanding-count`, `discharge-category`,
  `waive-category`. Complete.
- `swarmforge/scripts/test/verification_debt_ledger_lib_test_runner.bb`:
  the BL-1783 settle cases. Measured on the salvage tree: `ALL PASS`.
- `swarmforge/scripts/verification_debt_ledger_update.bb`: the
  `--discharge` and `--waive` branches and `commit-ledger!`. It does not
  load: four defects, below.

Restore it in your worktree (the ref is shared by every worktree):

    git checkout refs/swarmforge/salvage/BL-1783 -- \
      swarmforge/scripts/verification_debt_ledger_lib.bb \
      swarmforge/scripts/verification_debt_ledger_update.bb \
      swarmforge/scripts/test/verification_debt_ledger_lib_test_runner.bb

## The four defects in the salvage's update.bb

1. `commit-ledger!` is one `)` short (`nil)))` must be `nil))))`), so
   `(defn -main ...)` is read INSIDE `commit-ledger!` and never defined:
   running the CLI fails "Attempting to call unbound fn: -main". The seat
   looped on this file.
2. The `--discharge` branch has one `)` too many after its
   `(System/exit 1)` (`))))))` must be `)))))`). It hid defect 1 by
   re-balancing the file.
3. `fs/file?` does not exist in babashka.fs; use `fs/regular-file?`. The
   same line's refusal must name "evidence file" (scenario 03 row 2).
4. `parse-opts` has no `--by` and no `--reason`, so both verbs always
   refuse.

And one in `verification_debt_ledger_read.bb` (not touched by the salvage):
the per-category `count` must be `(vdl/outstanding-count rows category)`,
and `->json-row` must emit the six settle fields when present.

## Measured with all five fixes applied (scratch copy, never the live checkout)

- A mkdtemp `git init` fixture, 3 rows in `land-path-ownership` and 2 in
  `other-check`: `--discharge land-path-ownership --by coder --evidence
  backlog/evidence/BL-9200-tool.md --on 2026-09-26` exits 0; the reader
  reports `land-path-ownership` count 0, `other-check` count 2, unowned
  `[]`; each settled row carries `discharged_at`, `discharged_by`,
  `discharged_evidence`.
- Refusals exit 1, naming `--reason` (blank), `--by` (absent), `evidence
  file` (absent file), `--evidence` (no flag), `no outstanding row`
  (unknown category).
- `--waive other-check --by human --reason "novel shapes"` exits 0; a
  row recorded afterwards in `land-path-ownership` reads count 1.
- BL-1782's own feature, run against these scripts: `# pass 13`,
  `# fail 0`.

## The exact diffs (salvage -> fixed)

```diff
--- a/swarmforge/scripts/verification_debt_ledger_update.bb (salvage)
+++ b/swarmforge/scripts/verification_debt_ledger_update.bb (fixed)
@@ -64,6 +64,8 @@
           "--description" (recur more (assoc opts :description value))
           "--evidence" (recur more (assoc opts :evidence value))
           "--on" (recur more (assoc opts :detected-at value))
+          "--by" (recur more (assoc opts :by value))
+          "--reason" (recur more (assoc opts :reason value))
           (recur more opts))))))
 
 (defn- ticket-texts [project-root]
@@ -101,7 +103,7 @@
           (binding [*out* *err*]
             (println (str "verification_debt_ledger_update: commit failed (" (:reason result) ") - reverted, nothing written")))
           (System/exit 1))
-        nil)))
+        nil))))
 
 (defn -main [& args]
   (let [[project-root mode category & rest-args] args]
@@ -138,7 +140,7 @@
         (when (str/blank? by) (refuse! "--by" "--by is required"))
         (when (str/blank? evidence) (refuse! "--evidence" "--evidence is required"))
         (let [ev-path (fs/path project-root evidence)]
-          (when-not (fs/file? ev-path) (refuse! "--evidence" (str "\"" evidence "\" is not a file under the project root"))))
+          (when-not (fs/regular-file? ev-path) (refuse! "--evidence" (str "evidence file \"" evidence "\" is not a file under the project root"))))
         (let [before (read-rows project-root)
               {:keys [rows settled?]} (vdl/discharge-category before {:category category :by by :evidence evidence :on on})]
           (if settled?
@@ -150,7 +152,7 @@
             (do
               (binding [*out* *err*]
                 (println (str "verification_debt_ledger_update: no outstanding row in category " category " - nothing written")))
-              (System/exit 1))))))
+              (System/exit 1)))))
 
       "--waive"
       (let [{:keys [by reason detected-at]} (parse-opts rest-args)
--- a/swarmforge/scripts/verification_debt_ledger_read.bb (HEAD)
+++ b/swarmforge/scripts/verification_debt_ledger_read.bb (fixed)
@@ -59,10 +59,18 @@
   (let [p (vdl/default-conf-path project-root)]
     (vdl/threshold (vdl/parse-conf (if (fs/exists? p) (slurp p) "")))))
 
-(defn- ->json-row [{:keys [category ticket role description detected-at evidence]}]
+(defn- ->json-row [{:keys [category ticket role description detected-at evidence
+                           discharged-at discharged-by discharged-evidence
+                           waived-at waived-by waive-reason]}]
   (cond-> {:category category :ticket ticket :role role
            :description description :detected_at detected-at}
-    evidence (assoc :evidence evidence)))
+    evidence (assoc :evidence evidence)
+    discharged-at (assoc :discharged_at discharged-at)
+    discharged-by (assoc :discharged_by discharged-by)
+    discharged-evidence (assoc :discharged_evidence discharged-evidence)
+    waived-at (assoc :waived_at waived-at)
+    waived-by (assoc :waived_by waived-by)
+    waive-reason (assoc :waive_reason waive-reason)))
 
 (defn -main [& args]
   (let [[project-root] args]
@@ -74,7 +82,7 @@
           per-category (into {}
                               (map (fn [category]
                                      (let [category-rows (vdl/rows-for-category rows category)
-                                           count (count category-rows)
+                                           count (vdl/outstanding-count rows category)
                                            over? (>= count threshold)
                                            owners (owners-for entries category)]
                                        [category {:count count :threshold threshold
```

By specifier.
