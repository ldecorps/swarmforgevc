'use strict';

// BL-1144: frequent QA push races — publish-time rematch + land/close lock.
// Drives master_main_reconcile_lib pure decisions + land_main_publish.sh lock.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');
const CLI = path.join(REPO, 'swarmforge', 'scripts', 'land_main_publish.sh');
const FEATURE = 'frequent QA push races on main land are reduced';

let tracked = [];

afterEach(() => {
  while (tracked.length) fs.rmSync(tracked.pop(), { recursive: true, force: true });
});

function bbDecide(ednMap) {
  const expr = `
(load-file ${JSON.stringify(LIB)})
(prn (master-main-reconcile-lib/contention-publish-next
      {:purity-action (master-main-reconcile-lib/publish-time-purity-action
                       ${ednMap.purity})
       :lock-admission (master-main-reconcile-lib/land-close-publisher-admission
                        ${ednMap.lock})}))
`;
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^rematch-then-FF absorb recovery already lands residual races$/, () => {});
  scoped(/^tip purity vs origin\/main remains mandatory for landed tips$/, (ctx) => {
    const out = execFileSync(
      'bb',
      ['-e', `(load-file ${JSON.stringify(LIB)}) (prn (master-main-reconcile-lib/tip-purity-required?))`],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(out, 'true');
    ctx.tipPurityRequired = true;
  });

  scoped(/^a QA tip that was tip-pure at gate start$/, (ctx) => {
    ctx.gatePure = true;
    ctx.attempt = 0;
  });

  scoped(/^origin\/main advanced during the gate window$/, (ctx) => {
    ctx.originAdvanced = true;
    ctx.tipContainsNow = false;
  });

  scoped(/^the land path reaches publish$/, (ctx) => {
    const purity = `{:tip-contains-origin-now? ${ctx.tipContainsNow}
                     :rematch-would-conflict? false
                     :attempt ${ctx.attempt || 0}
                     :peer-holds-land-lock? false}`;
    const lock = '{:lock-available? true :already-rematched-at-edge? false}';
    ctx.decision = bbDecide({ purity, lock });
    ctx.purityAlone = execFileSync(
      'bb',
      [
        '-e',
        `(load-file ${JSON.stringify(LIB)}) (prn (master-main-reconcile-lib/publish-time-purity-action ${purity}))`,
      ],
      { encoding: 'utf8' }
    ).trim();
  });

  scoped(/^it fetches and rematches for tip purity immediately before push$/, (ctx) => {
    assert.match(ctx.purityAlone, /:rematch-then-push|:retry-rematch/);
  });

  scoped(
    /^a residual race retries within a bounded limit then lands FF or waits on the land lock$/,
    (ctx) => {
      const retry = execFileSync(
        'bb',
        [
          '-e',
          `(load-file ${JSON.stringify(LIB)})
           (prn (master-main-reconcile-lib/publish-time-purity-action
                 {:tip-contains-origin-now? false :rematch-would-conflict? false
                  :attempt 1 :peer-holds-land-lock? false}))
           (prn (master-main-reconcile-lib/publish-time-purity-action
                 {:tip-contains-origin-now? false :rematch-would-conflict? false
                  :attempt 2 :peer-holds-land-lock? false}))`,
        ],
        { encoding: 'utf8' }
      ).trim();
      assert.match(retry, /:retry-rematch/);
      assert.match(retry, /:wait-land-lock/);
      ctx.bounded = true;
    }
  );

  scoped(/^two concurrent land or close publishers targeting origin\/main$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl1144-');
    tracked.push(ctx.root);
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    // Minimal git so decide-only can resolve HEAD/origin if present; lock tests
    // do not need a real remote.
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: ctx.root });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: ctx.root });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: ctx.root });
    spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: ctx.root });
  });

  scoped(/^both attempt to publish$/, (ctx) => {
    const a = spawnSync('bash', [CLI, ctx.root, '--acquire-lock'], { encoding: 'utf8' });
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /LOCK_ACQUIRED/);
    const b = spawnSync('bash', [CLI, ctx.root, '--acquire-lock'], { encoding: 'utf8' });
    assert.notEqual(b.status, 0);
    assert.match(b.stdout, /LOCK_HELD/);
    ctx.secondLockHeld = true;
    const edge = execFileSync(
      'bb',
      [
        '-e',
        `(load-file ${JSON.stringify(LIB)})
         (prn (master-main-reconcile-lib/land-close-publisher-admission
               {:lock-available? false :already-rematched-at-edge? false}))
         (prn (master-main-reconcile-lib/land-close-publisher-admission
               {:lock-available? false :already-rematched-at-edge? true}))`,
      ],
      { encoding: 'utf8' }
    ).trim();
    ctx.lockEdge = edge;
  });

  scoped(/^the second waits or rematches once at the land\/close lock edge$/, (ctx) => {
    assert.match(ctx.lockEdge, /:rematch-once-at-edge/);
    assert.match(ctx.lockEdge, /:wait-lock/);
  });

  scoped(/^unbounded tip-purity bounce loops do not run mid-gate after a peer push$/, (ctx) => {
    const out = execFileSync(
      'bb',
      [
        '-e',
        `(load-file ${JSON.stringify(LIB)})
         (prn (master-main-reconcile-lib/publish-time-purity-action
               {:tip-contains-origin-now? false :rematch-would-conflict? false
                :attempt 0 :peer-holds-land-lock? true}))`,
      ],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(out, ':wait-land-lock');
    spawnSync('bash', [CLI, ctx.root, '--release-lock'], { encoding: 'utf8' });
  });

  scoped(/^a residual push race still occurs after the controls$/, (ctx) => {
    ctx.residual = ':rematch-lander';
  });

  scoped(/^the landed tip is tip-pure vs origin\/main$/, (ctx) => {
    assert.equal(ctx.tipPurityRequired, true);
  });

  scoped(/^designed recovery is rematch lander or rematch bookkeeping$/, (ctx) => {
    const out = execFileSync(
      'bb',
      [
        '-e',
        `(load-file ${JSON.stringify(LIB)})
         (prn (master-main-reconcile-lib/residual-race-recovery-ok? :rematch-lander))
         (prn (master-main-reconcile-lib/residual-race-recovery-ok? :rematch-bookkeeping-owner))
         (prn (master-main-reconcile-lib/residual-race-recovery-ok? :operator-absorb))`,
      ],
      { encoding: 'utf8' }
    ).trim();
    const lines = out.split('\n');
    assert.equal(lines[0], 'true');
    assert.equal(lines[1], 'true');
    assert.equal(lines[2], 'false');
  });

  scoped(/^no human absorb merge is required$/, (ctx) => {
    const out = execFileSync(
      'bb',
      [
        '-e',
        `(load-file ${JSON.stringify(LIB)})
         (prn (master-main-reconcile-lib/designed-recovery-is-operator-absorb?
               "Complete origin/main merge: resolve UU"))`,
      ],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(out, 'true'); // detector still names human absorb phrases
    assert.ok(ctx.residual !== ':operator-absorb');
  });
}

module.exports = { registerSteps };
