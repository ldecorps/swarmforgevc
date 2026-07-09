const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { isBounceType, parseBounceFile, processBounceFile, startBounceWatcher } = require('../out/swarm/bounceWatcher');

function waitUntil(predicate, timeoutMs = 2000, intervalMs = 10) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('waitUntil timed out'));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
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

test('startBounceWatcher detects a bounce file written after watching starts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'), { recursive: true });

  const bounces = [];
  const watcher = startBounceWatcher(tmpDir, (type) => bounces.push(type));
  assert.ok(watcher);
  try {
    fs.writeFileSync(path.join(tmpDir, '.swarmforge', 'bounce'), 'swarm\n');
    await waitUntil(() => bounces.length > 0);
    assert.deepEqual(bounces, ['swarm']);
    assert.equal(fs.existsSync(path.join(tmpDir, '.swarmforge', 'bounce')), false);
  } finally {
    watcher.close();
  }
});

test('startBounceWatcher ignores filesystem events for unrelated files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'), { recursive: true });

  const bounces = [];
  const watcher = startBounceWatcher(tmpDir, (type) => bounces.push(type));
  try {
    fs.writeFileSync(path.join(tmpDir, '.swarmforge', 'not-bounce.txt'), 'swarm\n');
    // give the watcher a chance to (incorrectly) react before asserting it didn't
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(bounces, []);
  } finally {
    watcher.close();
  }
});

test('startBounceWatcher ignores an unrelated file even when a real bounce file is already sitting on disk', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  // Written BEFORE the watcher starts, so its own creation never fires a
  // watch event - only the later unrelated-file write below does. If the
  // `filename !== 'bounce'` guard were ever bypassed, that unrelated event
  // would still find this pre-existing bounce file on its delayed
  // existsSync check and wrongly consume it.
  fs.writeFileSync(path.join(swarmforgeDir, 'bounce'), 'swarm\n');

  const bounces = [];
  const watcher = startBounceWatcher(tmpDir, (type) => bounces.push(type));
  try {
    fs.writeFileSync(path.join(swarmforgeDir, 'not-bounce.txt'), 'swarm\n');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(bounces, []);
    assert.equal(fs.existsSync(path.join(swarmforgeDir, 'bounce')), true, 'the untouched bounce file must not be consumed by an unrelated event');
  } finally {
    watcher.close();
  }
});

test('startBounceWatcher does not process a bounce file that is gone by the time its delayed check runs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });

  const errors = [];
  const watcher = startBounceWatcher(
    tmpDir,
    () => {},
    (err) => errors.push(err)
  );
  try {
    const bounceFilePath = path.join(swarmforgeDir, 'bounce');
    // The watch event fires for this create, but the file is gone again
    // (synchronously, well before the watcher's own 50ms settle delay)
    // by the time the delayed existsSync check runs.
    fs.writeFileSync(bounceFilePath, 'swarm\n');
    fs.unlinkSync(bounceFilePath);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(errors, [], 'a bounce file gone before the delayed check must be skipped, not treated as a read error');
  } finally {
    watcher.close();
  }
});

test('startBounceWatcher reports invalid bounce file content via onError', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bouncewatch-'));
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'), { recursive: true });

  const errors = [];
  const watcher = startBounceWatcher(
    tmpDir,
    () => {},
    (err) => errors.push(err)
  );
  try {
    fs.writeFileSync(path.join(tmpDir, '.swarmforge', 'bounce'), 'garbage\n');
    await waitUntil(() => errors.length > 0);
    assert.match(errors[0], /Unknown bounce type/);
  } finally {
    watcher.close();
  }
});
