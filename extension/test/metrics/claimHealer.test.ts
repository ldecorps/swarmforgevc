import * as assert from 'assert';
import { executeHealAction, ClaimHealerDeps } from '../../src/metrics/claimHealer';

describe('claimHealer', () => {
  let deps: ClaimHealerDeps;
  let nudges: { role: string; message: string }[];
  let bounces: string[];
  let halts: { role: string; task: string; reason: string }[];

  beforeEach(() => {
    nudges = [];
    bounces = [];
    halts = [];
    deps = {
      nudgeRole: (role, message) => nudges.push({ role, message }),
      triggerBounce: (type) => bounces.push(type),
      haltWithAlerts: (role, task, reason) => halts.push({ role, task, reason }),
    };
  });

  it('nudges role on nudge action', () => {
    executeHealAction('nudge', 'coder', 'BL-528', deps);
    assert.strictEqual(nudges.length, 1);
    assert.strictEqual(nudges[0].role, 'coder');
    assert.ok(nudges[0].message.includes('BL-528'));
  });

  it('triggers extension bounce on reassign action', () => {
    executeHealAction('reassign', 'coder', 'BL-528', deps);
    assert.deepStrictEqual(bounces, ['extension']);
  });

  it('halts with alerts on halt action', () => {
    executeHealAction('halt', 'coder', 'BL-528', deps);
    assert.strictEqual(halts.length, 1);
    assert.strictEqual(halts[0].role, 'coder');
    assert.strictEqual(halts[0].task, 'BL-528');
  });

  it('does nothing on ok action', () => {
    executeHealAction('ok', 'coder', 'BL-528', deps);
    assert.strictEqual(nudges.length, 0);
    assert.strictEqual(bounces.length, 0);
    assert.strictEqual(halts.length, 0);
  });
});
