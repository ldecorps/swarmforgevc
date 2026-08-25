'use strict';

// BL-1014: step handlers for "The Boy Scout scan ranks technical debt by what
// it keeps costing".
//
// Every scenario drives the REAL scan from extension/out/tools/boyScoutScan -
// the same functions the CLI calls - with the five source readers injected.
// Injection is what makes scenario 02 testable at all: this repository cannot
// be made to carry exactly one kind of debt signal on demand, and scenario 06
// needs a repository with NONE, which the live tree will never be.
//
// The readers are the only IO the scan has, so injecting them exercises
// everything above them unchanged, including the ranking and the report.
//
// Scenario 05 asserts read-only against a real temp tree rather than against
// the live repository: a scan that DID write would otherwise damage the
// checkout it was being tested in.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'The Boy Scout scan ranks technical debt by what it keeps costing';

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  EVIDENCE_SOURCES,
  scan,
  renderReport,
  mergeBySubject,
  rankInventory,
} = require(path.join(EXT_DIR, 'out', 'tools', 'boyScoutScan'));

// Explicit known values per the Scenario Outline handler rule: the closed set
// of source names scenario 02 iterates. A row the handlers do not know is a
// hard failure, never a passthrough that would assert nothing.
const KNOWN_SOURCES = new Set(EVIDENCE_SOURCES);

// An empty reader set - each scenario turns on exactly the signals it needs.
function emptyReaders() {
  return {
    hardeningLedger: () => [],
    bounceLines: () => [],
    crapReport: () => '',
    duplicationReport: () => '',
    countedPaths: () => [],
  };
}

// Turn on ONE source, with a signal whose subject is `subject`.
function withSignal(readers, source, subject) {
  switch (source) {
    case 'deferred-hardening-gate':
      readers.hardeningLedger = () => [
        { parcel: 'BL-620', gate: 'mutation', file_set: [subject], detected_at: '2026-08-19' },
      ];
      break;
    case 'bounce-recurrence':
      readers.bounceLines = () => [
        JSON.stringify({ ticket: 'BL-1', producingRole: 'coder', failureClass: 'wiring' }),
      ];
      break;
    case 'crap-over-threshold':
      readers.crapReport = () => `${subject}\tfn\tcomplexity=9\tcoverage=50%\tCRAP=18.00  *** CRAP > 6 ***`;
      break;
    case 'duplication':
      readers.duplicationReport = () => ` - ${subject} [10:1 - 40:1]\n   other.ts [80:1 - 110:1]\n`;
      break;
    case 'runtime-bloat':
      readers.countedPaths = () => [{ path: '.swarmforge/daemon', count: 797, threshold: 100 }];
      break;
    default:
      throw new Error(`unknown source ${source}`);
  }
  return readers;
}

function makeRoot(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1014acc-'));
  ctx.tempDirs.push(root);
  return root;
}

function cleanup(ctx) {
  for (const d of ctx.tempDirs || []) fs.rmSync(d, { recursive: true, force: true });
  ctx.tempDirs = [];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a Boy Scout scan over a repository$/, (ctx) => {
    ctx.tempDirs = [];
    ctx.readers = emptyReaders();
    ctx.synthetic = null;
  });

  scoped(/^a debt item "([^"]+)" attested by (\d+) evidence sources?$/, (ctx, name, n) => {
    // Scenario 01 is about the RANK KEY itself, so it builds evidence directly
    // rather than through the readers - the point is how many distinct sources
    // attest one subject, not which sources they happen to be.
    ctx.synthetic = ctx.synthetic || [];
    const count = Number(n);
    assert.ok(count >= 1 && count <= EVIDENCE_SOURCES.length,
      `${count} sources is outside the ${EVIDENCE_SOURCES.length} this scan has`);
    for (let i = 0; i < count; i++) {
      ctx.synthetic.push({
        subject: name,
        source: EVIDENCE_SOURCES[i],
        artifact: `artifact/${EVIDENCE_SOURCES[i]}`,
        detail: `${name} attested by ${EVIDENCE_SOURCES[i]}`,
      });
    }
  });

  scoped(/^the repository carries a debt signal of kind ([a-z-]+)$/, (ctx, source) => {
    assert.ok(KNOWN_SOURCES.has(source), `unknown source "${source}" - the scan declares ${[...KNOWN_SOURCES]}`);
    ctx.expectedSource = source;
    ctx.readers = withSignal(emptyReaders(), source, 'extension/src/a.ts');
  });

  scoped(/^the repository carries a deferred hardening gate for one file$/, (ctx) => {
    ctx.expectedSource = 'deferred-hardening-gate';
    ctx.subject = 'extension/src/tools/x.ts';
    ctx.readers = withSignal(emptyReaders(), 'deferred-hardening-gate', ctx.subject);
  });

  scoped(/^the repository carries no debt signal in any source$/, (ctx) => {
    ctx.readers = emptyReaders();
    // Every reader returns a real, readable, EMPTY result - which is "clean",
    // and deliberately not the same as a source that could not be read.
    ctx.readers.crapReport = () => 'src/a.ts\tfn\tcomplexity=1\tcoverage=100%\tCRAP=1.00';
    ctx.readers.duplicationReport = () => 'no clones found\n';
    ctx.readers.countedPaths = () => [{ path: '.swarmforge/daemon', count: 1, threshold: 100 }];
  });

  scoped(/^a fixed repository state$/, (ctx) => {
    ctx.readers = withSignal(emptyReaders(), 'crap-over-threshold', 'src/a.ts');
    ctx.readers.hardeningLedger = () => [
      { parcel: 'BL-620', gate: 'mutation', file_set: ['extension/src/a.ts', 'extension/src/b.ts'] },
    ];
    ctx.readers.countedPaths = () => [{ path: '.swarmforge/daemon', count: 797, threshold: 100 }];
  });

  scoped(/^the scan ranks the inventory$/, (ctx) => {
    if (ctx.synthetic) {
      ctx.result = { ranked: rankInventory(mergeBySubject(ctx.synthetic)), consulted: [] };
      return;
    }
    const root = makeRoot(ctx);
    try {
      ctx.result = scan(root, ctx.readers);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the scan runs twice$/, (ctx) => {
    const root = makeRoot(ctx);
    try {
      ctx.first = scan(root, ctx.readers);
      ctx.second = scan(root, ctx.readers);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the scan runs$/, (ctx) => {
    const root = makeRoot(ctx);
    try {
      // A real tree with real files, so "changed nothing" is a claim about
      // actual bytes on disk rather than about an empty directory.
      fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'a.log'), 'x');
      fs.writeFileSync(path.join(root, 'source.ts'), 'export const a = 1;\n');
      const snap = () =>
        fs.readdirSync(root, { recursive: true }).sort()
          .map((rel) => {
            const st = fs.statSync(path.join(root, String(rel)));
            return `${rel}:${st.isDirectory() ? 'd' : st.size}`;
          }).join('|');
      ctx.before = snap();
      ctx.result = scan(root, ctx.readers);
      ctx.after = snap();
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^"([^"]+)" ranks above "([^"]+)"$/, (ctx, higher, lower) => {
    const subjects = ctx.result.ranked.map((i) => i.subject);
    const hi = subjects.indexOf(higher);
    const lo = subjects.indexOf(lower);
    assert.ok(hi >= 0 && lo >= 0, `both items must be ranked; got ${subjects.join(', ')}`);
    assert.ok(hi < lo,
      `${higher} is attested more often and must outrank ${lower} - recurrence is the rank key; got ${subjects.join(', ')}`);
  });

  scoped(/^the inventory contains an item derived from ([a-z-]+)$/, (ctx, source) => {
    assert.ok(KNOWN_SOURCES.has(source), `unknown source "${source}"`);
    const found = ctx.result.ranked.some((i) => i.evidence.some((e) => e.source === source));
    assert.ok(found,
      `a repository carrying a ${source} signal must produce an item from it; consulted: ${JSON.stringify(ctx.result.consulted)}`);
  });

  scoped(/^that item names the evidence artifact it was derived from$/, (ctx) => {
    const item = ctx.result.ranked.find((i) => i.subject === ctx.subject);
    assert.ok(item, `expected an item for ${ctx.subject}; got ${ctx.result.ranked.map((i) => i.subject).join(', ')}`);
    ctx.artifact = item.evidence[0].artifact;
    assert.ok(ctx.artifact && ctx.artifact.length > 0, 'a rank with no artifact is a rank nobody can check');
    assert.ok(item.evidence[0].detail.includes('BL-620'), 'and the detail must locate the row inside it');
  });

  scoped(/^that artifact is readable without re-running the scan$/, (ctx) => {
    // The pointer must resolve to something a human can actually open.
    const abs = path.join(__dirname, '..', '..', '..', ctx.artifact);
    assert.ok(fs.existsSync(abs), `the evidence pointer must resolve on disk: ${ctx.artifact}`);
    assert.ok(fs.readFileSync(abs, 'utf8').includes('BL-620'),
      'and opening it must show the row the rank was derived from');
  });

  scoped(/^both runs produce an identical ranking$/, (ctx) => {
    assert.deepEqual(ctx.first.ranked, ctx.second.ranked,
      'the same repository state must produce the same ranking - no clock, no randomness in the rank key');
    assert.equal(renderReport(ctx.first), renderReport(ctx.second),
      'and the rendered report a human diffs must be identical too');
  });

  scoped(/^no file outside the report output has changed$/, (ctx) => {
    assert.equal(ctx.after, ctx.before,
      'the scan ranks and reports; anything that changes the repository is BL-1015');
  });

  scoped(/^the report names every source it consulted$/, (ctx) => {
    ctx.report = renderReport(ctx.result);
    for (const s of EVIDENCE_SOURCES) {
      assert.ok(ctx.report.includes(s),
        `a clean report must still name ${s} - an empty list reads the same whether there is no debt or the scan never looked`);
    }
  });

  scoped(/^the report states that each one was found clean$/, (ctx) => {
    for (const s of EVIDENCE_SOURCES) {
      const line = ctx.report.split('\n').find((l) => l.includes(s));
      assert.match(line, /clean/i,
        `${s} must be stated clean rather than merely listed; got: ${line}`);
    }
  });
}

module.exports = { registerSteps };
