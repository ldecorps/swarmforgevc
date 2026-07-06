const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { startBounceWatcher } = require('../out/swarm/bounceWatcher');

// Test for startBounceWatcher with .swarmforge directory
test('startBounceWatcher creates watcher when .swarmforge exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-watcher-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir);

  let bounceDetected = null;
  const watcher = startBounceWatcher(
    tmpDir,
    (bounceType) => {
      bounceDetected = bounceType;
    }
  );

  assert.ok(watcher !== null);
  watcher.close();

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });
});

test('startBounceWatcher returns null when .swarmforge does not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-watcher-'));

  const watcher = startBounceWatcher(
    tmpDir,
    () => {}
  );

  assert.equal(watcher, null);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });
});

test('startBounceWatcher detects bounce file creation', () => new Promise((resolve, reject) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-watcher-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir);

  let bounceDetected = null;
  const watcher = startBounceWatcher(
    tmpDir,
    (bounceType) => {
      bounceDetected = bounceType;
    }
  );

  // Create bounce file after a short delay
  setTimeout(() => {
    const bounceFile = path.join(swarmforgeDir, 'bounce');
    fs.writeFileSync(bounceFile, 'swarm\n');

    // Wait for watcher to process the file
    setTimeout(() => {
      let err = null;
      try { assert.equal(bounceDetected, 'swarm'); } catch (e) { err = e; }
      watcher.close();

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true });
      err ? reject(err) : resolve();
    }, 200);
  }, 100);
}));

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
