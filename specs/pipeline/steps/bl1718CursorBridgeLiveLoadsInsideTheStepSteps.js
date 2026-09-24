'use strict';

// BL-1718: step handler for "no step handler loads the cursor-bridge live
// graph at module scope" - a real, read-only scan of the parcel's own
// specs/pipeline/steps tree (the exact population the census charges),
// never a reimplementation of the module-load budget guard itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'BL-1718 No step handler loads the cursor-bridge live graph at module scope';
const STEPS_DIR = path.join(__dirname);

const MENTIONS_LIVE_MODULE = /telegramCursorBridgeLive/;

// A module-scope `const`/`let`/`var` declaration (column 0 - the
// established convention every lazy accessor in this tree already
// follows: an eager require sits at column 0, a lazy one is indented
// inside a function body) whose require() names telegramCursorBridgeLive,
// in either the relative-path form (`require('.../telegramCursorBridgeLive')`)
// or the `path.join(EXT_OUT, 'telegramCursorBridgeLive.js')` form BL-1445
// warned a naive matcher would miss.
const MODULE_SCOPE_REQUIRE_RE = /^(?:const|let|var)\b[^\n]*require\([^\n]*telegramCursorBridgeLive[^\n]*\)/m;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^every step handler file under specs\/pipeline\/steps is read$/, (ctx) => {
    ctx.files = fs
      .readdirSync(STEPS_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => e.name)
      .sort();
    assert.ok(ctx.files.length > 0, 'expected at least one step handler file');
    ctx.texts = new Map(ctx.files.map((name) => [name, fs.readFileSync(path.join(STEPS_DIR, name), 'utf8')]));
  });

  scoped(/^none requires telegramCursorBridgeLive at module scope$/, (ctx) => {
    const violators = ctx.files.filter((name) => MODULE_SCOPE_REQUIRE_RE.test(ctx.texts.get(name)));
    assert.deepEqual(violators, [], `expected no module-scope require, found: ${JSON.stringify(violators)}`);
  });

  scoped(
    /^the handlers that mention telegramCursorBridgeLive include bl709BubbleItsOwnTelegramTopicSteps\.js and bl725RenameCursorRemoteTopicToHostSteps\.js$/,
    (ctx) => {
      const mentioners = ctx.files.filter((name) => MENTIONS_LIVE_MODULE.test(ctx.texts.get(name)));
      // Non-vacuity for the scenario above: if the matcher's population were
      // empty (e.g. a wrong directory or a typo'd module name), "none
      // requires it at module scope" would pass trivially. Pinning both
      // known members (one relative-path form, one path.join form, per the
      // ticket's own BL-1445 warning) proves the census actually reached
      // them.
      assert.ok(mentioners.includes('bl709BubbleItsOwnTelegramTopicSteps.js'), 'expected bl709 in the census');
      assert.ok(mentioners.includes('bl725RenameCursorRemoteTopicToHostSteps.js'), 'expected bl725 in the census');
    }
  );
}

module.exports = { registerSteps };
