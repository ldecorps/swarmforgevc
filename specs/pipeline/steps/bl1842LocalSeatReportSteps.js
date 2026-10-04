'use strict';

// BL-1842: step handlers for "A local-model seat's health is one command
// away". Drives the REAL local_seat_report_cli.bb over a real mkdtemp
// fixture root, with every path handed in explicitly (--qwen-home,
// --ollama-log, --now-ms) so no run ever touches the operator's real
// ~/.qwen or a live Ollama log - never a reimplementation of the parsing
// or state logic, which live only in local_seat_report_lib.bb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const REPORT_CLI = path.join(SCRIPTS_DIR, 'local_seat_report_cli.bb');

const FEATURE = "BL-1842 A local-model seat's health is one command away";

// The same / and . -> - scheme local_seat_report_lib.bb's qwen-cwd-key
// implements - duplicated here ONLY to place the fixture's session file at
// the exact path the CLI will look for it, never as a second copy of the
// CLI's own resolution logic (the CLI is what is under test).
function qwenCwdKey(worktreePath) {
  return worktreePath.replace(/[/.]/g, '-');
}

function seatWorktreePath(root, seat) {
  return path.join(root, '.worktrees', seat.replace('@', '-'));
}

function isoMinutesAgo(nowMs, minutes) {
  return new Date(nowMs - minutes * 60000).toISOString();
}

function usageLine(sessionId, inputTokens, outputTokens, thoughtsTokens, isoTimestamp) {
  return JSON.stringify({
    sessionId,
    inputTokens,
    outputTokens,
    thoughtsTokens,
    timestamp: isoTimestamp,
  });
}

function runReport(ctx) {
  return execFileSync(
    'bb',
    [
      REPORT_CLI,
      ctx.root,
      '--seat',
      ctx.seat,
      '--now-ms',
      String(ctx.nowMs),
      '--qwen-home',
      path.join(ctx.root, '.qwen'),
      '--ollama-log',
      ctx.ollamaLogPath,
    ],
    { encoding: 'utf8' }
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(
    /^a fixture root with a qwen usage record, a qwen session record and an Ollama server log for the seat "([^"]+)"$/,
    (ctx, seat) => {
      ctx.seat = seat;
      ctx.root = mkProcessTmpDir('bl1842-seat-report-');
      ctx.nowMs = Date.now();
      ctx.sessionId = 'bl1842-session-01';
      ctx.usageDir = path.join(ctx.root, '.qwen', 'usage');
      fs.mkdirSync(ctx.usageDir, { recursive: true });
      // One request, far enough in the past to never race "within the last
      // minute" freshness checks unless a scenario explicitly overrides it.
      fs.writeFileSync(
        path.join(ctx.usageDir, 'token-usage-fixture.jsonl'),
        usageLine(ctx.sessionId, 10, 5, 1, isoMinutesAgo(ctx.nowMs, 30)) + '\n'
      );
      const worktreePath = seatWorktreePath(ctx.root, seat);
      ctx.chatDir = path.join(ctx.root, '.qwen', 'projects', qwenCwdKey(worktreePath), 'chats');
      fs.mkdirSync(ctx.chatDir, { recursive: true });
      fs.writeFileSync(path.join(ctx.chatDir, `${ctx.sessionId}.jsonl`), '');
      ctx.ollamaLogPath = path.join(ctx.root, 'ollama-serve.log');
      fs.writeFileSync(ctx.ollamaLogPath, '');
    }
  );

  // ── scenario 01: session summary ────────────────────────────────────────
  scoped(
    /^the latest session sent (\d+) requests, with (\d+) chat compressions and (\d+) api errors?$/,
    (ctx, requests, compressions, apiErrors) => {
      const n = Number(requests);
      const lines = [];
      for (let i = 0; i < n; i += 1) {
        lines.push(usageLine(ctx.sessionId, 100, 20 + i, 5 + i, isoMinutesAgo(ctx.nowMs, n - i)));
      }
      fs.writeFileSync(path.join(ctx.usageDir, 'token-usage-fixture.jsonl'), lines.join('\n') + '\n');
      ctx.expectedOutputTokens = lines.length ? Array.from({ length: n }, (_, i) => 20 + i).reduce((a, b) => a + b, 0) : 0;
      ctx.expectedReasoningTokens = n ? Array.from({ length: n }, (_, i) => 5 + i).reduce((a, b) => a + b, 0) : 0;

      // BL-1851 bounce-lesson fix (2026-10-03): the real record nests these
      // fields under systemPayload - verified against live session files.
      // A top-level tokensBefore/apiError (the old fixture's shape) never
      // occurs in a real record and would no longer be counted after
      // local_seat_report_lib.bb's own parse-session-events fix.
      const chatRows = [];
      for (let i = 0; i < Number(compressions); i += 1) {
        chatRows.push(
          JSON.stringify({
            type: 'system',
            subtype: 'chat_compression',
            systemPayload: { info: { originalTokenCount: 9000, newTokenCount: 1200 } },
          })
        );
      }
      for (let i = 0; i < Number(apiErrors); i += 1) {
        chatRows.push(
          JSON.stringify({
            type: 'system',
            subtype: 'ui_telemetry',
            systemPayload: { uiEvent: { 'event.name': 'qwen-code.api_error' } },
          })
        );
      }
      fs.writeFileSync(path.join(ctx.chatDir, `${ctx.sessionId}.jsonl`), chatRows.join('\n') + (chatRows.length ? '\n' : ''));
    }
  );

  // ── scenario 02: served-model facts ─────────────────────────────────────
  scoped(
    /^the Ollama log's latest load offloaded (\d+) of (\d+) layers with a (\d+) context and an ([a-z0-9_]+) KV cache$/,
    (ctx, onGpu, total, context, kvType) => {
      fs.appendFileSync(
        ctx.ollamaLogPath,
        `load_tensors: offloaded ${onGpu}/${total} layers to GPU\n` +
          `llama_kv_cache: size = 512.00 MiB (${kvType})\n` +
          `llama_context: n_ctx      = ${context}\n`
      );
    }
  );

  scoped(/^its latest generation ran at ([0-9.]+) tokens per second$/, (ctx, tokensPerSecond) => {
    fs.appendFileSync(ctx.ollamaLogPath, `slot print_timing: prompt eval | tg = ${tokensPerSecond} t/s\n`);
  });

  // ── scenario 03: generating vs stuck ─────────────────────────────────────
  scoped(/^the seat's last recorded request finished (\d+) minutes ago$/, (ctx, minutesAgo) => {
    fs.writeFileSync(
      path.join(ctx.usageDir, 'token-usage-fixture.jsonl'),
      usageLine(ctx.sessionId, 10, 5, 1, isoMinutesAgo(ctx.nowMs, Number(minutesAgo))) + '\n'
    );
  });

  scoped(/^the Ollama log shows a generation in progress within the last minute$/, (ctx) => {
    const generatingAt = new Date(ctx.nowMs - 30000).toISOString();
    fs.appendFileSync(
      ctx.ollamaLogPath,
      'load_tensors: offloaded 57/65 layers to GPU\n' + `${generatingAt} slot process: generating\n`
    );
  });

  // ── when ──────────────────────────────────────────────────────────────────
  scoped(/^the local-seat report runs for "([^"]+)"$/, (ctx, seat) => {
    ctx.seat = seat;
    ctx.output = runReport(ctx);
  });

  // ── then ──────────────────────────────────────────────────────────────────
  scoped(/^it prints the session's request count as (\d+)$/, (ctx, requests) => {
    assert.ok(
      ctx.output.includes(`Requests: ${requests}`),
      `expected "Requests: ${requests}" in output:\n${ctx.output}`
    );
  });

  scoped(/^it prints (\d+) compressions? and (\d+) api errors?$/, (ctx, compressions, apiErrors) => {
    assert.ok(
      ctx.output.includes(`Compressions: ${compressions}`),
      `expected "Compressions: ${compressions}" in output:\n${ctx.output}`
    );
    assert.ok(
      ctx.output.includes(`API errors: ${apiErrors}`),
      `expected "API errors: ${apiErrors}" in output:\n${ctx.output}`
    );
  });

  scoped(/^it prints the session's total output tokens and reasoning tokens$/, (ctx) => {
    assert.ok(
      ctx.output.includes(`Output tokens: ${ctx.expectedOutputTokens}`),
      `expected "Output tokens: ${ctx.expectedOutputTokens}" in output:\n${ctx.output}`
    );
    assert.ok(
      ctx.output.includes(`Reasoning tokens: ${ctx.expectedReasoningTokens}`),
      `expected "Reasoning tokens: ${ctx.expectedReasoningTokens}" in output:\n${ctx.output}`
    );
  });

  scoped(
    /^it prints "([^"]+)", the (\d+) context, the ([a-z0-9_]+) KV cache and ([0-9.]+) tokens per second$/,
    (ctx, layersPhrase, context, kvType, tokensPerSecond) => {
      assert.ok(ctx.output.includes(layersPhrase), `expected "${layersPhrase}" in output:\n${ctx.output}`);
      assert.ok(ctx.output.includes(String(context)), `expected context ${context} in output:\n${ctx.output}`);
      assert.ok(ctx.output.includes(kvType), `expected KV cache type "${kvType}" in output:\n${ctx.output}`);
      assert.ok(
        ctx.output.includes(`${tokensPerSecond} tokens per second`),
        `expected "${tokensPerSecond} tokens per second" in output:\n${ctx.output}`
      );
    }
  );

  scoped(/^it reports the seat as "([^"]+)"$/, (ctx, state) => {
    assert.ok(ctx.output.includes(`State: ${state}`), `expected "State: ${state}" in output:\n${ctx.output}`);
  });
}

module.exports = { registerSteps };
