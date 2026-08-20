'use strict';

// BL-968: a step file that resolves environmental state (git rev-parse, a
// live file read, a login-shell subprocess) at module top level makes the
// whole registry unloadable from the BL-761 gate's materialized non-repo
// temp tree - the require chain dies and the acceptance-contract check
// warns-and-skips for every send citing that file. Deferring the resolution
// into a memoized getter, called at step-execution time instead of require
// time, keeps behavior identical while letting the registry load cleanly.
function lazy(resolve) {
  let value;
  let resolved = false;
  return function lazyGetter() {
    if (!resolved) {
      value = resolve();
      resolved = true;
    }
    return value;
  };
}

module.exports = { lazy };
