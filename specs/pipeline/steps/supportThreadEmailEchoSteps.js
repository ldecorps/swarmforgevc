'use strict';

// BL-275: step handlers for "Support conversation threads over RC with an
// outbound email echo" (Support MVP, slice 1 of the Support role epic
// BL-274). Drives the REAL support_thread.bb CLI (mirrors
// costHealthSidecarHeadlessSteps.js's own "shell the real compiled/real
// tool" pattern) against a real fixture .swarmforge/support/ state dir -
// exercises the actual thread-store fs adapters and support_lib.bb's pure
// logic together, not a reimplementation of either in JS. SUPPORT_EMAIL_
// DRYRUN=1 keeps the email-echo scenario network-free and deterministic
// (composition is asserted; the real Resend send is the untested boundary
// per the ticket).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SUPPORT_THREAD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'support_thread.bb');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-support-mvp-'));
}

function runCli(root, args) {
  const out = execFileSync('bb', [SUPPORT_THREAD_CLI, root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SUPPORT_EMAIL_DRYRUN: '1' },
  });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Support runtime is handling support conversation threads over remote control$/, (ctx) => {
    ctx.root = mkTmp();
  });

  // ── support-mvp-01 ──────────────────────────────────────────────────
  registry.define(/^a caller opens a discussion$/, (ctx) => {
    ctx.channel = 'rc';
    ctx.text = 'my PR is stuck, can you help?';
  });

  registry.define(/^the Support runtime records the discussion$/, (ctx) => {
    ctx.thread = runCli(ctx.root, ['open', '--channel', ctx.channel, '--text', ctx.text]);
  });

  registry.define(/^a new thread is created with its own support ticket id$/, (ctx) => {
    if (!/^SUP-\d+$/.test(ctx.thread.id)) {
      throw new Error(`expected a SUP-### id, got: ${ctx.thread.id}`);
    }
  });

  registry.define(/^the message is stored under its channel and timestamp with the thread open$/, (ctx) => {
    const msg = ctx.thread.messages[0];
    if (msg.channel !== ctx.channel || !msg.timestamp || msg.text !== ctx.text) {
      throw new Error(`expected the message stored with its channel/timestamp/text, got: ${JSON.stringify(msg)}`);
    }
    if (ctx.thread.status !== 'open') {
      throw new Error(`expected the new thread to be open, got: ${ctx.thread.status}`);
    }
  });

  // ── support-mvp-02 ──────────────────────────────────────────────────
  registry.define(/^a thread has recorded an interaction$/, (ctx) => {
    ctx.thread = runCli(ctx.root, ['open', '--channel', 'rc', '--text', 'my PR is stuck\nneed help']);
  });

  registry.define(/^Support sends the email echo for the thread$/, (ctx) => {
    ctx.echo = runCli(ctx.root, [
      'email-echo',
      '--thread', ctx.thread.id,
      '--to', 'caller@example.com',
      '--next-step', 'check the CI logs',
      '--options', 'retry the build,escalate to human',
    ]);
  });

  registry.define(/^the email subject carries the thread's ticket id and a short title$/, (ctx) => {
    const prefix = `[${ctx.thread.id}]`;
    if (!ctx.echo.subject.startsWith(prefix) || ctx.echo.subject === prefix) {
      throw new Error(`expected the subject to carry the ticket id AND a title, got: ${ctx.echo.subject}`);
    }
  });

  registry.define(/^the body summarizes the conversation so far, states the next step, and lists the options$/, (ctx) => {
    const body = ctx.echo.body;
    if (!body.includes('my PR is stuck')) {
      throw new Error(`expected the body to summarize the conversation, got: ${body}`);
    }
    if (!body.includes('Next step: check the CI logs')) {
      throw new Error(`expected the body to state the next step, got: ${body}`);
    }
    if (!body.includes('- retry the build') || !body.includes('- escalate to human')) {
      throw new Error(`expected the body to list every option, got: ${body}`);
    }
  });

  // ── support-mvp-03 ──────────────────────────────────────────────────
  registry.define(/^an open thread$/, (ctx) => {
    ctx.thread = runCli(ctx.root, ['open', '--channel', 'rc', '--text', 'opening message']);
  });

  registry.define(/^the caller follows up$/, (ctx) => {
    ctx.followUpText = 'are you still there?';
    ctx.thread = runCli(ctx.root, ['followup', '--thread', ctx.thread.id, '--channel', 'rc', '--text', ctx.followUpText]);
  });

  registry.define(/^the follow-up is appended to the same thread$/, (ctx) => {
    if (ctx.thread.messages.length !== 2) {
      throw new Error(`expected 2 messages on the thread after the follow-up, got: ${JSON.stringify(ctx.thread.messages)}`);
    }
    if (ctx.thread.messages[1].text !== ctx.followUpText) {
      throw new Error(`expected the follow-up text appended, got: ${JSON.stringify(ctx.thread.messages[1])}`);
    }
  });

  // ── support-mvp-04 ──────────────────────────────────────────────────
  registry.define(/^the Support runtime processes an interaction that is not a close request$/, (ctx) => {
    ctx.thread = runCli(ctx.root, ['followup', '--thread', ctx.thread.id, '--channel', 'rc', '--text', 'just a regular question']);
  });

  registry.define(/^Support has not closed the thread$/, (ctx) => {
    if (ctx.thread.status !== 'open') {
      throw new Error(`expected the thread to remain open (no autonomous close in this slice), got: ${ctx.thread.status}`);
    }
  });
}

module.exports = { registerSteps };
