'use strict';

// BL-1057: step handlers for "The host switchover doctor names what a host
// move left behind".
//
// Every scenario builds a REAL host on disk - a checkout root, a fake $HOME
// with its two env-seamed registries - and runs the REAL command
// (`bb swarmforge/scripts/host_switchover_doctor.bb <root> --json`) as a
// subprocess against it. Nothing here restates a verdict rule, and nothing
// asserts over the command's source text: the report either records the
// location or it does not.
//
// The fixture is built FROM THE DECLARED INVENTORY, read out of the command
// itself via `--inventory`. A second copy of "what the inventory is" written
// in JavaScript would be free to drift from the one the doctor actually walks,
// and the lane that mattered would be the one that drifted.
//
// "Exists but cannot be read" is produced by making the path a DIRECTORY where
// a file belongs, so the read genuinely fails (EISDIR). Deliberately not a
// chmod - engineering.prompt forbids chmod-for-failure-simulation, and a
// chmod-based fixture is a lie on a host running as root anyway.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const FEATURE = 'The host switchover doctor names what a host move left behind';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DOCTOR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'host_switchover_doctor.bb');
const NAMED_TUNNEL_RUNBOOK = 'docs/how-to/named-tunnel-bubble-musicalsifu.md';

// Explicit known values per the Scenario Outline handler rule: a row the
// handlers do not know is a hard failure, never a passthrough.
const KNOWN_CONDITIONS = new Set([
  'names a repo root that is not this one',
  'names this repo root',
  'is absent',
  'exists but cannot be read',
]);

const KNOWN_INVENTORY_STATES = new Set([
  'every location is present and names this repo root',
  'one location names a repo root that is not this one',
  'one location is absent',
]);

const KNOWN_VERDICTS = new Set(['OK', 'STALE', 'MISSING', 'BLOCKED']);

// A near miss, not an unrelated path: the old Mac root this swarm actually
// moved off. A stale value that differed from the real root in every character
// would pass a comparison that only checks a prefix.
const OTHER_ROOT = '/Users/ldecorps/projects/swarmforgevc';

let trackedPaths = [];
afterEach(() => {
  while (trackedPaths.length) {
    fs.rmSync(trackedPaths.pop(), { recursive: true, force: true });
  }
});

function run(args, env) {
  return spawnSync('bb', args, { encoding: 'utf8', env: { ...process.env, ...env } });
}

function readInventory() {
  const listed = run([DOCTOR, '--inventory'], {});
  assert.equal(listed.status, 0, `could not read the declared inventory: ${listed.stdout}${listed.stderr}`);
  return JSON.parse(listed.stdout);
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function settingsBody(keys, value) {
  return `{\n${keys.map((k) => `  "${k}": "${value}"`).join(',\n')}\n}\n`;
}

function newHost() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1057-'));
  trackedPaths.push(root);
  const host = {
    root,
    repoRoot: path.join(root, 'checkout'),
    home: path.join(root, 'home'),
    inventory: readInventory(),
  };
  host.tunnels = path.join(host.home, '.swarmforge', 'tunnels');
  host.cloudflared = path.join(host.home, '.cloudflared');
  host.env = {
    HOME: host.home,
    SWARMFORGE_TUNNEL_REGISTRY_DIR: host.tunnels,
    SWARMFORGE_CLOUDFLARED_DIR: host.cloudflared,
  };
  fs.mkdirSync(host.repoRoot, { recursive: true });
  fs.mkdirSync(host.tunnels, { recursive: true });
  fs.mkdirSync(host.cloudflared, { recursive: true });
  return host;
}

function locationPath(host, row) {
  const base = { repo: host.repoRoot, tunnel_registry: host.tunnels, cloudflared: host.cloudflared }[
    row.base.replace(/-/g, '_')
  ];
  assert.ok(base, `unknown inventory base "${row.base}"`);
  return row.rel ? path.join(base, row.rel) : base;
}

// A location that describes THIS host, in whatever form its check needs.
function makeHealthy(host, row) {
  const target = locationPath(host, row);
  if (row.check === 'settings') return write(target, settingsBody(row.keys, host.repoRoot));
  if (row.check === 'root-text') return write(target, `${host.repoRoot}\n`);
  if (row.check === 'present') return write(target, 'x\n');
  if (row.check === 'present-any') return write(path.join(target, 'abc-123.json'), '{}\n');
  throw new Error(`unknown inventory check "${row.check}"`);
}

function makeStale(host, row) {
  const target = locationPath(host, row);
  if (row.check === 'settings') return write(target, settingsBody(row.keys, OTHER_ROOT));
  if (row.check === 'root-text') return write(target, `${OTHER_ROOT}\n`);
  throw new Error(`a "${row.check}" location holds no repo root, so it cannot be stale`);
}

function makeAbsent(host, row) {
  const target = locationPath(host, row);
  if (row.check === 'present-any') {
    // The directory itself stays - what is absent is the credentials file.
    for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

// A real read failure: a directory where a file belongs. No chmod.
function makeUnreadable(host, row) {
  const target = locationPath(host, row);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function healthyHost() {
  const host = newHost();
  for (const row of host.inventory) makeHealthy(host, row);
  return host;
}

function rowFor(host, id) {
  const row = host.inventory.find((entry) => entry.id === id);
  assert.ok(row, `"${id}" is not in the declared inventory: ${host.inventory.map((e) => e.id).join(', ')}`);
  return row;
}

function applyCondition(host, id, condition) {
  const row = rowFor(host, id);
  if (condition === 'names this repo root') return makeHealthy(host, row);
  if (condition === 'names a repo root that is not this one') return makeStale(host, row);
  if (condition === 'is absent') return makeAbsent(host, row);
  if (condition === 'exists but cannot be read') return makeUnreadable(host, row);
  throw new Error(`unknown condition "${condition}"`);
}

// Content, size and mtime of every entry under the host tree - a creation, a
// deletion, a rewrite or a touch anywhere changes this.
function fingerprint(dir) {
  const entries = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);
      if (entry.isDirectory()) {
        entries.push(`${full}\tDIR\t${stat.mtimeMs}`);
        walk(full);
      } else {
        entries.push(`${full}\t${stat.size}\t${stat.mtimeMs}\t${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
      }
    }
  };
  walk(dir);
  return entries.join('\n');
}

function findingFor(ctx, id) {
  const found = ctx.report.findings.find((f) => f.id === id);
  assert.ok(found, `the report has no entry for "${id}": ${ctx.report.findings.map((f) => f.id).join(', ')}`);
  return found;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  // A fully healthy host: every location present and naming the injected root.
  // Each scenario's Given then moves exactly one of them, so a verdict can
  // only ever come from the condition that scenario states.

  scoped(/^a swarm checkout whose repo root is the injected root$/, (ctx) => {
    assert.ok(fs.existsSync(DOCTOR), `the command under test is missing: ${DOCTOR}`);
    ctx.host = healthyHost();
  });

  scoped(/^a declared inventory of host-pinned locations the forge reads$/, (ctx) => {
    assert.ok(ctx.host, 'the background never built a checkout');
    assert.ok(ctx.host.inventory.length > 0, 'the command declares no inventory at all');
    for (const row of ctx.host.inventory) {
      assert.ok(row.remediation, `inventory row "${row.id}" declares no remediation`);
    }
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^the host-pinned location "(.+)" (.+)$/, (ctx, id, condition) => {
    assert.ok(
      KNOWN_CONDITIONS.has(condition),
      `unknown condition "${condition}" - the handlers know ${[...KNOWN_CONDITIONS].join('; ')}`
    );
    applyCondition(ctx.host, id, condition);
    ctx.subject = id;
  });

  scoped(/^an inventory in which (.+)$/, (ctx, state) => {
    assert.ok(
      KNOWN_INVENTORY_STATES.has(state),
      `unknown inventory state "${state}" - the handlers know ${[...KNOWN_INVENTORY_STATES].join('; ')}`
    );
    if (state === 'one location names a repo root that is not this one') {
      applyCondition(ctx.host, 'extension/.vscode/settings.json', 'names a repo root that is not this one');
    } else if (state === 'one location is absent') {
      applyCondition(ctx.host, '~/.swarmforge/tunnels/operator-root', 'is absent');
    }
    // 'every location is present and names this repo root' is the background
    // state itself - stated in the feature so the passing row is explicit.
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the operator runs the host switchover doctor$/, (ctx) => {
    assert.ok(ctx.host, 'no host was built before the doctor ran');
    ctx.before = fingerprint(ctx.host.root);
    const result = run([DOCTOR, ctx.host.repoRoot, '--json'], ctx.host.env);
    assert.ok(
      result.stdout && result.stdout.trim().length > 0,
      `the doctor printed nothing (status ${result.status}): ${result.stderr}`
    );
    ctx.exit = result.status;
    ctx.report = JSON.parse(result.stdout);
    ctx.after = fingerprint(ctx.host.root);
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the report records "(.+)" with verdict "(.+)"$/, (ctx, id, verdict) => {
    assert.ok(
      KNOWN_VERDICTS.has(verdict),
      `unknown verdict "${verdict}" - the handlers know ${[...KNOWN_VERDICTS].join(', ')}`
    );
    assert.equal(findingFor(ctx, id).verdict, verdict);
  });

  scoped(/^the finding for "(.+)" quotes the stale value it found$/, (ctx, id) => {
    const finding = findingFor(ctx, id);
    assert.equal(finding.verdict, 'STALE');
    assert.ok(
      finding.found && finding.found.includes(OTHER_ROOT),
      `the finding does not quote the stale value it found: ${JSON.stringify(finding.found)}`
    );
  });

  scoped(/^the finding for "(.+)" names a remediation step$/, (ctx, id) => {
    const finding = findingFor(ctx, id);
    assert.ok(
      finding.remediation && finding.remediation.trim().length > 0,
      `a non-OK finding with no remediation is one the reader cannot act on: ${JSON.stringify(finding)}`
    );
    assert.ok(
      finding.path && finding.path.trim().length > 0,
      `a non-OK finding must also name the concrete location at fault: ${JSON.stringify(finding)}`
    );
  });

  scoped(/^the finding for "(.+)" names "(.+)"$/, (ctx, id, runbook) => {
    assert.equal(runbook, NAMED_TUNNEL_RUNBOOK, `unexpected runbook "${runbook}" in the feature`);
    const finding = findingFor(ctx, id);
    assert.notEqual(finding.verdict, 'OK', 'an OK finding has nothing to point the reader at');
    assert.ok(
      finding.remediation.includes(runbook),
      `the remediation does not name the runbook: ${finding.remediation}`
    );
  });

  scoped(/^the doctor exit code is "(\d+)"$/, (ctx, exit) => {
    assert.equal(ctx.exit, Number(exit), `report was: ${JSON.stringify(ctx.report, null, 2)}`);
  });

  scoped(/^every inspected location is byte-identical to what it was before the run$/, (ctx) => {
    assert.equal(ctx.before, ctx.after, 'the doctor changed the host it inspected');
  });

  scoped(/^the report contains exactly one entry for every location in the declared inventory$/, (ctx) => {
    const reported = ctx.report.findings.map((f) => f.id).sort();
    const declared = ctx.host.inventory.map((row) => row.id).sort();
    assert.deepEqual(reported, declared, 'a declared check was dropped from the report, or reported twice');
    for (const finding of ctx.report.findings) {
      assert.ok(
        KNOWN_VERDICTS.has(finding.verdict),
        `"${finding.id}" carries no verdict from the declared set: ${finding.verdict}`
      );
    }
  });
}

module.exports = { registerSteps };
