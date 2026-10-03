'use strict';

// BL-1861: step handlers for "The local LLM leaves the running swarm and
// frees the GPU". Drives test_bl1861_local_llm_remove.sh, which exercises
// the REAL local_llm.sh (-> local_llm_cli.bb) against a REAL private tmux
// server and a stub Ollama HTTP server it starts itself (BL-1390's proof
// posture) - never a reimplementation of local_llm.sh.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_bl1861_local_llm_remove.sh');
const FEATURE = 'BL-1861 The local LLM leaves the running swarm and frees the GPU';

function ensureResult(ctx) {
  if (!ctx.bl1861?.result) {
    const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', timeout: 120000 });
    ctx.bl1861 = { result: { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') } };
  }
  return ctx.bl1861.result;
}

function requirePass(ctx, description, matcher) {
  const { stdout } = ensureResult(ctx);
  if (!matcher.test(stdout)) {
    throw new Error(`expected ${description}:\n${stdout}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(
    /^a fixture swarm whose roster lists the Claude seats "([^"]+)", "([^"]+)" and "([^"]+)" and the local-model seats "([^"]+)" and "([^"]+)"$/,
    (ctx) => {
      ctx.bl1861 = {};
    }
  );

  scoped(/^each local-model seat's launch script names the model "([^"]+)" on a stub model server$/, () => {});
  scoped(/^the stub model server has "([^"]+)" loaded$/, () => {});

  // ── remove-takes-out-every-local-seat-01 ───────────────────────────────
  scoped(/^the operator runs local_llm remove$/, (ctx) => {
    ensureResult(ctx);
  });

  scoped(/^no roster copy lists "([^"]+)" or "([^"]+)"$/, (ctx, a, b) => {
    requirePass(ctx, `no roster copy to list ${a} or ${b}`, /PASS: 0[16]: no roster copy lists coder@2 or coder@iq3/);
  });

  scoped(/^the sessions of "([^"]+)" and "([^"]+)" are killed only after every roster copy lost their rows$/, (ctx) => {
    requirePass(
      ctx,
      'the sessions of coder@2 and coder@iq3 killed, siblings surviving',
      /PASS: 01: the sessions of coder@2 and coder@iq3 are stopped; the other seats' sessions survive/
    );
  });

  scoped(/^the roster rows and sessions of "([^"]+)", "([^"]+)" and "([^"]+)" are unchanged$/, (ctx) => {
    requirePass(ctx, 'the roster rows of coder, cleaner and coordinator unchanged', /PASS: 01: the roster rows of coder, cleaner and coordinator are unchanged/);
  });

  scoped(/^the removal record names "([^"]+)" and "([^"]+)" with the rows they had$/, (ctx) => {
    requirePass(ctx, 'the removal record naming coder@2 and coder@iq3', /PASS: 01: the removal record names coder@2 and coder@iq3 with the rows they had/);
  });

  // ── remove-unloads-only-the-swarm-model-02 ─────────────────────────────
  // Also matches scenario 03's Outline rows ("<model_state>" substitutes
  // to this same literal text) - the two captured groups (which model,
  // which state) pick the one PASS line each combination actually maps
  // to, since a full run's output always carries every scenario's lines
  // together.
  scoped(/^"([^"]+)" is (not loaded|still loaded) on the stub model server$/, (ctx, model, state) => {
    const qwen = model === 'qwen2.5-coder-14b-q5km:latest';
    if (qwen && state === 'not loaded') {
      requirePass(
        ctx,
        `${model} not loaded`,
        /PASS: 02: qwen2\.5-coder-14b-q5km:latest is not loaded on the stub model server|PASS: 03\/row1: already-removed remove exits 0, says so, changes no roster, model stays not loaded/
      );
    } else if (qwen && state === 'still loaded') {
      requirePass(
        ctx,
        `${model} still loaded`,
        /PASS: 03\/row2: no-local-seat-no-record remove exits 0, says so, changes nothing, model stays loaded/
      );
    } else if (model === 'outside-task:latest' && state === 'still loaded') {
      requirePass(ctx, `${model} still loaded`, /PASS: 02: outside-task:latest is still loaded on the stub model server/);
    } else {
      throw new Error(`bl1861: unrecognized model/state combination "${model}"/"${state}"`);
    }
  });

  scoped(/^the stub model server is still running$/, (ctx) => {
    requirePass(ctx, 'the stub model server still running', /PASS: 02: the stub model server is still running/);
  });

  scoped(/^the output reports the GPU memory in use after the unload$/, (ctx) => {
    requirePass(ctx, 'a GPU memory report line', /PASS: 02: the output reports the GPU memory in use after the unload/);
  });

  // ── remove-again-says-so-03 ─────────────────────────────────────────────
  scoped(/^the local LLM was already removed$/, () => {});
  scoped(/^the roster lists no local-model seat and no removal record exists$/, () => {});

  scoped(/^it exits 0 and the output says "([^"]+)"$/, (ctx, message) => {
    if (message === 'already removed') {
      requirePass(ctx, "exit 0 saying 'already removed'", /PASS: 03\/row1: already-removed remove exits 0, says so, changes no roster, model stays not loaded/);
    } else if (message === 'no local-model seat') {
      requirePass(ctx, "exit 0 saying 'no local-model seat'", /PASS: 03\/row2: no-local-seat-no-record remove exits 0, says so, changes nothing, model stays loaded/);
    } else {
      throw new Error(`bl1861: unrecognized message "${message}"`);
    }
  });

  scoped(/^no roster copy changes$/, (ctx) => {
    const { stdout } = ensureResult(ctx);
    const sawRow1 = /PASS: 03\/row1: already-removed remove exits 0, says so, changes no roster/.test(stdout);
    const sawRow2 = /PASS: 03\/row2: no-local-seat-no-record remove exits 0, says so, changes nothing/.test(stdout);
    const sawRefusal = /PASS: 05\/(coder|coordinator): no roster copy changes/.test(stdout);
    if (!sawRow1 && !sawRow2 && !sawRefusal) {
      throw new Error(`expected a 'no roster copy changes' pass line:\n${stdout}`);
    }
  });

  // ── remove-reports-and-keeps-parcels-04 ─────────────────────────────────
  scoped(
    /^"([^"]+)" holds a parcel for "([^"]+)" in its in_process mailbox and a parcel for "([^"]+)" in its new mailbox$/,
    () => {}
  );

  scoped(/^the output names both parcels with their tickets and mailboxes$/, (ctx) => {
    requirePass(ctx, 'both parcels named with tickets and mailboxes', /PASS: 04: the output names both parcels with their tickets and mailboxes/);
  });

  scoped(/^both parcel files are byte-identical where they were$/, (ctx) => {
    requirePass(ctx, 'both parcel files byte-identical', /PASS: 04: both parcel files are byte-identical where they were/);
  });

  scoped(/^the worktree, branch and mailbox of "([^"]+)" still exist$/, (ctx) => {
    requirePass(ctx, "coder@2's worktree, branch and mailbox survive", /PASS: 04: the worktree, branch and mailbox of coder@2 still exist/);
  });

  // ── remove-refuses-a-bare-local-seat-05 ─────────────────────────────────
  scoped(/^the roster's "([^"]+)" seat runs on local-model$/, () => {});

  scoped(/^it exits non-zero naming "([^"]+)"$/, (ctx, seat) => {
    requirePass(ctx, `a non-zero exit naming ${seat}`, new RegExp(`PASS: 05/${seat}: remove exits non-zero naming ${seat}`));
  });

  scoped(/^no session is killed$/, (ctx) => {
    const { stdout } = ensureResult(ctx);
    if (!/PASS: 05\/(coder|coordinator): no session is killed/.test(stdout)) {
      throw new Error(`expected a 'no session is killed' pass line:\n${stdout}`);
    }
  });

  scoped(/^no model is unloaded$/, (ctx) => {
    const { stdout } = ensureResult(ctx);
    if (!/PASS: 05\/(coder|coordinator): no model is unloaded/.test(stdout)) {
      throw new Error(`expected a 'no model is unloaded' pass line:\n${stdout}`);
    }
  });

  // ── remove-says-when-the-model-stays-loaded-06 ──────────────────────────
  scoped(/^the stub model server keeps "([^"]+)" loaded whatever it is asked$/, () => {});

  scoped(/^it exits non-zero naming "([^"]+)" once the wait bound has passed$/, (ctx, model) => {
    requirePass(ctx, `a non-zero exit naming ${model} after the wait bound`, /PASS: 06: remove exits non-zero naming qwen2\.5-coder-14b-q5km:latest once the wait bound has passed/);
  });

  scoped(/^the output says to run remove again to retry the unload$/, (ctx) => {
    requirePass(ctx, 'the output saying to run remove again', /PASS: 06: the output says to run remove again to retry the unload/);
  });
}

module.exports = { registerSteps };
