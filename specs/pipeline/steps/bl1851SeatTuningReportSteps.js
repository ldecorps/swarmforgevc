'use strict';

// BL-1851: step handlers for "A local seat's tuning report compares its
// work across the settings it ran with". Drives the REAL
// local_seat_tuning_report_cli.bb (gather + build-report) via `bb -e`
// over a real mkdtemp fixture - never a reimplementation of the grouping
// or summary logic, which live only in local_seat_tuning_report_lib.bb
// and local_seat_report_lib.bb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1851 A local seat's tuning report compares its work across the settings it ran with";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS, 'local_seat_tuning_report_cli.bb');
const SEAT = 'coder@iq3';

// Mirrors local-seat-report-lib/seat-worktree-path + qwen-cwd-key exactly
// (never a hardcoded guess at the key) - the real CLI computes the SAME
// key from the SAME root, and the fixture must land its chat files where
// that computation will actually look.
function cwdKeyFor(root, seat) {
  const worktreePath = path.join(root, '.worktrees', seat.replace('@', '-'));
  return worktreePath.replace(/[/.]/g, '-');
}

function ensure(ctx) {
  if (!ctx.bl1851) {
    const root = mkProcessTmpDir('bl1851acc-');
    const settingsDir = path.join(root, '.swarmforge', 'local-agent', 'seat-settings');
    const chatsDir = path.join(root, 'qwen-projects', cwdKeyFor(root, SEAT), 'chats');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.mkdirSync(chatsDir, { recursive: true });
    ctx.bl1851 = {
      root,
      settingsFile: path.join(settingsDir, `${SEAT}.jsonl`),
      chatsDir,
      ollamaLog: path.join(root, 'ollama.log'),
      settingsRows: [],
      sessionCounter: 0,
    };
  }
  return ctx.bl1851;
}

function writeSettingsRows(fx) {
  fs.writeFileSync(fx.settingsFile, fx.settingsRows.map((r) => JSON.stringify(r)).join('\n') + (fx.settingsRows.length ? '\n' : ''));
}

function settingsRow(at, fingerprint, gpuPowerLimitW) {
  return { at, fingerprint, gpu: { powerLimitW: gpuPowerLimitW, defaultPowerLimitW: 180 } };
}

function apiResponseRow(ts, ttftMs, durationMs, inTok, outTok, thinkTok) {
  return {
    type: 'system',
    subtype: 'ui_telemetry',
    timestamp: ts,
    systemPayload: {
      uiEvent: {
        'event.name': 'qwen-code.api_response',
        ttft_ms: ttftMs,
        duration_ms: durationMs,
        input_token_count: inTok,
        output_token_count: outTok,
        thoughts_token_count: thinkTok,
      },
    },
  };
}

function compressionRow(ts, before, after) {
  return {
    type: 'system',
    subtype: 'chat_compression',
    timestamp: ts,
    systemPayload: { info: { originalTokenCount: before, newTokenCount: after } },
  };
}

function toolCallRow(ts, functionName, success) {
  return {
    type: 'system',
    subtype: 'ui_telemetry',
    timestamp: ts,
    systemPayload: { uiEvent: { 'event.name': 'qwen-code.tool_call', function_name: functionName, success } },
  };
}

function newSession(fx) {
  fx.sessionCounter += 1;
  const id = `S${fx.sessionCounter}`;
  return { id, file: path.join(fx.chatsDir, `${id}.jsonl`), rows: [] };
}

function writeSession(session) {
  fs.writeFileSync(session.file, session.rows.map((r) => JSON.stringify(r)).join('\n') + (session.rows.length ? '\n' : ''));
}

// Minute offsets from a fixed midnight anchor - every scenario's own
// timestamps are built this way so ordering is obvious from the test
// data itself.
const ANCHOR = Date.parse('2026-09-30T20:00:00.000Z');
function tsAt(minuteOffset) {
  return new Date(ANCHOR + minuteOffset * 60000).toISOString();
}

// Drives the REAL, standalone local_seat_tuning_report_cli.bb exactly as
// a person would (real argv, real -main) - never `load-file`d, which
// would also run its own trailing (-main (cli-args)) against THIS
// process's empty *command-line-args* and exit before any of its other
// functions could be called. Asserts against its rendered TEXT output,
// the same convention test_bl1861_local_llm_remove.sh and this ticket's
// own sibling fixtures already use for a CLI's own output.
function runReport(fx) {
  const out = execFileSync(
    'bb',
    [
      CLI,
      fx.root,
      '--seat',
      SEAT,
      '--qwen-projects-dir',
      path.join(fx.root, 'qwen-projects'),
      '--ollama-log',
      fx.ollamaLog,
      '--settings-file',
      fx.settingsFile,
    ],
    { encoding: 'utf8' }
  );
  fx.output = out;
  return out;
}

function groupBlocks(output) {
  return output.split(/\n\n(?=Group \d+:)/).filter((b) => b.startsWith('Group '));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(
    /^a fixture root holding a settings record, qwen session records and an Ollama log for the seat "coder@iq3"$/,
    (ctx) => {
      ensure(ctx);
    }
  );

  // ── requests-group-by-the-settings-they-ran-under-01 ────────────────────
  scoped(
    /^one session's first (\d+) requests ran before a settings row lowering the GPU power limit from (\d+) W to (\d+) W, and its last (\d+) after it$/,
    (ctx, firstN, beforeW, afterW, lastN) => {
      const fx = ensure(ctx);
      fx.settingsRows = [
        settingsRow(tsAt(-60), 'fp-before', Number(beforeW)),
        settingsRow(tsAt(Number(firstN)), 'fp-after', Number(afterW)),
      ];
      writeSettingsRows(fx);
      const session = newSession(fx);
      const n = Number(firstN) + Number(lastN);
      for (let i = 0; i < n; i += 1) {
        session.rows.push(apiResponseRow(tsAt(i), 1000, 2000, 100, 50, 10));
      }
      writeSession(session);
    }
  );

  scoped(/^the tuning report runs for "coder@iq3"$/, (ctx) => {
    runReport(ensure(ctx));
  });

  scoped(/^it prints two groups, of (\d+) requests and (\d+) requests$/, (ctx, a, b) => {
    const { output } = ensure(ctx);
    const blocks = groupBlocks(output);
    assert.equal(blocks.length, 2, output);
    assert.match(blocks[0], new RegExp(`Requests: ${a}\\b`), output);
    assert.match(blocks[1], new RegExp(`Requests: ${b}\\b`), output);
  });

  scoped(/^it names "([^"]+)" as the difference between them$/, (ctx, text) => {
    const { output } = ensure(ctx);
    assert.ok(output.includes(`Difference: ${text}`), output);
  });

  // ── a-group-prints-its-turn-numbers-02 ──────────────────────────────────
  // BL-1851 specifier amendment (note 000076, after the coder's own
  // finding that the pinned gherkin-parser drops a step DataTable
  // entirely): the three rows now arrive as three repeated steps of one
  // pattern, each firing this same handler once - appended to one
  // accumulating session across the three calls.
  scoped(
    /^a request in the group took (\d+) ms to first token and (\d+) ms in all, with (\d+) input, (\d+) output and (\d+) thinking tokens$/,
    (ctx, ttft, duration, input, output, thinking) => {
      const fx = ensure(ctx);
      if (!fx.turnSession) {
        fx.turnSession = newSession(fx);
        fx.turnIndex = 0;
      }
      fx.turnSession.rows.push(
        apiResponseRow(tsAt(fx.turnIndex), Number(ttft), Number(duration), Number(input), Number(output), Number(thinking))
      );
      fx.turnIndex += 1;
      writeSession(fx.turnSession);
    }
  );

  scoped(
    /^the group reads median time to first token (\d+) s, prefill (\d+) tokens\/s and decode (\d+) tokens\/s$/,
    (ctx, ttft, prefill, decode) => {
      const [block] = groupBlocks(ensure(ctx).output);
      assert.match(block, new RegExp(`Median time to first token: ${ttft} s`), block);
      assert.match(block, new RegExp(`Prefill: ${prefill} tokens/s`), block);
      assert.match(block, new RegExp(`Decode: ${decode} tokens/s`), block);
    }
  );

  scoped(/^the group reads median output (\d+) tokens with thinking at (\d+)% of output$/, (ctx, output, pct) => {
    const [block] = groupBlocks(ensure(ctx).output);
    assert.match(block, new RegExp(`Median output: ${output} tokens`), block);
    assert.match(block, new RegExp(`Thinking: ${pct}% of output`), block);
  });

  // ── a-group-prints-its-compressions-and-tool-failures-03 ────────────────
  scoped(/^one group's (\d+) requests came with (\d+) chat compressions, each from (\d+) to (\d+) tokens$/, (ctx, n, compressions, before, after) => {
    const fx = ensure(ctx);
    const session = newSession(fx);
    for (let i = 0; i < Number(n); i += 1) {
      session.rows.push(apiResponseRow(tsAt(i), 500, 1000, 100, 50, 0));
    }
    for (let i = 0; i < Number(compressions); i += 1) {
      session.rows.push(compressionRow(tsAt(i), Number(before), Number(after)));
    }
    fx.pendingSession = session;
    fx.pendingN = Number(n);
  });

  scoped(/^they came with (\d+) tool calls, of which (\d+) failed, (\d+) of them "([^"]+)"$/, (ctx, total, failed, namedFailed, toolName) => {
    const fx = ensure(ctx);
    const session = fx.pendingSession;
    const okCount = Number(total) - Number(failed);
    for (let i = 0; i < okCount; i += 1) {
      session.rows.push(toolCallRow(tsAt(i), 'run_shell_command', true));
    }
    for (let i = 0; i < Number(namedFailed); i += 1) {
      session.rows.push(toolCallRow(tsAt(i), toolName, false));
    }
    for (let i = 0; i < Number(failed) - Number(namedFailed); i += 1) {
      session.rows.push(toolCallRow(tsAt(i), 'read_file', false));
    }
    writeSession(session);
  });

  scoped(/^the group reads (\d+) compression per 10 requests saving (\d+) tokens each$/, (ctx, perTen, saved) => {
    const [block] = groupBlocks(ensure(ctx).output);
    assert.match(block, new RegExp(`\\(${perTen} per 10 requests, saving ${saved} tokens each\\)`), block);
  });

  scoped(/^the group reads a tool-call failure rate of (\d+)% with "([^"]+)" failing most$/, (ctx, rate, toolName) => {
    const [block] = groupBlocks(ensure(ctx).output);
    assert.match(block, new RegExp(`${rate}% failure rate, ${toolName} failing most`), block);
  });

  // ── how-ollama-served-the-model-splits-a-group-04 ───────────────────────
  scoped(/^every request ran under the same settings$/, (ctx) => {
    const fx = ensure(ctx);
    fx.settingsRows = [settingsRow(tsAt(-60), 'fp-only', 180)];
    writeSettingsRows(fx);
    fx.sameSettings = true;
  });

  scoped(
    /^the Ollama log loaded the model with (\d+) of (\d+) layers on the GPU and an ([a-z0-9_]+) KV cache before the first (\d+) requests, and with (\d+) of (\d+) and a ([a-z0-9_]+) KV cache before the other (\d+)$/,
    (ctx, layersA, totalA, kvA, nA, layersB, totalB, kvB, nB) => {
      const fx = ensure(ctx);
      const loadBlock = (startMinute, port, layers, total, kv, ctxSize) =>
        [
          `time=${isoOffset(startMinute)} level=INFO source=llama_server.go:433 msg="starting llama-server" cmd="/x/llama-server --port ${port} -c ${ctxSize}"`,
          'load_tensors: loading model tensors, this can take a while... (load_mode = mmap)',
          `load_tensors: offloaded ${layers}/${total} layers to GPU`,
          `llama_kv_cache: size = 512.00 MiB (${kv})`,
        ].join('\n');
      // The first load must precede request 0; the second must land
      // strictly between the last "first" request and the first "other"
      // one, or every request (not just the later half) would see the
      // second load as its own latest-at-or-before.
      const log =
        [loadBlock(-60, 40000, layersA, totalA, kvA, 32768), loadBlock(Number(nA) - 0.5, 40001, layersB, totalB, kvB, 32768)].join('\n') +
        '\n';
      fs.writeFileSync(fx.ollamaLog, log);

      const session = newSession(fx);
      const n = Number(nA) + Number(nB);
      for (let i = 0; i < n; i += 1) {
        session.rows.push(apiResponseRow(tsAt(i), 500, 1000, 100, 50, 0));
      }
      writeSession(session);
    }
  );

  scoped(/^it prints two groups under those settings, served as "([^"]+)" and "([^"]+)"$/, (ctx, servedA, servedB) => {
    const { output } = ensure(ctx);
    const blocks = groupBlocks(output);
    assert.equal(blocks.length, 2, output);
    assert.match(blocks[0], new RegExp(`^Group 1: .* / ${escapeRe(servedA)}`), output);
    assert.match(blocks[1], new RegExp(`^Group 2: .* / ${escapeRe(servedB)}`), output);
  });

  // ── requests-before-any-record-are-unrecorded-05 ────────────────────────
  scoped(/^a request ran before the settings record's first row$/, (ctx) => {
    const fx = ensure(ctx);
    fx.settingsRows = [settingsRow(tsAt(60), 'fp-later', 180)];
    writeSettingsRows(fx);
    const session = newSession(fx);
    session.rows.push(apiResponseRow(tsAt(0), 500, 1000, 100, 50, 0));
    writeSession(session);
  });

  scoped(/^that request is grouped under "unrecorded settings"$/, (ctx) => {
    const [block] = groupBlocks(ensure(ctx).output);
    assert.match(block, /^Group 1: unrecorded settings \//, block);
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function isoOffset(minuteOffset) {
  // Ollama's own time=... format: ISO with a numeric zone offset
  // (+00:00), never a bare Z - OffsetDateTime/parse (local_seat_report_
  // lib.bb's own reader) requires one.
  const d = new Date(ANCHOR + minuteOffset * 60000);
  return d.toISOString().replace('Z', '+00:00');
}

module.exports = { registerSteps };
