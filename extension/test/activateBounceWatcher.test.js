const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { startBounceWatcher } = require('../out/swarm/bounceWatcher');

test('startBounceWatcher creates watcher and detects bounce files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-watcher-'));
  try {
    const swarmforgeDir = path.join(tmpDir, '.swarmforge');
    let bounceDetected = null;
    const watcher = startBounceWatcher(
      tmpDir,
      (bounceType) => {
        bounceDetected = bounceType;
      }
    );

    assert.ok(watcher);
    fs.writeFileSync(path.join(swarmforgeDir, 'bounce'), 'swarm\n');
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const check = () => {
        if (bounceDetected === 'swarm') {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error('waitUntil timed out'));
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
    watcher.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('startBounceWatcher ignores non-bounce file changes', () => new Promise((resolve, reject) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-watcher-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir);

  let bounceDetected = false;
  const watcher = startBounceWatcher(
    tmpDir,
    () => {
      bounceDetected = true;
    }
  );

  // Create a non-bounce file
  setTimeout(() => {
    const otherFile = path.join(swarmforgeDir, 'other-file');
    fs.writeFileSync(otherFile, 'content\n');

    // Wait a bit and verify bounce was not detected
    setTimeout(() => {
      let err = null;
      try { assert.equal(bounceDetected, false); } catch (e) { err = e; }
      watcher.close();

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true });
      err ? reject(err) : resolve();
    }, 200);
  }, 100);
}));
