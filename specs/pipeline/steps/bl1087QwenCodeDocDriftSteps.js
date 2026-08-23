'use strict';

// BL-1087: step handlers for "Documentation stops describing the withdrawn
// qwen-code seat". Inspects the real docs/ tree and the pure
// namedPackConfDrift checker (compiled under extension/out/docs/) — never a
// second reimplementation of the pack-conf drift rule.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  findAbsentNamedPackConfs,
  extractNamedPackConfs,
  isIllustrativePackPlaceholder,
} = require('../../../extension/out/docs/namedPackConfDrift');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const INDEX_PATH = path.join(DOCS_DIR, 'index.md');
const SPEC_PATH = path.join(DOCS_DIR, 'reference', 'Specification.MD');

const FEATURE = 'Documentation stops describing the withdrawn qwen-code seat';

const KNOWN_ARTIFACTS = Object.freeze({
  'swarmforge/packs/qwen-code-mono-router.conf': true,
  'test_qwen_code_seat.sh': true,
  'bl1052_qwen_code_seat_property_runner.bb': true,
  'bl1053_qwen_provider_routing_test_runner.bb': true,
});

const KNOWN_KEPT = Object.freeze({
  'swarmforge/packs/qwen-mono-router.conf': true,
  'start-swarm-qwen.sh': true,
});

function knownArtifact(label) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_ARTIFACTS, label)) {
    throw new Error(`bl1087: unrecognized <artifact> value "${label}"`);
  }
  return label;
}

function knownKept(label) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_KEPT, label)) {
    throw new Error(`bl1087: unrecognized <kept> value "${label}"`);
  }
  return label;
}

function walkMarkdownFiles(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMarkdownFiles(full, acc);
    else if (/\.(md|MD)$/.test(ent.name)) acc.push(full);
  }
  return acc;
}

function readAllDocSources() {
  return walkMarkdownFiles(DOCS_DIR).map((f) => ({
    relativePath: path.relative(REPO_ROOT, f).split(path.sep).join('/'),
    text: fs.readFileSync(f, 'utf8'),
  }));
}

function existingPackPaths() {
  const packsDir = path.join(REPO_ROOT, 'swarmforge', 'packs');
  return fs
    .readdirSync(packsDir)
    .filter((f) => f.endsWith('.conf'))
    .map((f) => `swarmforge/packs/${f}`);
}

function docsFilesMentioning(artifact) {
  return walkMarkdownFiles(DOCS_DIR).filter((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return text.includes(artifact);
  });
}

function extractShippedEntries(specText) {
  // Specification.MD entries are reverse-chronological prose blocks that
  // open with "BL-NNNN:". Slice each BL-1052 / BL-1053 block through the
  // next "Prior entry —" / "BL-" boundary.
  const entries = {};
  for (const id of ['BL-1052', 'BL-1053']) {
    const start = specText.indexOf(`${id}:`);
    assert.ok(start >= 0, `expected a shipped-work entry for ${id}`);
    const after = specText.slice(start + id.length);
    const next = after.search(/\nPrior entry —\nBL-|\nBL-\d+:/);
    entries[id] = next === -1 ? after : after.slice(0, next);
  }
  return entries;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the qwen-code mono-router seat has been removed from the tree$/, () => {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, 'swarmforge', 'packs', 'qwen-code-mono-router.conf')),
      false,
      'expected qwen-code-mono-router.conf to be absent'
    );
  });

  scoped(/^the tree is inspected$/, (ctx) => {
    ctx.treeRoot = REPO_ROOT;
  });

  scoped(/^"([^"]+)" is not present$/, (ctx, rel) => {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, rel)), false, `expected ${rel} absent`);
  });

  scoped(/^"([^"]+)" is present$/, (ctx, rel) => {
    const kept = knownKept(rel);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, kept)), true, `expected ${kept} present`);
  });

  scoped(/^the documentation index is inspected$/, (ctx) => {
    ctx.indexText = fs.readFileSync(INDEX_PATH, 'utf8');
  });

  scoped(/^it carries no link to "([^"]+)"$/, (ctx, link) => {
    assert.equal(
      ctx.indexText.includes(link),
      false,
      `docs/index.md still links to ${link}`
    );
  });

  scoped(/^"([^"]+)" is absent from the tree$/, (ctx, artifact) => {
    ctx.artifact = knownArtifact(artifact);
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, ctx.artifact)),
      false,
      `expected ${ctx.artifact} absent from the tree`
    );
  });

  scoped(/^the documentation tree is searched for "([^"]+)"$/, (ctx, artifact) => {
    ctx.artifact = knownArtifact(artifact);
    ctx.mentioning = docsFilesMentioning(ctx.artifact);
  });

  scoped(/^the only file mentioning it is "([^"]+)"$/, (ctx, expectedRel) => {
    const expectedAbs = path.join(REPO_ROOT, expectedRel);
    const rels = ctx.mentioning.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'));
    assert.deepEqual(rels, [expectedRel.split(path.sep).join('/')], `mentions of ${ctx.artifact}: ${JSON.stringify(rels)}`);
    assert.equal(path.resolve(ctx.mentioning[0]), path.resolve(expectedAbs));
  });

  scoped(/^the shipped-work log entries for BL-1052 and BL-1053 are read$/, (ctx) => {
    ctx.specText = fs.readFileSync(SPEC_PATH, 'utf8');
    ctx.shippedEntries = extractShippedEntries(ctx.specText);
  });

  scoped(/^each records that the seat was superseded and removed$/, (ctx) => {
    for (const [id, body] of Object.entries(ctx.shippedEntries)) {
      assert.match(
        body,
        /superseded and removed|was then superseded|supersede disposition|removed from the tree/i,
        `${id} does not record withdrawal`
      );
      assert.doesNotMatch(
        body,
        /\bNew pack `swarmforge\/packs\/qwen-code-mono-router\.conf`|\bNew runbook `docs\/how-to\/BL-1052/,
        `${id} still asserts the removed pack/runbook as a present addition`
      );
    }
  });

  scoped(/^each names "([^"]+)"$/, (ctx, evidence) => {
    for (const [id, body] of Object.entries(ctx.shippedEntries)) {
      assert.ok(body.includes(evidence), `${id} does not name ${evidence}`);
    }
  });

  scoped(/^every relative markdown link in the documentation index is followed$/, (ctx) => {
    const index = fs.readFileSync(INDEX_PATH, 'utf8');
    const links = [];
    const re = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(index)) !== null) {
      const href = m[1];
      if (/^[a-z]+:\/\//i.test(href) || href.startsWith('#')) continue;
      const decoded = decodeURIComponent(href.split('#')[0]);
      links.push(decoded);
    }
    ctx.indexLinks = links;
    ctx.brokenLinks = links.filter((href) => !fs.existsSync(path.join(DOCS_DIR, href)));
  });

  scoped(/^each one resolves to a file that is present$/, (ctx) => {
    assert.deepEqual(ctx.brokenLinks, [], `dead links in docs/index.md: ${JSON.stringify(ctx.brokenLinks)}`);
  });

  scoped(
    /^the shipped-work log illustrates pack naming with the placeholder "([^"]+)"$/,
    (ctx, placeholder) => {
      const spec = fs.readFileSync(SPEC_PATH, 'utf8');
      assert.ok(spec.includes(placeholder), `expected ${placeholder} in Specification.MD`);
      const stem = placeholder.replace(/^swarmforge\/packs\/|\.conf$/g, '');
      assert.equal(isIllustrativePackPlaceholder(stem), true);
      ctx.placeholder = placeholder;
      ctx.docSources = readAllDocSources();
      ctx.existingPacks = existingPackPaths();
    }
  );

  scoped(/^the documentation tree is checked for packs it names but does not have$/, (ctx) => {
    ctx.drift = findAbsentNamedPackConfs(ctx.docSources, ctx.existingPacks);
    // Plant a synthetic absent name outside the shipped-work log so the
    // positive report step can observe drift without deleting a live pack.
    ctx.syntheticAbsent = 'swarmforge/packs/bl1087-synthetic-absent.conf';
    ctx.driftWithSynthetic = findAbsentNamedPackConfs(
      [...ctx.docSources, { relativePath: 'docs/how-to/synthetic.md', text: `see ${ctx.syntheticAbsent}` }],
      ctx.existingPacks
    );
  });

  scoped(/^the placeholder is not reported$/, (ctx) => {
    assert.equal(
      ctx.drift.includes(ctx.placeholder),
      false,
      `placeholder ${ctx.placeholder} was reported as drift: ${JSON.stringify(ctx.drift)}`
    );
    const named = ctx.docSources.flatMap((d) => extractNamedPackConfs(d.text));
    assert.ok(named.some((r) => r.namedPath === ctx.placeholder));
  });

  scoped(/^a real pack name that is absent from the tree is reported$/, (ctx) => {
    assert.ok(
      ctx.driftWithSynthetic.includes(ctx.syntheticAbsent),
      `expected synthetic absent pack to be reported, got ${JSON.stringify(ctx.driftWithSynthetic)}`
    );
  });
}

module.exports = { registerSteps };
