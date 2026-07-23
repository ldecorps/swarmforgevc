'use strict';

function createStepRegistry() {
  const definitions = [];

  function define(pattern, handler) {
    definitions.push({ pattern, handler });
  }

  // BL-425: a scoped registration is preferred over an unscoped one, but
  // ONLY when resolve() is asked to resolve for the SAME featureName it was
  // defined under - see resolve() below. Two different tickets' step files
  // can legitimately register the exact same generic step text (e.g. "the
  // message is handled") for completely unrelated behavior; this lets a new
  // ticket's step file pin its own registration to its own feature without
  // touching (or risking breaking) whichever unscoped registration
  // currently wins that literal text for every OTHER feature.
  function defineScoped(pattern, handler, featureName) {
    definitions.push({ pattern, handler, featureName });
  }

  // featureName is optional - omitted (or not matched by any scoped
  // definition) falls back to the ORIGINAL first-match-across-every-
  // registration scan, unchanged from before scoping existed. This keeps
  // every pre-existing registry.define call (no featureName involved at
  // all) exactly as behaviorally unaffected as a resolve(stepText) call
  // with no second argument.
  function resolve(stepText, featureName) {
    if (featureName) {
      for (const { pattern, handler, featureName: scope } of definitions) {
        if (scope === featureName) {
          const match = pattern.exec(stepText);
          if (match) {
            return { handler, args: match.slice(1) };
          }
        }
      }
    }
    // Unscoped-only fallback: a defineScoped registration never leaks into
    // resolution for a DIFFERENT (or absent) featureName - it already had
    // its chance in the scoped pass above. Only entries with no featureName
    // at all (every pre-existing registry.define call) participate here,
    // so this scan is byte-for-byte the original, unscoped resolve().
    for (const { pattern, handler, featureName: scope } of definitions) {
      if (scope) {
        continue;
      }
      const match = pattern.exec(stepText);
      if (match) {
        return { handler, args: match.slice(1) };
      }
    }
    return null;
  }

  return { define, defineScoped, resolve };
}

module.exports = { createStepRegistry };
