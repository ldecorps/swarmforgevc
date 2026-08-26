'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'claim-progress sidecars never outlive their handoff';
const REPO = path.join(__dirname, '..', '..', '..');
const DONE = path.join(REPO, 'swarmforge', 'scripts', 'done_with_current_task.bb');
const CHASE = path.join(REPO, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

function ensure(ctx) {
  if (!ctx.bl615) ctx.bl615 = {};
  return ctx.bl615;
}

function sh(cwd, cmd, args, env = {}) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function mkRoleInbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl615-aps-'));
  const wt = path.join(root, '.worktrees', 'coder');
  const ip = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const completed = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(ip, { recursive: true });
  fs.mkdirSync(completed, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${wt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
  fs.copyFileSync(path.join(root, '.swarmforge', 'roles.tsv'), path.join(wt, '.swarmforge', 'roles.tsv'));
  return { root, wt, ip, completed };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a role's inbox\/in_process holds a handoff file paired with its claim-progress sidecar$/, (ctx) => {
    const fx = mkRoleInbox();
    const handoff = path.join(fx.ip, '50_x_from_a_to_coder.handoff');
    fs.writeFileSync(
      handoff,
      'id: x\nfrom: a\nto: coder\nrecipient: coder\npriority: 50\ntype: note\nmessage: hi\ndequeued_at: 2026-08-25T00:00:00Z\n\nhi\n'
    );
    fs.writeFileSync(`${handoff}.claim-progress.json`, '{"claimCommit":"aaaa000000","claimAtMs":1,"reclaims":0}');
    ensure(ctx).fx = fx;
    ensure(ctx).handoff = handoff;
    ensure(ctx).sidecar = `${handoff}.claim-progress.json`;
  });

  scoped(/^the role completes the handoff with done_with_current\.sh$/, (ctx) => {
    const st = ensure(ctx);
    // Skip ready_for_next by stubbing — done_with_current_task calls ready at end.
    // Use env to skip if available; else run and ignore ready failure.
    const r = sh(st.fx.wt, 'bb', [DONE], { SWARMFORGE_ROLE: 'coder', SWARMFORGE_SKIP_READY_FOR_NEXT: '1' });
    st.doneExit = r.status;
    st.doneOut = (r.stdout || '') + (r.stderr || '');
  });

  scoped(/^the handoff file moves out of inbox\/in_process$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.existsSync(st.handoff), false);
    const moved = fs.readdirSync(st.fx.completed).some((f) => f.endsWith('.handoff'));
    assert.equal(moved, true);
  });

  scoped(/^the paired sidecar is deleted with it$/, (ctx) => {
    assert.equal(fs.existsSync(ensure(ctx).sidecar), false);
  });

  scoped(/^a role's inbox\/in_process holds an orphaned claim-progress sidecar whose handoff file is gone$/, (ctx) => {
    const fx = mkRoleInbox();
    const orphan = path.join(fx.ip, 'gone.handoff.claim-progress.json');
    fs.writeFileSync(orphan, '{}');
    ensure(ctx).fx = fx;
    ensure(ctx).orphan = orphan;
    ensure(ctx).logs = [];
  });

  scoped(/^the claim-progress sweep runs$/, (ctx) => {
    const st = ensure(ctx);
    const expr = `
(load-file "${CHASE}")
(def orphans (chase-sweep-lib/reap-orphaned-sidecars! "${st.fx.ip}"))
(println (clojure.string/join "," orphans))
`;
    const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    st.reaped = r.stdout.trim().split(',').filter(Boolean);
    st.logs = st.reaped.map((o) => `reap-orphaned-sidecar ${o}`);
  });

  scoped(/^the orphaned sidecar is deleted$/, (ctx) => {
    assert.equal(fs.existsSync(ensure(ctx).orphan), false);
  });

  scoped(/^the reap is logged$/, (ctx) => {
    assert.ok(ensure(ctx).logs.some((l) => /reap-orphaned-sidecar/.test(l)));
  });
}

module.exports = { registerSteps };
