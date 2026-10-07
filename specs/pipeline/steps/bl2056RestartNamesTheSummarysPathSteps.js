'use strict';

// BL-2056: step handlers for "A restart reads and names the file its
// compaction summary named, at the path the summary wrote". Drives the REAL
// local_model_repeat_guard.bb `answer` (via bl1991RestartGuardCli.bb, which
// load-files the production hook straight from swarmforge/scripts/ - the
// same driver BL-1991 uses, never restated) against fixture transcripts
// under a tracked mkdtemp root - never the live seat, and never this
// checkout's own .swarmforge/ (every event carries an explicit cwd pointing
// at the fixture root).
//
// The guard's own defect this feature pins: `named-write-path` dropped a
// path's leading "/", and `named-write-call?` compared the result with the
// call's `file_path` exactly, so a seat that edited the named file at its
// absolute path (every edit and write_file in the iq3 coder's recorded
// sessions did) was still judged to have missed the write, and the restart
// message told the seat a file that exists does not exist yet.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const CLI = path.join(__dirname, 'lib', 'bl1991RestartGuardCli.bb');

const FEATURE = 'BL-2056 A restart reads and names the file its compaction summary named, at the path the summary wrote';

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

  scoped(
    /^a local coder seat whose latest compaction names an edit of (.+?), written as an (absolute|relative) path, as its next step$/,
    (ctx, namedPath, form) => {
      const root = trackedTmpRoot('sfvc-bl2056-restart-');
      const inProcessName = 'parcel-01.handoff';
      mkdirp(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
      const inProcessPath = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process', inProcessName);
      fs.writeFileSync(inProcessPath, 'type: git_handoff\nto: coder@2\n');

      const transcriptPath = path.join(root, 'transcript.jsonl');
      const writtenPath = form === 'absolute' ? path.join(root, namedPath) : namedPath;
      const nextStep = `Edit ${writtenPath} and run its feature.`;
      fs.writeFileSync(transcriptPath, compactionLine(nextStep));

      ctx.bl2056 = {
        root,
        transcriptPath,
        inProcessName,
        inProcessPath,
        inProcessContent: fs.readFileSync(inProcessPath, 'utf8'),
        namedPath,
        writtenPath,
        nextStep,
        killedFile: path.join(root, 'killed.flag'),
      };
    }
  );

  scoped(
    /^a local coder seat whose latest compaction names a write of (.+?), written as a relative path, as its next step$/,
    (ctx, namedPath) => {
      const root = trackedTmpRoot('sfvc-bl2056-restart-');
      const inProcessName = 'parcel-01.handoff';
      mkdirp(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
      const inProcessPath = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process', inProcessName);
      fs.writeFileSync(inProcessPath, 'type: git_handoff\nto: coder@2\n');

      const transcriptPath = path.join(root, 'transcript.jsonl');
      const nextStep = `Write ${namedPath} and run its feature.`;
      fs.writeFileSync(transcriptPath, compactionLine(nextStep));

      ctx.bl2056 = {
        root,
        transcriptPath,
        inProcessName,
        inProcessPath,
        inProcessContent: fs.readFileSync(inProcessPath, 'utf8'),
        namedPath,
        writtenPath: namedPath,
        nextStep,
        killedFile: path.join(root, 'killed.flag'),
      };
    }
  );

  scoped(/^that file exists in the seat's worktree$/, (ctx) => {
    const filePath = path.join(ctx.bl2056.root, ctx.bl2056.namedPath);
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, 'module.exports = {};\n');
  });

  scoped(/^that file does not exist in the seat's worktree$/, (ctx) => {
    const filePath = path.join(ctx.bl2056.root, ctx.bl2056.namedPath);
    assert.ok(!fs.existsSync(filePath), `expected ${filePath} to be missing, but it exists`);
  });

  scoped(/^since that compaction the seat has edited that file at its absolute path and made one other tool call$/, (ctx) => {
    appendTranscript(ctx.bl2056, callLine('edit', {
      file_path: path.join(ctx.bl2056.root, ctx.bl2056.namedPath),
      old_string: 'a',
      new_string: 'b',
    }));
    appendTranscript(ctx.bl2056, callLine('read_file', { file_path: '/bl2056-probe-1' }));
  });

  scoped(/^the seat has made two tool calls since that compaction, neither of them the named write$/, (ctx) => {
    appendTranscript(ctx.bl2056, callLine('read_file', { file_path: '/bl2056-probe-2' }));
    appendTranscript(ctx.bl2056, callLine('read_file', { file_path: '/bl2056-probe-3' }));
  });

  scoped(/^the seat makes a third tool call that is not the named write$/, (ctx) => {
    const call = { name: 'read_file', args: { file_path: '/bl2056-probe-4' } };
    appendTranscript(ctx.bl2056, callLine(call.name, call.args));
    invokeGuard(ctx.bl2056, call.name, call.args);
  });

  scoped(/^the seat's qwen process is not restarted$/, (ctx) => {
    assert.equal(ctx.bl2056.killed, false, 'the fake process controller must not have been told to end qwen');
    const { msgFile } = stateFiles(ctx.bl2056);
    assert.ok(!fs.existsSync(msgFile), 'no pending override may be left for the launcher');
  });

  scoped(/^the fresh turn's only user message names that file at its absolute path$/, (ctx) => {
    const { msgFile } = stateFiles(ctx.bl2056);
    assert.ok(fs.existsSync(msgFile), 'the launcher needs a pending override message to relaunch with');
    const actual = fs.readFileSync(msgFile, 'utf8');
    const absolutePath = path.join(ctx.bl2056.root, ctx.bl2056.namedPath);
    assert.ok(actual.includes(absolutePath), `expected the message to name ${absolutePath}, got: ${actual}`);
  });

  scoped(/^the message tells the seat to edit that file and never says that it does not exist$/, (ctx) => {
    const { msgFile } = stateFiles(ctx.bl2056);
    const actual = fs.readFileSync(msgFile, 'utf8');
    assert.ok(/^Edit .* now\./m.test(actual), `expected the message to tell the seat to edit the file, got: ${actual}`);
    assert.ok(!actual.includes('does not exist'), `the message must never say the file does not exist, got: ${actual}`);
  });

  scoped(/^the message tells the seat to read only the lines it will change before editing, and never not to read the file$/, (ctx) => {
    const { msgFile } = stateFiles(ctx.bl2056);
    const actual = fs.readFileSync(msgFile, 'utf8');
    assert.ok(actual.includes('Read only the lines you will change'), `expected the message to tell the seat to read only the lines it will change, got: ${actual}`);
    assert.ok(!actual.includes('Do not read'), `the message must never tell the seat not to read the file, got: ${actual}`);
  });

  scoped(/^the fresh turn's only user message tells the seat to write tmp\/notes\.md and not to read it first$/, (ctx) => {
    const { msgFile } = stateFiles(ctx.bl2056);
    assert.ok(fs.existsSync(msgFile), 'the launcher needs a pending override message to relaunch with');
    const actual = fs.readFileSync(msgFile, 'utf8');
    assert.ok(actual.includes('Write tmp/notes.md now.'), `expected the message to tell the seat to write tmp/notes.md, got: ${actual}`);
    assert.ok(actual.includes('Do not read tmp/notes.md first'), `expected the message to say not to read it first, got: ${actual}`);
  });
}

module.exports = { registerSteps };
