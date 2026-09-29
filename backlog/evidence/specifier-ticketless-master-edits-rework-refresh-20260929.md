# Ticket-less edits on master: rework-observatory refresh (preserved copy)

Coordinator note 012879 (2026-09-29 09:28Z): "Ticket-less dirty prod files on
master block build-freshness sync". Six tracked files in the master checkout
carry uncommitted edits with no ticket and an unknown author. They were
written between 09:55:21 and 09:56:33 BST on 2026-09-29, and the specifier
did not make them. The three `extension/src/tools/*.ts` files are on
`build_freshness_lib.bb`'s deployed surface, so `build_freshness_cli.bb sync`
refuses (dirty-surface). The tests, `start-swarm.sh` and
`swarmforge/packs/anthropic-mono-router.conf` are also dirty but off the
surface.

What the change does: `rework-observatory.ts` gains `refreshReworkSignal`
and `loadRoleWorktreesOrEmpty`. `suboptimality-verdict-line.ts` (BL-431)
and `emit-throttle-recommendation.ts` (BL-432) now refresh BL-430's signal
before they diagnose, instead of reading whatever snapshot is on disk.

The specifier copied the diff here and left the master files untouched.
This copy is so that no decision about them loses the work. Base:
HEAD 173ce3e46f.

```diff
diff --git a/extension/src/tools/emit-throttle-recommendation.ts b/extension/src/tools/emit-throttle-recommendation.ts
index 109a72d15a..596b7c74bd 100644
--- a/extension/src/tools/emit-throttle-recommendation.ts
+++ b/extension/src/tools/emit-throttle-recommendation.ts
@@ -9,9 +9,10 @@
  * Shelled out to from swarmforge/scripts/effective_backlog_depth_cli.bb at
  * EVERY promotion decision (Babashka has no way to import compiled TS) - the
  * same shell-to-node-and-degrade-on-failure pattern handoffd.bb already uses
- * for its other emit-*.js CLIs. Computed FRESH on every call rather than on a
- * periodic sweep: a promotion decision needs the current diagnosis, not one
- * that might be stale between coordinator wake-ups.
+ * for its other emit-*.js CLIs. Refreshes BL-430's observatory signal then
+ * re-diagnoses on every CLI call rather than on a periodic sweep: a
+ * promotion decision needs the current diagnosis, not one that might be
+ * stale between coordinator wake-ups (or left on disk from months ago).
  *
  * needs_human-style safety contract (BL-429): only a 'lower the intake
  * throttle' verdict (no concentrated, attributable cause - the epic's ONE
@@ -28,6 +29,7 @@ import { diagnoseReworkSignal, classifyThrottleSeverity, recommendedCapForSeveri
 import { computeStandingRedRecommendation, describeStandingRedSignal, StandingRedRecommendation } from '../metrics/standingRedSignal';
 import { atomicWrite, atomicAppend } from '../util/atomicWrite';
 import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';
+import { refreshReworkSignal } from './rework-observatory';
 
 export interface EmitThrottleRecommendationArgs {
   targetRepoPath: string;
@@ -180,6 +182,10 @@ export const main = makeArgsGuardedMain(
   parseArgs,
   'Usage: node emit-throttle-recommendation.js <target-repo-path>\n',
   async (args) => {
+    // Refresh before diagnose: computeThrottleRecommendation still reads the
+    // persisted signal (so in-process unit tests can inject fixtures), but
+    // the live CLI never trusts a snapshot that nothing else has rewritten.
+    refreshReworkSignal(args.targetRepoPath);
     printJsonToStdout(emitThrottleRecommendation(args.targetRepoPath));
   }
 );
diff --git a/extension/src/tools/rework-observatory.ts b/extension/src/tools/rework-observatory.ts
index 59114995fd..eb759c51b6 100644
--- a/extension/src/tools/rework-observatory.ts
+++ b/extension/src/tools/rework-observatory.ts
@@ -10,7 +10,7 @@
  *
  * Usage: node rework-observatory.js
  */
-import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
+import { resolveCliMainWorktreeContext, loadRoles, runCliMain } from './swarm-metrics';
 import { RoleWorktree, NO_SAMPLE_PLACEHOLDER } from '../metrics/swarmMetrics';
 import { computeReworkSignal, ReworkSignal } from '../metrics/reworkObservatory';
 import { loadCompletedTicketRecords } from '../metrics/reworkObservatorySource';
@@ -20,6 +20,29 @@ export const WINDOW_DAYS = 14;
 export const BASELINE_WINDOW_DAYS = 14;
 const DAY_MS = 24 * 60 * 60 * 1000;
 
+// Soft roles.tsv load for consumers that only have a target path (emit-
+// throttle CLI, tests without a packed swarm) - missing/unreadable roles
+// degrade to "no live handoff attribution", never a crash; evidence-based
+// bounce counting on main still works with an empty roles list.
+export function loadRoleWorktreesOrEmpty(targetPath: string): RoleWorktree[] {
+  try {
+    return loadRoles(targetPath).map((r) => ({ role: r.role, worktreePath: r.worktreePath }));
+  } catch {
+    return [];
+  }
+}
+
+// BL-430 refresh seam used by BL-431 (briefing verdict) and BL-432 (throttle
+// emit) so neither diagnoses a stale observatory snapshot. Returns the fresh
+// signal; persists it the same way the standalone rework-observatory CLI does.
+export function refreshReworkSignal(
+  targetPath: string,
+  nowMs: number = Date.now(),
+  roles?: RoleWorktree[]
+): ReworkSignal {
+  return runObservatory(targetPath, roles ?? loadRoleWorktreesOrEmpty(targetPath), nowMs).signal;
+}
+
 function formatPercent(rate: number): string {
   return `${Math.round(rate * 100)}%`;
 }
diff --git a/extension/src/tools/suboptimality-verdict-line.ts b/extension/src/tools/suboptimality-verdict-line.ts
index 30f8020eef..8b8f93ea1d 100644
--- a/extension/src/tools/suboptimality-verdict-line.ts
+++ b/extension/src/tools/suboptimality-verdict-line.ts
@@ -3,18 +3,18 @@
  * BL-431 (epic BL-429 slice 2 - DIAGNOSE + ESCALATE): the briefing-line CLI
  * that surfaces reworkDiagnosis.ts's verdict through the same shell-out
  * convention every other briefing section already uses (Babashka has no way
- * to import compiled TS) - reads BL-430's persisted rework-rate signal
- * (reworkObservatoryStore.ts, written by rework-observatory.js) unchanged,
- * so the briefing can never disagree with the CLI/holistic-UI reading of
- * the same signal. Prints nothing (empty stdout, exit 0) when there is no
- * verdict - briefing_email_lib.bb's append-content-block already treats a
- * blank block as "nothing to append," never a fabricated no-issue line.
+ * to import compiled TS). Refreshes BL-430's observatory signal first
+ * (refreshReworkSignal) so the briefing never echoes a stale snapshot left
+ * on disk from a prior run, then diagnoses that fresh signal. Prints
+ * nothing (empty stdout, exit 0) when there is no verdict -
+ * briefing_email_lib.bb's append-content-block already treats a blank block
+ * as "nothing to append," never a fabricated no-issue line.
  *
  * Usage: node suboptimality-verdict-line.js
  */
-import { readReworkSignal } from '../metrics/reworkObservatoryStore';
 import { diagnoseReworkSignal, SuboptimalityVerdict } from '../metrics/reworkDiagnosis';
 import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
+import { refreshReworkSignal } from './rework-observatory';
 
 function formatPercent(rate: number): string {
   return `${Math.round(rate * 100)}%`;
@@ -29,11 +29,8 @@ export function formatSuboptimalityVerdictLine(verdict: SuboptimalityVerdict): s
 }
 
 export function main(): void {
-  const { mainWorktreePath } = resolveCliMainWorktreeContext();
-  const signal = readReworkSignal(mainWorktreePath);
-  if (signal === null) {
-    return;
-  }
+  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
+  const signal = refreshReworkSignal(mainWorktreePath, Date.now(), roleWorktrees);
   const verdict = diagnoseReworkSignal(signal);
   if (verdict === null) {
     return;
diff --git a/extension/test/emitThrottleRecommendationCli.test.js b/extension/test/emitThrottleRecommendationCli.test.js
index 78d69a0690..8411ef5e0c 100644
--- a/extension/test/emitThrottleRecommendationCli.test.js
+++ b/extension/test/emitThrottleRecommendationCli.test.js
@@ -198,24 +198,26 @@ test('main() prints usage and exits non-zero when the target repo path is missin
   assert.notEqual(result.exitCode, 0);
 });
 
-test('main() emits the recommendation and prints it to stdout', async () => {
+test('main() refreshes the observatory before diagnosing - a stale injected signal is not trusted', async () => {
   const targetPath = mkTmp();
   writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
   const { exitCode, output } = await runCli([targetPath]);
   assert.equal(exitCode, 0);
   const printed = JSON.parse(output);
-  assert.equal(printed.recommendedCap, 1);
+  // Empty tmp has no completed tickets in the live window, so refresh
+  // yields no sample and the stale degraded recommendation must not stick.
+  assert.equal(printed.recommendedCap, null);
   assert.ok(fs.existsSync(throttleRecommendationPath(targetPath)));
 });
 
 // A single subprocess smoke test locks the compiled CLI's own wiring
 // (require.main === module, real argv boundary) - an ADDITION to the
 // in-process tests above, never the only cover for the real logic.
-test('the compiled CLI runs standalone as a subprocess and publishes the recommendation', () => {
+test('the compiled CLI runs standalone as a subprocess and refreshes rather than echoing a stale alarm', () => {
   const targetPath = mkTmp();
   writeSignal(targetPath, { reworkRate: 0.5, baselineRate: 0.1 });
   const output = execFileSync('node', [CLI_PATH, targetPath], { encoding: 'utf8' });
   const printed = JSON.parse(output);
-  assert.equal(printed.recommendedCap, 0);
+  assert.equal(printed.recommendedCap, null);
   assert.ok(fs.existsSync(throttleRecommendationPath(targetPath)));
 });
diff --git a/extension/test/reworkObservatoryCli.test.js b/extension/test/reworkObservatoryCli.test.js
index 18267c98d9..1651984a4f 100644
--- a/extension/test/reworkObservatoryCli.test.js
+++ b/extension/test/reworkObservatoryCli.test.js
@@ -110,6 +110,16 @@ test('runObservatory reports no sample when nothing closed within the trailing w
   assert.equal(result.signal.hasSample, false);
 });
 
+test('refreshReworkSignal recomputes and persists via runObservatory', () => {
+  const { refreshReworkSignal, loadRoleWorktreesOrEmpty } = require('../out/tools/rework-observatory');
+  const repo = mkTmp();
+  initRepoOnMain(repo);
+  assert.deepEqual(loadRoleWorktreesOrEmpty(repo), []);
+  const signal = refreshReworkSignal(repo, Date.now(), []);
+  assert.equal(signal.hasSample, false);
+  assert.equal(fs.existsSync(observatorySignalsPath(repo)), true);
+});
+
 // ── main() - real git fixture, in-process (thin-wrapper rule) ──────────────
 
 function mkCliFixture() {
diff --git a/extension/test/suboptimalityVerdictLineCli.test.js b/extension/test/suboptimalityVerdictLineCli.test.js
index 51c9156748..e0ce0a8e36 100644
--- a/extension/test/suboptimalityVerdictLineCli.test.js
+++ b/extension/test/suboptimalityVerdictLineCli.test.js
@@ -4,7 +4,7 @@ const fs = require('node:fs');
 const path = require('node:path');
 const { execFileSync } = require('node:child_process');
 const { formatSuboptimalityVerdictLine, main } = require('../out/tools/suboptimality-verdict-line');
-const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');
+const { persistReworkSignal, observatorySignalsPath, readReworkSignal } = require('../out/metrics/reworkObservatoryStore');
 const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
 
 const CLI = path.join(__dirname, '..', 'out', 'tools', 'suboptimality-verdict-line.js');
@@ -13,8 +13,17 @@ function mkTmp() {
   return mkTmpDir('sfvc-suboptimality-cli-');
 }
 
-function git(cwd, args) {
-  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
+function git(cwd, args, dateIso) {
+  const env = { ...process.env };
+  if (dateIso) {
+    env.GIT_AUTHOR_DATE = dateIso;
+    env.GIT_COMMITTER_DATE = dateIso;
+  }
+  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
+}
+
+function mkdirp(dir) {
+  fs.mkdirSync(dir, { recursive: true });
 }
 
 function mkCliFixture() {
@@ -65,48 +74,91 @@ async function runCli(root) {
   return writes.join('\n');
 }
 
-test('main() prints nothing when no signal has been persisted yet, never a crash', async () => {
+test('main() prints nothing when the fresh observatory has no sample, never a crash', async () => {
   const repo = mkCliFixture();
   const output = await runCli(repo);
   assert.equal(output, '');
 });
 
-test('main() prints nothing when the persisted signal is at/below baseline (no false alarm)', async () => {
+// Regression: a July-era 22%-style snapshot must not keep alarming once the
+// live window has nothing to sample - the CLI refreshes before diagnosing.
+test('main() clears a stale above-baseline snapshot instead of echoing it forever', async () => {
   const repo = mkCliFixture();
   persistReworkSignal(repo, {
     kind: 'rework-rate',
     version: 1,
-    computedAtIso: '2026-07-16T00:00:00Z',
-    signal: { hasSample: true, sampleCount: 5, reworkRate: 0.1, baselineRate: 0.2, topRole: null, topTicketClass: null },
+    computedAtIso: '2026-07-16T00:22:02.557Z',
+    signal: {
+      hasSample: true,
+      sampleCount: 303,
+      reworkRate: 0.21782178217821782,
+      baselineRate: 0,
+      topRole: 'QA',
+      topTicketClass: 'medium',
+    },
   });
   const output = await runCli(repo);
   assert.equal(output, '');
+  const refreshed = JSON.parse(fs.readFileSync(observatorySignalsPath(repo), 'utf8'));
+  const entry = refreshed.signals.find((s) => s.kind === 'rework-rate');
+  assert.notEqual(entry.computedAtIso, '2026-07-16T00:22:02.557Z');
+  assert.equal(entry.signal.hasSample, false);
 });
 
-test('main() prints the verdict line when the persisted signal is meaningfully above baseline', async () => {
+test('main() prints the verdict line when the live observatory is meaningfully above baseline', async () => {
   const repo = mkCliFixture();
-  persistReworkSignal(repo, {
-    kind: 'rework-rate',
-    version: 1,
-    computedAtIso: '2026-07-16T00:00:00Z',
-    signal: { hasSample: true, sampleCount: 5, reworkRate: 0.6, baselineRate: 0.2, topRole: 'hardener', topTicketClass: null },
-  });
+  const nowMs = Date.now();
+  const DAY_MS = 24 * 60 * 60 * 1000;
+  // Baseline window (14-28d ago): one clean close → baselineRate 0.
+  // Current window (within 14d): one bounced close → reworkRate 1 (> 2x 0).
+  const baselineCloseIso = new Date(nowMs - 20 * DAY_MS).toISOString();
+  const windowPromoteIso = new Date(nowMs - 5 * DAY_MS).toISOString();
+  const windowCloseIso = new Date(nowMs - 4 * DAY_MS).toISOString();
+
+  mkdirp(path.join(repo, 'backlog', 'active'));
+  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-9001.yaml'), 'id: BL-9001\nmutation_cost: low\n');
+  git(repo, ['add', '.']);
+  git(repo, ['commit', '-q', '-m', 'promote baseline'], baselineCloseIso);
+  mkdirp(path.join(repo, 'backlog', 'done'));
+  git(repo, ['mv', 'backlog/active/BL-9001.yaml', 'backlog/done/BL-9001.yaml']);
+  git(repo, ['commit', '-q', '-m', 'close baseline'], baselineCloseIso);
+
+  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-9002.yaml'), 'id: BL-9002\nmutation_cost: medium\n');
+  git(repo, ['add', '.']);
+  git(repo, ['commit', '-q', '-m', 'promote hot'], windowPromoteIso);
+  git(repo, ['mv', 'backlog/active/BL-9002.yaml', 'backlog/done/BL-9002.yaml']);
+  mkdirp(path.join(repo, 'backlog', 'evidence'));
+  fs.writeFileSync(path.join(repo, 'backlog', 'evidence', 'BL-9002-qa-bounce.md'), 'bounce\n');
+  git(repo, ['add', '.']);
+  git(repo, ['commit', '-q', '-m', 'close hot with bounce evidence'], windowCloseIso);
+
   const output = await runCli(repo);
   assert.match(output, /^Suboptimality verdict: /);
-  assert.match(output, /hardener/);
+  assert.match(output, /ticket-class medium/);
+  const signal = readReworkSignal(repo);
+  assert.ok(signal);
+  assert.equal(signal.reworkRate, 1);
+  assert.equal(signal.baselineRate, 0);
 });
 
 // A single subprocess smoke test locks the compiled CLI's own wiring
 // (require.main === module, real argv/cwd boundary) - an ADDITION to the
 // in-process tests above, never the only cover for the real logic.
-test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
+test('the compiled CLI runs standalone as a subprocess and refreshes rather than echoing a stale alarm', () => {
   const repo = mkCliFixture();
   persistReworkSignal(repo, {
     kind: 'rework-rate',
     version: 1,
-    computedAtIso: '2026-07-16T00:00:00Z',
-    signal: { hasSample: true, sampleCount: 5, reworkRate: 0.6, baselineRate: 0.2, topRole: 'hardener', topTicketClass: null },
+    computedAtIso: '2026-07-16T00:22:02.557Z',
+    signal: {
+      hasSample: true,
+      sampleCount: 303,
+      reworkRate: 0.21782178217821782,
+      baselineRate: 0,
+      topRole: 'QA',
+      topTicketClass: 'medium',
+    },
   });
   const output = execFileSync('node', [CLI], { cwd: repo, encoding: 'utf8' });
-  assert.match(output, /^Suboptimality verdict: /);
+  assert.equal(output, '');
 });
```

By specifier.
