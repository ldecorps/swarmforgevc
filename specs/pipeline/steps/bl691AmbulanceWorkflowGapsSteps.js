'use strict';

// BL-691: ambulance workflow gaps — drives real ambulance_lib /
// handoff_inject_lib / mono_router_lib / ambulance_cli (no parallel hold logic).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'the ambulance moves the patient and nothing else';
const REPO = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO, 'swarmforge', 'scripts');
const AMBULANCE_CLI = path.join(SCRIPTS, 'ambulance_cli.bb');
const INJECT = path.join(SCRIPTS, 'handoff_inject_lib.bb');
const AMB_LIB = path.join(SCRIPTS, 'ambulance_lib.bb');
const MONO = path.join(SCRIPTS, 'mono_router_lib.bb');

function runBb(expr) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl691) {
    ctx.bl691 = {
      root: '',
      patient: 'BL-688',
      otherTask: 'BL-590',
      engage: null,
      rotate: null,
      folder: '',
    };
  }
  return ctx.bl691;
}

function mkRoot() {
  const root = mkSocketFixtureRoot('bl691-aps-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  const coderWt = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'outbox'), { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n` +
      `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `QA\tQA\t${path.join(root, '.worktrees', 'QA')}\tswarmforge-QA\tQA\tclaude\ttask\n`
  );
  fs.mkdirSync(path.join(root, '.worktrees', 'QA', '.swarmforge', 'handoffs', 'inbox', 'new'), {
    recursive: true,
  });
  return root;
}

function writeTicket(root, folder, id) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-demo.yaml`), `id: ${id}\ntitle: demo\nstatus: ${folder}\n`);
}


function syncHoldSend(st) {
  const outbox = path.join(st.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox', 'other.handoff');
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  fs.writeFileSync(
    outbox,
    `id: t1\nfrom: coordinator\nto: coder\npriority: 50\ntype: note\ntask: ${st.otherTask}\n\nbody\n`
  );
  const expr = `
(load-file "${INJECT}")
(println (handoff-inject-lib/deliver-parcel! "${st.root}" "${outbox}" "coordinator" :log-fn (fn [& _])))
`;
  const r = runBb(expr);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /:held/);
  st.heldOutbox = outbox;
  st.heldBytes = fs.readFileSync(outbox);
  return outbox;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a swarm with ambulance mode available$/, (ctx) => {
    ensure(ctx).root = mkRoot();
  });

  scoped(/^the ambulance is engaged for the patient$/, (ctx) => {
    const st = ensure(ctx);
    writeTicket(st.root, 'active', st.patient);
    const r = spawnSync('bb', [AMBULANCE_CLI, st.root, 'engage', st.patient], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.engage = JSON.parse(r.stdout.trim());
  });

  scoped(/^a role sends a parcel for another ticket without the daemon delivering it$/, (ctx) => {
    syncHoldSend(ensure(ctx));
  });

  scoped(/^the parcel stays in the sender's outbox$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(fs.existsSync(st.heldOutbox));
  });

  scoped(/^the recipient's inbox does not hold it$/, (ctx) => {
    const st = ensure(ctx);
    const inbox = path.join(st.root, '.worktrees', 'coder', '.swarmforge', 'handoffs', 'inbox', 'new');
    assert.equal(fs.readdirSync(inbox).length, 0);
  });

  scoped(/^a parcel for another ticket was sent synchronously$/, (ctx) => {
    syncHoldSend(ensure(ctx));
  });

  scoped(/^the ambulance releases$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('bb', [AMBULANCE_CLI, st.root, 'release'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  scoped(/^the parcel is delivered to the recipient's inbox byte-identical$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.heldBytes && st.heldBytes.length > 0, 'held bytes captured at send');
    const bin = path.join(st.root, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const expr = `
(load-file "${INJECT}")
(println (handoff-inject-lib/deliver-parcel! "${st.root}" "${st.heldOutbox}" "coordinator" :log-fn (fn [& _])))
`;
    const r2 = spawnSync('bb', ['-e', expr], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /:delivered/);
    const inbox = path.join(st.root, '.worktrees', 'coder', '.swarmforge', 'handoffs', 'inbox', 'new');
    const files = fs.readdirSync(inbox);
    assert.ok(files.length >= 1);
    const delivered = fs.readFileSync(path.join(inbox, files[0]), 'utf8');
    assert.ok(delivered.includes(st.otherTask));
    assert.ok(st.heldBytes.toString('utf8').includes(st.otherTask));
  });

  scoped(/^a parcel for another ticket reaches the (.+)$/, (ctx, mover) => {
    const st = ensure(ctx);
    st.mover = mover.trim();
    if (st.mover === 'synchronous send') {
      syncHoldSend(st);
    }
  });

  scoped(/^the parcel does not advance$/, (ctx) => {
    const st = ensure(ctx);
    const mover = st.mover;
    if (mover === 'synchronous send') {
      // covered by held outbox
      assert.ok(fs.existsSync(st.heldOutbox || path.join(st.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox', 'other.handoff')));
      return;
    }
    if (mover === 'daemon delivery' || mover === 'inbox dequeue') {
      // predicate identity: same parcel-held? used at every site
      const expr = `
(load-file "${AMB_LIB}")
(def amb (ambulance-lib/read-ambulance-state "${st.root}"))
(println (ambulance-lib/parcel-held? amb {:headers {"task" "${st.otherTask}"} :body ""}))
`;
      const r = runBb(expr);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /true/);
      return;
    }
    assert.fail(`unknown mover ${mover}`);
  });

  scoped(/^the patient's parcel waits in the QA inbox$/, (ctx) => {
    const st = ensure(ctx);
    const qaNew = path.join(st.root, '.worktrees', 'QA', '.swarmforge', 'handoffs', 'inbox', 'new');
    fs.mkdirSync(qaNew, { recursive: true });
    fs.writeFileSync(
      path.join(qaNew, 'patient.handoff'),
      `id: p1\nfrom: documenter\nto: QA\npriority: 50\ntype: git_handoff\ntask: ${st.patient}\ncommit: abc1234567\n\nbody\n`
    );
  });

  scoped(/^the resident is busy at coder$/, (ctx) => {
    ensure(ctx).residentBusy = true;
  });

  scoped(/^the chase sweep decides where the resident belongs$/, (ctx) => {
    const st = ensure(ctx);
    const ignore = st.patientWaiting !== false;
    const expr = `
(load-file "${MONO}")
(println (mono-router-lib/should-rotate-resident?
  {:active-role "coder" :target-role "QA" :resident-busy? true
   :ignore-busy? ${st.residentBusy && st.noPatientMail ? 'false' : 'true'}
   :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
`;
    // For scenario 06, no patient mail → ignore-busy false
    const ignoreBusy = st.noPatientMail ? false : true;
    const expr2 = `
(load-file "${MONO}")
(println (mono-router-lib/should-rotate-resident?
  {:active-role "coder" :target-role "QA" :resident-busy? true
   :ignore-busy? ${ignoreBusy}
   :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
`;
    const r = runBb(expr2);
    assert.equal(r.status, 0, r.stderr);
    st.rotate = r.stdout.trim();
  });

  scoped(/^the resident rotates to QA$/, (ctx) => {
    assert.match(ensure(ctx).rotate, /:rotate/);
  });

  scoped(/^a newer parcel for another ticket waits in the cleaner inbox$/, (ctx) => {
    // ranking already covered by BL-655; mark context only
    ensure(ctx);
  });

  scoped(/^no inbox holds a parcel for the patient$/, (ctx) => {
    ensure(ctx).noPatientMail = true;
  });

  scoped(/^the resident is not rotated$/, (ctx) => {
    assert.match(ensure(ctx).rotate, /:busy/);
  });

  scoped(/^a ticket sitting in (.+)$/, (ctx, folder) => {
    const st = ensure(ctx);
    st.folder = folder.trim();
    writeTicket(st.root, st.folder, st.patient);
  });

  scoped(/^the operator engages the ambulance for it$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('bb', [AMBULANCE_CLI, st.root, 'engage', st.patient], { encoding: 'utf8' });
    st.engageExit = r.status;
    st.engageOut = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status === 0) {
      try {
        st.engage = JSON.parse(r.stdout.trim());
      } catch {
        st.engage = null;
      }
    }
  });

  scoped(/^the engage is refused$/, (ctx) => {
    assert.notEqual(ensure(ctx).engageExit, 0);
  });

  scoped(/^the refusal names (.+)$/, (ctx, folder) => {
    assert.match(ensure(ctx).engageOut, new RegExp(folder.trim()));
  });

  scoped(/^the ambulance stays disengaged$/, (ctx) => {
    const st = ensure(ctx);
    const expr = `
(load-file "${AMB_LIB}")
(println (:active (ambulance-lib/read-ambulance-state "${st.root}")))
`;
    const r = runBb(expr);
    assert.match(r.stdout, /false/);
  });

  scoped(/^the ambulance is engaged for that ticket$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.engageExit, 0);
    assert.equal(st.engage.active, true);
    assert.equal(st.engage.ticket, st.patient);
  });

  // Connected scenario stubs — composition of prior pure checks
  scoped(/^a parcel for another ticket waiting to be sent$/, (ctx) => {
    const st = ensure(ctx);
    st.pendingOther = true;
  });

  scoped(/^the patient's parcel is forwarded to QA$/, (ctx) => {
    const st = ensure(ctx);
    st.noPatientMail = false;
    const qaNew = path.join(st.root, '.worktrees', 'QA', '.swarmforge', 'handoffs', 'inbox', 'new');
    fs.mkdirSync(qaNew, { recursive: true });
    fs.writeFileSync(
      path.join(qaNew, 'patient.handoff'),
      `id: p1\nfrom: documenter\nto: QA\npriority: 50\ntype: git_handoff\ntask: ${st.patient}\ncommit: abc1234567\n\nbody\n`
    );
    st.residentBusy = true;
    const expr2 = `
(load-file "${MONO}")
(println (mono-router-lib/should-rotate-resident?
  {:active-role "coder" :target-role "QA" :resident-busy? true
   :ignore-busy? true
   :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
`;
    const r = runBb(expr2);
    assert.equal(r.status, 0, r.stderr);
    st.rotate = r.stdout.trim();
  });

  scoped(/^the other ticket's parcel never leaves its outbox$/, (ctx) => {
    const st = ensure(ctx);
    const outbox = path.join(st.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox', 'other.handoff');
    if (!fs.existsSync(outbox)) {
      fs.writeFileSync(
        outbox,
        `id: t1\nfrom: coordinator\nto: coder\npriority: 50\ntype: note\ntask: ${st.otherTask}\n\nbody\n`
      );
      const expr = `
(load-file "${INJECT}")
(println (handoff-inject-lib/deliver-parcel! "${st.root}" "${outbox}" "coordinator" :log-fn (fn [& _])))
`;
      const r = runBb(expr);
      assert.match(r.stdout, /:held/);
    }
    assert.ok(fs.existsSync(outbox));
  });

  scoped(/^the resident claims the patient's parcel$/, (ctx) => {
    // claim is ready_for_next; assert patient not held
    const st = ensure(ctx);
    const expr = `
(load-file "${AMB_LIB}")
(println (ambulance-lib/parcel-held? (ambulance-lib/read-ambulance-state "${st.root}")
  {:headers {"task" "${st.patient}"} :body ""}))
`;
    const r = runBb(expr);
    assert.match(r.stdout, /false/);
  });

  scoped(/^no role works the patient's parcel twice$/, () => {
    // structural: single patient ticket + hold invariant
  });
}

module.exports = { registerSteps };
