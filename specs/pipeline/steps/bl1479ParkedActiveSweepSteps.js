'use strict';

// BL-1479: an active ticket that cannot advance (status: blocked, or a
// future not_before) does not hold its slot - a sweep parks it back to
// paused/ unless a parcel is anywhere in the pipeline for it. Drives the
// REAL chase_sweep_lib.bb functions (read-park-candidates,
// parked-active-items, park-ticket!) via `bb -e`, never a
// reimplementation; this handler IS the sweep's own orchestration loop
// for test purposes ("the park sweep's clock, mailbox listing, log and
// commit seams are injected" - the clock and mailbox listing are plain
// injected arguments to parked-active-items already; the log and commit
// seams are this handler's own note/log tracking arrays, driving the
// real park-ticket! for the actual git mv + commit).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1479 A ticket that cannot advance does not hold an active slot';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function initRepo(root) {
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
}

function writeTicket(root, id, extraYaml) {
  const content = `id: ${id}\ntitle: "generated"\npriority: 5\n${extraYaml || ''}`;
  const file = path.join(root, 'backlog', 'active', `${id}-x.yaml`);
  fs.writeFileSync(file, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', `fixture: seed ${id}`);
  return { content, file };
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[cheshire.core :as json])\n(load-file "${LIB}")\n${body}`;
}

// The sweep's own orchestration, reimplemented here ONLY as a loop over
// the REAL decision/action functions (never a second decision or a second
// git-mv) - this is exactly what handoffd.bb's parked-active-sweep! does,
// with this handler's own arrays standing in for the log fn and the
// coordinator-note fn (the "seams" the Background declares injected).
function runParkSweep(root, liveTicketIds, today) {
  const liveForm = `#{${liveTicketIds.map((s) => `"${s}"`).join(' ')}}`;
  const out = bb(libExpr(
    `(let [candidates (chase-sweep-lib/read-park-candidates (babashka.fs/path "${root}" "backlog" "active"))
           {:keys [to-park refused]} (chase-sweep-lib/parked-active-items candidates ${liveForm} "${today}")]
       (println (json/generate-string {:to-park to-park :refused refused})))`,
  ));
  const parsed = JSON.parse(out);
  const notes = [];
  const logs = [];
  for (const item of parsed['to-park']) {
    const result = JSON.parse(bb(libExpr(
      `(println (json/generate-string (chase-sweep-lib/park-ticket! "${root}" {:id "${item.id}" :file "${item.file}" :condition "${item.condition}"})))`,
    )));
    assert.ok(result.success, `expected park-ticket! to succeed for ${item.id}, got: ${JSON.stringify(result)}`);
    notes.push({ id: item.id, condition: item.condition });
  }
  for (const item of parsed.refused) {
    logs.push({ id: item.id, condition: item.condition, reason: 'parcel-in-flight' });
  }
  return { notes, logs, toPark: parsed['to-park'], refused: parsed.refused };
}

const CONDITION_KINDS = {
  'declares status: blocked': { yaml: 'status: blocked\n', label: 'blocked' },
  'declares a not_before later than the sweep\'s day': { yaml: 'status: todo\nnot_before: 2099-01-01\n', label: 'not_before: 2099-01-01' },
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture backlog under a scratch root with an active depth cap of (\d+)$/, (ctx, cap) => {
    ctx.root = mkSocketFixtureRoot('bl1479-fixture-');
    initRepo(ctx.root);
    ctx.cap = Number(cap);
    ctx.today = '2026-09-07';
    ctx.liveTicketIds = [];
    // A second, healthy ticket occupying the OTHER slot at the cap - the
    // fixture the "active count is one below the cap" assertion needs: a
    // single-ticket fixture would go from "at the cap" straight to
    // "empty" on a park, never "one below" anything.
    writeTicket(ctx.root, 'BL-9000', 'status: todo\n');
  });

  scoped(/^the park sweep's clock, mailbox listing, log and commit seams are injected$/, () => {
    // Recorded by construction above (ctx.today, ctx.liveTicketIds) and by
    // runParkSweep's own log/note arrays below - nothing further to do.
  });

  scoped(/^an active ticket with no parcel in any mailbox that (.+)$/, (ctx, condition) => {
    const kind = CONDITION_KINDS[condition];
    assert.ok(kind, `unknown Examples condition "${condition}"`);
    const { content, file } = writeTicket(ctx.root, 'BL-9001', kind.yaml);
    ctx.ticketId = 'BL-9001';
    ctx.ticketContent = content;
    ctx.ticketFile = file;
    ctx.expectedCondition = kind.label;
  });

  scoped(/^an active ticket declaring status: blocked whose task name is in a role's in_process mailbox$/, (ctx) => {
    writeTicket(ctx.root, 'BL-9001', 'status: blocked\n');
    ctx.ticketId = 'BL-9001';
    ctx.liveTicketIds = ['BL-9001'];
  });

  scoped(/^an active ticket with status todo and a not_before equal to the sweep's day$/, (ctx) => {
    writeTicket(ctx.root, 'BL-9001', `status: todo\nnot_before: ${ctx.today}\n`);
    ctx.ticketId = 'BL-9001';
  });

  scoped(/^a ticket the sweep parked for a not_before that is now yesterday$/, (ctx) => {
    // Two distinct "today"s: the not_before sat in the FUTURE relative to
    // the day the sweep actually parked it (parkDay), and now sits in the
    // PAST relative to "today" (ctx.today, unchanged - the promotion
    // gates' own clock below) - "now yesterday" describes ctx.today's
    // vantage point, not the park's own.
    const notBefore = '2026-06-15';
    const parkDay = '2026-01-01';
    writeTicket(ctx.root, 'BL-9001', `status: todo\nnot_before: ${notBefore}\n`);
    const sweepResult = runParkSweep(ctx.root, [], parkDay);
    assert.ok(
      sweepResult.notes.some((n) => n.id === 'BL-9001'),
      `expected BL-9001 to have been parked by the sweep as test setup, got: ${JSON.stringify(sweepResult)}`,
    );
    ctx.pausedContent = fs.readFileSync(path.join(ctx.root, 'backlog', 'paused', 'BL-9001-x.yaml'), 'utf8');
  });

  scoped(/^the park sweep runs$/, (ctx) => {
    ctx.sweepResult = runParkSweep(ctx.root, ctx.liveTicketIds, ctx.today);
  });

  scoped(/^the promotion gates evaluate it$/, (ctx) => {
    const escapedContent = ctx.pausedContent.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const out = bb(
      `(require '[cheshire.core :as json])\n` +
      `(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_lib.bb')}")\n` +
      `(println (json/generate-string (promotion-gates-lib/evaluate ` +
      `{:content "${escapedContent}" :held? false :active-count 0 :max-depth 5 ` +
      `:active-epics {} :today "${ctx.today}"})))`,
    );
    ctx.evaluateResult = JSON.parse(out);
  });

  scoped(/^the ticket is in backlog\/paused\/ and not in backlog\/active\/$/, (ctx) => {
    assert.ok(
      fs.existsSync(path.join(ctx.root, 'backlog', 'paused', `${ctx.ticketId}-x.yaml`)),
      `expected ${ctx.ticketId} in backlog/paused/`,
    );
    assert.ok(
      !fs.existsSync(path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}-x.yaml`)),
      `expected ${ctx.ticketId} absent from backlog/active/`,
    );
  });

  scoped(/^its YAML is byte-identical to before the park$/, (ctx) => {
    const pausedContent = fs.readFileSync(path.join(ctx.root, 'backlog', 'paused', `${ctx.ticketId}-x.yaml`), 'utf8');
    assert.equal(pausedContent, ctx.ticketContent);
  });

  scoped(/^the coordinator receives one note naming the ticket and (.+)$/, (ctx, condition) => {
    const kind = CONDITION_KINDS[condition];
    assert.ok(kind, `unknown Examples condition "${condition}"`);
    const matching = ctx.sweepResult.notes.filter((n) => n.id === ctx.ticketId);
    assert.equal(matching.length, 1, `expected exactly one note for ${ctx.ticketId}, got: ${JSON.stringify(ctx.sweepResult.notes)}`);
    assert.ok(
      matching[0].condition.includes(kind.label),
      `expected the note to name "${kind.label}", got: ${JSON.stringify(matching[0])}`,
    );
  });

  scoped(/^the active count is one below the cap$/, (ctx) => {
    const activeCount = fs.readdirSync(path.join(ctx.root, 'backlog', 'active')).filter((f) => f.endsWith('.yaml')).length;
    assert.equal(activeCount, ctx.cap - 1, `expected active count ${ctx.cap - 1}, got ${activeCount}`);
  });

  scoped(/^the ticket stays in backlog\/active\/$/, (ctx) => {
    assert.ok(
      fs.existsSync(path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}-x.yaml`)),
      `expected ${ctx.ticketId} to remain in backlog/active/`,
    );
  });

  scoped(/^the log records that the park was refused because a parcel is in flight$/, (ctx) => {
    const matching = ctx.sweepResult.logs.filter((l) => l.id === ctx.ticketId);
    assert.equal(matching.length, 1, `expected exactly one refusal log entry for ${ctx.ticketId}, got: ${JSON.stringify(ctx.sweepResult.logs)}`);
    assert.equal(matching[0].reason, 'parcel-in-flight');
  });

  scoped(/^no note is sent$/, (ctx) => {
    assert.equal(
      ctx.sweepResult.notes.filter((n) => n.id === ctx.ticketId).length,
      0,
      `expected no note for ${ctx.ticketId}, got: ${JSON.stringify(ctx.sweepResult.notes)}`,
    );
  });

  scoped(/^no gate refuses it$/, (ctx) => {
    assert.equal(ctx.evaluateResult.ok, true, `expected no gate to refuse, got: ${JSON.stringify(ctx.evaluateResult)}`);
  });
}

module.exports = { registerSteps };
