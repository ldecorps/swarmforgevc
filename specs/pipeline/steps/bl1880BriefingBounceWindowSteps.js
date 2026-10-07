'use strict';

// Scaffolded by scaffold_step_handler.js from specs/features/BL-1880-the-briefing-bounce-line-counts-since-the-previous-briefing.feature (BL-1979).
// Fill in each stub below - this header records where it began.
//
// Drives the REAL qa-bounce-line.js CLI (compiled) via subprocess against a
// real git worktree fixture, under mkdtemp (BL-1390, trackedTmpRoot) - "the
// previous briefing was sent at <time>" is a real commit to
// docs/briefings/<day>.md with that author/committer date, exactly what
// findPreviousBriefingSentAtIso (qa-bounce-line.ts) reads via `git log`.
// The bounce log itself is written directly as JSONL (the same shape
// appendBounceRecordIfNew writes) - no need for a second real git repo
// layer there, since bounceStore.ts reads it straight off disk.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1880 The briefing's bounce line counts since the previous briefing, shows the trend, and names each role's model";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const CLI = path.join(EXT_OUT, 'tools', 'qa-bounce-line.js');
const { formatModelDisplayName } = require(path.join(EXT_OUT, 'swarm', 'modelDisplayName'));
const { claudeSettingsPath } = require(path.join(EXT_OUT, 'swarm', 'claudeSettingsFile'));

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RENDER_AT = '2026-10-02T07:00:00Z';

function git(root, args, extraEnv) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...extraEnv } }).trim();
}

// A fresh `git init` on a brand-new mkdtemp root establishes its own
// isolated .git itself (BL-1390) - proven, not merely asserted by comment.
function initFixtureRepo() {
  const root = trackedTmpRoot('bl1880-fixture-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const commonDir = git(root, ['rev-parse', '--git-common-dir']);
  assert.equal(
    path.resolve(root, commonDir),
    path.join(root, '.git'),
    `bl1880: git-common-dir did not resolve inside the fixture root, got "${commonDir}"`
  );
  return root;
}

let bounceSeq = 0;
function appendBounceRecord(root, { producingRole, at, by }) {
  bounceSeq += 1;
  const record = {
    ticket: `BL-9${String(bounceSeq).padStart(3, '0')}`,
    producingRole,
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: `${String(bounceSeq).padStart(10, '0')}`,
    at,
    by: by ?? 'architect',
  };
  const month = at.slice(0, 7);
  const dir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${month}.jsonl`), JSON.stringify(record) + '\n');
}

function commitBriefingFile(root, dayKey, atIso) {
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${dayKey}.md`), `# Briefing ${dayKey}\n`);
  git(root, ['add', `docs/briefings/${dayKey}.md`]);
  git(root, ['commit', '-q', '-m', `briefing: record sent marker ${dayKey}`], {
    GIT_AUTHOR_DATE: atIso,
    GIT_COMMITTER_DATE: atIso,
  });
}

function setCoderModel(root, modelId) {
  const settingsPath = claudeSettingsPath(root, 'coder');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ model: modelId }));
}

function runLine(root, atIso) {
  return execFileSync('node', [CLI, '--target', root, '--at', atIso], { encoding: 'utf8' }).trim();
}

function runJson(root, atIso) {
  const out = execFileSync('node', [CLI, '--target', root, '--at', atIso, '--json'], { encoding: 'utf8' });
  return JSON.parse(out);
}

function ensureState(ctx) {
  if (!ctx.bl1880) {
    ctx.bl1880 = { root: initFixtureRepo() };
  }
  return ctx.bl1880;
}

// Extracts the ISO-ish token right after "Bounces since " at the start of
// the line - the one place the window start is printed.
function extractWindowStartFromLine(line) {
  const match = /^Bounces since (\S+):/.exec(line);
  return match ? match[1] : undefined;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp('^a fixture project with a bounce log and a record of when briefings were sent$'), (ctx) => {
    ensureState(ctx);
  });

  scoped(new RegExp('^the previous briefing was sent at 2026-10-01T08:00:00Z$'), (ctx) => {
    const state = ensureState(ctx);
    state.previousBriefingAt = '2026-10-01T08:00:00Z';
    commitBriefingFile(state.root, '2026-10-01', state.previousBriefingAt);
  });

  scoped(new RegExp('^the bounce log holds 3 bounces before that time and 2 after it$'), (ctx) => {
    const state = ensureState(ctx);
    const beforeMs = new Date(state.previousBriefingAt).getTime() - 2 * 60 * 60 * 1000;
    const afterMs = new Date(state.previousBriefingAt).getTime() + 60 * 60 * 1000;
    for (let i = 0; i < 3; i++) {
      appendBounceRecord(state.root, { producingRole: 'coder', at: new Date(beforeMs).toISOString() });
    }
    for (let i = 0; i < 2; i++) {
      appendBounceRecord(state.root, { producingRole: 'coder', at: new Date(afterMs).toISOString() });
    }
  });

  scoped(new RegExp('^the bounce line is rendered at 2026-10-02T07:00:00Z$'), (ctx) => {
    const state = ensureState(ctx);
    state.output = runLine(state.root, RENDER_AT);
  });

  scoped(new RegExp('^the line counts 2 bounces since the previous briefing$'), (ctx) => {
    const state = ensureState(ctx);
    assert.match(state.output, /^Bounces since \S+: 2\b/, `expected a window count of 2: ${state.output}`);
  });

  scoped(new RegExp("^the line names 2026-10-01T08:00:00Z as the start of that window$"), (ctx) => {
    const state = ensureState(ctx);
    const printed = extractWindowStartFromLine(state.output);
    assert.ok(printed, `expected the line to name a window start: ${state.output}`);
    assert.equal(new Date(printed).getTime(), new Date('2026-10-01T08:00:00Z').getTime());
  });

  scoped(new RegExp('^no briefing send is on record$'), (ctx) => {
    ensureState(ctx);
    // Nothing to add - no docs/briefings/*.md commit exists in this fixture.
  });

  scoped(new RegExp('^the bounce log holds one bounce 30 hours and one 2 hours before 2026-10-02T07:00:00Z$'), (ctx) => {
    const state = ensureState(ctx);
    const nowMs = new Date(RENDER_AT).getTime();
    appendBounceRecord(state.root, { producingRole: 'coder', at: new Date(nowMs - 30 * 60 * 60 * 1000).toISOString() });
    appendBounceRecord(state.root, { producingRole: 'coder', at: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString() });
  });

  scoped(new RegExp('^the line counts 1 bounce in the last 24 hours$'), (ctx) => {
    const state = ensureState(ctx);
    assert.match(
      state.output,
      /^Bounces in the last 24 hours \(no previous briefing was found\): 1\b/,
      `expected a 24h window count of 1: ${state.output}`
    );
  });

  scoped(new RegExp('^the line says no previous briefing was found$'), (ctx) => {
    const state = ensureState(ctx);
    assert.match(state.output, /no previous briefing was found/, `expected that phrase: ${state.output}`);
  });

  scoped(
    new RegExp('^the bounce log holds coder bounces of 1, 0, 2, 0, 3, 1 and 4 on the seven days before 2026-10-02T07:00:00Z$'),
    (ctx) => {
      const state = ensureState(ctx);
      const nowMs = new Date(RENDER_AT).getTime();
      const counts = [1, 0, 2, 0, 3, 1, 4]; // oldest (day 1) .. newest (day 7)
      counts.forEach((count, dayIndex) => {
        const offsetMs = (7 - dayIndex - 0.5) * MS_PER_DAY; // midpoint of that day's bucket
        for (let i = 0; i < count; i++) {
          appendBounceRecord(state.root, { producingRole: 'coder', at: new Date(nowMs - offsetMs).toISOString() });
        }
      });
    }
  );

  scoped(new RegExp('^the coder trend reads 1 0 2 0 3 1 4$'), (ctx) => {
    const state = ensureState(ctx);
    assert.match(state.output, /trend 1 0 2 0 3 1 4\b/, `expected the coder trend in the line: ${state.output}`);
  });

  scoped(new RegExp('^the coder role runs claude-opus-5-5$'), (ctx) => {
    const state = ensureState(ctx);
    setCoderModel(state.root, 'claude-opus-5-5');
  });

  scoped(new RegExp('^the bounce log holds a coder bounce after that time$'), (ctx) => {
    const state = ensureState(ctx);
    const afterMs = new Date(state.previousBriefingAt).getTime() + 60 * 60 * 1000;
    appendBounceRecord(state.root, { producingRole: 'coder', at: new Date(afterMs).toISOString() });
  });

  scoped(new RegExp("^the coder entry names the coder role's model as the swarm tiles show it$"), (ctx) => {
    const state = ensureState(ctx);
    const expected = formatModelDisplayName('claude-opus-5-5');
    assert.match(
      state.output,
      new RegExp(`coder x\\d+ \\(trend [^)]*, now ${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`),
      `expected the coder entry to name "${expected}": ${state.output}`
    );
  });

  scoped(new RegExp('^the line ends with an all-time total of 5$'), (ctx) => {
    const state = ensureState(ctx);
    assert.match(state.output, /all-time total: 5$/, `expected the line to end with an all-time total of 5: ${state.output}`);
  });

  scoped(new RegExp('^the bounce figures are requested as JSON at 2026-10-02T07:00:00Z$'), (ctx) => {
    const state = ensureState(ctx);
    state.json = runJson(state.root, RENDER_AT);
    state.output = runLine(state.root, RENDER_AT);
  });

  scoped(
    new RegExp(
      "^the JSON holds the window start, the window counts by producing and bouncing role, the seven-day trend per producing role, and each producing role's model$"
    ),
    (ctx) => {
      const state = ensureState(ctx);
      const json = state.json;
      assert.ok(json.windowStartIso, 'expected windowStartIso');
      assert.ok(Array.isArray(json.windowByProducingRole), 'expected windowByProducingRole array');
      assert.ok(Array.isArray(json.windowByBouncingRole), 'expected windowByBouncingRole array');
      for (const entry of json.windowByProducingRole) {
        assert.equal(typeof entry.role, 'string');
        assert.equal(typeof entry.windowCount, 'number');
        assert.ok(Array.isArray(entry.trend) && entry.trend.length === 7, `expected a 7-value trend for ${entry.role}`);
        assert.equal(typeof entry.model, 'string');
      }
    }
  );

  scoped(new RegExp('^every count in the JSON equals the count the line prints$'), (ctx) => {
    const state = ensureState(ctx);
    const json = state.json;
    assert.match(state.output, new RegExp(`: ${json.windowTotal} - by producing role`), `window total mismatch: ${state.output}`);
    assert.match(state.output, new RegExp(`all-time total: ${json.allTimeTotal}$`), `all-time total mismatch: ${state.output}`);
    for (const entry of json.windowByProducingRole) {
      assert.match(state.output, new RegExp(`${entry.role} x${entry.windowCount}\\b`), `role count mismatch for ${entry.role}: ${state.output}`);
    }
  });
}

module.exports = { registerSteps };
