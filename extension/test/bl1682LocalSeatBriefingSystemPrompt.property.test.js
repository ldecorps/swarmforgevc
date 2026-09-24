'use strict';

// BL-1682's one declared invariant: "A local-seat turn's ollama request
// differs from today's request only by the presence of the `system`
// field, and that field is present only when a non-empty
// docs/reference/local-model-briefing.md exists under the target path."
//
// Two pure facts combine to establish this end to end, both exhaustively
// constructed (never fc-sampled - a handful of discrete filesystem/string
// states, BL-1697/BL-1703/BL-1705's own precedent for a space this small):
//
//   A. readLocalSeatSystemPrompt(targetPath) is defined if and only if the
//      briefing file exists AND is non-empty after trim.
//   B. completeWithLocalModel's constructed JSON body carries a `system`
//      key if and only if the `system` argument is defined, and every
//      OTHER key (model, prompt, stream) is byte-identical whether or not
//      `system` is present - so adding it never perturbs the rest of
//      "today's request".

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { readLocalSeatSystemPrompt, completeWithLocalModel } = require('../out/tools/localQwenSeatLive');

function briefingPath(root) {
  return path.join(root, 'docs', 'reference', 'local-model-briefing.md');
}

function withBriefingState(state, fn) {
  const root = mkTmpDir('bl1682-briefing-prop-');
  try {
    if (state.write !== undefined) {
      fs.mkdirSync(path.dirname(briefingPath(root)), { recursive: true });
      fs.writeFileSync(briefingPath(root), state.write);
    }
    // "absent": leave docs/reference entirely unwritten.
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('invariant A: readLocalSeatSystemPrompt is defined iff the briefing exists and is non-empty after trim', () => {
  const STATES = [
    { name: 'absent', write: undefined, expected: undefined },
    { name: 'empty file', write: '', expected: undefined },
    { name: 'whitespace-only file', write: '   \n\t  ', expected: undefined },
    { name: 'real text, untrimmed', write: '  Project briefing text.  \n', expected: 'Project briefing text.' },
  ];

  it('reaches and correctly classifies every constructed filesystem state', () => {
    const reach = new Set();
    for (const state of STATES) {
      reach.add(state.name);
      withBriefingState(state, (root) => {
        assert.equal(
          readLocalSeatSystemPrompt(root),
          state.expected,
          `expected ${JSON.stringify(state.expected)} for state "${state.name}", root=${root}`
        );
      });
    }
    assert.equal(reach.size, STATES.length, 'reach floor: expected every constructed state to run');
  });
});

describe('invariant B: the constructed ollama request body carries `system` iff the argument is defined, and no other key ever changes', () => {
  const SYSTEMS = [undefined, 'You are the local seat.'];
  const PROMPTS = ['', 'hello', 'what is 2 + 2?'];

  async function bodyFor(prompt, system) {
    let captured;
    await completeWithLocalModel(
      'qwen3:14b',
      prompt,
      'http://fixture.invalid',
      async (_url, init) => {
        captured = JSON.parse(init.body);
        return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) };
      },
      system
    );
    return captured;
  }

  it('exhaustively, over every (prompt, system) combination', async () => {
    const reach = new Set();
    for (const prompt of PROMPTS) {
      const bodyWithoutSystem = await bodyFor(prompt, undefined);
      assert.ok(
        !Object.prototype.hasOwnProperty.call(bodyWithoutSystem, 'system'),
        `expected no "system" key when system is undefined, got: ${JSON.stringify(bodyWithoutSystem)}`
      );
      for (const system of SYSTEMS) {
        reach.add(`${JSON.stringify(prompt)}:${JSON.stringify(system)}`);
        const body = await bodyFor(prompt, system);
        if (system === undefined) {
          assert.ok(
            !Object.prototype.hasOwnProperty.call(body, 'system'),
            `expected no "system" key for prompt=${JSON.stringify(prompt)}, got: ${JSON.stringify(body)}`
          );
        } else {
          assert.equal(body.system, system, `expected system=${JSON.stringify(system)}, got: ${JSON.stringify(body)}`);
        }
        // Every OTHER key is unaffected by system's presence - diffing
        // against the system-undefined baseline for the same prompt.
        assert.equal(body.model, bodyWithoutSystem.model);
        assert.equal(body.prompt, bodyWithoutSystem.prompt);
        assert.equal(body.stream, bodyWithoutSystem.stream);
      }
    }
    assert.equal(reach.size, PROMPTS.length * SYSTEMS.length, 'reach floor: expected every combination to be constructed');
  });
});
