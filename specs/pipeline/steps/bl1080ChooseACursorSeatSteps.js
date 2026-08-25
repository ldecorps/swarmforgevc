'use strict';

// BL-1080: Cursor seat pack + unsupported-agent how-to pointer.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'an operator can choose a Cursor seat on purpose';
const REPO = path.join(__dirname, '..', '..', '..');
const PACKS = path.join(REPO, 'swarmforge', 'packs');
const PACK = path.join(PACKS, 'cursor-mono-router.conf');
const HOWTO = 'docs/how-to/BL-1080-choose-a-cursor-seat.md';
const LAUNCHER = path.join(REPO, 'swarmforge', 'scripts', 'swarmforge.sh');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the committed packs directory$/, (ctx) => {
    assert.ok(fs.statSync(PACKS).isDirectory());
    ctx.packsDir = PACKS;
  });

  scoped(/^the Cursor seat pack is parsed$/, (ctx) => {
    assert.ok(fs.existsSync(PACK), `missing ${PACK}`);
    ctx.packText = fs.readFileSync(PACK, 'utf8');
    ctx.packName = 'cursor-mono-router';
  });

  scoped(/^it names at least one role whose agent is cursor$/, (ctx) => {
    const windows = ctx.packText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('window '));
    const cursorWindows = windows.filter((l) => /\bcursor\b/.test(l));
    assert.ok(cursorWindows.length >= 1, `no cursor window in pack: ${windows.join('; ')}`);
    ctx.cursorWindows = cursorWindows;
  });

  scoped(/^that pack is selectable by name at launch$/, (ctx) => {
    assert.equal(path.basename(PACK, '.conf'), ctx.packName);
    assert.ok(fs.existsSync(PACK));
  });

  scoped(/^the launcher source$/, (ctx) => {
    ctx.launcher = fs.readFileSync(LAUNCHER, 'utf8');
  });

  scoped(/^every unsupported-agent refusal it can emit is enumerated$/, (ctx) => {
    const sites = [];
    const re = /Unsupported agent '\$\{?agent\}?' for role '\$\{?role\}?'[^\n]*/g;
    let m;
    while ((m = re.exec(ctx.launcher)) !== null) {
      sites.push(m[0]);
    }
    // Also catch the literal pattern used in error_msg strings.
    const lit = [...ctx.launcher.matchAll(/Unsupported agent '\$agent' for role '\$role'[^\n"]*/g)].map(
      (x) => x[0]
    );
    ctx.sites = lit.length > 0 ? lit : sites;
  });

  scoped(/^each one names the Cursor-seat how-to by path$/, (ctx) => {
    assert.ok(ctx.sites.length > 0, 'no unsupported-agent refusal sites found');
    for (const site of ctx.sites) {
      assert.ok(
        site.includes(HOWTO),
        `refusal missing how-to path: ${site}`
      );
    }
    ctx.howtoPath = HOWTO;
  });

  scoped(/^more than one refusal site is found$/, (ctx) => {
    assert.ok(ctx.sites.length > 1, `expected >1 site, got ${ctx.sites.length}`);
  });

  scoped(/^a refusal emitted for an unsupported agent$/, (ctx) => {
    ctx.howtoPath = HOWTO;
  });

  scoped(/^the how-to path it names is resolved against the repository$/, (ctx) => {
    ctx.resolved = path.join(REPO, ctx.howtoPath);
  });

  scoped(/^a committed file is found at that path$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.resolved), `missing ${ctx.resolved}`);
    const text = fs.readFileSync(ctx.resolved, 'utf8');
    assert.match(text, /Cursor seat/i);
    assert.match(text, /\/pilot/i);
    assert.match(text, /Claude/i);
  });
}

module.exports = { registerSteps };
