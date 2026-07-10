const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  isBounceType,
  parseBounceFile,
  processBounceFile,
  startBounceWatcher,
  handleWatchEvent,
  closeBounceWatcher,
} = require('../out/swarm/bounceWatcher');

// BL-131: captures the debounce callback instead of scheduling it for real -
// fire() simulates the 50ms settle delay elapsing synchronously, with no
// real wall-clock wait anywhere (same pattern as chaserMonitor.test.js).
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

// --- isBounceType ---

test('isBounceType accepts "swarm", "extension", and "all"', () => {
  assert.equal(isBounceType('swarm'), true);
  assert.equal(isBounceType('extension'), true);
  assert.equal(isBounceType('all'), true);
});

test('isBounceType rejects an unknown value', () => {
  assert.equal(isBounceType('nope'), false);
});

// --- parseBounceFile ---

test('parseBounceFile parses "swarm" content', () => {
  const result = parseBounceFile('swarm');
  assert.equal(result.valid, true);
  assert.equal(result.bounceType, 'swarm');
});

test('parseBounceFile parses "extension" content', () => {
  const result = parseBounceFile('extension');
  assert.equal(result.valid, true);
  assert.equal(result.bounceType, 'extension');
});

test('parseBounceFile parses "all" content', () => {
  const result = parseBounceFile('all');
  assert.equal(result.valid, true);
  assert.equal(result.bounceType, 'all');
});

test('parseBounceFile handles leading/trailing whitespace', () => {
  const result = parseBounceFile('  swarm\n');
  assert.equal(result.valid, true);
  assert.equal(result.bounceType, 'swarm');
});

test('parseBounceFile handles newline at end', () => {
  const result = parseBounceFile('extension\n');
  assert.equal(result.valid, true);
  assert.equal(result.bounceType, 'extension');
});

test('parseBounceFile rejects unknown content', () => {
  const result = parseBounceFile('unknown');
  assert.equal(result.valid, false);
  assert.ok(result.error);
  assert.ok(result.error.includes('Unknown bounce type'));
});

test('parseBounceFile rejects empty content', () => {
  const result = parseBounceFile('');
  assert.equal(result.valid, false);
});

test('parseBounceFile rejects whitespace-only content', () => {
  const result = parseBounceFile('  \n  ');
  assert.equal(result.valid, false);
});

// --- processBounceFile ---

test('processBounceFile reads and deletes valid swarm file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-'));
  const bounceFile = path.join(tmpDir, 'bounce');
  fs.writeFileSync(bounceFile, 'swarm\n');

  let detected = null;
  processBounceFile(bounceFile, (bounceType) => {
    detected = bounceType;
  });

  assert.equal(detected, 'swarm');
  assert.equal(fs.existsSync(bounceFile), false);
});

test('processBounceFile reads and deletes valid extension file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-'));
  const bounceFile = path.join(tmpDir, 'bounce');
  fs.writeFileSync(bounceFile, 'extension\n');

  let detected = null;
  processBounceFile(bounceFile, (bounceType) => {
    detected = bounceType;
  });

  assert.equal(detected, 'extension');
  assert.equal(fs.existsSync(bounceFile), false);
});

test('processBounceFile reads and deletes valid all file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-'));
  const bounceFile = path.join(tmpDir, 'bounce');
  fs.writeFileSync(bounceFile, 'all\n');

  let detected = null;
  processBounceFile(bounceFile, (bounceType) => {
    detected = bounceType;
  });

  assert.equal(detected, 'all');
  assert.equal(fs.existsSync(bounceFile), false);
});

test('processBounceFile handles invalid content and deletes file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-'));
  const bounceFile = path.join(tmpDir, 'bounce');
  fs.writeFileSync(bounceFile, 'invalid\n');

  let errorMessage = null;
  let bounceDetected = false;
  processBounceFile(
    bounceFile,
    () => {
      bounceDetected = true;
    },
    (error) => {
      errorMessage = error;
    }
  );

  assert.equal(bounceDetected, false);
  assert.ok(errorMessage);
  assert.equal(fs.existsSync(bounceFile), false);
});

test('processBounceFile reports file read errors', () => {
  const nonexistent = '/nonexistent/path/bounce';
  let errorMessage = null;

  processBounceFile(
    nonexistent,
    () => {},
    (error) => {
      errorMessage = error;
    }
  );

  assert.ok(errorMessage);
  assert.ok(errorMessage.includes('Failed to process bounce file'));
});

test('processBounceFile with whitespace content reports error', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-'));
  const bounceFile = path.join(tmpDir, 'bounce');
  fs.writeFileSync(bounceFile, '   \n');

  let errorMessage = null;
  processBounceFile(
    bounceFile,
    () => {},
    (error) => {
      errorMessage = error;
    }
  );

  assert.ok(errorMessage);
  assert.equal(fs.existsSync(bounceFile), false);
});

test('processBounceFile with invalid content and no onError does not throw', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-'));
  const bounceFile = path.join(tmpDir, 'bounce');
  fs.writeFileSync(bounceFile, 'invalid\n');

  assert.doesNotThrow(() => processBounceFile(bounceFile, () => {}));
  assert.equal(fs.existsSync(bounceFile), false);
});

test('processBounceFile with a read error and no onError does not throw', () => {
  assert.doesNotThrow(() => processBounceFile('/nonexistent/path/bounce', () => {}));
});

// --- startBounceWatcher ---

test('BL-204: startBounceWatcher returns null and creates nothing when .swarmforge is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  const bounces = [];
  const watcher = startBounceWatcher(tmpDir, (type) => bounces.push(type));
  assert.equal(watcher, null, '.swarmforge is created by the launcher, not the watcher - no swarm dir means no watcher');
  assert.equal(fs.existsSync(path.join(tmpDir, '.swarmforge')), false);
});

// BL-131: the only piece of this that is genuinely OS-async is fs.watch's
// own event delivery, which can't be faked without replacing fs.watch
// itself - so this test awaits a promise that an injected scheduleTick
// resolves the instant the real watch event arrives (event-driven, not a
// real-clock wait), then fires the debounce synchronously. Every other
// startBounceWatcher scenario below now drives handleWatchEvent directly
// and needs no real fs.watch event or real wait at all.
test('startBounceWatcher wires real fs.watch events into the debounce', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'), { recursive: true });

  const bounces = [];
  let capturedTick = null;
  let resolveCaptured;
  const captured = new Promise((resolve) => {
    resolveCaptured = resolve;
  });
  const scheduleTick = (fn) => {
    capturedTick = fn;
    resolveCaptured();
  };

  const watcher = startBounceWatcher(tmpDir, (type) => bounces.push(type), undefined, scheduleTick);
  assert.ok(watcher);
  try {
    fs.writeFileSync(path.join(tmpDir, '.swarmforge', 'bounce'), 'swarm\n');
    await captured;
    capturedTick(); // simulate the 50ms settle delay elapsing, synchronously
    assert.deepEqual(bounces, ['swarm']);
    assert.equal(fs.existsSync(path.join(tmpDir, '.swarmforge', 'bounce')), false);
  } finally {
    watcher.close();
  }
});

test('handleWatchEvent ignores events for unrelated files', () => {
  const bounces = [];
  const { scheduleTick, fire } = fakeScheduler();
  handleWatchEvent('not-bounce.txt', '/irrelevant/bounce', (type) => bounces.push(type), undefined, scheduleTick);
  fire();
  assert.deepEqual(bounces, [], 'no debounce should even be scheduled for an unrelated filename');
});

test('handleWatchEvent ignores an unrelated file even when a real bounce file is already sitting on disk', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  // Present BEFORE the event, so an untouched pre-existing bounce file
  // would wrongly be consumed if the `filename !== 'bounce'` guard were
  // ever bypassed for this unrelated-file event.
  const bounceFilePath = path.join(swarmforgeDir, 'bounce');
  fs.writeFileSync(bounceFilePath, 'swarm\n');

  const bounces = [];
  const { scheduleTick, fire } = fakeScheduler();
  handleWatchEvent('not-bounce.txt', bounceFilePath, (type) => bounces.push(type), undefined, scheduleTick);
  fire();
  assert.deepEqual(bounces, []);
  assert.equal(fs.existsSync(bounceFilePath), true, 'the untouched bounce file must not be consumed by an unrelated event');
});

test('handleWatchEvent does not process a bounce file that is gone by the time its delayed check runs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  const bounceFilePath = path.join(swarmforgeDir, 'bounce');

  const errors = [];
  const { scheduleTick, fire } = fakeScheduler();
  // The watch event fires for this create, but the file is gone again
  // (synchronously, well before the debounce's delayed check runs).
  fs.writeFileSync(bounceFilePath, 'swarm\n');
  fs.unlinkSync(bounceFilePath);
  handleWatchEvent('bounce', bounceFilePath, () => {}, (err) => errors.push(err), scheduleTick);
  fire();
  assert.deepEqual(errors, [], 'a bounce file gone before the delayed check must be skipped, not treated as a read error');
});

// --- BL-115: watcher error/close recovery ---

// BL-115 bounce-watch-04: a real watcher error must be surfaced through
// onWatcherLost so the caller can re-establish - emitted directly on the
// real fs.FSWatcher (an EventEmitter) rather than waiting on a genuine OS
// failure, since a watcher error is inherently not reproducible on demand.
test('BL-115 bounce-watch-04: a watcher error calls onWatcherLost, naming the error', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'), { recursive: true });

  const lostReasons = [];
  const watcher = startBounceWatcher(
    tmpDir,
    () => {},
    undefined,
    undefined,
    (reason) => lostReasons.push(reason)
  );
  try {
    watcher.emit('error', new Error('ENOSPC watch failure'));
    assert.equal(lostReasons.length, 1);
    assert.match(lostReasons[0], /ENOSPC watch failure/);
  } finally {
    closeBounceWatcher(watcher);
  }
});

// BL-115 bounce-watch-04: an unexpected close (not routed through
// closeBounceWatcher) must also call onWatcherLost - e.g. the underlying
// platform watch tearing itself down when .swarmforge/ is removed.
test('BL-115 bounce-watch-04: an unexpected close calls onWatcherLost', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'), { recursive: true });

  const lostReasons = [];
  const watcher = startBounceWatcher(
    tmpDir,
    () => {},
    undefined,
    undefined,
    (reason) => lostReasons.push(reason)
  );
  const closed = new Promise((resolve) => watcher.once('close', resolve));
  watcher.close(); // NOT via closeBounceWatcher - simulates an unexpected close
  await closed;
  assert.equal(lostReasons.length, 1);
  assert.match(lostReasons[0], /unexpectedly/);
});

// BL-115: closeBounceWatcher marks the close as intentional first - a
// deliberate teardown (target switch, deactivation, a bounce replacing the
// watcher) must NEVER be mistaken for a lost watcher and re-trigger a
// redundant re-establish.
test('BL-115: closeBounceWatcher does not call onWatcherLost for a deliberate close', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'), { recursive: true });

  const lostReasons = [];
  const watcher = startBounceWatcher(
    tmpDir,
    () => {},
    undefined,
    undefined,
    (reason) => lostReasons.push(reason)
  );
  const closed = new Promise((resolve) => watcher.once('close', resolve));
  closeBounceWatcher(watcher);
  await closed;
  assert.deepEqual(lostReasons, []);
});

test('closeBounceWatcher is a no-op for null/undefined', () => {
  assert.doesNotThrow(() => closeBounceWatcher(null));
  assert.doesNotThrow(() => closeBounceWatcher(undefined));
});

test('handleWatchEvent reports invalid bounce file content via onError', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  const bounceFilePath = path.join(swarmforgeDir, 'bounce');
  fs.writeFileSync(bounceFilePath, 'garbage\n');

  const errors = [];
  const { scheduleTick, fire } = fakeScheduler();
  handleWatchEvent('bounce', bounceFilePath, () => {}, (err) => errors.push(err), scheduleTick);
  fire();
  assert.match(errors[0], /Unknown bounce type/);
});
