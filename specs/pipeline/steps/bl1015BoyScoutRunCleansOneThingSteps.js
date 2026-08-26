'use strict';

// BL-1015: step handlers for "A Boy Scout run cleans one thing, or says why it
// cleaned nothing".
//
// Every scenario drives the REAL run from extension/out/tools/boyScoutRun -
// the same function the CLI calls - and the ranked inventory the Background
// speaks of is produced by the REAL BL-1014 scan, with only its five source
// readers injected (the same seam bl1014BoyScoutScanRanksDebtSteps.js uses).
// That is deliberate: BL-1015's required_wiring says the run must consume
// BL-1014's ranking rather than re-deriving one of its own, and a handler that
// handed the run a hand-built array would prove nothing about that.
//
// The tree is an in-memory map rather than a real checkout, because these
// scenarios need a run that WRITES and then must be shown not to have written
// - and the only tree available to a step handler is the checkout it is being
// tested in. Every side effect the run is allowed to have (read, write, gate,
// commit) goes through the injected environment, so "the working tree is
// unchanged" is a claim about every byte the run could have touched.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE = 'A Boy Scout run cleans one thing, or says why it cleaned nothing';

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { scan } = require(path.join(EXT_DIR, 'out', 'tools', 'boyScoutScan'));
const {
  SIZE_ENVELOPE,
  NO_CLEAN_REASONS,
  assertionLines,
  boyScoutRun,
  renderRunReport,
} = require(path.join(EXT_DIR, 'out', 'tools', 'boyScoutRun'));

// The three subjects the seeded sources attest, most-recurrent first. Written
// the way each source actually prints paths - the ledger repo-relative, jscpd
// and crapReport.js relative to extension/ - so the scan's own subject
// normalization is exercised rather than side-stepped.
const TOP = 'extension/src/tools/alpha.ts';
const SECOND = 'extension/src/tools/beta.ts';
const THIRD = 'extension/src/tools/gamma.ts';
const SEEDED_TEST = 'extension/test/alpha.test.js';

// Explicit known values per the Scenario Outline handler rule. Scenario 02's
// table is the closed set below; a row these handlers do not know is a hard
// failure, never a passthrough that would assert nothing. Changing any cell in
// the feature file - including flipping an outcome - makes its row unknown.
const KNOWN_ENVELOPE_ROWS = [
  { files: 1, lines: 40, outcome: 'cleaned' },
  { files: 3, lines: 120, outcome: 'cleaned' },
  { files: 4, lines: 40, outcome: 'refused' },
  { files: 1, lines: 400, outcome: 'refused' },
];
const KNOWN_OUTCOMES = new Set(['cleaned', 'refused']);

function body(n, prefix) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n');
}

function seedTree() {
  const tree = new Map();
  for (const subject of [TOP, SECOND, THIRD]) {
    tree.set(subject, `${body(12, 'line')}\n`);
  }
  tree.set(
    SEEDED_TEST,
    ["test('alpha', () => {", '  assert.equal(clean(1), 1);', '  assert.ok(clean(2));', '});', ''].join('\n')
  );
  return tree;
}

// The five source readers, seeded so the ranking is alpha (3 sources) > beta
// (2) > gamma (2, behind beta on the scan's own alphabetical tie-break).
// Nothing here bypasses the scan: these are the same injected readers BL-1014
// exposes, and the ranking below is the scan's. The clone's second end is
// gamma rather than some fourth file because a clone implicates BOTH ends -
// naming an unseeded file there would put a fourth subject in the ranking
// that no scenario has a tree entry for.
function seedReaders() {
  return {
    hardeningLedger: () => [
      { parcel: 'BL-620', gate: 'mutation', file_set: [TOP, SECOND, THIRD], detected_at: '2026-08-19' },
    ],
    bounceLines: () => [],
    crapReport: () =>
      [
        'src/tools/alpha.ts\tcleanUp\tcomplexity=9\tcoverage=50%\tCRAP=18.00  *** CRAP > 6 ***',
        'src/tools/beta.ts\tcleanUp\tcomplexity=8\tcoverage=50%\tCRAP=16.00  *** CRAP > 6 ***',
      ].join('\n'),
    duplicationReport: () => ' - src/tools/alpha.ts [10:1 - 40:1]\n   src/tools/gamma.ts [80:1 - 110:1]\n',
    // A counted path UNDER its threshold: read, readable, and clean - which is
    // deliberately not the same as a source that could not be read.
    countedPaths: () => [{ path: '.swarmforge/daemon', count: 3, threshold: 100 }],
  };
}

// Exactly `files` changed files totalling exactly `lines` changed lines. Each
// file is CREATED by the cleanup, so its changed-line count is its whole body
// and the fixture's declared size is the size the run measures.
function sizedEdits(files, lines) {
  const edits = [];
  const per = Math.ceil(lines / files);
  let remaining = lines;
  for (let i = 0; i < files; i++) {
    const take = Math.min(per, remaining);
    remaining -= take;
    edits.push({ path: `extension/src/tools/extracted${i}.ts`, after: body(take, 'extracted') });
  }
  return edits;
}

function buildEnv(ctx) {
  return {
    scanRepository: (root) => scan(root, ctx.readers),
    propose: () => ctx.proposal,
    readFile: (_root, p) => (ctx.tree.has(p) ? ctx.tree.get(p) : null),
    writeFile: (_root, p, content) => {
      if (content === null) ctx.tree.delete(p);
      else ctx.tree.set(p, content);
    },
    runGates: () => {
      ctx.gateRuns += 1;
      return ctx.gatePasses
        ? { passed: true, ran: ['unit'], failed: [] }
        : { passed: false, ran: ['unit'], failed: ['unit'] };
    },
    commit: (_root, message) => {
      ctx.commits.push(message);
    },
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ranked debt inventory from a Boy Scout scan$/, (ctx) => {
    ctx.tree = seedTree();
    ctx.before = new Map(ctx.tree);
    ctx.readers = seedReaders();
    ctx.proposal = null;
    ctx.gatePasses = true;
    ctx.gateRuns = 0;
    ctx.commits = [];
    // The ranking the run will consume, read from the scan itself so the
    // expectations below are anchored to what the scan actually produced.
    ctx.ranked = scan('/fixture-root', ctx.readers).ranked;
    assert.deepEqual(
      ctx.ranked.map((i) => i.subject),
      [TOP, SECOND, THIRD],
      'the seeded sources must rank alpha above beta above gamma for these scenarios to mean anything'
    );
  });

  scoped(/^the top-ranked item fits the size envelope$/, (ctx) => {
    // A small edit to the item's OWN file - the shape scenario 01 is about.
    ctx.proposal = {
      subject: TOP,
      summary: 'extract the duplicated block',
      edits: [{ path: TOP, after: ctx.tree.get(TOP).replace('line3', 'tidied') }],
    };
  });

  scoped(/^the top-ranked item would change (\d+) files and (\d+) lines$/, (ctx, files, lines) => {
    const row = KNOWN_ENVELOPE_ROWS.find((r) => r.files === Number(files) && r.lines === Number(lines));
    assert.ok(
      row,
      `unknown Examples row ${files} files / ${lines} lines - this handler validates against the declared ` +
        `table ${JSON.stringify(KNOWN_ENVELOPE_ROWS)}, never a passthrough`
    );
    ctx.expectedRow = row;
    ctx.proposal = { subject: TOP, summary: 'a cleanup of a declared size', edits: sizedEdits(row.files, row.lines) };
  });

  scoped(/^the top-ranked item exceeds the size envelope$/, (ctx) => {
    ctx.proposal = {
      subject: TOP,
      summary: 'a cleanup too big for one sitting',
      edits: sizedEdits(SIZE_ENVELOPE.files + 1, 40),
    };
  });

  scoped(/^the top-ranked item cannot be cleaned without changing an existing test assertion$/, (ctx) => {
    // Derived from the seeded test file's OWN content: a real assertion line
    // is taken out of it and reworded. A hand-written `after` would collide
    // with a real assertion only by coincidence.
    const before = ctx.tree.get(SEEDED_TEST);
    const existing = assertionLines(before);
    assert.ok(existing.length > 0, 'the seeded test file must actually carry assertions');
    ctx.assertionTarget = existing[0];
    ctx.proposal = {
      subject: TOP,
      summary: 'rename clean() to tidy()',
      edits: [
        { path: TOP, after: ctx.tree.get(TOP).replace('line3', 'tidied') },
        { path: SEEDED_TEST, after: before.replace(ctx.assertionTarget, ctx.assertionTarget.replace('clean(', 'tidy(')) },
      ],
    };
  });

  scoped(/^the repository gate set fails on the cleaned result$/, (ctx) => {
    ctx.gatePasses = false;
  });

  scoped(/^the ranked inventory is empty$/, (ctx) => {
    // Every reader real, readable and EMPTY - a clean repository, which is
    // deliberately not the same as a scan that could not look.
    ctx.readers = {
      hardeningLedger: () => [],
      bounceLines: () => [],
      crapReport: () => 'src/tools/alpha.ts\tfn\tcomplexity=1\tcoverage=100%\tCRAP=1.00',
      duplicationReport: () => 'no clones found\n',
      countedPaths: () => [{ path: '.swarmforge/daemon', count: 1, threshold: 100 }],
    };
    ctx.ranked = [];
  });

  scoped(/^the Boy Scout run executes$/, (ctx) => {
    ctx.result = boyScoutRun('/fixture-root', buildEnv(ctx));
    ctx.report = renderRunReport(ctx.result);
  });

  scoped(/^that item is cleaned$/, (ctx) => {
    assert.equal(ctx.result.outcome, 'cleaned', `expected a cleaned run; report was:\n${ctx.report}`);
    assert.equal(ctx.result.subject, TOP, 'the item cleaned is the TOP-ranked one');
    assert.ok(ctx.result.editedPaths.includes(TOP), 'and its own file is what changed');
    assert.notEqual(ctx.tree.get(TOP), ctx.before.get(TOP), 'the cleanup actually landed in the tree');
    assert.equal(ctx.result.committed, true, 'a cleaned run commits, having passed the gates first');
  });

  scoped(/^no other ranked item is touched$/, (ctx) => {
    for (const item of ctx.ranked.slice(1)) {
      assert.equal(
        ctx.tree.get(item.subject),
        ctx.before.get(item.subject),
        `${item.subject} is ranked below the top item and must be left exactly as it was`
      );
      assert.ok(!ctx.result.editedPaths.includes(item.subject), `${item.subject} must not appear in the run's edits`);
    }
  });

  scoped(/^the run outcome is ([a-z]+)$/, (ctx, outcome) => {
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome "${outcome}" - the declared set is ${[...KNOWN_OUTCOMES]}`);
    assert.equal(ctx.expectedRow.outcome, outcome, 'the Examples row and its outcome column must agree');
    assert.equal(
      ctx.result.outcome,
      outcome,
      `${ctx.expectedRow.files} file(s) / ${ctx.expectedRow.lines} line(s) against an envelope of ` +
        `${SIZE_ENVELOPE.files}/${SIZE_ENVELOPE.lines}; report was:\n${ctx.report}`
    );
    if (outcome === 'refused') {
      assert.deepEqual([...ctx.tree.keys()].sort(), [...ctx.before.keys()].sort(),
        'refused whole means never partially applied');
      assert.equal(ctx.commits.length, 0);
    }
  });

  scoped(/^the report names that item$/, (ctx) => {
    assert.ok(ctx.report.includes(TOP), `the report must name the refused item; got:\n${ctx.report}`);
  });

  scoped(/^the report names the envelope it exceeded$/, (ctx) => {
    assert.ok(ctx.result.exceeded.length > 0, 'the run must record which dimension blew');
    for (const dimension of ctx.result.exceeded) {
      assert.ok(ctx.report.includes(dimension), `the report must name the ${dimension} dimension`);
      assert.ok(
        ctx.report.includes(String(SIZE_ENVELOPE[dimension])),
        `and the declared ${dimension} limit of ${SIZE_ENVELOPE[dimension]}, so the reader can check it`
      );
    }
    assert.ok(
      ctx.report.includes(String(ctx.result.measured.files)),
      'along with the size the cleanup would actually have been'
    );
  });

  scoped(/^the cleanup is abandoned$/, (ctx) => {
    assert.equal(ctx.result.outcome, 'abandoned', `expected an abandoned run; report was:\n${ctx.report}`);
    for (const [relPath, content] of ctx.before) {
      assert.equal(ctx.tree.get(relPath), content, `${relPath} must be exactly as it was - abandoned, not half-applied`);
    }
  });

  scoped(/^the report states that the item needs its own ticket$/, (ctx) => {
    assert.match(ctx.report, /needs its own ticket/i, `got:\n${ctx.report}`);
    assert.ok(ctx.report.includes(SEEDED_TEST), 'and names the test it would have had to edit');
    assert.equal(
      ctx.tree.get(SEEDED_TEST),
      ctx.before.get(SEEDED_TEST),
      'the test itself is left untouched - that is the whole point of the guard'
    );
  });

  scoped(/^no cleanup is committed$/, (ctx) => {
    assert.deepEqual(ctx.commits, [], 'a cleanup that failed the gate set is never committed');
    assert.equal(ctx.result.committed, false);
    assert.ok(ctx.gateRuns > 0, 'and the gate set must actually have run on the cleaned result');
  });

  scoped(/^the report states why nothing was cleaned$/, (ctx) => {
    assert.notEqual(ctx.result.outcome, 'cleaned');
    assert.ok(
      NO_CLEAN_REASONS.includes(ctx.result.reason),
      `the reason must come from the declared set ${NO_CLEAN_REASONS.join(', ')}; got ${ctx.result.reason}`
    );
    assert.ok(
      ctx.report.includes(ctx.result.reason),
      `a quiet no-op is indistinguishable from a clean repository; got:\n${ctx.report}`
    );
    assert.match(ctx.report, /ranked no debt at all/, 'and says which reason applied in words, not just a code');
  });
}

module.exports = { registerSteps };
