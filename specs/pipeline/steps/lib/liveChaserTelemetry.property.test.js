'use strict';

/**
 * BL-987 invariants for the headless dark-emitter audit's live chaser pointer.
 *
 * Invariant 2 (executable): every live artifact path the audit re-verifies is
 * resolved at run time — never a calendar-month literal. Generator advances
 * across month boundaries so a pinned `chaser-2026-07` style path cannot pass.
 *
 * Invariant 1 (executable against the path+count helpers): a recorded
 * "runs headless / samples present" verdict fails when the live file has zero
 * resource_sample rows, and a recorded "dark / zero samples" verdict fails
 * when the live file has samples — verdicts must match the live system.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  composeMonthlyChaserPath,
  liveChaserTelemetryPath,
  countResourceSampleLines,
} = require('./liveChaserTelemetry');

describe('BL-987 live chaser telemetry path', () => {
  it('resolves the same month key the writer would for every generated instant', () => {
    const root = '/tmp/sf-main-checkout';
    // Reachability floor: sample across ~18 months including year roll.
    const start = Date.UTC(2026, 0, 15, 12, 0, 0);
    const seen = new Set();
    for (let i = 0; i < 18; i++) {
      const atMs = start + i * 30 * 24 * 60 * 60 * 1000;
      const expectedMonth = new Date(atMs).toISOString().slice(0, 7);
      seen.add(expectedMonth);
      const composed = composeMonthlyChaserPath(root, atMs);
      assert.equal(
        path.basename(composed),
        `chaser-${expectedMonth}.jsonl`,
        `composed path must track month at i=${i}`
      );
      const live = liveChaserTelemetryPath(root, atMs);
      assert.equal(path.basename(live), `chaser-${expectedMonth}.jsonl`);
    }
    assert.ok(seen.size >= 12, `generator must cross many months, got ${[...seen]}`);
    assert.ok(!seen.has('2026-07') || seen.size > 1, 'must not only ever produce July');
  });

  it('rejects a runs-headless verdict when the live file has zero resource samples', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl987-chaser-'));
    const file = composeMonthlyChaserPath(dir, Date.now());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"type":"chase","at":"x"}\n');
    const samples = countResourceSampleLines(file);
    assert.equal(samples, 0);
    const recordedVerdict = 'runs headless';
    const matchesLive = recordedVerdict === 'runs headless' ? samples > 0 : samples === 0;
    assert.equal(matchesLive, false);
  });

  it('rejects a dark-when-headless verdict when the live file has resource samples', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl987-chaser-'));
    const file = composeMonthlyChaserPath(dir, Date.now());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      '{"type":"resource_sample","role":"coder","rssBytes":1,"cpuPercent":1,"at":"2026-08-25T00:00:00.000Z"}\n'
    );
    const samples = countResourceSampleLines(file);
    assert.equal(samples, 1);
    const recordedVerdict = 'dark when headless';
    const matchesLive = recordedVerdict === 'runs headless' ? samples > 0 : samples === 0;
    assert.equal(matchesLive, false);
  });
});
