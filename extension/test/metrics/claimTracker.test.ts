import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { recordClaim, loadClaimState } from '../../src/metrics/claimTracker';
import { ClaimLivenessConfig } from '../../src/metrics/claimLiveness';

describe('claimTracker', () => {
  let tmpDir: string;
  const config: ClaimLivenessConfig = {
    idleReclaimThreshold: 1,
    nudgeThreshold: 2,
    reassignThreshold: 3,
    haltThreshold: 4,
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-tracker-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records initial claim as ok with progress', () => {
    const action = recordClaim(tmpDir, 'coder', 'BL-528', 1, config);
    assert.strictEqual(action, 'ok');
    const state = loadClaimState(tmpDir);
    assert.strictEqual(state['coder'].task, 'BL-528');
    assert.strictEqual(state['coder'].claimCount, 1);
  });

  it('detects idle reclaim and increments claimCount', () => {
    recordClaim(tmpDir, 'coder', 'BL-528', 1, config);
    const action = recordClaim(tmpDir, 'coder', 'BL-528', 1, config); // same beat count
    assert.strictEqual(action, 'nudge'); // claimCount becomes 2, which is nudgeThreshold
    const state = loadClaimState(tmpDir);
    assert.strictEqual(state['coder'].claimCount, 2);
  });

  it('resets claimCount when progress is made', () => {
    recordClaim(tmpDir, 'coder', 'BL-528', 1, config);
    recordClaim(tmpDir, 'coder', 'BL-528', 1, config); // idle reclaim
    const action = recordClaim(tmpDir, 'coder', 'BL-528', 2, config); // progress made
    assert.strictEqual(action, 'ok');
    const state = loadClaimState(tmpDir);
    assert.strictEqual(state['coder'].claimCount, 1);
  });
});
