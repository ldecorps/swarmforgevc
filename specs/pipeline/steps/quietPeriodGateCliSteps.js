'use strict';

// BL-327: step handlers for "The quiet-period promotion gate is a
// shell-callable command, not bare Clojure in prose". Drives the REAL
// quiet_period_gate_cli.bb as a real subprocess (spawnSync, since a
// blocked/error answer is a non-zero exit BY DESIGN, not a failure) -
// mirrors backlogDepthSteps.js's own real-CLI pattern.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'quiet_period_gate_cli.bb');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-quiet-period-gate-cli-'));
}

function writeCandidate(root, id, source) {
  const file = path.join(root, `${id}.yaml`);
  const lines = [`id: ${id}`, 'status: todo'];
  if (source !== undefined) {
    lines.push(`source: "${source}"`);
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function runBlocked(candidatePath, { backlogDrained, rosterIdle }) {
  const args = ['blocked', candidatePath];
  if (backlogDrained !== undefined) {
    args.push('--backlog-drained', String(backlogDrained));
  }
  if (rosterIdle !== undefined) {
    args.push('--roster-idle', String(rosterIdle));
  }
  const result = spawnSync('bb', [CLI, ...args], { encoding: 'utf8' });
  return { stdout: result.stdout.trim(), stderr: result.stderr, code: result.status };
}

function runComposeSource(reason) {
  const result = spawnSync('bb', [CLI, 'compose-source', reason], { encoding: 'utf8' });
  return { stdout: result.stdout.trim(), code: result.status };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the coordinator is deciding whether to promote a paused candidate$/, (ctx) => {
    ctx.root = mkTmp();
  });

  // ── quiet-period-gate-cli-01 (Scenario Outline) ─────────────────────────
  registry.define(/^a candidate ticket that (the coordinator raised|a human raised)$/, (ctx, provenance) => {
    const source =
      provenance === 'the coordinator raised'
        ? 'Raised by the coordinator itself (self-generated) - cost review flagged idle quota'
        : 'Raised by the human 2026-07-13 via INTAKE-foo.md';
    ctx.candidatePath = writeCandidate(ctx.root, 'BL-500', source);
  });

  registry.define(/^the swarm (is drained and idle|still has work in flight)$/, (ctx, quietState) => {
    ctx.backlogDrained = quietState === 'is drained and idle';
    ctx.rosterIdle = quietState === 'is drained and idle';
  });

  registry.define(/^the coordinator asks the gate whether promotion is blocked$/, (ctx) => {
    ctx.result = runBlocked(ctx.candidatePath, { backlogDrained: ctx.backlogDrained, rosterIdle: ctx.rosterIdle });
  });

  registry.define(/^the gate answers (blocked|not blocked)$/, (ctx, answer) => {
    const expected = answer === 'blocked' ? 'blocked' : 'allowed';
    if (ctx.result.stdout !== expected) {
      throw new Error(`expected the gate to answer "${expected}", got: ${JSON.stringify(ctx.result)}`);
    }
    const expectedCode = answer === 'blocked' ? 1 : 0;
    if (ctx.result.code !== expectedCode) {
      throw new Error(`expected exit code ${expectedCode} for "${expected}", got: ${ctx.result.code}`);
    }
  });

  // ── quiet-period-gate-cli-02 ─────────────────────────────────────────────
  registry.define(/^the coordinator composes a self-generated ticket's source line with the tool$/, (ctx) => {
    const composed = runComposeSource('cost review flagged idle quota');
    if (composed.code !== 0 || !composed.stdout.includes('(self-generated)')) {
      throw new Error(`expected compose-source to succeed and carry the marker, got: ${JSON.stringify(composed)}`);
    }
    ctx.candidatePath = writeCandidate(ctx.root, 'BL-501', composed.stdout);
  });

  registry.define(/^that ticket is put to the gate during a quiet period$/, (ctx) => {
    ctx.result = runBlocked(ctx.candidatePath, { backlogDrained: true, rosterIdle: true });
  });

  registry.define(/^the gate recognizes it as self-generated$/, (ctx) => {
    if (ctx.result.stdout === 'error') {
      throw new Error(`expected a real answer, not an error: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^answers that promotion is blocked$/, (ctx) => {
    if (ctx.result.stdout !== 'blocked' || ctx.result.code !== 1) {
      throw new Error(`expected blocked/1, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── quiet-period-gate-cli-03 ─────────────────────────────────────────────
  registry.define(/^a self-generated ticket whose source line was hand-written rather than composed by the tool$/, (ctx) => {
    ctx.candidatePath = writeCandidate(ctx.root, 'BL-502', 'coordinator wrote this by hand (self-generated) - no tool used');
  });

  registry.define(/^the gate does not answer that promotion is allowed$/, (ctx) => {
    if (ctx.result.stdout === 'allowed') {
      throw new Error(`expected the gate to never answer "allowed" here, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── quiet-period-gate-cli-04 ─────────────────────────────────────────────
  registry.define(/^a candidate ticket that cannot be read or parsed$/, (ctx) => {
    ctx.candidatePath = path.join(ctx.root, 'does-not-exist.yaml');
  });

  registry.define(/^the gate reports an error$/, (ctx) => {
    if (ctx.result.stdout !== 'error' || ctx.result.code !== 2) {
      throw new Error(`expected error/2, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── quiet-period-gate-cli-05 ─────────────────────────────────────────────
  registry.define(/^the gate is invoked as a shell command with a candidate and the swarm's quiet state$/, (ctx) => {
    ctx.blockedRun = runBlocked(writeCandidate(ctx.root, 'BL-503', 'Raised by the coordinator itself (self-generated) - x'), {
      backlogDrained: true,
      rosterIdle: true,
    });
    ctx.allowedRun = runBlocked(writeCandidate(ctx.root, 'BL-504', 'Raised by the human via INTAKE-bar.md'), {
      backlogDrained: true,
      rosterIdle: true,
    });
  });

  registry.define(/^it answers on standard output$/, (ctx) => {
    if (!ctx.blockedRun.stdout || !ctx.allowedRun.stdout) {
      throw new Error(`expected a real stdout answer from both runs, got: ${JSON.stringify({ blockedRun: ctx.blockedRun, allowedRun: ctx.allowedRun })}`);
    }
  });

  registry.define(/^its exit status distinguishes a blocked candidate from an allowed one$/, (ctx) => {
    if (ctx.blockedRun.code !== 1 || ctx.allowedRun.code !== 0) {
      throw new Error(`expected exit codes 1 (blocked) and 0 (allowed), got: ${ctx.blockedRun.code} and ${ctx.allowedRun.code}`);
    }
  });
}

module.exports = { registerSteps };
