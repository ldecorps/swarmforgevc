# Evidence — BL-1040 — rescued seat-fold work found uncommitted in the coder worktree

Recorded by the specifier 2026-08-22 from a coordinator `note`: "Rescued
BL-981 seat-fold fix, uncommitted in coder wt - needs ticket".

## Why the diff is reproduced here rather than pointed at

At the time of writing this work exists ONLY as uncommitted changes in
`.worktrees/coder`. It is on no branch and in no commit, so it is one
`git restore` or one crash-recovery sweep away from being gone — a failure
mode this repo has already recorded more than once. Reproducing it in a
committed backlog artifact is what makes the ticket resumable.

The specifier did NOT commit it into the coder worktree: that is the coder's
worktree and production code is not the specifier's to land. The working
copy is left exactly as found.

## Status of this work

**UNVERIFIED.** It has not been compiled, unit-run, or reviewed by any
pipeline stage. It is a starting point that saves rediscovery, not a
solution to merge. `handoff-lib/seat-stage`, which the Babashka half calls,
does already exist on `main` (`swarmforge/scripts/handoff_lib.bb:360`).

## Working tree as found

```
 M extension/src/concierge/pipelineBoard.ts
 M extension/src/swarm/swarmState.ts
 M extension/test/pipelineBoard.test.js
 M extension/test/state.test.js
 M swarmforge/scripts/pipeline_stage_cli.bb
 M swarmforge/scripts/test/test_pipeline_stage_cli.sh
?? swarmforge/scripts/test/fixtures/
```

`swarmforge/scripts/test/fixtures/` is untracked and is NOT part of this
work — it is the same hot-sync orphan present in the master checkout, and is
surfaced rather than swept.

## The rescued diff (6 tracked files)

```diff
diff --git a/extension/src/concierge/pipelineBoard.ts b/extension/src/concierge/pipelineBoard.ts
index 48f412d04..2feaa883e 100644
--- a/extension/src/concierge/pipelineBoard.ts
+++ b/extension/src/concierge/pipelineBoard.ts
@@ -362,11 +362,40 @@ function listEntryFor(item: PipelineBoardListSourceItem): PipelineBoardListEntry
 // pipeline_stage_lib.bb's own reconcile-stage-map "most downstream wins"
 // rule - the same guarantee, belt-and-braces at the renderer, whatever the
 // authoritative source's own shape already structurally prevents.
+//
+// BL-983: also fold any seat-keyed entries (`coder@sonnet2`) onto their
+// stage column. Seat identity must not escape the mailbox layer; a leaked
+// seat key would otherwise never match ALL_SWARM_ROLES and paint as NS
+// while the seat is busy.
+function stageOfSeat(roleOrSeat: string): string {
+  const at = roleOrSeat.indexOf('@');
+  return at === -1 ? roleOrSeat : roleOrSeat.slice(0, at);
+}
+
 function heldRoleByTicketId(roleHeldTickets: Record<string, string[]>): Map<string, string> {
   const heldRoleById = new Map<string, string>();
+  const rank = (role: string): number => {
+    const i = ALL_SWARM_ROLES.indexOf(role);
+    return i === -1 ? -1 : i;
+  };
+  const consider = (roleOrSeat: string, id: string): void => {
+    const stage = stageOfSeat(roleOrSeat);
+    const prev = heldRoleById.get(id);
+    if (prev === undefined || rank(stage) > rank(prev)) {
+      heldRoleById.set(id, stage);
+    }
+  };
   for (const role of ALL_SWARM_ROLES) {
     for (const id of roleHeldTickets[role] ?? []) {
-      heldRoleById.set(id, role);
+      consider(role, id);
+    }
+  }
+  for (const [roleOrSeat, ids] of Object.entries(roleHeldTickets)) {
+    if (ALL_SWARM_ROLES.includes(roleOrSeat)) {
+      continue;
+    }
+    for (const id of ids) {
+      consider(roleOrSeat, id);
     }
   }
   return heldRoleById;
diff --git a/extension/src/swarm/swarmState.ts b/extension/src/swarm/swarmState.ts
index ec43b178b..ac840f45f 100644
--- a/extension/src/swarm/swarmState.ts
+++ b/extension/src/swarm/swarmState.ts
@@ -175,10 +175,19 @@ export function readTicketStageMap(targetPath: string): Record<string, string> {
 // structurally closes the double-row defect at its source; computePipeline
 // Board's own dedup (BL-464) is the belt-and-braces guarantee for whatever
 // reaches it regardless of the source.
+// BL-983: seat ids (`coder@sonnet2`) must never reach the board — only the
+// stage (`coder`). Defensive for any stage-map producer that still leaks a
+// seat; pipeline_stage_cli.bb report/sync already normalizes at the source.
+function stageOfSeat(roleOrSeat: string): string {
+  const at = roleOrSeat.indexOf('@');
+  return at === -1 ? roleOrSeat : roleOrSeat.slice(0, at);
+}
+
 export function invertTicketStageToRoleHeldTickets(stageMap: Record<string, string>): Record<string, string[]> {
   const byRole: Record<string, string[]> = {};
   for (const [ticketId, role] of Object.entries(stageMap)) {
-    (byRole[role] ??= []).push(ticketId);
+    const stage = stageOfSeat(role);
+    (byRole[stage] ??= []).push(ticketId);
   }
   return byRole;
 }
diff --git a/extension/test/pipelineBoard.test.js b/extension/test/pipelineBoard.test.js
index add3c8146..08189888c 100644
--- a/extension/test/pipelineBoard.test.js
+++ b/extension/test/pipelineBoard.test.js
@@ -77,6 +77,22 @@ test('BL-464: the double-role collapse is independent of which role the input ma
   assert.deepEqual(rows, [{ id: 'BL-460', column: 'cleaner', epic: undefined, slug: '' }]);
 });
 
+test('BL-983: a second seat key paints on the stage column, never as not-started', () => {
+  const { rows } = computePipelineBoard(
+    { coder: ['BL-995'], 'coder@sonnet2': ['BL-993'] },
+    [],
+    {},
+    { activeIds: ['BL-993', 'BL-995'] }
+  );
+  assert.deepEqual(
+    rows.map((r) => ({ id: r.id, column: r.column })),
+    [
+      { id: 'BL-993', column: 'coder' },
+      { id: 'BL-995', column: 'coder' },
+    ]
+  );
+});
+
 test('BL-464: a ticket held under two roles alongside other distinct tickets still yields one row per distinct id', () => {
   const { rows } = computePipelineBoard({ coder: ['BL-1', 'BL-460'], cleaner: ['BL-460', 'BL-2'] }, [], {});
   assert.deepEqual(rows.map((r) => `${r.id}:${r.column}`).sort(), ['BL-1:coder', 'BL-2:cleaner', 'BL-460:cleaner']);
diff --git a/extension/test/state.test.js b/extension/test/state.test.js
index 94889aed7..2ed8c39b7 100644
--- a/extension/test/state.test.js
+++ b/extension/test/state.test.js
@@ -350,3 +350,10 @@ test('BL-464: invertTicketStageToRoleHeldTickets groups ticket ids under their r
 test('BL-464: invertTicketStageToRoleHeldTickets returns an empty map for an empty stage map', () => {
   assert.deepEqual(invertTicketStageToRoleHeldTickets({}), {});
 });
+
+test('BL-983: invertTicketStageToRoleHeldTickets folds a seat id onto its stage', () => {
+  assert.deepEqual(
+    invertTicketStageToRoleHeldTickets({ 'BL-995': 'coder', 'BL-993': 'coder@sonnet2' }),
+    { coder: ['BL-995', 'BL-993'] }
+  );
+});
diff --git a/swarmforge/scripts/pipeline_stage_cli.bb b/swarmforge/scripts/pipeline_stage_cli.bb
index 713ce7cad..52307b1fb 100644
--- a/swarmforge/scripts/pipeline_stage_cli.bb
+++ b/swarmforge/scripts/pipeline_stage_cli.bb
@@ -90,15 +90,21 @@
           (str/split-lines header))))
 
 (defn- role-ticket-pairs-for [role-info]
-  (let [dir (str (handoff-lib/mailbox-dir role-info :in_process))]
+  ;; BL-983 invariant 3: seat identity never escapes the mailbox layer —
+  ;; the board / stage map must see the STAGE (`coder`), never `coder@sonnet2`.
+  ;; Without this, a second seat's held ticket falls through heldRoleByTicketId
+  ;; (which only iterates ALL_SWARM_ROLES bare names) and paints as NS.
+  (let [dir (str (handoff-lib/mailbox-dir role-info :in_process))
+        stage (handoff-lib/seat-stage (:role role-info))]
     (->> (list-handoff-files-with-batches dir)
          (map (fn [f] {:task (read-header-field f "task") :message (read-header-field f "message")}))
          (keep pipeline-stage-lib/ticket-id-from-headers)
-         (map (fn [ticket-id] {:role (:role role-info) :ticket-id ticket-id})))))
+         (map (fn [ticket-id] {:role stage :ticket-id ticket-id})))))
 
 (defn compute-stage-map [project-root]
   (let [roles (handoff-lib/load-all-roles project-root)
-        role-order (mapv :role roles)
+        ;; Distinct stages in roles.tsv order — a multi-seat stage appears once.
+        role-order (vec (distinct (map #(handoff-lib/seat-stage (:role %)) roles)))
         pairs (mapcat role-ticket-pairs-for roles)]
     (pipeline-stage-lib/filter-active
      (pipeline-stage-lib/reconcile-stage-map pairs role-order)
diff --git a/swarmforge/scripts/test/test_pipeline_stage_cli.sh b/swarmforge/scripts/test/test_pipeline_stage_cli.sh
index d61e7fc97..26045a9eb 100755
--- a/swarmforge/scripts/test/test_pipeline_stage_cli.sh
+++ b/swarmforge/scripts/test/test_pipeline_stage_cli.sh
@@ -158,6 +158,26 @@ check "a re-sync reflects the ticket's NEW stage, dropping the stale one" \
   '[[ "$(cat "$ROOT/.swarmforge/board/ticket-stage-map.json")" == *"\"BL-7\":\"cleaner\""* ]]'
 rm -rf "$ROOT"
 
+# ── BL-983: a second seat of a stage reports as the STAGE, never the seat id —
+#    otherwise the board paints the seat's ticket as not-started (heldRoleByTicketId
+#    only knows bare ALL_SWARM_ROLES names). Two seats holding two tickets both
+#    appear under "coder".
+mk_fixture
+printf 'coder@sonnet2\tcoder-sonnet2\t%s/wt-coder-sonnet2\tswarmforge-coder@sonnet2\tCoder@Sonnet2\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
+write_backlog_active "BL-995"
+write_backlog_active "BL-993"
+CODER_DIR="$(role_in_process_dir coder)"
+SONNET_DIR="$ROOT/wt-coder-sonnet2/.swarmforge/handoffs/inbox/in_process"
+mkdir -p "$CODER_DIR" "$SONNET_DIR"
+printf 'from: coordinator\nto: coder\ntype: note\npriority: 10\nmessage: Work BL-995-a-sanctioned-detached-job\n\nstart\n' > "$CODER_DIR/10_a.handoff"
+printf 'from: coordinator\nto: coder\ntype: note\npriority: 10\nmessage: Work BL-993-a-dead-operator-runtime\n\nstart\n' > "$SONNET_DIR/10_b.handoff"
+OUT="$(run_cli report)"
+check "BL-983: bare coder seat reports as stage coder" \
+  '[[ "$OUT" == *"\"BL-995\":\"coder\""* ]]'
+check "BL-983: coder@sonnet2 seat reports as stage coder, never the seat id" \
+  '[[ "$OUT" == *"\"BL-993\":\"coder\""* ]] && [[ "$OUT" != *"coder@sonnet2"* ]]'
+rm -rf "$ROOT"
+
 if [[ $fail -eq 0 ]]; then
   echo "pipeline_stage_cli: ALL CHECKS PASSED"
 else
```

## What it tells us about the defect

Three layers each recorded or rendered the raw seat id:

1. `pipeline_stage_cli.bb` `role-ticket-pairs-for` wrote `(:role role-info)`
   verbatim into the pairs it reconciles, so `coder@sonnet2` reached
   `.swarmforge/board/ticket-stage-map.json`. `compute-stage-map`'s
   `role-order` likewise listed each SEAT, so a multi-seat stage appeared
   more than once in the precedence order the reconciler uses.
2. `swarmState.ts` `invertTicketStageToRoleHeldTickets` grouped by whatever
   key the stage map carried, propagating the seat id onward.
3. `pipelineBoard.ts` `heldRoleByTicketId` iterated `ALL_SWARM_ROLES` only,
   so a seat-keyed entry matched nothing at all and the ticket painted as
   not-started while the seat was actively working it.

By specifier.
