const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-1261 invariants (declared in the ticket YAML):
// 1. "The audit reports only. No path in it moves, promotes, or deletes a ticket
//    in any pool, or removes a parcel from any mailbox."
// 2. "The audit fails closed: a mailbox or backlog directory it cannot read is
//    reported as unresolved, never silently omitted from the report."
// 3. "Parcel discovery reaches every place a parcel can sit, including one level
//    of batch_* subdirectory..."
//
// Authored by the coder per BL-654. Drives the REAL hold_divergence_audit_cli.bb
// CLI via execFileSync (never a JS reimplementation). Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const AUDIT_CLI = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'hold_divergence_audit_cli.bb'
);

function runAudit(root) {
  try {
    const result = execFileSync('bb', [AUDIT_CLI, root], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { status: 0, output: result };
  } catch (err) {
    return {
      status: err.status,
      output: `${err.stdout || ''}${err.stderr || ''}`,
    };
  }
}

const POOLS = ['active', 'paused', 'hold', 'done'];
const ROLES = ['coder', 'cleaner', 'architect', 'hardener', 'documenter', 'QA'];
const SUBDIRS = ['new', 'in_process'];

function makeFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl1261-prop-'));
}

function setupPools(root) {
  for (const pool of POOLS) {
    fs.mkdirSync(path.join(root, 'backlog', pool), { recursive: true });
  }
}

function setupMailboxes(root) {
  for (const role of ROLES) {
    for (const sub of SUBDIRS) {
      fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', role, 'inbox', sub), {
        recursive: true,
      });
    }
  }
}

function writeTicket(root, pool, id) {
  const full = path.join(root, 'backlog', pool, `${id}.yaml`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, [`id: ${id}`, 'title: "prop-test"', 'status: todo', ''].join('\n'));
  return full;
}

function writeParcel(root, role, subdir, id, filename) {
  const dir = path.join(root, '.swarmforge', 'handoffs', role, 'inbox', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, filename);
  fs.writeFileSync(full, [`type: git_handoff`, `task: ${id}-task`, ''].join('\n'));
  return full;
}

function writeBatchParcel(root, role, subdir, batchDir, id, filename) {
  const dir = path.join(root, '.swarmforge', 'handoffs', role, 'inbox', subdir, batchDir);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, filename);
  fs.writeFileSync(full, [`type: git_handoff`, `task: ${id}-task`, ''].join('\n'));
  return full;
}

function snapshotFiles(root) {
  const entries = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) {
        walk(full);
      } else {
        entries.set(full, fs.readFileSync(full));
      }
    }
  };
  walk(path.join(root, 'backlog'));
  walk(path.join(root, '.swarmforge'));
  return entries;
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// Arbitrary generators
const poolArb = fc.constantFrom(...POOLS);
const roleArb = fc.constantFrom(...ROLES);
const subdirArb = fc.constantFrom(...SUBDIRS);
const batchIndexArb = fc.integer({ min: 1, max: 999 });
const ticketIdArb = fc.integer({ min: 1000, max: 9999 }).map((n) => `BL-${n}`);

// ──────────────────────────────────────────────────────────────────────
// Invariant 1: Report only. Running the audit never modifies the filesystem.
// ──────────────────────────────────────────────────────────────────────
test('property invariant 1: the audit reports only and never modifies state', () => {
  fc.assert(
    fc.property(
      poolArb,
      roleArb,
      subdirArb,
      ticketIdArb,
      (pool, role, subdir, ticketId) => {
        const root = makeFixtureRoot();
        try {
          setupPools(root);
          setupMailboxes(root);
          writeTicket(root, pool, ticketId);
          writeParcel(root, role, subdir, ticketId, 'prop.handoff');

          const before = snapshotFiles(root);
          runAudit(root);
          const after = snapshotFiles(root);

          // Every file present before must still be present with the same content
          for (const [filePath, content] of before) {
            assert.ok(after.has(filePath), `file must still exist after audit: ${filePath}`);
            assert.deepEqual(
              after.get(filePath),
              content,
              `file content must not change after audit: ${filePath}`
            );
          }
          // No new files may be created
          for (const filePath of after.keys()) {
            assert.ok(before.has(filePath), `audit must not create new files: ${filePath}`);
          }
        } finally {
          rmrf(root);
        }
      }
    ),
    { numRuns: 50 }
  );
});

// ──────────────────────────────────────────────────────────────────────
// Invariant 2: Fail closed. An unreadable mailbox is reported as UNRESOLVED,
// never silently omitted.
// ──────────────────────────────────────────────────────────────────────
test('property invariant 2: an unreadable mailbox is always reported as unresolved', () => {
  fc.assert(
    fc.property(roleArb, subdirArb, ticketIdArb, (role, subdir, ticketId) => {
      const root = makeFixtureRoot();
      try {
        setupPools(root);
        setupMailboxes(root);
        writeTicket(root, 'hold', ticketId);

        // Make one mailbox unreadable
        const unreadableDir = path.join(
          root,
          '.swarmforge',
          'handoffs',
          role,
          'inbox',
          subdir
        );
        fs.chmodSync(unreadableDir, 0o000);

        const result = runAudit(root);

        // The report must name UNRESOLVED — never CLEAN when a mailbox is unreadable
        assert.match(result.output, /UNRESOLVED/);
        assert.doesNotMatch(result.output, /CLEAN/);
      } finally {
        // Restore permissions so cleanup works
        try {
          fs.chmodSync(
            path.join(root, '.swarmforge', 'handoffs', role, 'inbox', subdir),
            0o755
          );
        } catch {
          // ignore
        }
        rmrf(root);
      }
    }),
    { numRuns: 50 }
  );
});

// ──────────────────────────────────────────────────────────────────────
// Invariant 3: Parcel discovery reaches every place a parcel can sit,
// including one level of batch_* subdirectory.
// ──────────────────────────────────────────────────────────────────────
test('property invariant 3: parcels in any valid location are discovered', () => {
  // Test every combination of (role, subdir, batch-or-no-batch) for a held ticket
  const locationArb = fc.record({
    role: roleArb,
    subdir: subdirArb,
    batched: fc.boolean(),
    batchIndex: batchIndexArb,
  });

  fc.assert(
    fc.property(locationArb, ticketIdArb, (loc, ticketId) => {
      const root = makeFixtureRoot();
      try {
        setupPools(root);
        setupMailboxes(root);
        writeTicket(root, 'hold', ticketId);

        let parcelPath;
        if (loc.batched) {
          const batchDir = `batch_${String(loc.batchIndex).padStart(3, '0')}`;
          parcelPath = writeBatchParcel(
            root,
            loc.role,
            loc.subdir,
            batchDir,
            ticketId,
            'prop.handoff'
          );
        } else {
          parcelPath = writeParcel(
            root,
            loc.role,
            loc.subdir,
            ticketId,
            'prop.handoff'
          );
        }

        const result = runAudit(root);

        // The audit must report this as a divergence
        assert.match(result.output, /DIVERGENCE/);
        assert.match(result.output, new RegExp(ticketId));
        // And the parcel must still exist (invariant 1 also covers this, but let's be explicit)
        assert.ok(fs.existsSync(parcelPath), 'parcel must still exist after audit');
      } finally {
        rmrf(root);
      }
    }),
    { numRuns: 50 }
  );
});
