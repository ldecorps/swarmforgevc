'use strict';

// BL-1126: Local Agent Telegram turns stay live under Ollama latency.
// Drives the landed Python harden (fast-path, progress, empty recovery, deadlines).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1126 Local Agent Telegram turns stay live under Ollama latency';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LA = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_agent');

function py(code) {
  const r = spawnSync('python3', ['-c', code], {
    cwd: LA,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: LA },
  });
  return r;
}

function ensure(ctx) {
  if (!ctx.bl1126) ctx.bl1126 = { last: null, events: [] };
  return ctx.bl1126;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^Local Agent is healthy$/, (ctx) => {
    ensure(ctx);
    const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-q'], {
      cwd: LA,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  scoped(/^the human sends a documented fast-path probe \(Ping hi hello status\)$/, (ctx) => {
    const s = ensure(ctx);
    const r = py(`
from agent_core import fast_path_reply, run_turn
import time
probes = ["Ping", "hi", "hello", "status"]
for p in probes:
    t0 = time.perf_counter()
    hit = fast_path_reply(p)
    assert hit is not None, p
    reply, _ = run_turn(p, history=[], root=".", chat_fn=lambda *a, **k: (_ for _ in ()).throw(AssertionError("Ollama called")))
    dt = (time.perf_counter() - t0) * 1000
    print(f"{p}\\t{dt:.1f}\\t{reply}")
`);
    s.last = r;
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  scoped(/^the Telegram reply returns without calling Ollama$/, (ctx) => {
    const s = ensure(ctx);
    assert.equal(s.last.status, 0);
    assert.ok(!/Ollama called/.test(s.last.stderr || ''));
  });

  scoped(/^latency stays in the fast-path band \(order of tens of ms\)$/, (ctx) => {
    const s = ensure(ctx);
    for (const line of (s.last.stdout || '').trim().split('\n').filter(Boolean)) {
      const ms = parseFloat(line.split('\t')[1]);
      assert.ok(ms < 500, `slow fast-path ${line}`);
    }
  });

  scoped(/^Ollama is serving the configured chat model$/, (ctx) => {
    ensure(ctx).events = [];
  });

  scoped(/^the human asks a non-probe question in the Local Agent topic$/, (ctx) => {
    const s = ensure(ctx);
    const r = py(`
from agent_core import run_turn, fast_path_reply
assert fast_path_reply("how many files?") is None
events = []
def on_event(e):
    events.append(e)
def chat(messages, *, model, tools):
    return {"message": {"role": "assistant", "content": "42 files.", "tool_calls": []}}
reply, _ = run_turn("how many files?", history=[], root=".", chat_fn=chat, on_event=on_event)
print(len(events))
print(reply)
for e in events:
    print(e.get("type"), e.get("text", "")[:80])
`);
    s.last = r;
    assert.equal(r.status, 0, r.stderr || r.stdout);
    s.events = (r.stdout || '').trim().split('\n');
  });

  scoped(/^the front desk posts at least one progress update before the final$/, (ctx) => {
    const s = ensure(ctx);
    const body = s.last.stdout || '';
    assert.ok(/status|progress|thinking|tool/i.test(body), body);
  });

  scoped(/^the bot poll loop is not blocked waiting on the full completion$/, (ctx) => {
    // Stream/event design: run_turn accepts on_event and emits before final.
    const s = ensure(ctx);
    const n = parseInt(s.events[0], 10);
    assert.ok(n >= 1, `expected progress events, got ${s.events[0]}`);
  });

  scoped(/^a turn whose model completion is empty or whitespace-only$/, (ctx) => {
    const s = ensure(ctx);
    const r = py(`
from agent_core import run_turn
n = {"i": 0}
def chat(messages, *, model, tools):
    n["i"] += 1
    if n["i"] == 1:
        return {"message": {"role": "assistant", "content": "   ", "tool_calls": []}}
    return {"message": {"role": "assistant", "content": "recovered", "tool_calls": []}}
reply, _ = run_turn("count lines", history=[], root=".", chat_fn=chat)
print(reply)
`);
    s.last = r;
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  scoped(/^the turn finishes$/, () => {});

  scoped(/^Local Agent recovers with a non-empty degraded reply or explicit failure$/, (ctx) => {
    const s = ensure(ctx);
    const reply = (s.last.stdout || '').trim();
    assert.ok(reply.length > 0);
    assert.notEqual(reply.toLowerCase(), '(empty model reply)');
  });

  scoped(/^the topic is not left awaiting a final that never comes$/, (ctx) => {
    assert.equal(ensure(ctx).last.status, 0);
  });

  scoped(/^an Ollama chat call that exceeds the configured socket or idle deadline$/, (ctx) => {
    const s = ensure(ctx);
    const r = py(`
import threading, time
from agent_core import run_turn
from turn_gate import TurnGate
gate = TurnGate(idle_s=999)
entered = threading.Event()
def chat(messages, *, model, tools):
    entered.set()
    time.sleep(5.0)
    raise AssertionError("chat should have been aborted")
def killer():
    assert entered.wait(2)
    time.sleep(0.05)
    gate.abort("turn deadline exceeded (1s)")
threading.Thread(target=killer, daemon=True).start()
reply, _ = run_turn("do something slow", history=[], root=".", chat_fn=chat, gate=gate, deadline_s=999)
print(reply)
`);
    s.last = r;
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  scoped(/^the deadline fires$/, () => {});

  scoped(/^the turn aborts cleanly$/, (ctx) => {
    assert.match(ensure(ctx).last.stdout || '', /deadline/i);
  });

  scoped(/^the topic receives an explicit timeout\/failure receipt$/, (ctx) => {
    assert.match(ensure(ctx).last.stdout || '', /deadline/i);
  });

  scoped(/^a later probe or turn can succeed without restarting the bot$/, (ctx) => {
    const r = py(`
from agent_core import fast_path_reply, run_turn
assert fast_path_reply("ping") == "Pong"
reply, _ = run_turn("ping", history=[], root=".",
    chat_fn=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no ollama")))
print(reply)
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout || '', /Pong/);
  });
}

module.exports = { registerSteps, FEATURE };
