'use strict';

// BL-1866: a handler's stale-fixture sweep (BL-971) runs before the first
// of ITS OWN steps executes, never while the full step registry is being
// built. Thirteen handlers called their `/tmp` prefix sweep as the first
// line of `registerSteps`, so every full-registry build (bl800's property
// test, the BL-761 registration gate) listed `/tmp` thirteen times - about
// half a second each with ~445,000 leaked entries there (BL-1867) - and
// bl800 went red under load. A feature run that never reaches one of the
// handler's steps now pays for no listing at all.
//
// Usage, as the first line of registerSteps:
//   registry = sweepOnFirstStep(registry, sweepStaleFixtures);
//
// The returned registry is the caller's own (resolve/listDefinitions reach
// it through the prototype); only define/defineScoped wrap the handler so
// the sweep runs once per process, before the first wrapped step.

function sweepOnFirstStep(registry, sweep) {
  let swept = false;
  const sweepOnce = () => {
    if (!swept) {
      swept = true;
      sweep();
    }
  };
  const wrap = (handler) =>
    function sweptFirst(...args) {
      sweepOnce();
      return handler.apply(this, args);
    };
  return Object.assign(Object.create(registry), {
    define: (pattern, handler) => registry.define(pattern, wrap(handler)),
    defineScoped: (pattern, handler, featureName) => registry.defineScoped(pattern, wrap(handler), featureName),
  });
}

module.exports = { sweepOnFirstStep };
