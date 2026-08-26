'use strict';

// BL-371: step handlers for "A question the Operator cannot answer is
// passed down, never sat on". Drives the REAL compiled/real subprocess
// path - swarmforge/scripts/operator_file_question.bb (a genuine bb
// subprocess) against a REAL git repo, and swarmforge/scripts/operator_
// reply.bb (the EXISTING reply mechanism, reused unchanged) - never a
// hand-rolled substitute for either.
//
// The Background step ("the human is talking to the Operator in a
// Telegram topic") is IDENTICAL text to BL-369's own Background and is
// already registered by noInboundMessageIsEverLostSteps.js (setting
// ctx.subjectId = 'SUP-1') - reused here rather than re-registered, per
// this codebase's own "one handler serves both" convention for shared
// step text (see that file's docstring for the same pattern).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARM_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SWARM_SCRIPTS, 'operator_file_question.bb');
const REPLY_CLI = path.join(SWARM_SCRIPTS, 'operator_reply.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitRepo() {
  const dir = mkTmp('sfvc-bl371-repo-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: dir });
  return dir;
}

function fileQuestion(root, thread, question) {
  return spawnSync('bb', [CLI, root, '--thread', thread, '--question', question], { encoding: 'utf8' });
}

function reply(root, thread, text) {
  return spawnSync('bb', [REPLY_CLI, root, '--thread', thread, '--text', text], { encoding: 'utf8' });
}

function backlogRootFiles(root) {
  const backlogDir = path.join(root, 'backlog');
  if (!fs.existsSync(backlogDir)) return [];
  return fs.readdirSync(backlogDir).filter((f) => fs.statSync(path.join(backlogDir, f)).isFile());
}

function replyOutboxText(root) {
  const p = path.join(root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function registerSteps(registry) {
  // ── operator-passes-a-question-down-01 ──────────────────────────────
  registry.define(/^the human asks the Operator something it cannot answer itself$/, (ctx) => {
    ctx.root = gitRepo();
    ctx.question = 'why does the coordinator keep restarting?';
    ctx.canAnswerItself = false;
  });

  registry.define(/^the Operator handles the message$/, (ctx) => {
    const thread = ctx.subjectId || 'SUP-1';
    if (ctx.canAnswerItself) {
      // "Answers directly" is exercised through the EXISTING, unchanged
      // reply CLI - this ticket builds no new "I can answer this myself"
      // path, only the pass-down half that did not exist before it.
      ctx.replyResult = reply(ctx.root, thread, 'Yes - the coordinator restarts on a config reload, that is expected.');
    } else {
      ctx.fileResult = fileQuestion(ctx.root, thread, ctx.question);
    }
  });

  registry.define(/^the question is filed as a raw intake item in the backlog root$/, (ctx) => {
    if (ctx.fileResult.status !== 0) {
      throw new Error(`expected operator_file_question.bb to succeed, got: ${ctx.fileResult.stdout}${ctx.fileResult.stderr}`);
    }
    const parsed = JSON.parse(ctx.fileResult.stdout);
    if (!parsed.committed) {
      throw new Error(`expected committed:true, got: ${ctx.fileResult.stdout}`);
    }
    ctx.filedRelPath = parsed.filed;
    const files = backlogRootFiles(ctx.root);
    if (!files.some((f) => path.join('backlog', f) === parsed.filed)) {
      throw new Error(`expected the filed path to actually exist in the backlog root, got files=${JSON.stringify(files)} filed=${parsed.filed}`);
    }
    const content = fs.readFileSync(path.join(ctx.root, parsed.filed), 'utf8');
    if (!content.includes(ctx.question)) {
      throw new Error('expected the filed content to carry the original question verbatim');
    }
  });

  registry.define(/^the human is told it has been filed$/, (ctx) => {
    const outbox = replyOutboxText(ctx.root);
    if (!outbox.includes('Filed for the swarm') || !outbox.includes(ctx.filedRelPath)) {
      throw new Error(`expected the human to be told what was filed, got outbox: ${outbox}`);
    }
  });

  // ── operator-passes-a-question-down-02 ──────────────────────────────
  registry.define(/^the Operator has filed a question as a raw intake item$/, (ctx) => {
    ctx.root = gitRepo();
    ctx.question = 'why did the socket vanish?';
    const result = fileQuestion(ctx.root, ctx.subjectId || 'SUP-1', ctx.question);
    if (result.status !== 0) {
      throw new Error(`setup failed: expected filing to succeed, got: ${result.stdout}${result.stderr}`);
    }
    ctx.filedRelPath = JSON.parse(result.stdout).filed;
  });

  registry.define(/^the specifier drains the backlog root$/, (ctx) => {
    // The specifier's own drain is a DIFFERENT worktree/checkout in
    // production - proven here the same way (a real independent clone of
    // the SAME repo), the only check that actually proves a role reading
    // from its own isolated checkout can see it (the ticket's own E2E note).
    ctx.clone = mkTmp('sfvc-bl371-clone-');
    fs.rmdirSync(ctx.clone);
    execFileSync('git', ['clone', '-q', ctx.root, ctx.clone]);
  });

  registry.define(/^the filed question is there to be specced$/, (ctx) => {
    const cloned = path.join(ctx.clone, ctx.filedRelPath);
    if (!fs.existsSync(cloned)) {
      throw new Error(`expected the filed intake to be visible from an INDEPENDENT clone (never the worktree that wrote it), missing: ${cloned}`);
    }
    if (!fs.readFileSync(cloned, 'utf8').includes(ctx.question)) {
      throw new Error('expected the cloned copy to carry the exact same question text');
    }
  });

  // ── operator-passes-a-question-down-03 ──────────────────────────────
  registry.define(/^the human asks the Operator something it can answer itself$/, (ctx) => {
    ctx.root = gitRepo();
    ctx.canAnswerItself = true;
  });

  registry.define(/^the Operator answers the human directly$/, (ctx) => {
    if (ctx.replyResult.status !== 0) {
      throw new Error(`expected operator_reply.bb to succeed, got: ${ctx.replyResult.stdout}${ctx.replyResult.stderr}`);
    }
    const outbox = replyOutboxText(ctx.root);
    if (!outbox.includes('coordinator restarts on a config reload')) {
      throw new Error(`expected the direct answer to reach the reply outbox, got: ${outbox}`);
    }
  });

  registry.define(/^no intake item is filed$/, (ctx) => {
    const files = backlogRootFiles(ctx.root);
    if (files.some((f) => f.startsWith('INTAKE-'))) {
      throw new Error(`expected NO intake item filed when the Operator answers directly, got: ${JSON.stringify(files)}`);
    }
  });

  // ── operator-passes-a-question-down-04 ──────────────────────────────
  registry.define(/^the human asks the Operator a question$/, (ctx) => {
    // Deliberately exercises the CANNOT-answer path - "either" outcome is
    // proven by scenario 01 (filed) and scenario 03 (answered) already;
    // this scenario's own job is only "the human learns SOMETHING",
    // checked generically below regardless of which branch ran.
    ctx.root = gitRepo();
    ctx.question = 'will scenario 04 always tell me something?';
    ctx.canAnswerItself = false;
  });

  registry.define(/^the human is told either the answer or where the question was filed$/, (ctx) => {
    const outbox = replyOutboxText(ctx.root);
    if (!outbox.trim()) {
      throw new Error('expected the human to be told SOMETHING - the reply outbox is empty');
    }
  });
}

module.exports = { registerSteps };
