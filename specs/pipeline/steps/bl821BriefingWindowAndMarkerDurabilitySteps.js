'use strict';

// BL-821: step handlers for "briefing emails are sent once, and only inside
// the allowed date window" - drives the real briefing_email_lib.bb through
// briefing_email_harness.bb's "bl821" mode (a fake send-email!/log! adapter,
// no real network) and, for the durable-marker (Leg A) scenarios, a REAL
// git repo (via commit-mode "real") - never a mocked stand-in for git
// itself, same discipline as every other tmux/git-touching acceptance step
// in this tree.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const HANDOFFD = path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb');

// Scoped (registry.defineScoped) throughout - several of this feature's own
// step texts ("the sweep runs" etc.) are generic enough that another
// ticket's step file already claims the same literal text for unrelated
// behavior (stepRegistry.js's own documented reason for defineScoped
// existing at all). Pinning every step here to this exact Feature: title
// means this file only ever resolves for ITS OWN scenarios, regardless of
// registration order in index.js.
const FEATURE_NAME = 'Briefing emails are sent once, and only inside the allowed date window';

// The exact expression handoffd.bb wires as :today-str (BL-897's lesson:
// a constant mirrored across a language boundary needs a test asserting
// both literals agree, not a "kept in sync" comment) - scenario 05 both
// confirms this literal is still present in the real daemon source AND
// executes it under two extreme timezones to prove the value it produces
// never depends on host local time.
const TODAY_STR_WIRING_LITERAL = '(str (java.time.LocalDate/now java.time.ZoneOffset/UTC))';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function initRepo(dir) {
  fs.mkdirSync(path.join(dir, 'docs', 'briefings'), { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'aps@example.com']);
  git(dir, ['config', 'user.name', 'aps']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture repo\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

function ensureRepo(ctx) {
  if (!ctx.repoDir) {
    ctx.repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl821-'));
    initRepo(ctx.repoDir);
    ctx.briefingsDir = path.join(ctx.repoDir, 'docs', 'briefings');
    // Real UTC "today", computed once per scenario so file names and
    // :today-str stay consistent regardless of how long the scenario's
    // own steps take to run.
    ctx.today = new Date().toISOString().slice(0, 10);
  }
  return ctx;
}

function utcOffsetDate(todayStr, daysAgo) {
  const d = new Date(`${todayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const PHRASE_TO_OFFSET = {
  today: 0,
  yesterday: 1,
  'two days ago': 2,
  'a month ago': 30,
};

function offsetForPhrase(phrase) {
  if (!(phrase in PHRASE_TO_OFFSET)) {
    throw new Error(`unknown briefing-date phrase: "${phrase}"`);
  }
  return PHRASE_TO_OFFSET[phrase];
}

function runBl821(briefingsDir, todayStr, commitMode, sendOutcome, envOverride) {
  const args = [HARNESS, briefingsDir, 'bl821', todayStr || 'none', commitMode || 'none', sendOutcome || 'success'];
  const out = execFileSync('bb', args, { encoding: 'utf8', env: envOverride ? { ...process.env, ...envOverride } : process.env });
  return JSON.parse(out);
}

function readSentSet(briefingsDir) {
  const p = path.join(briefingsDir, '.sent.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8')).sent || [];
}

function registerSteps(registry) {
  function defineScoped(pattern, handler) {
    registry.defineScoped(pattern, handler, FEATURE_NAME);
  }

  defineScoped(/^a briefings directory and a sent-marker the sweep reads$/, (ctx) => {
    ensureRepo(ctx);
  });

  // Registered BEFORE the generic "dated <phrase>" pattern below (this
  // registry is first-match-wins, stepRegistry.js) - scenario 05's own
  // Given step text is a phrase that happens to end in one of the generic
  // pattern's own alternatives ("today"), so the more specific pattern
  // must win or the generic handler would try (and fail) to look up
  // "today in UTC" as a phrase.
  defineScoped(/^an unsent briefing dated today in UTC$/, (ctx) => {
    ensureRepo(ctx);
    ctx.lastBriefingDate = ctx.today;
    fs.writeFileSync(path.join(ctx.briefingsDir, `${ctx.today}.md`), 'Headline: BL-821 UTC-window fixture\n\nBody.\n');
  });

  // Covers the fixed Given steps in scenarios 01/02/03/06 AND every
  // Scenario Outline row in scenario 04 - runtime.js substitutes
  // <briefing date> with the row's literal phrase before this pattern
  // ever sees the step text (same one-regex-covers-both-shapes note as
  // bl902's own step file).
  defineScoped(/^an unsent briefing dated (.+)$/, (ctx, phrase) => {
    ensureRepo(ctx);
    const offset = offsetForPhrase(phrase);
    const dateStr = utcOffsetDate(ctx.today, offset);
    ctx.lastBriefingDate = dateStr;
    fs.writeFileSync(path.join(ctx.briefingsDir, `${dateStr}.md`), `Headline: BL-821 fixture (${phrase})\n\nBody.\n`);
  });

  defineScoped(/^an unsent briefing file whose name carries a suffix beyond the date$/, (ctx) => {
    ensureRepo(ctx);
    ctx.lastBriefingDate = `${ctx.today}-evening`;
    fs.writeFileSync(path.join(ctx.briefingsDir, `${ctx.today}-evening.md`), 'Headline: BL-821 suffixed fixture\n\nBody.\n');
  });

  defineScoped(/^a checkout whose marker is missing every briefing older than yesterday$/, (ctx) => {
    ensureRepo(ctx);
    // The marker already lists everything through yesterday as sent -
    // only briefings OLDER than that are "missing" from it (BL-821's own
    // stale-marker scenario), so those are what the ordinary sweep must
    // never dump as a catch-up.
    const alreadySent = [0, 1].map((n) => `${utcOffsetDate(ctx.today, n)}.md`);
    fs.writeFileSync(path.join(ctx.briefingsDir, '.sent.json'), JSON.stringify({ sent: alreadySent }));
  });

  defineScoped(/^a marker listing nothing at all$/, (ctx) => {
    ensureRepo(ctx);
    fs.writeFileSync(path.join(ctx.briefingsDir, '.sent.json'), JSON.stringify({ sent: [] }));
  });

  defineScoped(/^those older briefing files are present on disk$/, (ctx) => {
    ensureRepo(ctx);
    ctx.olderDates = [5, 10, 90, 365].map((n) => utcOffsetDate(ctx.today, n));
    for (const d of ctx.olderDates) {
      fs.writeFileSync(path.join(ctx.briefingsDir, `${d}.md`), `Headline: old fixture ${d}\n\nBody.\n`);
    }
  });

  defineScoped(/^a long history of briefing files on disk$/, (ctx) => {
    ensureRepo(ctx);
    ctx.longHistoryDates = [0, 1, 2, 3, 10, 40, 400].map((n) => utcOffsetDate(ctx.today, n));
    for (const d of ctx.longHistoryDates) {
      fs.writeFileSync(path.join(ctx.briefingsDir, `${d}.md`), `Headline: history fixture ${d}\n\nBody.\n`);
    }
  });

  defineScoped(/^unrelated modified files in the working tree$/, (ctx) => {
    ensureRepo(ctx);
    fs.appendFileSync(path.join(ctx.repoDir, 'README.md'), 'an unrelated local edit\n');
  });

  defineScoped(/^a host whose local date differs from the UTC date$/, () => {
    // Non-behavioral marker - the actual TZ divergence is exercised by the
    // "the window decision used the UTC date" assertion below, which runs
    // handoffd.bb's real :today-str wiring literal under two DIFFERENT
    // extreme timezones and requires them to agree; nothing to fixture
    // here ahead of that.
  });

  defineScoped(/^the sweep mails it successfully$/, (ctx) => {
    ensureRepo(ctx);
    ctx.result = runBl821(ctx.briefingsDir, ctx.today, 'real', 'success');
  });

  defineScoped(/^the sweep tries to mail it and the send fails$/, (ctx) => {
    ensureRepo(ctx);
    ctx.result = runBl821(ctx.briefingsDir, ctx.today, 'real', 'fail');
  });

  defineScoped(/^the sweep runs$/, (ctx) => {
    ensureRepo(ctx);
    ctx.result = runBl821(ctx.briefingsDir, ctx.today, 'real', 'success');
  });

  defineScoped(/^the sweep runs a second time$/, (ctx) => {
    ctx.result = runBl821(ctx.briefingsDir, ctx.today, 'real', 'success');
  });

  defineScoped(/^the briefing is recorded as sent in the durable store$/, (ctx) => {
    const committed = git(ctx.repoDir, ['show', `HEAD:docs/briefings/.sent.json`]);
    const sent = JSON.parse(committed).sent || [];
    if (!sent.includes(`${ctx.lastBriefingDate}.md`)) {
      throw new Error(`expected ${ctx.lastBriefingDate}.md committed in the durable store's marker, got: ${committed}`);
    }
  });

  defineScoped(/^a fresh checkout of that store already lists it as sent$/, (ctx) => {
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl821-clone-'));
    git(cloneDir, ['clone', '-q', ctx.repoDir, '.']);
    const unsentOut = execFileSync('bb', [
      '-e',
      `(load-file "${path.join(SWARMFORGE_SCRIPTS, 'briefing_email_lib.bb')}") (println (pr-str (briefing-email-lib/find-unsent-briefings "${path.join(cloneDir, 'docs', 'briefings')}")))`,
    ], { encoding: 'utf8' }).trim();
    if (unsentOut.includes(`${ctx.lastBriefingDate}.md`)) {
      throw new Error(`expected a fresh clone to already see ${ctx.lastBriefingDate}.md as sent, but it was still unsent: ${unsentOut}`);
    }
  });

  defineScoped(/^the briefing is not recorded as sent in the durable store$/, (ctx) => {
    const sent = readSentSet(ctx.briefingsDir);
    if (sent.includes(`${ctx.lastBriefingDate}.md`)) {
      throw new Error(`expected ${ctx.lastBriefingDate}.md NOT recorded as sent after a failed send, got marker: ${JSON.stringify(sent)}`);
    }
  });

  defineScoped(/^the next sweep tries it again$/, (ctx) => {
    const second = runBl821(ctx.briefingsDir, ctx.today, 'real', 'success');
    if (!second.sent.includes(`${ctx.lastBriefingDate}.md`)) {
      throw new Error(`expected a retried sweep to offer ${ctx.lastBriefingDate}.md again after the earlier failed send, got: ${JSON.stringify(second)}`);
    }
    ctx.result = second;
  });

  defineScoped(/^none of those older briefings is mailed$/, (ctx) => {
    const unmailed = ctx.olderDates.filter((d) => !ctx.result.sent.includes(`${d}.md`));
    if (unmailed.length !== ctx.olderDates.length) {
      throw new Error(`expected none of ${JSON.stringify(ctx.olderDates)} mailed, but sent included some: ${JSON.stringify(ctx.result.sent)}`);
    }
  });

  defineScoped(/^the briefing is (mailed|suppressed)$/, (ctx, disposition) => {
    const name = `${ctx.lastBriefingDate}.md`;
    const wasMailed = ctx.result.sent.includes(name);
    if (disposition === 'mailed' && !wasMailed) {
      throw new Error(`expected ${name} mailed, got sent=${JSON.stringify(ctx.result.sent)}`);
    }
    if (disposition === 'suppressed' && wasMailed) {
      throw new Error(`expected ${name} suppressed, but it was mailed: ${JSON.stringify(ctx.result.sent)}`);
    }
  });

  defineScoped(/^the window decision used the UTC date$/, () => {
    const handoffdSrc = fs.readFileSync(HANDOFFD, 'utf8');
    if (!handoffdSrc.includes(TODAY_STR_WIRING_LITERAL)) {
      throw new Error(`expected handoffd.bb to still wire :today-str via the literal UTC-clock expression, got no match for: ${TODAY_STR_WIRING_LITERAL}`);
    }
    const evalUnderTz = (tz) => execFileSync('bb', ['-e', `(println ${TODAY_STR_WIRING_LITERAL})`], {
      encoding: 'utf8',
      env: { ...process.env, TZ: tz },
    }).trim();
    const underFarAhead = evalUnderTz('Pacific/Kiritimati'); // UTC+14
    const underFarBehind = evalUnderTz('Etc/GMT+12'); // UTC-12
    if (underFarAhead !== underFarBehind) {
      throw new Error(`expected the UTC-anchored today-str to be identical regardless of host TZ, got Pacific/Kiritimati=${underFarAhead} vs Etc/GMT+12=${underFarBehind}`);
    }
  });

  defineScoped(/^the sweep reports that briefing as suppressed for being outside the window$/, (ctx) => {
    const name = `${ctx.lastBriefingDate}.md`;
    if (!ctx.result.logs.some((l) => l[0] === 'briefing-suppressed-outside-window' && l[1] === name)) {
      throw new Error(`expected a briefing-suppressed-outside-window log for ${name}, got: ${JSON.stringify(ctx.result.logs)}`);
    }
  });

  defineScoped(/^that report is distinguishable from having generated no briefing at all$/, (ctx) => {
    // "no briefing generated at all" produces NO log line for the file
    // (find-unsent-briefings never even sees a name that doesn't exist);
    // the suppression path instead names the file explicitly - the two
    // are distinguishable by construction, proven directly by the
    // previous step already finding a NAMED log entry rather than silence.
    if (ctx.result.logs.length === 0) {
      throw new Error('expected at least one log line distinguishing suppression from silence, got none');
    }
  });

  defineScoped(/^two hosts running the sweep against the same durable store$/, (ctx) => {
    ctx.originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl821-origin-'));
    git(ctx.originDir, ['init', '-q', '--bare']);
    ctx.hostADir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl821-hosta-'));
    git(ctx.hostADir, ['clone', '-q', ctx.originDir, '.']);
    git(ctx.hostADir, ['config', 'user.email', 'aps@example.com']);
    git(ctx.hostADir, ['config', 'user.name', 'aps']);
    fs.mkdirSync(path.join(ctx.hostADir, 'docs', 'briefings'), { recursive: true });
    fs.writeFileSync(path.join(ctx.hostADir, 'README.md'), '# fixture repo\n');
    ctx.today = new Date().toISOString().slice(0, 10);
  });

  defineScoped(/^both hosts run their sweep$/, (ctx) => {
    const name = `${ctx.today}.md`;
    fs.writeFileSync(path.join(ctx.hostADir, 'docs', 'briefings', name), 'Headline: two-host fixture\n\nBody.\n');
    git(ctx.hostADir, ['add', 'README.md', `docs/briefings/${name}`]);
    git(ctx.hostADir, ['commit', '-q', '-m', 'seed']);
    git(ctx.hostADir, ['push', '-q', 'origin', 'HEAD:main']);

    const hostABriefings = path.join(ctx.hostADir, 'docs', 'briefings');
    const resultA = runBl821(hostABriefings, ctx.today, 'real', 'success');
    git(ctx.hostADir, ['push', '-q', 'origin', 'HEAD:main']);

    ctx.hostBDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl821-hostb-'));
    git(ctx.hostBDir, ['clone', '-q', ctx.originDir, '.']);
    git(ctx.hostBDir, ['config', 'user.email', 'aps@example.com']);
    git(ctx.hostBDir, ['config', 'user.name', 'aps']);
    git(ctx.hostBDir, ['pull', '-q', 'origin', 'main']);
    const hostBBriefings = path.join(ctx.hostBDir, 'docs', 'briefings');
    const resultB = runBl821(hostBBriefings, ctx.today, 'real', 'success');

    ctx.twoHostSentTotal = resultA.emailsSent + resultB.emailsSent;
  });

  defineScoped(/^the briefing is mailed exactly once$/, (ctx) => {
    if (ctx.twoHostSentTotal !== 1) {
      throw new Error(`expected exactly 1 global send across both hosts, got ${ctx.twoHostSentTotal}`);
    }
  });

  defineScoped(/^only the marker is committed to the durable store$/, (ctx) => {
    const stat = git(ctx.repoDir, ['show', '--stat', '-1', '--format=', 'HEAD']);
    if (!stat.includes('docs/briefings/.sent.json')) {
      throw new Error(`expected the last commit to touch the marker, got: ${stat}`);
    }
    if (stat.includes('README.md')) {
      throw new Error(`expected the unrelated README.md edit NOT in the marker's commit, got: ${stat}`);
    }
  });

  defineScoped(/^the unrelated modified files remain uncommitted$/, (ctx) => {
    const status = git(ctx.repoDir, ['status', '--porcelain']);
    if (!status.includes('README.md')) {
      throw new Error(`expected README.md to remain modified/uncommitted, got status: ${status}`);
    }
  });

  defineScoped(/^the window predicate reaches a definite decision for that file$/, (ctx) => {
    const name = `${ctx.lastBriefingDate}.md`;
    const wasMailed = ctx.result.sent.includes(name);
    const wasSuppressed = ctx.result.logs.some((l) => l[0] === 'briefing-suppressed-outside-window' && l[1] === name);
    if (wasMailed === wasSuppressed) {
      // both true is impossible by construction; both false means neither
      // branch ever decided on this file at all - the actual crash-vs-
      // silently-passing-through failure mode this scenario guards.
      throw new Error(`expected a definite mailed-XOR-suppressed decision for ${name}, got mailed=${wasMailed} suppressed=${wasSuppressed}`);
    }
  });

  defineScoped(/^the sweep does not fail$/, (ctx) => {
    if (!ctx.result) {
      throw new Error('expected the sweep to have produced a result without throwing');
    }
  });

  defineScoped(/^only briefings inside the window are mailed$/, (ctx) => {
    const inWindow = new Set([0, 1].map((n) => `${utcOffsetDate(ctx.today, n)}.md`));
    for (const sentName of ctx.result.sent) {
      if (!inWindow.has(sentName)) {
        throw new Error(`expected only in-window names mailed, but got out-of-window ${sentName} among ${JSON.stringify(ctx.result.sent)}`);
      }
    }
  });

  defineScoped(/^mailing the rest requires an explicit one-shot operator action$/, (ctx) => {
    // The ordinary sweep path (what "the sweep runs" above exercised) is
    // exactly send-unsent-briefings! with :today-str supplied - there is
    // no code path in this ticket's ordinary cadence that ever omits the
    // window, so re-running the SAME ordinary sweep again must still never
    // mail the suppressed history; a real catch-up would need a caller
    // that deliberately omits :today-str, which is a distinct, explicit
    // invocation this ticket does not wire into the daemon's own cadence.
    const again = runBl821(ctx.briefingsDir, ctx.today, 'real', 'success');
    const inWindow = new Set([0, 1].map((n) => `${utcOffsetDate(ctx.today, n)}.md`));
    for (const sentName of again.sent) {
      if (!inWindow.has(sentName)) {
        throw new Error(`expected the ordinary sweep to still never mail out-of-window history on a repeat run, got ${sentName}`);
      }
    }
  });
}

module.exports = { registerSteps };
