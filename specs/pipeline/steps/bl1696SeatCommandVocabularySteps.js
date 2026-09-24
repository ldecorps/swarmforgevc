'use strict';

// BL-1696: step handlers for "seat gives a local aider seat its whole
// command vocabulary". Drives the REAL swarmforge/scripts/seat script
// (copied verbatim into a throwaway git repo by
// extension/test/helpers/seatFixture.js) against recorder-stub pipeline
// scripts that only append their own name and argv to one log - never a
// reimplementation of seat itself, and no real pipeline script or model is
// ever run (engineering.prompt "Acceptance Pipeline").
//
// This file never allocates its own temp directory - fixture-root handling
// (creation, prefix sweep, teardown) lives entirely in the shared helper,
// wired into this runtime's own per-scenario disposal hook below.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeSeatFixture, CONFLICT_FILE_NAME } = require('../../../extension/test/helpers/seatFixture');

const FEATURE = 'BL-1696 seat gives a local aider seat its whole command vocabulary';

// Scenario Outline handlers validate against explicit KNOWN_VALUES, never a
// passthrough parse of the Examples table's own display text (BL-1696's
// argv column mixes a literal sentinel - NONE/DRAFT - with a human-readable
// rendering of the ask row's expected argv; only the sentinels are parsed,
// the ask row is reconstructed from the verb's own known contract instead).
const TOKEN_SUBSTITUTIONS = {
  EIGHTY_ONE_CHARACTERS: () => 'a'.repeat(81),
  A_REAL_COMMIT: (ctx) => ctx.fixture.headSha(),
};

// Scenario 01's own well-formed content, pinned as literals rather than
// re-derived from the invocation text at match time: a value re-derived
// from the SAME Examples cell the acceptance-mutation tool perturbs would
// mutate in lockstep with the "actual" side of the comparison, so the
// check could never disagree with itself (the exact passthrough this
// file's own header forbids). Pinning the literal here means a mutation
// to either the "ask"/"note" invocation text or the seat script's own
// argument threading shows up as a real mismatch.
const KNOWN_ASK_QUESTION = 'BL-7: the acceptance test stays red';
const KNOWN_NOTE_MESSAGE = 'BL-7 is on its way';

// The ask row's argv column is the one non-sentinel display value in the
// table, spelling out "ROOT --role <role> --question <text>" for a human
// to read - parsed here as a SECOND, independent source for the expected
// argv, cross-checked against the pinned KNOWN_ASK_QUESTION literal above.
// Two independent sources must agree before either is trusted: a mutation
// to the argv column alone (leaving the invocation and the pinned literal
// untouched) now disagrees with the literal, and a mutation to the
// invocation alone disagrees with the (unmutated) argv column's own text.
const ASK_ARGV_COLUMN_PATTERN = /^ROOT --role (\S+) --question (.+)$/;

function tokenizeInvocation(invocation) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(invocation)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

function resolveTokens(tokens, ctx) {
  return tokens.map((t) =>
    Object.prototype.hasOwnProperty.call(TOKEN_SUBSTITUTIONS, t) ? TOKEN_SUBSTITUTIONS[t](ctx) : t
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a throwaway git repository whose pipeline scripts only record the arguments they receive$/, (ctx) => {
    ctx.fixture = makeSeatFixture();
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => {
      ctx.fixture.cleanup();
    });
  });

  scoped(/^the repository's roles file lists coordinator, coder, cleaner and QA$/, (ctx) => {
    ctx.fixture.writeRolesFile(['coordinator', 'coder', 'cleaner', 'QA']);
  });

  // ── Shared Given/When steps ──────────────────────────────────────────
  scoped(/^the seat runs as role "([^"]+)"$/, (ctx, role) => {
    ctx.role = role;
  });

  scoped(/^the seat runs "(.+)"$/, (ctx, invocationRaw) => {
    const tokens = resolveTokens(tokenizeInvocation(invocationRaw), ctx);
    ctx.invocationTokens = tokens;
    ctx.verb = tokens[0];
    ctx.statusBefore = ctx.fixture.statusPorcelain();
    ctx.result = ctx.fixture.run(ctx.role, tokens);
  });

  scoped(/^the seat runs "merge coordinator" with that commit$/, (ctx) => {
    ctx.invocationTokens = ['merge', 'coordinator', ctx.mergeSha];
    ctx.verb = 'merge';
    ctx.statusBefore = ctx.fixture.statusPorcelain();
    ctx.headBeforeMerge = ctx.fixture.headSha();
    ctx.result = ctx.fixture.run(ctx.role, ctx.invocationTokens);
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^it exits (\d+)$/, (ctx, code) => {
    assert.equal(
      ctx.result.status,
      Number(code),
      `expected exit ${code}, got ${ctx.result.status}: stdout=${ctx.result.stdout} stderr=${ctx.result.stderr}`
    );
  });

  scoped(/^exactly one recorded call exists, to "([^"]+)" with arguments "(.+)"$/, (ctx, script, argvDescriptor) => {
    const calls = ctx.fixture.recordedCalls();
    assert.equal(calls.length, 1, `expected exactly one recorded call, got: ${JSON.stringify(calls)}`);
    const call = calls[0];
    assert.equal(call.script, script, `expected a call to ${script}, got: ${JSON.stringify(call)}`);
    if (argvDescriptor === 'NONE') {
      assert.deepEqual(call.argv, [], `expected no arguments, got: ${JSON.stringify(call.argv)}`);
    } else if (argvDescriptor === 'DRAFT') {
      assert.equal(call.argv.length, 1, `expected one draft-path argument, got: ${JSON.stringify(call.argv)}`);
      assert.ok(fs.existsSync(call.argv[0]), `expected ${call.argv[0]} to be a real file`);
      const draft = ctx.fixture.readDraft(ctx.role);
      assert.ok(draft, 'expected a readable note draft');
      assert.equal(ctx.verb, 'note', `unhandled DRAFT descriptor for verb ${ctx.verb}`);
      assert.equal(draft.fields.type, 'note');
      assert.equal(draft.fields.to, 'cleaner', `expected note draft "to: cleaner", got: ${JSON.stringify(draft.fields)}`);
      assert.equal(
        draft.fields.priority,
        '50',
        `expected note draft "priority: 50", got: ${JSON.stringify(draft.fields)}`
      );
      assert.equal(
        draft.fields.message,
        KNOWN_NOTE_MESSAGE,
        `expected note draft "message: ${KNOWN_NOTE_MESSAGE}", got: ${JSON.stringify(draft.fields)}`
      );
    } else {
      assert.equal(ctx.verb, 'ask', `unhandled argv descriptor for verb ${ctx.verb}: ${argvDescriptor}`);
      const columnMatch = ASK_ARGV_COLUMN_PATTERN.exec(argvDescriptor);
      assert.ok(
        columnMatch,
        `expected the argv column to read "ROOT --role <role> --question <text>", got: ${argvDescriptor}`
      );
      const [, columnRole, columnQuestion] = columnMatch;
      assert.equal(columnRole, ctx.role, `argv column role disagrees with the running role: ${argvDescriptor}`);
      assert.equal(
        columnQuestion,
        KNOWN_ASK_QUESTION,
        `argv column question disagrees with the pinned literal: ${argvDescriptor}`
      );
      const expected = [ctx.fixture.projectRoot(), '--role', ctx.role, '--question', KNOWN_ASK_QUESTION];
      assert.deepEqual(call.argv, expected, `expected argv ${JSON.stringify(expected)}, got: ${JSON.stringify(call.argv)}`);
    }
  });

  // ── Scenario 02 (Outline) ────────────────────────────────────────────
  scoped(/^it exits 2 and prints the usage of the verb, or the role's verbs for an unknown one$/, (ctx) => {
    assert.equal(ctx.result.status, 2, `expected exit 2, got ${ctx.result.status}: stderr=${ctx.result.stderr}`);
    assert.ok(
      /usage:|unknown verb/.test(ctx.result.stderr),
      `expected a usage line or an unknown-verb message, got: ${ctx.result.stderr}`
    );
  });

  scoped(/^no script call is recorded and the working tree is unchanged$/, (ctx) => {
    assert.equal(
      ctx.fixture.recordedCalls().length,
      0,
      `expected no recorded calls, got: ${JSON.stringify(ctx.fixture.recordedCalls())}`
    );
    assert.equal(ctx.fixture.statusPorcelain(), ctx.statusBefore || '', 'expected the working tree to be unchanged');
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the handoff helper answers the first call for a draft with AUDIT_REQUIRED$/, (ctx) => {
    ctx.fixture.setAuditChallenge(true);
  });

  scoped(
    /^the coder's draft names type git_handoff, recipient cleaner, task BL-7 and the 10-hex HEAD commit$/,
    (ctx) => {
      const draft = ctx.fixture.readDraft('coder');
      assert.ok(draft, 'expected a readable handoff draft');
      assert.equal(draft.fields.type, 'git_handoff');
      assert.equal(draft.fields.to, 'cleaner');
      assert.equal(draft.fields.task, 'BL-7');
      assert.match(draft.fields.commit, /^[0-9a-f]{10}$/, `expected a 10-hex commit, got: ${draft.fields.commit}`);
      assert.equal(draft.fields.commit, ctx.fixture.shortHeadSha());
    }
  );

  scoped(/^the handoff helper was called twice with a byte-identical draft$/, (ctx) => {
    const calls = ctx.fixture.recordedCalls().filter((c) => c.script === 'swarm_handoff.sh');
    assert.equal(calls.length, 2, `expected two swarm_handoff.sh calls, got: ${JSON.stringify(calls)}`);
    assert.equal(calls[0].argv.length, 1);
    assert.deepEqual(calls[0].argv, calls[1].argv, 'expected both calls to name the identical draft path');
  });

  // ── Scenarios 04 / 05 ────────────────────────────────────────────────
  scoped(/^a commit on another branch conflicts with the checkout in one file$/, (ctx) => {
    ctx.mergeSha = ctx.fixture.makeConflictingSideCommit();
  });

  scoped(/^a commit on another branch touches a file the checkout does not$/, (ctx) => {
    ctx.mergeSha = ctx.fixture.makeCleanSideCommit();
  });

  scoped(/^it exits 3 and prints the conflicted path$/, (ctx) => {
    assert.equal(ctx.result.status, 3, `expected exit 3, got ${ctx.result.status}: stderr=${ctx.result.stderr}`);
    assert.ok(
      ctx.result.stderr.includes(CONFLICT_FILE_NAME),
      `expected the conflicted path (${CONFLICT_FILE_NAME}) in stderr, got: ${ctx.result.stderr}`
    );
  });

  scoped(/^the checkout has no merge in progress and its HEAD is unchanged$/, (ctx) => {
    assert.equal(ctx.fixture.hasMergeInProgress(), false, 'expected no merge in progress');
    assert.equal(ctx.fixture.headSha(), ctx.headBeforeMerge, 'expected HEAD unchanged');
  });

  scoped(/^the new HEAD is a merge commit whose parents are the old HEAD and that commit$/, (ctx) => {
    const parents = ctx.fixture.headParents().slice().sort();
    const expected = [ctx.headBeforeMerge, ctx.mergeSha].sort();
    assert.deepEqual(parents, expected, `expected parents ${JSON.stringify(expected)}, got: ${JSON.stringify(parents)}`);
  });

  // ── Scenario 06 ──────────────────────────────────────────────────────
  scoped(/^the live pack declares no seat test command$/, () => {
    // no-op: the fixture never writes a `config seat_test_command` line.
  });

  scoped(/^it exits 2 and says no seat test command is configured$/, (ctx) => {
    assert.equal(ctx.result.status, 2, `expected exit 2, got ${ctx.result.status}: stderr=${ctx.result.stderr}`);
    assert.ok(
      /no seat test command is configured/.test(ctx.result.stderr),
      `expected the configuration message, got: ${ctx.result.stderr}`
    );
  });
}

module.exports = { registerSteps };
