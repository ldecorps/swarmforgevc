'use strict';

// BL-1991: step handlers for the local-seat restart trial. Drives the REAL
// local_model_repeat_guard.bb `answer` (via bl1991RestartGuardCli.bb, which
// load-files the production hook straight from swarmforge/scripts/) against
// fixture transcripts under a tracked mkdtemp root - never the live seat,
// and never this checkout's own .swarmforge/ (the hazard this ticket's own
// trial-run exposed: calling the guard with no `cwd` in the event falls
// back to the real process's working directory, which - inside a live
// swarm worktree - IS a real seat's state. Every event here always carries
// an explicit cwd pointing at the fixture root).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const CLI = path.join(__dirname, 'lib', 'bl1991RestartGuardCli.bb');

const FEATURE = 'BL-1991 A local seat that skips the write its compaction named is restarted on that write';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function callLine(name, args) {
  return JSON.stringify({ type: 'assistant', message: { role: 'model', parts: [{ functionCall: { name, args } }] } }) + '\n';
}

function appendTranscript(ctx, line) {
  fs.appendFileSync(ctx.transcriptPath, line);
}

function overrideMessage(nextStep, namedPath) {
  return `${nextStep}\n\nWrite ${namedPath} now. Do not read ${namedPath} first - it does not exist yet.`;
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
  const out = execFileSync('bb', [CLI, eventPath, ctx.killedFile], { encoding: 'utf8' });
  ctx.lastOutput = out;
  ctx.killed = fs.existsSync(ctx.killedFile);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^a local coder seat holding a parcel whose latest compaction names a write of (\S+) as its next step$/, (ctx, namedPath) => {
    const root = trackedTmpRoot('sfvc-bl1991-restart-');
    const inProcessName = 'parcel-01.handoff';
    mkdirp(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
    const inProcessPath = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process', inProcessName);
    fs.writeFileSync(inProcessPath, 'type: git_handoff\nto: coder@2\n');

    const transcriptPath = path.join(root, 'transcript.jsonl');
    const nextStep = `Write ${namedPath} and run its feature.`;
    fs.writeFileSync(transcriptPath, compactionLine(nextStep));

    ctx.bl1991 = {
      root,
      transcriptPath,
      inProcessName,
      inProcessPath,
      inProcessContent: fs.readFileSync(inProcessPath, 'utf8'),
      namedPath,
      nextStep,
      killedFile: path.join(root, 'killed.flag'),
    };
  });

  scoped(/^a later compaction names "([^"]+)" as its next step$/, (ctx, nextStep) => {
    appendTranscript(ctx.bl1991, compactionLine(nextStep));
    ctx.bl1991.nextStep = nextStep;
  });

  scoped(/^the seat was already restarted twice on this parcel for a missed write$/, (ctx) => {
    const { countFile } = stateFiles(ctx.bl1991);
    mkdirp(path.dirname(countFile));
    fs.writeFileSync(countFile, JSON.stringify({ restarts: 2 }));
  });

  scoped(/^the seat has made two tool calls since that compaction, neither of them the named write$/, (ctx) => {
    appendTranscript(ctx.bl1991, callLine('read_file', { file_path: '/bl1991-probe-1' }));
    appendTranscript(ctx.bl1991, callLine('read_file', { file_path: '/bl1991-probe-2' }));
  });

  scoped(/^the seat has made two tool calls since that compaction$/, (ctx) => {
    appendTranscript(ctx.bl1991, callLine('run_shell_command', { command: 'node specs/pipeline/cli.js specs/features/BL-1928-x.feature' }));
    appendTranscript(ctx.bl1991, callLine('read_file', { file_path: '/bl1991-probe-3' }));
  });

  scoped(/^the seat makes a third tool call that is not the named write$/, (ctx) => {
    const call = { name: 'read_file', args: { file_path: '/bl1991-probe-3' } };
    appendTranscript(ctx.bl1991, callLine(call.name, call.args));
    invokeGuard(ctx.bl1991, call.name, call.args);
  });

  scoped(/^the seat makes a third tool call$/, (ctx) => {
    const call = { name: 'read_file', args: { file_path: '/bl1991-probe-4' } };
    appendTranscript(ctx.bl1991, callLine(call.name, call.args));
    invokeGuard(ctx.bl1991, call.name, call.args);
  });

  scoped(/^the seat writes the named file$/, (ctx) => {
    const args = { file_path: ctx.bl1991.namedPath, content: 'module.exports = {};\n' };
    appendTranscript(ctx.bl1991, callLine('write_file', args));
    invokeGuard(ctx.bl1991, 'write_file', args);
  });

  scoped(/^the seat's qwen process is ended and a fresh one is started$/, (ctx) => {
    assert.equal(ctx.bl1991.killed, true, 'the fake process controller must have been told to end qwen');
    const { msgFile } = stateFiles(ctx.bl1991);
    assert.ok(fs.existsSync(msgFile), 'the launcher needs a pending override message to relaunch with');
  });

  scoped(/^the fresh turn's only user message is the named next step, told to write the named file and not to read a file it is about to create$/, (ctx) => {
    const { msgFile } = stateFiles(ctx.bl1991);
    const actual = fs.readFileSync(msgFile, 'utf8');
    assert.equal(actual, overrideMessage(ctx.bl1991.nextStep, ctx.bl1991.namedPath));
  });

  scoped(/^the parcel is still in the seat's in_process$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.bl1991.inProcessPath), 'nothing may complete or hand off the parcel');
    assert.equal(fs.readFileSync(ctx.bl1991.inProcessPath, 'utf8'), ctx.bl1991.inProcessContent);
  });

  scoped(/^the seat's qwen process is not restarted$/, (ctx) => {
    assert.equal(ctx.bl1991.killed, false, 'the fake process controller must not have been told to end qwen');
    const { msgFile } = stateFiles(ctx.bl1991);
    assert.ok(!fs.existsSync(msgFile), 'no pending override may be left for the launcher');
  });
}

module.exports = { registerSteps };
