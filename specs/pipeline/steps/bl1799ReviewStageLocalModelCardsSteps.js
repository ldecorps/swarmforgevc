'use strict';

// BL-1799: step handlers for "The review-stage roles get local-model
// cards". Reuses BL-1798's own unscoped steps (compose/char-limit/names
// ready_for_next.sh etc. - registered via registry.define, so they
// resolve for any feature, not just BL-1798's own) for the generic
// assertions; this file adds only the one assertion BL-1798 hardcoded to
// "coder" - naming the role's OWN full prompt file - parameterized by
// role so it works for cleaner/architect/hardender/documenter too.
// Drives the REAL prompt_engine_cli.bb compose command, never a
// reimplementation.

const FEATURE = 'BL-1799 The review-stage roles get local-model cards';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^it names swarmforge\/roles\/([a-z-]+)\.prompt and swarmforge\/constitution\.prompt as where the full text lives$/,
    (ctx, role) => {
      for (const needle of [`swarmforge/roles/${role}.prompt`, 'swarmforge/constitution.prompt']) {
        if (!ctx.composed.includes(needle)) {
          throw new Error(`expected the composed prompt to name "${needle}"`);
        }
      }
    }
  );

  scoped(/^it names "([^"]+)" as the role it forwards to$/, (ctx, next) => {
    if (!ctx.composed.includes(next)) {
      throw new Error(`expected the composed prompt to name "${next}" as the role it forwards to`);
    }
  });
}

module.exports = { registerSteps };
