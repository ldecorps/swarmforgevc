'use strict';

// BL-2064: step handlers for "A local seat that reads without writing is
// told to write, then restarted". Drives the REAL local_model_repeat_guard.bb
// `answer` (via bl2064ReadBudgetGuardCli.bb, which load-files the production
// hook straight from swarmforge/scripts/ - never restated), against fixture
// transcripts under a tracked mkdtemp root - never the live seat. The
// ticket's own direction: "the kill and release seams are fakes" - unlike
// BL-1992's own driver, this feature never asserts on a real moved parcel
// or a real coordinator note, so both seams here are fakes that only write
// a sentinel file, the same shape BL-1991's own bl1991RestartGuardCli.bb
// already uses for its kill seam.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const CLI = path.join(__dirname, 'lib', 'bl2064ReadBudgetGuardCli.bb');

const FEATURE = 'A local seat that reads without writing is told to write, then restarted';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function callLine(name, args) {
  return JSON.stringify({ type: 'assistant', message: { role: 'model', parts: [{ functionCall: { name, args } }] } }) + '\n';
}

function compactionLine(nextStep) {
  const payload = {
    type: 'system',
    subtype: 'chat_compression',
    systemPayload: {
      compressedHistory: [{ role: 'user', parts: [{ text: `<state_snapshot>\n<next_step>\n${nextStep}\n</next_step>\n</state_snapshot>` }] }],
    },
  };
  return JSON.stringify(payload) + '\n';
}

function readCallLine(i) {
  return callLine('read_file', { file_path: `/bl2064-probe-${i}` });
}

// The four reset kinds scenario 02 names. "a git commit" never runs a real
// git command - read-budget-resets? only matches the command STRING for a
// known state-changing prefix, so a fixture run_shell_command call whose
// "command" arg merely contains "git commit" is exactly what it reads.
function resetLine(kind) {
  switch (kind) {
    case 'an edit':
      return callLine('edit', { file_path: '/bl2064-target.js', old_string: 'a', new_string: 'b' });
    case 'a write_file to tmp/notes.md':
      return callLine('write_file', { file_path: 'tmp/notes.md', content: 'plan\n' });
    case 'a compaction':
      return compactionLine('Keep going on the current change.');
    case 'a git commit':
      return callLine('run_shell_command', { command: 'git commit -m "wip"' });
    default:
      throw new Error(`unrecognized reset kind: ${kind}`);
  }
}

function appendTranscript(ctx, line) {
  fs.appendFileSync(ctx.transcriptPath, line);
}

function stateFiles(ctx) {
  const base = path.join(ctx.root, '.swarmforge', 'local-seat-restart', `${ctx.inProcessName}.json`);
  return { countFile: base, msgFile: `${base}.msg` };
}

function invokeGuard(ctx, name, args) {
  const eventPath = path.join(ctx.root, 'event.json');
  fs.writeFileSync(
    eventPath,
    JSON.stringify({
      tool_name: name,
      tool_input: args,
      transcript_path: ctx.transcriptPath,
      cwd: ctx.root,
      hook_event_name: 'PostToolUse',
    })
  );
  fs.rmSync(ctx.killedFile, { force: true });
  fs.rmSync(ctx.releasedFile, { force: true });
  const out = execFileSync('bb', [CLI, eventPath, ctx.killedFile, ctx.releasedFile], { encoding: 'utf8' });
  ctx.lastOutput = out;
  ctx.killed = fs.existsSync(ctx.killedFile);
  ctx.released = fs.existsSync(ctx.releasedFile);
}

function appendReads(ctx, n) {
  for (let i = 0; i < n; i += 1) {
    appendTranscript(ctx, readCallLine(ctx.nextReadIndex));
    ctx.nextReadIndex += 1;
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^a local seat holding a parcel with no restart used$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl2064-readbudget-');
    const inProcessName = 'parcel-01.handoff';
    mkdirp(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
    const inProcessPath = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process', inProcessName);
    fs.writeFileSync(inProcessPath, 'type: git_handoff\nto: coder@2\n');

    const transcriptPath = path.join(root, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, '');

    ctx.bl2064 = {
      root,
      transcriptPath,
      inProcessName,
      inProcessPath,
      killedFile: path.join(root, 'killed.flag'),
      releasedFile: path.join(root, 'released.flag'),
      nextReadIndex: 0,
    };
  });

  // Covers both the outline's <reads> and the literal "11"/"23" scenario
  // 03/04 use - all three are the same step shape with a different count.
  scoped(/^the seat's transcript has (\d+) read-type calls since its last write$/, (ctx, countStr) => {
    appendReads(ctx.bl2064, Number(countStr));
  });

  scoped(/^the seat's transcript has 20 read-type calls, then (.+?), then 3 read-type calls$/, (ctx, reset) => {
    appendReads(ctx.bl2064, 20);
    appendTranscript(ctx.bl2064, resetLine(reset));
    appendReads(ctx.bl2064, 3);
  });

  scoped(/^the seat makes another read_file call$/, (ctx) => {
    const args = { file_path: `/bl2064-probe-${ctx.bl2064.nextReadIndex}` };
    ctx.bl2064.nextReadIndex += 1;
    appendTranscript(ctx.bl2064, callLine('read_file', args));
    invokeGuard(ctx.bl2064, 'read_file', args);
  });

  scoped(/^the seat runs the shell command sed -n 1,40p swarmforge\/scripts\/local_model_repeat_guard\.bb$/, (ctx) => {
    const args = { command: 'sed -n 1,40p swarmforge/scripts/local_model_repeat_guard.bb' };
    appendTranscript(ctx.bl2064, callLine('run_shell_command', args));
    invokeGuard(ctx.bl2064, 'run_shell_command', args);
  });

  scoped(/^the parcel has already used both of its restarts$/, (ctx) => {
    const { countFile } = stateFiles(ctx.bl2064);
    mkdirp(path.dirname(countFile));
    fs.writeFileSync(countFile, JSON.stringify({ restarts: 2 }));
  });

  // One dispatcher for every "Then the guard ..." phrasing: the outline's
  // <answer> substitution and scenarios 02/03/04's own literal Then text
  // are all the identical step shape, registered in resolution order ahead
  // of any narrower pattern, so this is the only "the guard ..." handler
  // that can ever be reached.
  scoped(/^the guard (.+)$/, (ctx, answer) => {
    const { bl2064 } = ctx;
    if (answer === 'adds no read-budget note') {
      assert.equal(bl2064.killed, false, 'must not restart when no read-budget note is expected');
      assert.ok(
        !bl2064.lastOutput || !bl2064.lastOutput.includes('READ-BUDGET'),
        `expected no READ-BUDGET note, got: ${bl2064.lastOutput}`
      );
    } else if (answer === 'tells the seat it made 12 reads without a write and to write next') {
      assert.equal(bl2064.killed, false, 'the warn threshold must not restart the seat');
      assert.ok(bl2064.lastOutput && bl2064.lastOutput.includes('READ-BUDGET'), `expected a READ-BUDGET note, got: ${bl2064.lastOutput}`);
      assert.ok(bl2064.lastOutput.includes('12th read'), `expected the note to name its 12th read, got: ${bl2064.lastOutput}`);
      assert.ok(/change your ticket names|writing your/.test(bl2064.lastOutput), `expected the note to tell the seat to write next, got: ${bl2064.lastOutput}`);
    } else if (answer === 'restarts the seat with a first message naming its 24 reads') {
      assert.equal(bl2064.killed, true, 'expected the 24th read to restart the seat');
      assert.equal(bl2064.released, false, 'a restart must never also release the parcel');
      const { msgFile } = stateFiles(bl2064);
      assert.ok(fs.existsSync(msgFile), 'the launcher needs a pending override message to relaunch with');
      const msg = fs.readFileSync(msgFile, 'utf8');
      assert.ok(msg.includes('24 reads'), `expected the restart message to name its 24 reads, got: ${msg}`);
    } else if (answer === 'releases the parcel instead of restarting the seat') {
      assert.equal(bl2064.killed, false, 'a release must never also restart the seat');
      assert.equal(bl2064.released, true, 'expected the (fake) release seam to have been invoked');
    } else {
      throw new Error(`unrecognized guard answer: ${answer}`);
    }
  });
}

module.exports = { registerSteps };
