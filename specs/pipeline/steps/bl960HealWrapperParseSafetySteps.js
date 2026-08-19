'use strict';

// BL-960 (epic tool-miss-auto-heal; defect against BL-913's shipped hook):
// step handlers for "the heal wrapper emits only parseable bash and
// round-trips hostile commands". Drives the REAL product via
// bl960_heal_wrapper_acceptance_runner.bb (build-healing-wrapper-command,
// the real hook over stdin JSON, and swarmforge.sh's own
// write_claude_settings_file) - never a JS reimplementation. Every step is
// scoped to this feature (defineScoped): scenarios 04/05 deliberately reuse
// BL-913's own step text "the role runs that command", and the scoped
// registration wins here without touching BL-913's unscoped one.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl960_heal_wrapper_acceptance_runner.bb');
const RUNNER_913 = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'tool_miss_heal_acceptance_runner.bb');

const FEATURE_NAME = 'the heal wrapper emits only parseable bash and round-trips hostile commands';

// The Scenario Outline's <shape> column, validated against explicit
// KNOWN_VALUES (engineering article's own Scenario Outline rule) - each
// value maps to a concrete hostile-but-valid command. A mutated Examples
// cell fails loudly here.
const KNOWN_SHAPES = new Map([
  [
    'quoted-heredoc',
    "cat <<'SFH960' > heredoc-out.txt\n" +
      "line one with 'quotes' and a ) paren\n" +
      'line (two "doubles"\n' +
      'SFH960\n' +
      "printf 'bytes:'\n" +
      'wc -c < heredoc-out.txt',
  ],
  ['literal-close-paren', 'printf \'%s\\n\' "a)b" ")" "(c"'],
  ['nested-quotes', 'printf \'%s\\n\' "outer \'inner\' \\"deep\\"" \'single "double" done\''],
  ['pipeline', "printf 'b\\na\\nc\\n' | sort | head -2"],
  ['semicolon-sequence', "printf 'one\\n'; printf 'two\\n' >&2; printf 'three\\n'"],
]);

// Valid on its own, but the composition cannot parse: an unterminated
// heredoc swallows the wrapper's own group closer (bash itself treats
// end-of-file as the terminator when run standalone).
const NON_COMPOSING_COMMAND = 'cat <<SFH960\nstill open';

function runMode(payload) {
  const out = execFileSync('bb', [RUNNER, JSON.stringify(payload)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function run913(miss, healOutcome) {
  const out = execFileSync('bb', [RUNNER_913, JSON.stringify({ miss, healOutcome })], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a pinned worktree used by the Bash PreToolUse heal wrapper$/, (ctx) => {
    ctx.bl960 = {};
  });

  // ── 01: hostile-but-valid round-trip (Scenario Outline) ─────────────
  scoped(/^an original command of shape "([^"]+)" that is valid bash on its own$/, (ctx, shape) => {
    if (!KNOWN_SHAPES.has(shape)) {
      throw new Error(`BL-960: unrecognized shape "${shape}" - not in KNOWN_SHAPES`);
    }
    ctx.bl960.command = KNOWN_SHAPES.get(shape);
  });

  scoped(/^the PreToolUse heal wrapper is generated and executed for that command$/, (ctx) => {
    ctx.bl960.result = ctx.bl960.realFailure
      ? runMode({ mode: 'real-failure' })
      : runMode({ mode: 'roundtrip', command: ctx.bl960.command });
  });

  scoped(/^the wrapper source parses as bash$/, (ctx) => {
    if (!ctx.bl960.result.parses) {
      throw new Error('BL-960: expected the composed wrapper to parse as bash (bash -n rejected it)');
    }
  });

  scoped(
    /^the wrapper's exit code, combined output, and file side effects are byte-identical to the unwrapped command's$/,
    (ctx) => {
      const r = ctx.bl960.result;
      if (!r.exitIdentical || !r.outputIdentical || !r.filesIdentical) {
        throw new Error(
          `BL-960: round-trip diverged (exitIdentical=${r.exitIdentical}, outputIdentical=${r.outputIdentical}, ` +
            `filesIdentical=${r.filesIdentical}); unwrapped ${r.unwrappedExit}:${JSON.stringify(r.unwrappedOut)} ` +
            `vs wrapped ${r.wrappedExit}:${JSON.stringify(r.wrappedOut)}`
        );
      }
    }
  );

  // ── 02: fail-open, silently ──────────────────────────────────────────
  scoped(/^an original command whose composed wrapper does not parse as bash$/, (ctx) => {
    ctx.bl960.command = NON_COMPOSING_COMMAND;
  });

  scoped(/^the hook processes that command$/, (ctx) => {
    ctx.bl960.failopen = runMode({ mode: 'failopen', command: ctx.bl960.command });
  });

  scoped(/^the hook returns the original command byte-untouched$/, (ctx) => {
    // {} is the hook's no-op response: Claude Code applies no update, so
    // the original command runs exactly as issued - byte-untouched.
    if (ctx.bl960.failopen.response !== '{}') {
      throw new Error(`BL-960: expected the {} no-op response, got: ${ctx.bl960.failopen.response}`);
    }
  });

  scoped(/^the hook emits no narration about the failed composition$/, (ctx) => {
    if (ctx.bl960.failopen.stderr !== '') {
      throw new Error(`BL-960: expected silence on stderr, got: ${ctx.bl960.failopen.stderr}`);
    }
  });

  // ── 03: a real failure passes through unchanged, once ────────────────
  scoped(/^an original command that fails with output matching no miss class$/, (ctx) => {
    ctx.bl960.realFailure = true;
  });

  scoped(/^the command's own output and exit code are returned unchanged$/, (ctx) => {
    const r = ctx.bl960.result;
    if (!r.outputIdentical || !r.exitIdentical) {
      throw new Error(
        `BL-960: expected the failure returned unchanged, got outputIdentical=${r.outputIdentical}, ` +
          `exitIdentical=${r.exitIdentical} (out=${JSON.stringify(r.out)}, exit=${r.exit})`
      );
    }
  });

  scoped(/^the command ran exactly once$/, (ctx) => {
    if (ctx.bl960.result.invocations !== 1) {
      throw new Error(`BL-960: expected exactly one invocation, got ${ctx.bl960.result.invocations}`);
    }
  });

  // ── 04 + 05: the missing-root heal, gated by shape ────────────────────
  scoped(
    /^an original command that misses because of "([^"]+)" and is a single simple command$/,
    (ctx, miss) => {
      if (miss !== 'missing-root-argv') {
        throw new Error(`BL-960: scenario 04 is about missing-root-argv, feature names "${miss}"`);
      }
      ctx.bl960.miss = miss;
    }
  );

  scoped(
    /^an original command that is a multi-command sequence whose failing segment misses because of "([^"]+)" and whose final segment is an unrelated command$/,
    (ctx, miss) => {
      if (miss !== 'missing-root-argv') {
        throw new Error(`BL-960: scenario 05 is about missing-root-argv, feature names "${miss}"`);
      }
      ctx.bl960.misdirect = true;
    }
  );

  scoped(/^the role runs that command$/, (ctx) => {
    if (ctx.bl960.misdirect) {
      ctx.bl960.result = runMode({ mode: 'misdirect' });
    } else {
      ctx.bl960.result = run913(ctx.bl960.miss, 'succeeds');
    }
  });

  scoped(/^the command is re-run once with the pinned root supplied to that command$/, (ctx) => {
    const r = ctx.bl960.result;
    if (r.invocationCount !== 2 || !r.gotProjectRootArg) {
      throw new Error(
        `BL-960: expected exactly one healed re-run with the root supplied, got ` +
          `invocationCount=${r.invocationCount}, gotProjectRootArg=${r.gotProjectRootArg}`
      );
    }
  });

  scoped(/^the pinned root is never appended to the unrelated final segment$/, (ctx) => {
    const r = ctx.bl960.result;
    if (r.rootAppendedInSource) {
      throw new Error('BL-960: the wrapper source appends the root to a multi-command original');
    }
    if (r.doneRan) {
      throw new Error(`BL-960: the unrelated final segment ran with the root appended: ${r.out}`);
    }
    if (!r.usageReturned || r.invocations !== 1) {
      throw new Error(
        `BL-960: expected the failure returned as-is after exactly one run, got invocations=${r.invocations}, out=${r.out}`
      );
    }
  });

  // ── 06: launch settings register the hook again ──────────────────────
  scoped(/^launch settings are written for a role$/, (ctx) => {
    ctx.bl960.settings = runMode({ mode: 'settings' }).settings;
  });

  scoped(/^the settings file registers the tool-miss-heal hook for the Bash tool$/, (ctx) => {
    const s = ctx.bl960.settings;
    if (!s.includes('"PreToolUse"') || !s.includes('"matcher": "Bash"') || !s.includes('tool_miss_heal_hook.bb')) {
      throw new Error(`BL-960: expected the settings to register the Bash-matched heal hook, got: ${s}`);
    }
  });
}

module.exports = { registerSteps };
