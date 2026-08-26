'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-882 handoffd cadence comment accuracy';
const REPO = path.join(__dirname, '..', '..', '..');
const HANDOFFD = path.join(REPO, 'swarmforge', 'scripts', 'handoffd.bb');

function ensure(ctx) {
  if (!ctx.bl882) ctx.bl882 = { comment: '', diff: '' };
  return ctx.bl882;
}

function gateCommentBlock(src) {
  const idx = src.indexOf('BL-617: chase/dispatch-gap/unassigned-active/open-slot');
  assert.ok(idx >= 0, 'BL-617 gate comment missing');
  const end = src.indexOf('(when-not (outbound-wakes-suppressed?)', idx);
  assert.ok(end > idx, 'pause gate form missing after comment');
  return src.slice(idx, end);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the file "swarmforge\/scripts\/handoffd\.bb" at the parcel commit$/, (ctx) => {
    ensure(ctx).src = fs.readFileSync(HANDOFFD, 'utf8');
  });

  scoped(/^the comment block introducing the outbound-wakes suppression gate is read$/, (ctx) => {
    ensure(ctx).comment = gateCommentBlock(ensure(ctx).src);
  });

  scoped(/^it does not contain the phrase "keep running unconditionally"$/, (ctx) => {
    assert.ok(!ensure(ctx).comment.includes('keep running unconditionally'));
  });

  scoped(/^it contains the phrase "pause-exempt, never every-tick"$/, (ctx) => {
    const flat = ensure(ctx).comment.replace(/\s+/g, ' ');
    assert.ok(flat.includes('pause-exempt, never every-tick'));
  });

  scoped(/^it names the "chase-sweep-every-cycles" gate as still applying to the sibling sweeps$/, (ctx) => {
    assert.ok(ensure(ctx).comment.includes('chase-sweep-every-cycles'));
  });

  scoped(/^the parcel's changes to that file are diffed against its received base$/, (ctx) => {
    const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    const mb = (base.stdout || '').trim() || 'origin/main';
    const r = spawnSync('git', ['diff', `${mb}..HEAD`, '--', 'swarmforge/scripts/handoffd.bb'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    ensure(ctx).diff = r.stdout || '';
  });

  scoped(/^every changed line in that file is a Clojure comment line$/, (ctx) => {
    const lines = ensure(ctx).diff.split('\n');
    const changed = lines.filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'));
    assert.ok(changed.length > 0, 'expected handoffd.bb comment diff');
    for (const line of changed) {
      const body = line.slice(1).trimStart();
      if (body === '') continue;
      assert.ok(body.startsWith(';;'), `non-comment change: ${line}`);
    }
  });
}

module.exports = { registerSteps };
