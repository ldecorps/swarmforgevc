const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { startBounceWatcher, handleWatchEvent } = require('../out/swarm/bounceWatcher');

// BL-131: captures the debounce callback instead of scheduling it for real -
// fire() simulates the 50ms settle delay elapsing synchronously.
function fakeScheduler() {
  let tick = null;
  return {
    scheduleTick: (fn) => {
      tick = fn;
    },
    fire: () => {
      if (tick) {
        tick();
      }
    },
  };
}

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

// BL-131: fs.watch's own event delivery is the only genuinely OS-async part
// here - it can't be faked without replacing fs.watch itself, so this awaits
// a promise that an injected scheduleTick resolves the instant the real
// watch event arrives (event-driven, not a real-clock wait), then fires the
// debounce synchronously. No fixed-ms setTimeout anywhere.
test('startBounceWatcher detects bounce file creation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-watcher-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir);

  let bounceDetected = null;
  let capturedTick = null;
  let resolveCaptured;
  const captured = new Promise((resolve) => {
    resolveCaptured = resolve;
  });
  const scheduleTick = (fn) => {
    capturedTick = fn;
    resolveCaptured();
  };
  const watcher = startBounceWatcher(
    tmpDir,
    (bounceType) => {
      bounceDetected = bounceType;
    },
    undefined,
    scheduleTick
  );

  const bounceFile = path.join(swarmforgeDir, 'bounce');
  fs.writeFileSync(bounceFile, 'swarm\n');
  await captured;
  capturedTick();
  assert.equal(bounceDetected, 'swarm');
  watcher.close();

  fs.rmSync(tmpDir, { recursive: true });
});

// BL-131: no real fs.watch event needed at all - the guard that ignores
// non-bounce filenames is exercised directly, synchronously.
test('handleWatchEvent ignores non-bounce file changes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-watcher-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir);
  const bounceFilePath = path.join(swarmforgeDir, 'bounce');

  let bounceDetected = false;
  const { scheduleTick, fire } = fakeScheduler();
  handleWatchEvent('other-file', bounceFilePath, () => {
    bounceDetected = true;
  }, undefined, scheduleTick);
  fire();
  assert.equal(bounceDetected, false);

  fs.rmSync(tmpDir, { recursive: true });
});
