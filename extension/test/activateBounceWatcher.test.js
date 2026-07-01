const assert = require('node:assert/strict');
const test = require('node:test');
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

test('startBounceWatcher detects bounce file creation', (t, done) => {
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
      assert.equal(bounceDetected, 'swarm');
      watcher.close();

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true });
      done();
    }, 200);
  }, 100);
});

test('startBounceWatcher ignores non-bounce file changes', (t, done) => {
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
      assert.equal(bounceDetected, false);
      watcher.close();

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true });
      done();
    }, 200);
  }, 100);
});
