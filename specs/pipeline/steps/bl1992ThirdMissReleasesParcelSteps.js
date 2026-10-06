'use strict';

// BL-1992: step handlers for "A third missed write releases the parcel to
// another coder seat". Drives the REAL local_model_repeat_guard.bb `answer`
// (via bl1992ReleaseGuardCli.bb, which load-files the production hook
// straight from swarmforge/scripts/ - never restated), against a real git
// fixture and a real swarm_handoff.sh send (SWARMFORGE_SKIP_SYNC_INJECT=1
// skips only the tmux wake-up, never the note itself), under a tracked
// mkdtemp root. Shares BL-1991's own transcript-building conventions but
// never its fixture object (a different feature, so a fresh ctx key and a
// fresh scoped registration even for step text repeated word for word -
// BL-425).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const CLI = path.join(__dirname, 'lib', 'bl1992ReleaseGuardCli.bb');

const FEATURE = 'BL-1992 A third missed write releases the parcel to another coder seat';

const TICKET = 'BL-1928';
const NAMED_PATH = 'specs/pipeline/steps/bl1928SeatToolingFromOriginMainSteps.js';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(root, args) {
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
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

function inProcessDir(ctx) {
  return path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function abandonedDir(ctx) {
  return path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'abandoned');
}

function outboxHandoffs(ctx) {
  const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'outbox');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.handoff'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
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
  const out = execFileSync('bb', [CLI, eventPath, ctx.killedFile], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: 'coder', SWARMFORGE_SKIP_SYNC_INJECT: '1' },
  });
  ctx.lastOutput = out;
  ctx.killed = fs.existsSync(ctx.killedFile);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(
    /^a local coder seat already restarted twice on its parcel for a missed write, whose latest compaction names a write of (\S+) as its next step$/,
    (ctx, namedPath) => {
      const root = trackedTmpRoot('sfvc-bl1992-release-');
      git(root, ['init', '-q', '-b', 'main']);
      git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

      mkdirp(path.join(root, '.swarmforge'));
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'roles.tsv'),
        [
          ['coder', 'coder-wt', root, 'swarmforge-coder', 'Coder', 'local-model', 'task'].join('\t'),
          ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'].join('\t'),
        ].join('\n') + '\n'
      );

      const inProcessName = 'parcel-01.handoff';
      mkdirp(inProcessDir({ root }));
      const inProcessPath = path.join(inProcessDir({ root }), inProcessName);
      fs.writeFileSync(inProcessPath, `type: git_handoff\nto: coder\ntask: ${TICKET}\ncommit: 0000000000\n`);

      const countFile = path.join(root, '.swarmforge', 'local-seat-restart', `${inProcessName}.json`);
      mkdirp(path.dirname(countFile));
      fs.writeFileSync(countFile, JSON.stringify({ restarts: 2 }));

      const transcriptPath = path.join(root, 'transcript.jsonl');
      const nextStep = `Write ${namedPath} and run its feature.`;
      fs.writeFileSync(transcriptPath, compactionLine(nextStep));

      ctx.bl1992 = {
        root,
        transcriptPath,
        inProcessName,
        inProcessPath,
        inProcessContent: fs.readFileSync(inProcessPath, 'utf8'),
        namedPath,
        nextStep,
        killedFile: path.join(root, 'killed.flag'),
      };
    }
  );

  scoped(/^the seat has made two tool calls since that compaction, neither of them the named write$/, (ctx) => {
    appendTranscript(ctx.bl1992, callLine('read_file', { file_path: '/bl1992-probe-1' }));
    appendTranscript(ctx.bl1992, callLine('read_file', { file_path: '/bl1992-probe-2' }));
  });

  scoped(/^the seat makes a third tool call that is not the named write$/, (ctx) => {
    const call = { name: 'read_file', args: { file_path: '/bl1992-probe-3' } };
    appendTranscript(ctx.bl1992, callLine(call.name, call.args));
    invokeGuard(ctx.bl1992, call.name, call.args);
  });

  scoped(/^the seat writes the named file$/, (ctx) => {
    const args = { file_path: ctx.bl1992.namedPath, content: 'module.exports = {};\n' };
    appendTranscript(ctx.bl1992, callLine('write_file', args));
    invokeGuard(ctx.bl1992, 'write_file', args);
  });

  scoped(/^the parcel is no longer in the seat's in_process$/, (ctx) => {
    assert.ok(!fs.existsSync(ctx.bl1992.inProcessPath), 'expected the in_process handoff to be gone');
    const dest = path.join(abandonedDir(ctx.bl1992), ctx.bl1992.inProcessName);
    assert.ok(fs.existsSync(dest), `expected the parcel to land in inbox/abandoned, got: ${JSON.stringify(fs.readdirSync(abandonedDir(ctx.bl1992)))}`);
    assert.equal(fs.readFileSync(dest, 'utf8'), ctx.bl1992.inProcessContent);
  });

  scoped(/^the coordinator receives a note naming the parcel's ticket, so another coder seat can take it$/, (ctx) => {
    const notes = outboxHandoffs(ctx.bl1992).filter(
      (c) => /^type: note$/m.test(c) && /^to: coordinator$/m.test(c) && new RegExp(`^message:.*\\b${TICKET}\\b`, 'm').test(c)
    );
    assert.equal(notes.length, 1, `expected one note to coordinator naming ${TICKET}, got outbox:\n${outboxHandoffs(ctx.bl1992).join('\n---\n')}`);
  });

  scoped(/^the seat's qwen process is not restarted$/, (ctx) => {
    assert.equal(ctx.bl1992.killed, false, 'the fake process controller must not have been told to end qwen');
    const msgFile = path.join(ctx.bl1992.root, '.swarmforge', 'local-seat-restart', `${ctx.bl1992.inProcessName}.json.msg`);
    assert.ok(!fs.existsSync(msgFile), 'no pending override may be left for the launcher');
  });

  scoped(/^the parcel is still in the seat's in_process$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.bl1992.inProcessPath), 'nothing may complete or hand off the parcel');
    assert.equal(fs.readFileSync(ctx.bl1992.inProcessPath, 'utf8'), ctx.bl1992.inProcessContent);
  });

  scoped(/^the coordinator receives no note about the parcel$/, (ctx) => {
    const notes = outboxHandoffs(ctx.bl1992).filter((c) => /^type: note$/m.test(c) && /^to: coordinator$/m.test(c));
    assert.deepEqual(notes, [], `expected no note to coordinator, got:\n${notes.join('\n---\n')}`);
  });
}

module.exports = { registerSteps };
