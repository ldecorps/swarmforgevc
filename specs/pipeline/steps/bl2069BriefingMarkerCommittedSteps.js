'use strict';

// BL-2069: step handlers for "every briefing send commits its sent marker".
// Drives the REAL send-unsent-briefings! with the REAL commit-sent-marker!
// through briefing_email_harness.bb's "bl821" mode (commit-mode "real" -
// real git, no fake sh-fn), against a per-scenario fixture git repo, the
// same discipline as bl821BriefingWindowAndMarkerDurabilitySteps.js's own
// Leg A scenarios.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');

const FEATURE = 'Every briefing send commits its sent marker';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function configGitIdentity(dir) {
  git(dir, ['config', 'user.email', 'aps@example.com']);
  git(dir, ['config', 'user.name', 'aps']);
}

function initRepo(dir) {
  fs.mkdirSync(path.join(dir, 'docs', 'briefings'), { recursive: true });
  git(dir, ['init', '-q']);
  configGitIdentity(dir);

  // BL-1390 (this ticket's own constraint): proven isolated before any
  // further, actually-mutating git command.
  const commonDir = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const realRoot = fs.realpathSync(dir);
  const realCommon = fs.realpathSync(commonDir);
  if (!realCommon.startsWith(realRoot)) {
    throw new Error(`BL-2069 fixture: git-common-dir "${realCommon}" escapes fixture root "${realRoot}"`);
  }

  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture repo\n');
  fs.writeFileSync(path.join(dir, 'docs', 'briefings', '.sent.json'), JSON.stringify({ sent: [] }));
  fs.writeFileSync(path.join(dir, 'docs', 'briefings', '2020-01-01.md'), 'Headline: old fixture\n\nBody.\n');
  git(dir, ['add', 'README.md', 'docs/briefings/.sent.json', 'docs/briefings/2020-01-01.md']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

function ensureRepo(ctx) {
  if (!ctx.repoDir) {
    ctx.repoDir = trackedTmpRoot('aps-bl2069-');
    initRepo(ctx.repoDir);
    ctx.briefingsDir = path.join(ctx.repoDir, 'docs', 'briefings');
    ctx.today = new Date().toISOString().slice(0, 10);
  }
  return ctx;
}

function runBl821(briefingsDir, todayStr, commitMode, sendOutcome) {
  const args = [HARNESS, briefingsDir, 'bl821', todayStr || 'none', commitMode || 'none', sendOutcome || 'success'];
  const out = execFileSync('bb', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

function headSentSet(repoDir) {
  const committed = git(repoDir, ['show', 'HEAD:docs/briefings/.sent.json']);
  return JSON.parse(committed).sent || [];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture repository with a briefings directory whose sent marker is committed$/, (ctx) => {
    ensureRepo(ctx);
    // Prove this is a real git working tree (not a bare dir): the harness's
    // commit-sent-marker! resolves its project root via
    // `git rev-parse --absolute-git-dir`, which only succeeds here.
    const gitDir = git(ctx.repoDir, ['rev-parse', '--absolute-git-dir']);
    if (!gitDir.trim()) {
      throw new Error('expected the fixture to be a real git working tree');
    }
  });

  // ── Scenario 01 (Outline): absolute vs relative project root ─────────
  // KNOWN_VALUES (engineering.prompt's Scenario Outline rule): exactly
  // these two labels; anything else - including a corrupted label a
  // Gherkin mutation introduces - is a loud failure here, never a silent
  // fall-through that would let the wrong branch's behavior pass for it.
  const KNOWN_ROOT_FORMS = ['an absolute', 'a relative'];

  scoped(/^the briefing sweep's project root is given as (.+?) path$/, (ctx, form) => {
    ensureRepo(ctx);
    if (!KNOWN_ROOT_FORMS.includes(form)) {
      throw new Error(`BL-2069: unknown project-root form "${form}" - expected one of ${JSON.stringify(KNOWN_ROOT_FORMS)}`);
    }
    ctx.rootForm = form;
    const briefingName = `${ctx.today}.md`;
    fs.writeFileSync(path.join(ctx.briefingsDir, briefingName), 'Headline: BL-2069 fixture\n\nBody.\n');
    ctx.lastBriefingDate = ctx.today;
  });

  scoped(/^the briefing sweep records a briefing as sent$/, (ctx) => {
    // BL-2069 hardener bounce D1: the two Outline rows must drive genuinely
    // different real inputs, not the same absolute path with a label that
    // is never read. The "a relative" row passes briefings-dir relative to
    // THIS process's own cwd - the exact historical shape (a relative
    // project root) commit-sent-marker!'s own fs/canonicalize now resolves
    // correctly; passing the bare absolute path here would never exercise
    // that resolution at all.
    const briefingsDirArg =
      ctx.rootForm === 'a relative' ? path.relative(process.cwd(), ctx.briefingsDir) : ctx.briefingsDir;
    ctx.result = runBl821(briefingsDirArg, ctx.today, 'real', 'success');
    if (!ctx.result.sent.includes(`${ctx.lastBriefingDate}.md`)) {
      throw new Error(`expected the sweep to send ${ctx.lastBriefingDate}.md, got sent=${JSON.stringify(ctx.result.sent)}`);
    }
  });

  scoped(/^HEAD's sent marker lists that briefing$/, (ctx) => {
    const sent = headSentSet(ctx.repoDir);
    const briefingDate = ctx.leftoverBriefingDate || ctx.lastBriefingDate;
    if (!sent.includes(`${briefingDate}.md`)) {
      throw new Error(`expected ${briefingDate}.md committed in HEAD's marker, got: ${JSON.stringify(sent)}`);
    }
  });

  // ── Scenario 02: a held index lock delays the commit, does not lose it ─
  scoped(/^another git process holds the fixture's index lock for 2 seconds$/, (ctx) => {
    ensureRepo(ctx);
    const gitDir = git(ctx.repoDir, ['rev-parse', '--absolute-git-dir']).trim();
    const lockPath = path.join(gitDir, 'index.lock');
    // Hold the lock in a background process for 2 seconds, then release it.
    // commit-with-integrity! polls the lock (bounded, 50ms) and retries the
    // add/commit within its budget - the sweep must land the commit AFTER
    // the lock is released, not fail.
    const { spawn } = require('node:child_process');
    const holderProc = spawn('bash', ['-c', `touch "${lockPath}" && sleep 2 && rm -f "${lockPath}"`], { stdio: 'ignore' });
    ctx.lockHolder = holderProc;
    const briefingName = `${ctx.today}.md`;
    fs.writeFileSync(path.join(ctx.briefingsDir, briefingName), 'Headline: BL-2069 lock fixture\n\nBody.\n');
    ctx.lastBriefingDate = ctx.today;
  });

  // ── Scenario 03: a leftover uncommitted marker is committed by the next sweep ─
  scoped(/^the working tree's sent marker lists a briefing that HEAD's does not$/, (ctx) => {
    ensureRepo(ctx);
    // A briefing file exists on disk and is listed in the WORKING-TREE marker,
    // but HEAD's marker does not list it - simulating an earlier sweep that
    // recorded the send locally but failed to commit the marker. The
    // briefing file is NOT committed: the heal commit must be scoped to the
    // marker path only and never sweep the briefing file in.
    const briefingName = `${ctx.today}.md`;
    fs.writeFileSync(path.join(ctx.briefingsDir, briefingName), 'Headline: BL-2069 leftover fixture\n\nBody.\n');
    fs.writeFileSync(path.join(ctx.briefingsDir, '.sent.json'), JSON.stringify({ sent: [briefingName] }));
    ctx.leftoverBriefingDate = ctx.today;
  });

  scoped(/^the briefing sweep runs with nothing new to send$/, (ctx) => {
    // The marker already lists the briefing as sent, so find-unsent-briefings
    // returns empty - the per-file send loop does nothing. The heal block
    // (BL-2069) still commits the leftover marker.
    ctx.result = runBl821(ctx.briefingsDir, ctx.today, 'real', 'success');
  });

  scoped(/^the commit changes no path but the sent marker$/, (ctx) => {
    const stat = git(ctx.repoDir, ['show', '--stat', '-1', '--format=', 'HEAD']);
    if (!stat.includes('docs/briefings/.sent.json')) {
      throw new Error(`expected the last commit to touch the marker, got: ${stat}`);
    }
    // The briefing .md file was never committed (left untracked, like a
    // briefing the failed sweep recorded but never committed); the heal
    // commit must not sweep it in (pathspec-scoped to the marker only).
    if (stat.includes(`${ctx.leftoverBriefingDate}.md`)) {
      throw new Error(`expected the heal commit to NOT touch the briefing file, got: ${stat}`);
    }
  });
}

module.exports = { registerSteps };
