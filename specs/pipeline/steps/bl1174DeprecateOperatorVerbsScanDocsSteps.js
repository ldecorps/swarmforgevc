'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'deprecate operator verbs scan and retire stale rules with docs';
const REPO = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO, 'extension');
const CLI = path.join(EXT, 'out', 'tools', 'deprecate.js');

function ensure(ctx) {
  if (!ctx.bl1174) ctx.bl1174 = {};
  return ctx.bl1174;
}

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl1174-'));
}

function writeConf(root, body) {
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'swarmforge.conf'), body);
}

function writeIndex(root, body) {
  const dir = path.join(root, 'docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.md'), body);
}

function runCli(root, args) {
  return spawnSync('node', [CLI, root, ...args], { encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the shared operator verb backend from BL-698$/, () => {});
  scoped(/^the deprecator freshness check from BL-1173$/, () => {});

  scoped(/^at least one stale-rule signal exists in the tree$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    writeConf(st.root, 'config orphan_only_flag 1\n');
    writeIndex(st.root, '# Docs\n');
    st.confBefore = fs.readFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), 'utf8');
    st.indexBefore = fs.readFileSync(path.join(st.root, 'docs', 'index.md'), 'utf8');
  });

  scoped(/^the operator runs deprecate dry$/, (ctx) => {
    const st = ensure(ctx);
    const r = runCli(st.root, ['--seat-tier', 'hard', 'dry']);
    st.out = r.stdout;
    st.status = r.status;
  });

  scoped(/^a ranked list is printed$/, (ctx) => {
    assert.match(ensure(ctx).out, /ranked|orphan_only_flag/i);
  });

  scoped(/^no files under backlog or docs are changed$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(
      fs.readFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), 'utf8'),
      st.confBefore
    );
    assert.equal(fs.readFileSync(path.join(st.root, 'docs', 'index.md'), 'utf8'), st.indexBefore);
  });

  scoped(/^a dead conf flag with no readers ranks first$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    writeConf(st.root, 'config dead_flag 1\nconfig keep_me 1\n');
    // give keep_me a reader so it is not orphan
    fs.mkdirSync(path.join(st.root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(st.root, 'docs', 'keep.md'), 'mentions keep_me\n');
    writeIndex(st.root, '# Docs\n');
    st.flag = 'dead_flag';
  });

  scoped(/^the operator confirms deprecate$/, (ctx) => {
    const st = ensure(ctx);
    const r = runCli(st.root, ['--seat-tier', 'hard', 'confirm']);
    st.out = r.stdout;
    st.status = r.status;
  });

  scoped(/^that flag is retired$/, (ctx) => {
    const st = ensure(ctx);
    const conf = fs.readFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), 'utf8');
    assert.ok(!conf.includes(st.flag));
    assert.ok(conf.includes('keep_me'));
  });

  scoped(/^a stub is written under docs\/deprecated$/, (ctx) => {
    const st = ensure(ctx);
    const dir = path.join(st.root, 'docs', 'deprecated');
    assert.ok(fs.existsSync(dir));
    const stubs = fs.readdirSync(dir);
    assert.ok(stubs.some((n) => n.includes('dead_flag')));
  });

  scoped(/^docs\/index\.md links the stub from a Deprecated section$/, (ctx) => {
    const index = fs.readFileSync(path.join(ensure(ctx).root, 'docs', 'index.md'), 'utf8');
    assert.match(index, /## Deprecated/);
    assert.match(index, /deprecated\//);
  });

  scoped(/^the top ranked item is ambiguous between stale and valid$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    // Drive ambiguity via injected dry/confirm through a tiny fixture file the
    // CLI does not use — acceptance uses the pure run API for this scenario.
    const { runDeprecate } = require(path.join(EXT, 'out', 'tools', 'deprecate.js'));
    st.result = runDeprecate({
      mode: 'confirm',
      seatTier: 'hard',
      signals: [
        {
          subject: 'maybe_flag',
          kind: 'orphan-conf-flag',
          recurrence: 2,
          blastRadius: 1,
          adjudication: 'human-ask',
          estimatedFiles: 1,
          estimatedLines: 5,
          ambiguityReason: 'still referenced in one living how-to',
        },
      ],
      writeFile: () => {
        st.wrote = true;
      },
      readFile: () => null,
    });
  });

  scoped(/^the operator runs deprecate$/, (ctx) => {
    // result already produced in the Given for ambiguous/oversized/weak cases
    // that use the pure API; for confirm-path fixtures, run CLI.
    const st = ensure(ctx);
    if (st.result) return;
    const r = runCli(st.root, ['--seat-tier', 'hard', 'confirm']);
    st.out = r.stdout;
  });

  scoped(/^a human ask is surfaced$/, (ctx) => {
    assert.equal(ensure(ctx).result.outcome, 'human-ask');
  });

  scoped(/^no behaviour is deleted$/, (ctx) => {
    assert.ok(!ensure(ctx).wrote);
  });

  scoped(/^the top ranked retirement exceeds the one-item size envelope$/, (ctx) => {
    const st = ensure(ctx);
    const { runDeprecate } = require(path.join(EXT, 'out', 'tools', 'deprecate.js'));
    st.result = runDeprecate({
      mode: 'confirm',
      seatTier: 'hard',
      signals: [
        {
          subject: 'huge_flag',
          kind: 'orphan-conf-flag',
          recurrence: 3,
          blastRadius: 2,
          adjudication: 'retire',
          estimatedFiles: 9,
          estimatedLines: 400,
        },
      ],
      writeFile: () => {
        st.wrote = true;
      },
      readFile: () => null,
    });
  });

  scoped(/^the verb refuses with a reason$/, (ctx) => {
    assert.equal(ensure(ctx).result.outcome, 'refused');
    assert.match(ensure(ctx).result.reason, /envelope|oversized|size/i);
  });

  scoped(/^nothing is retired$/, (ctx) => {
    assert.ok(!ensure(ctx).wrote);
  });

  scoped(/^the executing seat is easy-tier or otherwise weak at multi-document reasoning$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    writeConf(st.root, 'config orphan_only_flag 1\n');
    writeIndex(st.root, '# Docs\n');
    st.seat = 'easy';
  });

  scoped(/^the operator runs deprecate or deprecate dry$/, (ctx) => {
    const st = ensure(ctx);
    const r = runCli(st.root, ['--seat-tier', st.seat || 'easy', 'dry']);
    st.out = r.stdout;
  });

  scoped(/^the verb refuses naming needs hard-tier multi-document reasoner$/, (ctx) => {
    assert.match(ensure(ctx).out, /needs hard-tier multi-document reasoner/i);
  });

  scoped(/^no scan mutation or retirement occurs$/, (ctx) => {
    const st = ensure(ctx);
    const conf = fs.readFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), 'utf8');
    assert.ok(conf.includes('orphan_only_flag'));
  });
}

module.exports = { registerSteps };
