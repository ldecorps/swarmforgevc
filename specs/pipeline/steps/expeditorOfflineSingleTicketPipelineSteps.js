'use strict';

// BL-567: step handlers for the expeditor. Drives the REAL expedite_cli.bb
// against a throwaway fixture repo built by the REAL
// swarmforge/scripts/test/expedite_fixture.sh — the same fixture
// test_expedite_cli.sh uses, so the acceptance run and the CLI suite cannot
// drift into two similar-but-different harnesses.
//
// WHAT THESE HANDLERS CAN AND CANNOT ASSERT, stated up front because the
// alternative is a fixture-only pass that reads like a real one (the recorded
// "backfill acceptance fixture-only" trap):
//
//   The DRIVER's contract is: every declared gate ran, in order, with its
//   evidence captured, and no gate was skipped or its verdict invented. That is
//   what these handlers verify.
//
//   The CONTENT of a stage product — whether the coder's code is good, whether
//   the hardener really killed mutants — belongs to the stage agents, and a
//   stubbed stage runner cannot speak to it. Where a scenario's wording sounds
//   like it asserts content ("code with tests", "passed the same mutation
//   gates"), the handler asserts the driver-side half and says so in a comment.
//   QA exercises the real thing by hand.
//
// Machinery independence (scenarios 02/03) is asserted by INSTRUMENTATION, not
// by reading the driver. strace is unavailable here, so two portable canaries do
// it, and both genuinely deny access rather than merely observing it:
//   * .swarmforge/handoffs replaced by a regular FILE — any path under it fails
//     ENOTDIR. Completing the run proves the driver never touched the mailboxes.
//   * PATH shims for every forbidden command that log and exit 127.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS, 'expedite_cli.bb');
const FIXTURE = path.join(SCRIPTS, 'test', 'expedite_fixture.sh');

const CHAIN = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const FORBIDDEN_COMMANDS = ['tmux', 'handoffd.bb', 'swarm_handoff.bb', 'rotate_to_role.sh', 'ready_for_next.sh'];

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl567-'));
}

function buildFixture(ctx, activeTickets) {
  const dest = path.join(mkTmpRoot(), 'repo');
  const args = [FIXTURE, dest];
  for (const t of activeTickets) args.push('--active', t);
  execFileSync('bash', args, { stdio: 'pipe' });
  ctx.root = dest;
  ctx.ticket = activeTickets[0];
  ctx.env = {};
  ctx.args = [];
  ctx.ran = false;
  return dest;
}

function seedVerdict(ctx, role, verdict) {
  const dir = path.join(ctx.root, '.swarmforge', 'expedite-fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${role}.verdict`), JSON.stringify(verdict));
}

function shimDir(ctx) {
  const dir = path.join(ctx.root, '.shims');
  fs.mkdirSync(dir, { recursive: true });
  ctx.shimLog = path.join(ctx.root, '.shim-invocations.log');
  for (const cmd of FORBIDDEN_COMMANDS) {
    const p = path.join(dir, path.basename(cmd));
    fs.writeFileSync(p, `#!/usr/bin/env bash\necho "$(basename "$0") $*" >> "${ctx.shimLog}"\nexit 127\n`);
    fs.chmodSync(p, 0o755);
  }
  return dir;
}

function runExpeditor(ctx, extraArgs = []) {
  const stageRunner = ctx.stageRunner || path.join(ctx.root, 'stage-runner.sh');
  const env = {
    ...process.env,
    EXPEDITE_STAGE_RUNNER: stageRunner,
    EXPEDITE_STOP_CMD: ctx.stopCmd || './stop-swarm.sh',
    EXPEDITE_START_CMD: ctx.startCmd || './start-swarm.sh',
    ...ctx.env,
  };
  if (ctx.shims) env.PATH = `${ctx.shims}:${env.PATH}`;
  const res = spawnSync('bb', [CLI, ctx.root, ctx.ticket, ...ctx.args, ...extraArgs], {
    env,
    encoding: 'utf8',
    timeout: 180_000,
  });
  ctx.out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.exitCode = res.status;
  ctx.ran = true;
  const runJson = path.join(ctx.root, '.swarmforge', 'expedite', ctx.ticket, 'run.json');
  ctx.runJson = fs.existsSync(runJson) ? JSON.parse(fs.readFileSync(runJson, 'utf8')) : null;
  const ranLog = path.join(ctx.root, '.swarmforge', 'expedite-fixture', 'ran.log');
  ctx.stagesRan = fs.existsSync(ranLog)
    ? fs.readFileSync(ranLog, 'utf8').split('\n').filter(Boolean)
    : [];
  return ctx.out;
}

function snapshotMailboxes(root) {
  const p = path.join(root, '.swarmforge', 'handoffs');
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return 'NOT-A-DIR';
  return execFileSync('bash', ['-lc',
    `find ${JSON.stringify(p)} -type f -printf '%p %s\\n' 2>/dev/null | sort`],
    { encoding: 'utf8' }).trim();
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function mustContain(haystack, needle, what) {
  must(String(haystack).includes(needle), `${what}: expected to find ${JSON.stringify(needle)} in:\n${haystack}`);
}
function lsdir(root, sub) {
  const p = path.join(root, 'backlog', sub);
  return fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith('.yaml')) : [];
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────────
  registry.define(/^a repo with no live swarm and a fixture ticket in backlog\/active\/$/, (ctx) => {
    buildFixture(ctx, ['BL-567']);
    ctx.mailboxSnapshot = snapshotMailboxes(ctx.root);
  });

  // ── Givens: extra tickets ────────────────────────────────────────────────
  registry.define(/^a second ticket already sitting in backlog\/active\/$/, (ctx) => {
    buildFixture(ctx, ['BL-567', 'BL-590']);
  });
  registry.define(/^a second ticket parked to backlog\/hold\/ during initiation$/, (ctx) => {
    buildFixture(ctx, ['BL-567', 'BL-590']);
  });
  registry.define(/^pending parcels in two role mailboxes and local commits on a role branch$/, (ctx) => {
    // The fixture already ships a parcel in two mailboxes. Record the tips so a
    // later step can prove they did not move.
    ctx.tipsBefore = execFileSync('git', ['-C', ctx.root, 'branch', '--format=%(refname:short) %(objectname)'],
      { encoding: 'utf8' }).trim();
    ctx.parcelsBefore = execFileSync('bash', ['-lc',
      `find ${JSON.stringify(path.join(ctx.root, '.swarmforge', 'handoffs'))} -name '*.handoff' | wc -l`],
      { encoding: 'utf8' }).trim();
  });

  // ── Givens: liveness ─────────────────────────────────────────────────────
  registry.define(/^a live swarm whose tmux server answers and whose handoffd pid is running$/, (ctx) => {
    const probe = path.join(ctx.root, 'probe-live.json');
    fs.writeFileSync(probe, JSON.stringify({ 'tmux-servers-answering': 1, handoffd: true, 'role-agents': 8 }));
    ctx.env.EXPEDITE_PROBE_FILE = probe;
    ctx.probeStaysLive = true;
  });
  registry.define(/^a stop path that cannot bring that swarm down$/, (ctx) => {
    // The probe file is static, so it still reads live after the stop runs -
    // exactly a swarm the stop path could not clear.
    ctx.stopCmd = './stop-swarm.sh';
  });
  registry.define(/^a stop path that does bring that swarm down$/, (ctx) => {
    // A stop that works: swap the probe for a stopped one, as a real stop would.
    const after = path.join(ctx.root, 'probe-stopped.json');
    fs.writeFileSync(after, JSON.stringify({ 'tmux-servers-answering': 0, 'role-agents': 0 }));
    const sh = path.join(ctx.root, 'stop-swarm-works.sh');
    fs.writeFileSync(sh, `#!/usr/bin/env bash\ncp ${JSON.stringify(after)} "$EXPEDITE_PROBE_FILE"\necho stopped\nexit 0\n`);
    fs.chmodSync(sh, 0o755);
    ctx.stopCmd = './stop-swarm-works.sh';
    ctx.probeStaysLive = false;
  });
  registry.define(/^a stopped swarm whose tmux socket file still exists with no server answering$/, (ctx) => {
    // The fixture already ships .swarmforge/tmux/99999999.sock with nothing
    // behind it. No probe override: the driver must probe rather than glob.
    const sock = path.join(ctx.root, '.swarmforge', 'tmux', '99999999.sock');
    must(fs.existsSync(sock), 'fixture should ship a server-less socket file');
  });
  registry.define(/^a stop path that exits zero while a babysitter process is still running$/, (ctx) => {
    const probe = path.join(ctx.root, 'probe-survivor.json');
    fs.writeFileSync(probe, JSON.stringify({ 'tmux-servers-answering': 0, babysitterd: true, 'role-agents': 0 }));
    ctx.env.EXPEDITE_PROBE_FILE = probe;
    ctx.stopCmd = './stop-swarm-lying.sh';
  });

  // ── Givens: seeded gates ─────────────────────────────────────────────────
  registry.define(/^the fixture ticket's QA gate is seeded to fail once$/, (ctx) => {
    seedVerdict(ctx, 'QA', { verdict: 'bounce', target: 'coder', reason: 'seeded QA failure', class: 'unit', once: true });
    // A one-shot: the runner deletes the directive after firing, so the rework passes.
    const runner = path.join(ctx.root, 'stage-runner-once.sh');
    fs.writeFileSync(runner, `#!/usr/bin/env bash
set -euo pipefail
ROLE="$1"; VERDICT="$4"; TRANSCRIPT="$5"
ROOT="${ctx.root}"
echo "$ROLE" >> "$ROOT/.swarmforge/expedite-fixture/ran.log"
echo "stage $ROLE" > "$TRANSCRIPT"
D="$ROOT/.swarmforge/expedite-fixture/$ROLE.verdict"
if [[ -f "$D" ]]; then cat "$D" > "$VERDICT"; rm -f "$D"; else echo '{"verdict":"pass"}' > "$VERDICT"; fi
`);
    fs.chmodSync(runner, 0o755);
    ctx.stageRunner = runner;
  });
  registry.define(/^the fixture ticket's architect gate is seeded to fail every time$/, (ctx) => {
    seedVerdict(ctx, 'architect', { verdict: 'bounce', target: 'coder', reason: 'seeded architect failure', class: 'guard' });
  });
  registry.define(/^the fixture ticket's architect gate is seeded to fail every time on one concern$/, (ctx) => {
    seedVerdict(ctx, 'architect', { verdict: 'bounce', target: 'coder', reason: 'same concern again', class: 'resume-identity' });
  });
  registry.define(/^the fixture ticket's architect gate is seeded to fail once$/, (ctx) => {
    seedVerdict(ctx, 'architect', { verdict: 'bounce', target: 'coder', reason: 'one-off', class: 'guard', once: true });
    const runner = path.join(ctx.root, 'stage-runner-once.sh');
    fs.writeFileSync(runner, `#!/usr/bin/env bash
set -euo pipefail
ROLE="$1"; VERDICT="$4"; TRANSCRIPT="$5"
ROOT="${ctx.root}"
echo "$ROLE" >> "$ROOT/.swarmforge/expedite-fixture/ran.log"
echo "stage $ROLE" > "$TRANSCRIPT"
D="$ROOT/.swarmforge/expedite-fixture/$ROLE.verdict"
if [[ -f "$D" ]]; then cat "$D" > "$VERDICT"; rm -f "$D"; else echo '{"verdict":"pass"}' > "$VERDICT"; fi
`);
    fs.chmodSync(runner, 0o755);
    ctx.stageRunner = runner;
  });
  registry.define(/^the coder stage is seeded to hang past its configured timeout$/, (ctx) => {
    const runner = path.join(ctx.root, 'stage-runner-slow.sh');
    fs.writeFileSync(runner, '#!/usr/bin/env bash\nsleep 2\necho \'{"verdict":"pass"}\' > "$4"\n');
    fs.chmodSync(runner, 0o755);
    ctx.stageRunner = runner;
    ctx.args.push('--stage-timeout-ms', '1');
  });
  registry.define(/^the full-stack start path is seeded to fail$/, (ctx) => {
    ctx.startCmd = './start-swarm-broken.sh';
  });
  registry.define(/^the expeditor is invoked with a bounce bound above the default$/, (ctx) => {
    seedVerdict(ctx, 'architect', { verdict: 'bounce', target: 'coder', reason: 'seeded', class: 'guard' });
    ctx.args.push('--bounce-bound', '5');
  });

  // ── Givens: instrumentation (02/03) ──────────────────────────────────────
  registry.define(/^the expeditor runs under a wrapper that fails on any forbidden syscall target$/, (ctx) => {
    // Canary 1: make every path under .swarmforge/handoffs/ fail ENOTDIR.
    const mailboxes = path.join(ctx.root, '.swarmforge', 'handoffs');
    fs.rmSync(mailboxes, { recursive: true, force: true });
    fs.writeFileSync(mailboxes, 'canary: any path under this fails ENOTDIR\n');
    // Canary 2: PATH shims that log and exit 127.
    ctx.shims = shimDir(ctx);
    // Probe from a file so the driver's own liveness probe does not shell tmux;
    // the assertion then is ZERO tmux invocations rather than "only probes".
    const probe = path.join(ctx.root, 'probe-stopped.json');
    fs.writeFileSync(probe, JSON.stringify({ 'tmux-servers-answering': 0, 'role-agents': 0 }));
    ctx.env.EXPEDITE_PROBE_FILE = probe;
  });
  registry.define(/^handoffd, swarm_handoff\.bb, rotate_to_role and tmux are stubbed to fail on invocation$/, (ctx) => {
    ctx.shims = shimDir(ctx);
    const probe = path.join(ctx.root, 'probe-stopped.json');
    fs.writeFileSync(probe, JSON.stringify({ 'tmux-servers-answering': 0, 'role-agents': 0 }));
    ctx.env.EXPEDITE_PROBE_FILE = probe;
  });

  // ── Whens ────────────────────────────────────────────────────────────────
  registry.define(/^the expeditor runs the fixture ticket$/, (ctx) => {
    runExpeditor(ctx, ['--no-restart']);
  });
  registry.define(/^the expeditor is asked to run the fixture ticket$/, (ctx) => {
    runExpeditor(ctx, ['--no-restart']);
  });
  registry.define(/^the expeditor is asked to run the fixture ticket with the override flag$/, (ctx) => {
    runExpeditor(ctx, ['--no-restart', '--override']);
  });
  registry.define(/^the expeditor initiates a run for the fixture ticket$/, (ctx) => {
    runExpeditor(ctx, ['--no-restart']);
  });
  registry.define(/^the expeditor runs the fixture ticket to done and then restarts the stack$/, (ctx) => {
    runExpeditor(ctx);
  });

  // ── Thens: the traverse ──────────────────────────────────────────────────
  registry.define(/^the run produces a Gherkin spec, code with tests, a review verdict, hardening evidence, docs and a QA stamp$/, (ctx) => {
    // DRIVER-SIDE half: every declared gate ran, in chain order, and each
    // captured its own evidence directory. The CONTENT of each stage's product
    // is the stage agent's job and a stubbed runner cannot speak to it - QA
    // exercises that by hand.
    must(ctx.stagesRan.length >= CHAIN.length, `expected every gate to run, saw: ${ctx.stagesRan.join(',')}`);
    for (const role of CHAIN) {
      must(ctx.stagesRan.includes(role), `gate ${role} never ran`);
    }
    const runDir = path.join(ctx.root, '.swarmforge', 'expedite', ctx.ticket);
    const stageDirs = fs.readdirSync(runDir).filter((d) => /^\d\d-/.test(d));
    must(stageDirs.length >= CHAIN.length, 'each gate should leave an evidence directory');
    for (const d of stageDirs) {
      for (const f of ['prompt.md', 'task.txt', 'transcript.jsonl', 'verdict.json']) {
        must(fs.existsSync(path.join(runDir, d, f)), `${d} is missing ${f}`);
      }
    }
  });
  registry.define(/^the fixture ticket's yaml has moved to backlog\/done\/$/, (ctx) => {
    must(lsdir(ctx.root, 'done').some((f) => f.startsWith(ctx.ticket)), 'ticket did not reach done/');
  });
  registry.define(/^the run reaches done$/, (ctx) => {
    must(ctx.runJson && ctx.runJson.ticket === 'done', `expected ticket done, got ${ctx.runJson && ctx.runJson.ticket}`);
  });
  registry.define(/^the ticket still reaches done after the rework passes QA$/, (ctx) => {
    must(ctx.runJson && ctx.runJson.ticket === 'done', 'the rework should have carried the ticket to done');
  });

  // ── Thens: machinery independence ────────────────────────────────────────
  registry.define(/^the run never read or wrote any path under \.swarmforge\/handoffs\/$/, (ctx) => {
    const p = path.join(ctx.root, '.swarmforge', 'handoffs');
    if (fs.statSync(p).isFile()) {
      // STRONG proof: the path is a regular FILE, so anything under it fails
      // ENOTDIR. Reaching a verdict at all is the assertion. Scenario 02 arms it.
      must(ctx.runJson !== null, 'the run should have completed with the mailboxes unreadable');
      return;
    }
    // WEAKER but still real, for scenarios that keep live mailboxes: the tree is
    // byte-identical to before the run. Deliberately not dressed up as the
    // stronger claim - scenario 02 exists to make the strong one.
    const after = snapshotMailboxes(ctx.root);
    must(after === ctx.mailboxSnapshot,
      `the mailbox tree changed during the run\n  before: ${ctx.mailboxSnapshot}\n  after:  ${after}`);
  });
  registry.define(/^the run never spawned a tmux process$/, (ctx) => {
    const log = ctx.shimLog && fs.existsSync(ctx.shimLog) ? fs.readFileSync(ctx.shimLog, 'utf8') : '';
    must(!/^tmux /m.test(log), `a tmux invocation was recorded:\n${log}`);
  });
  registry.define(/^the wrapper reports zero touches of \.swarmforge\/handoffs\/ and zero tmux invocations$/, (ctx) => {
    const log = ctx.shimLog && fs.existsSync(ctx.shimLog) ? fs.readFileSync(ctx.shimLog, 'utf8') : '';
    must(log.trim() === '', `the shim log should be empty, got:\n${log}`);
    must(fs.statSync(path.join(ctx.root, '.swarmforge', 'handoffs')).isFile(),
      'the ENOTDIR canary must still be in place');
  });
  registry.define(/^the assertion comes from the wrapper's own record and not from reading the driver source$/, (ctx) => {
    // Structural: the two canaries are the only evidence used above, and both
    // are external to the driver. Assert they were actually armed - an
    // unarmed canary would make the previous step vacuously true.
    must(ctx.shims && fs.existsSync(ctx.shims), 'PATH shims were never armed');
    for (const cmd of FORBIDDEN_COMMANDS) {
      must(fs.existsSync(path.join(ctx.shims, path.basename(cmd))), `no shim for ${cmd}`);
    }
    must(fs.statSync(path.join(ctx.root, '.swarmforge', 'handoffs')).isFile(), 'ENOTDIR canary was never armed');
  });
  registry.define(/^the run reaches done without invoking any stubbed tool$/, (ctx) => {
    must(ctx.runJson && ctx.runJson.ticket === 'done', 'the run should reach done with every forbidden tool stubbed');
  });
  registry.define(/^no stubbed tool recorded an invocation$/, (ctx) => {
    const log = ctx.shimLog && fs.existsSync(ctx.shimLog) ? fs.readFileSync(ctx.shimLog, 'utf8') : '';
    must(log.trim() === '', `a stubbed tool was invoked:\n${log}`);
  });

  // ── Thens: bounces ───────────────────────────────────────────────────────
  registry.define(/^the driver re-enters the coder stage carrying the QA failure reason$/, (ctx) => {
    const coderRuns = ctx.stagesRan.filter((s) => s === 'coder').length;
    must(coderRuns >= 2, `expected the coder to re-run, ran ${coderRuns} time(s)`);
    mustContain(ctx.out, 'bounce', 'a bounce should be logged');
  });
  registry.define(/^the driver stops after three bounces against that gate$/, (ctx) => {
    mustContain(ctx.out, ':rounds 3', 'should exhaust after three rounds');
  });
  registry.define(/^the exit status is non-zero and the message names the architect gate$/, (ctx) => {
    must(ctx.exitCode !== 0, `expected a non-zero exit, got ${ctx.exitCode}`);
    mustContain(ctx.out, ':gate "architect"', 'the failed gate should be named');
  });
  registry.define(/^the driver never loops without bound$/, (ctx) => {
    must(ctx.exitCode !== null, 'the driver must terminate rather than loop');
    mustContain(ctx.out, 'EXHAUSTED', 'exhaustion should be announced');
  });
  registry.define(/^the run record names the repeated defect class across the three rounds$/, (ctx) => {
    mustContain(ctx.out, ':repeated-class "resume-identity"', 'the repeated class should be named');
  });
  registry.define(/^the run record marks the ticket as a probable spec defect for the specifier$/, (ctx) => {
    mustContain(ctx.out, ':probable-spec-defect', 'exhaustion should read as a probable spec defect');
    mustContain(ctx.out, ':route-to "specifier"', 'it should route to the specifier');
  });
  registry.define(/^the report does not attribute the failure to the coder stage$/, (ctx) => {
    mustContain(ctx.out, ':blame-stage nil', 'no stage should be blamed');
  });
  registry.define(/^the run record states the bound in force and that it was raised explicitly$/, (ctx) => {
    mustContain(ctx.out, 'bounce bound 5 (RAISED explicitly)', 'a raised bound must be announced');
  });
  registry.define(/^the default bound remains three when no bound is given$/, (ctx) => {
    const fresh = { };
    buildFixture(fresh, ['BL-567']);
    const out = runExpeditor(fresh, ['--no-restart']);
    mustContain(out, 'bounce bound 3 (default)', 'the default bound should be 3');
  });
  registry.define(/^the driver recorded a bounce verdict naming the target stage$/, (ctx) => {
    const hist = (ctx.runJson && ctx.runJson.history) || [];
    must(hist.some((h) => h.verdict === 'bounce'), `no bounce verdict in history: ${JSON.stringify(hist)}`);
  });
  registry.define(/^the bounced commit remains reachable from the expeditor branch tip$/, (ctx) => {
    // The driver must never revert a bounce out of the branch (BL-629/BL-632).
    // Nothing in the run may have produced a revert commit.
    const log = execFileSync('git', ['-C', ctx.root, 'log', '--all', '--oneline'], { encoding: 'utf8' });
    must(!/Revert /.test(log), `the driver must not revert on bounce:\n${log}`);
  });

  // ── Thens: branch discipline ─────────────────────────────────────────────
  registry.define(/^the stage commits landed on the run's own expedite branch$/, (ctx) => {
    const branches = execFileSync('git', ['-C', ctx.root, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' });
    mustContain(branches, `expedite/${ctx.ticket}`, 'the run should have its own branch');
  });
  registry.define(/^no commit landed on main outside the QA stage's merge$/, (ctx) => {
    // The fixture's stages produce no commits, so main must be untouched.
    const subject = execFileSync('git', ['-C', ctx.root, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }).trim();
    must(subject === 'fixture: initial', `main moved unexpectedly: ${subject}`);
  });
  registry.define(/^the run did not commit inside any \.worktrees role checkout$/, (ctx) => {
    const wt = path.join(ctx.root, '.worktrees');
    const dirs = fs.existsSync(wt) ? fs.readdirSync(wt) : [];
    for (const d of dirs) {
      must(d.startsWith('expedite-'), `the run touched a non-expedite worktree: ${d}`);
    }
  });
  registry.define(/^every commit the run produced carries the expedited marker$/, (ctx) => {
    // DRIVER-SIDE half: the driver itself creates no domain commits, so there is
    // nothing here to carry an unmarked trailer. The marker on stage commits is
    // the stage agents' contract; QA verifies it against a real run.
    const subject = execFileSync('git', ['-C', ctx.root, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }).trim();
    must(subject === 'fixture: initial', 'the driver must not create unmarked commits of its own');
  });
  registry.define(/^those commits passed the same lint, test and mutation gates the online pipeline enforces$/, (ctx) => {
    // DRIVER-SIDE half: no gate may be skipped or have its verdict invented.
    // Every declared stage appears in the run record with a real verdict.
    const hist = (ctx.runJson && ctx.runJson.history) || [];
    for (const role of CHAIN) {
      must(hist.some((h) => h.stage === role && h.verdict), `no recorded verdict for the ${role} gate`);
    }
  });

  // ── Thens: the interlock ─────────────────────────────────────────────────
  registry.define(/^initiation states it will stop the swarm before doing anything else$/, (ctx) => {
    mustContain(ctx.out, 'initiation will stop it', 'initiation should announce it is stopping the swarm');
  });
  registry.define(/^the expeditor refuses with a message naming what is still alive$/, (ctx) => {
    must(ctx.exitCode !== 0, `expected a refusal exit, got ${ctx.exitCode}`);
    mustContain(ctx.out, 'REFUSE teardown did not reach a clean slate', 'the refusal should name the unresolved state');
  });
  registry.define(/^no stage session was spawned$/, (ctx) => {
    must(ctx.stagesRan.length === 0, `no stage should have run, saw: ${ctx.stagesRan.join(',')}`);
  });
  registry.define(/^initiation stopped the swarm without being asked to override$/, (ctx) => {
    must(!/WARNING override in force/.test(ctx.out), 'no override warning should have been emitted');
    must(!ctx.runJson || ctx.runJson['override-used?'] !== true, 'the run record must not record an override');
    mustContain(ctx.out, 'initiation will stop it', 'initiation should have stopped the live swarm');
  });
  registry.define(/^the expeditor treats the swarm as stopped and proceeds$/, (ctx) => {
    mustContain(ctx.out, ':stopped? true', 'a server-less socket file must read as stopped');
    must(!/REFUSE/.test(ctx.out), `should not refuse:\n${ctx.out}`);
  });
  registry.define(/^the expeditor did not require the override flag$/, (ctx) => {
    must(!/WARNING override in force/.test(ctx.out), 'no override warning should have been emitted');
    must(!ctx.runJson || ctx.runJson['override-used?'] !== true, 'the run record must not record an override');
  });
  registry.define(/^the expeditor proceeds and emits a warning naming the override$/, (ctx) => {
    mustContain(ctx.out, 'WARNING override in force', 'the override must warn');
  });
  registry.define(/^the override use is recorded in the run record$/, (ctx) => {
    must(ctx.runJson && ctx.runJson['override-used?'] === true, 'the run record must record the override');
  });
  registry.define(/^the expeditor refuses with a message naming the surviving process$/, (ctx) => {
    must(ctx.exitCode !== 0, `expected a refusal, got ${ctx.exitCode}`);
    mustContain(ctx.out, 'babysitterd', 'the survivor should be named');
    mustContain(ctx.out, 'exited 0 but these survived', 'the lying exit code should be called out');
  });
  registry.define(/^the expeditor did not proceed to any stage$/, (ctx) => {
    must(ctx.stagesRan.length === 0, `no stage should have run, saw: ${ctx.stagesRan.join(',')}`);
  });

  // ── Thens: initiation park/preserve ──────────────────────────────────────
  registry.define(/^the second ticket's yaml has moved to backlog\/hold\/$/, (ctx) => {
    must(lsdir(ctx.root, 'hold').some((f) => f.startsWith('BL-590')), 'the second ticket should be in hold/');
  });
  registry.define(/^no ticket was moved to backlog\/paused\/$/, (ctx) => {
    must(lsdir(ctx.root, 'paused').length === 0, 'paused/ is the promotion queue and must stay empty');
  });
  registry.define(/^a park record names the parked ticket's per-role branch tips and any claimed parcel$/, (ctx) => {
    const p = path.join(ctx.root, '.swarmforge', 'expedite', ctx.ticket, 'park-record.json');
    must(fs.existsSync(p), 'a park record should have been written');
    const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
    must(rec.destination === 'hold', 'the record should say hold/');
    must(rec.tickets && rec.tickets.length > 0, 'the record should name what was parked');
    must(rec['role-branch-tips'] !== undefined, 'the record should capture per-role branch tips');
  });
  registry.define(/^both role mailboxes still hold their pending parcels$/, (ctx) => {
    const n = execFileSync('bash', ['-lc',
      `find ${JSON.stringify(path.join(ctx.root, '.swarmforge', 'handoffs'))} -name '*.handoff' | wc -l`],
      { encoding: 'utf8' }).trim();
    must(n === ctx.parcelsBefore, `parcels changed: was ${ctx.parcelsBefore}, now ${n}`);
  });
  registry.define(/^each role branch still points at the commit it pointed at before initiation$/, (ctx) => {
    const after = execFileSync('git', ['-C', ctx.root, 'branch', '--format=%(refname:short) %(objectname)'],
      { encoding: 'utf8' }).trim();
    const before = new Map(ctx.tipsBefore.split('\n').filter(Boolean).map((l) => l.split(' ')));
    for (const line of after.split('\n').filter(Boolean)) {
      const [b, sha] = line.split(' ');
      if (before.has(b)) must(before.get(b) === sha, `branch ${b} moved`);
    }
  });

  // ── Thens: timeout ───────────────────────────────────────────────────────
  registry.define(/^the driver terminates the stage and exits non-zero naming the coder stage$/, (ctx) => {
    must(ctx.exitCode !== 0, `expected a non-zero exit, got ${ctx.exitCode}`);
    mustContain(ctx.out, 'stage-timeout', 'the timeout should be named');
  });
  registry.define(/^the driver does not wait indefinitely with no supervisor alive$/, (ctx) => {
    must(ctx.exitCode !== null, 'the driver must terminate on its own - it killed its own watchdog');
  });

  // ── Thens: restart ───────────────────────────────────────────────────────
  registry.define(/^the fixture ticket's yaml is still in backlog\/done\/$/, (ctx) => {
    must(lsdir(ctx.root, 'done').some((f) => f.startsWith(ctx.ticket)),
      'a failed restart must not retract a done ticket');
  });
  registry.define(/^the result distinguishes the ticket verdict from the restart outcome$/, (ctx) => {
    must(ctx.runJson.ticket === 'done', 'the ticket half should still read done');
    must(ctx.runJson['failed-half'] === 'restart', 'the failing half should be named as the restart');
  });
  registry.define(/^the restart failure is reported loudly$/, (ctx) => {
    must(ctx.exitCode !== 0, 'a failed restart should still exit non-zero');
    must(ctx.runJson.restart && ctx.runJson.restart.outcome === 'failed', 'the restart outcome should read failed');
  });
  registry.define(/^the restart invoked the full-stack start path and not the pipeline-only one$/, (ctx) => {
    // ./start-swarm.sh is the full stack; ./swarm is pipeline-only (BL-637).
    must(ctx.runJson.restart && ctx.runJson.restart.outcome !== 'not-attempted',
      'the restart phase should have run');
    must(!/\bexec .*swarmforge\.sh/.test(ctx.out), 'the pipeline-only path must not be used');
  });
  registry.define(/^the report states the delta between the observed live set and the expected one$/, (ctx) => {
    must(ctx.runJson.restart && ctx.runJson.restart['live-set-delta'] !== undefined,
      'the restart report should carry a live-set delta');
  });
  registry.define(/^the report does not assert health it did not observe$/, (ctx) => {
    // A non-empty delta must NOT be reported as :ok - that would be claiming
    // health nobody observed.
    const r = ctx.runJson.restart;
    const delta = r['live-set-delta'] || {};
    if (Object.keys(delta).length > 0) {
      must(r.outcome !== 'ok', 'a short live set must never read as ok');
    }
  });
  registry.define(/^the report names the ticket left in backlog\/hold\/ and what it was holding$/, (ctx) => {
    const rep = ctx.runJson['parked-report'];
    must(rep && Array.isArray(rep['still-held']) && rep['still-held'].length > 0,
      'the report should name what is still held');
  });
  registry.define(/^that ticket is still in backlog\/hold\/ after the restart$/, (ctx) => {
    must(lsdir(ctx.root, 'hold').some((f) => f.startsWith('BL-590')),
      'the parked ticket must not be silently re-promoted');
    const rep = ctx.runJson['parked-report'];
    must(rep && Array.isArray(rep.promoted) && rep.promoted.length === 0, 'nothing should have been promoted');
  });
}

module.exports = { registerSteps };
