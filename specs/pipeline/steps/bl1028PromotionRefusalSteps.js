'use strict';

// BL-1028: step handlers for "a promotion never bypasses an integrity commit
// that refused".
//
// Every scenario drives the REAL swarmforge/scripts/promote_and_route_next.sh
// against a REAL git fixture, with commit_integrity_cli.bb shadowed by a stub
// that reproduces one refusal shape. Nothing here re-implements the script's
// decision - the assertions read git's own state afterwards.
//
// The stub is invoked as `bb <path>` by the script under test, so it is
// Babashka, not bash. A bash stub is parsed as Clojure and dies on "Invalid
// keyword", which the old `||` would have read as an ordinary refusal - every
// scenario would then pass for entirely the wrong reason.
//
// The two refusal shapes are NOT alike, which is why scenario 01's table
// carries close-guard alongside the three :success-false reasons: a
// :success-false refusal prints the result JSON on stdout AND a
// `FAILED (reason)` line on stderr, while a close-guard rejection exits
// before commit-with-integrity! ever runs and prints only a `CLOSE BLOCKED`
// line, with no JSON at all.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const FEATURE = 'a promotion never bypasses an integrity commit that refused';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HELPER = path.join(SCRIPTS, 'promote_and_route_next.sh');
const TICKET = 'BL-9028-fixture-ticket.yaml';

// promotion_gates (BL-663) is the chokepoint the script shells every gate
// decision through; its whole load-file chain must travel with the copy or the
// gate throws on load and the script reports "no eligible paused ticket" - a
// broken fixture that reads like a promotion decision.
const GATE_DEPS = [
  'promotion_gates_cli.bb',
  'promotion_gates_lib.bb',
  'backlog_depth_lib.bb',
  'swarm_identity_lib.bb',
  'daemon_cycle_guard_lib.bb',
];

// Explicit known values per the Scenario Outline handler rule: a reason the
// handlers do not know is a hard failure, never a passthrough. `close-guard`
// is deliberately a different SHAPE, not just a different string.
const KNOWN_REASONS = new Map([
  ['lock-timeout', 'success-false'],
  ['verify-mismatch', 'success-false'],
  ['commit-failed', 'success-false'],
  ['close-guard', 'close-guard'],
]);

const REFUSING_CLI = (reason) => [
  '#!/usr/bin/env bb',
  `(println "{\\"success\\":false,\\"reason\\":\\"${reason}\\",\\"attempts\\":3}")`,
  `(binding [*out* *err*] (println "commit_integrity_cli: FAILED (${reason}) after 3 attempt(s)"))`,
  '(System/exit 1)',
].join('\n');

const CLOSE_GUARD_CLI = [
  '#!/usr/bin/env bb',
  '(binding [*out* *err*]',
  '  (println "commit_integrity_cli: CLOSE BLOCKED for BL-9028 (missing-qa-approval)."))',
  '(System/exit 1)',
].join('\n');

const ACCEPTING_CLI = [
  '#!/usr/bin/env bb',
  "(require '[babashka.process :as p])",
  '(let [args (vec *command-line-args*)',
  '      root (first args)',
  '      msg (second (drop-while #(not= "--message" %) args))',
  '      paths (keep-indexed (fn [i a] (when (= "--path" a) (get args (inc i)))) args)]',
  '  (doseq [path paths]',
  '    (p/shell {:continue true :out :string :err :string} "git" "-C" root "add" "-A" "--" path))',
  '  (p/shell {:out :string :err :string} "git" "-C" root "commit" "-q" "-m" msg)',
  '  (println "{\\"success\\":true,\\"attempts\\":1}"))',
].join('\n');

// Every path this file creates is tracked, roots and route logs alike - a
// route log left in /tmp is still a leak, and it is the one a "remove the
// fixture root" cleanup silently misses because it deliberately lives
// outside that root.
let trackedPaths = [];
afterEach(() => {
  while (trackedPaths.length) {
    fs.rmSync(trackedPaths.pop(), { recursive: true, force: true });
  }
});

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function gitOut(root, args) {
  return (git(root, args).stdout || '').trim();
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1028-'));
  trackedPaths.push(root);
  ctx.root = root;
  // The route log lives OUTSIDE the repo: inside it, it would show as an
  // untracked entry and "the index holds nothing staged" would be measuring
  // this harness rather than the script. It gets its own tracked directory
  // rather than a bare /tmp file, so cleanup covers it too.
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1028-logs-'));
  trackedPaths.push(logDir);
  ctx.routeLog = path.join(logDir, 'route.log');

  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  for (const d of ['backlog/paused', 'backlog/active', 'specs/features', 'swarmforge/scripts']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.copyFileSync(HELPER, path.join(root, 'swarmforge/scripts/promote_and_route_next.sh'));
  fs.chmodSync(path.join(root, 'swarmforge/scripts/promote_and_route_next.sh'), 0o755);
  for (const dep of GATE_DEPS) {
    fs.copyFileSync(path.join(SCRIPTS, dep), path.join(root, 'swarmforge/scripts', dep));
  }
  fs.writeFileSync(path.join(root, 'swarmforge/swarmforge.conf'), 'config active_backlog_max_depth 5\n');
  fs.writeFileSync(path.join(root, 'swarmforge/scripts/route_backlog_to_coder.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$1" >> "${ROUTE_LOG:?}"\n');
  fs.chmodSync(path.join(root, 'swarmforge/scripts/route_backlog_to_coder.sh'), 0o755);

  fs.writeFileSync(path.join(root, 'backlog/paused', TICKET),
    'id: BL-9028\ntitle: "fixture ticket"\nstatus: paused\npriority: 1\nassigned_to:\n');
  fs.writeFileSync(path.join(root, 'specs/features/BL-9028-fixture-ticket.feature'), '');

  git(root, ['add', 'backlog', 'specs', 'swarmforge']);
  git(root, ['commit', '-q', '-m', 'fixture paused backlog']);
  return root;
}

// Committed, never left untracked: an untracked stub would itself show in
// `status --porcelain` and every index assertion would be reading it.
function installCli(ctx, body) {
  const cli = path.join(ctx.root, 'swarmforge/scripts/commit_integrity_cli.bb');
  fs.writeFileSync(cli, `${body}\n`);
  fs.chmodSync(cli, 0o755);
  git(ctx.root, ['add', '--', 'swarmforge/scripts/commit_integrity_cli.bb']);
  git(ctx.root, ['commit', '-q', '-m', 'fixture: stub commit_integrity_cli.bb']);
}

function runPromotion(ctx) {
  ctx.headBefore = gitOut(ctx.root, ['rev-parse', 'HEAD']);
  ctx.indexBefore = gitOut(ctx.root, ['status', '--porcelain']);
  const res = spawnSync('bash', [path.join(ctx.root, 'swarmforge/scripts/promote_and_route_next.sh')], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ROUTE_LOG: ctx.routeLog,
      SWARMFORGE_SKIP_DAEMON: '1',
      SWARMFORGE_ROLE: 'coordinator',
    },
  });
  ctx.exit = res.status;
  ctx.output = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.headAfter = gitOut(ctx.root, ['rev-parse', 'HEAD']);
  ctx.indexAfter = gitOut(ctx.root, ['status', '--porcelain']);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the index holds nothing staged$/, (ctx) => {
    if (!ctx.root) mkFixture(ctx);
    // Asserted, not assumed: a dirty starting index would make scenario 02's
    // "no longer staged" pass against the wrong baseline.
    assert.equal(gitOut(ctx.root, ['status', '--porcelain']), '',
      'the fixture must start with a clean index');
  });

  scoped(/^an eligible paused ticket ready to promote$/, (ctx) => {
    assert.ok(fs.existsSync(path.join(ctx.root, 'backlog/paused', TICKET)),
      'the fixture must carry an eligible paused ticket');
    ctx.cliInstalled = false;
  });

  scoped(/^the integrity CLI is not present in the target repo$/, (ctx) => {
    assert.equal(fs.existsSync(path.join(ctx.root, 'swarmforge/scripts/commit_integrity_cli.bb')), false,
      'the fixture for this scenario must genuinely have no integrity CLI');
    ctx.cliInstalled = false;
  });

  scoped(/^the integrity CLI refuses the promotion commit with (.+)$/, (ctx, reason) => {
    assert.ok(KNOWN_REASONS.has(reason),
      `unknown refusal reason "${reason}" - the handlers know ${[...KNOWN_REASONS.keys()].join(', ')}`);
    ctx.reason = reason;
    installCli(ctx, KNOWN_REASONS.get(reason) === 'close-guard' ? CLOSE_GUARD_CLI : REFUSING_CLI(reason));
    ctx.cliInstalled = true;
    runPromotion(ctx);
  });

  scoped(/^the integrity CLI accepts the promotion commit$/, (ctx) => {
    installCli(ctx, ACCEPTING_CLI);
    ctx.cliInstalled = true;
    runPromotion(ctx);
  });

  scoped(/^the promotion runs$/, (ctx) => {
    runPromotion(ctx);
  });

  scoped(/^no commit is created for the promotion$/, (ctx) => {
    assert.equal(ctx.headAfter, ctx.headBefore,
      `a commit was created despite the refusal: ${gitOut(ctx.root, ['log', '--oneline', '-1'])}`);
  });

  scoped(/^a commit is created for the promotion$/, (ctx) => {
    assert.notEqual(ctx.headAfter, ctx.headBefore, 'no commit was created for the promotion');
    assert.match(gitOut(ctx.root, ['log', '--oneline', '-1']), /Promote BL-9028/,
      'the new commit is not the promotion commit');
  });

  scoped(/^the promotion reports failure naming (.+)$/, (ctx, reason) => {
    assert.ok(KNOWN_REASONS.has(reason), `unknown refusal reason "${reason}"`);
    assert.notEqual(ctx.exit, 0, `the promotion reported success; output: ${ctx.output}`);
    assert.ok(ctx.output.includes(reason),
      `the failure report does not name ${reason}; output: ${ctx.output}`);
  });

  scoped(/^the paused -> active rename is no longer staged$/, (ctx) => {
    assert.equal(ctx.indexAfter, ctx.indexBefore,
      `the index was left changed - the staged rename survived: [${ctx.indexAfter}]`);
    assert.ok(!/backlog\/active/.test(ctx.indexAfter),
      `a paused -> active rename is still staged: [${ctx.indexAfter}]`);
  });

  scoped(/^the ticket file is back at its paused path$/, (ctx) => {
    assert.ok(fs.existsSync(path.join(ctx.root, 'backlog/paused', TICKET)),
      'the ticket is not back at its paused path for the next attempt');
    assert.equal(fs.existsSync(path.join(ctx.root, 'backlog/active', TICKET)), false,
      'the ticket was left at its active path after a refusal');
  });

  scoped(/^the ticket file is at its active path$/, (ctx) => {
    assert.ok(fs.existsSync(path.join(ctx.root, 'backlog/active', TICKET)),
      'the ticket is not at its active path');
    assert.equal(fs.existsSync(path.join(ctx.root, 'backlog/paused', TICKET)), false,
      'the ticket is still at its paused path');
  });

  scoped(/^the promotion reports that it committed without the integrity guard$/, (ctx) => {
    assert.equal(ctx.cliInstalled, false, 'this scenario is about a target with NO integrity CLI');
    assert.match(ctx.output, /without the integrity guard/i,
      `an unguarded commit must say so, or it reads as a guarded one; output: ${ctx.output}`);
  });
}

module.exports = { registerSteps };
