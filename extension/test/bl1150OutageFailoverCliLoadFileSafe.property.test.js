'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'outage_failover_cli.bb');

// BL-1150 invariants:
// 1. load-file never calls System/exit and never invokes -main (encoded by
//    presence of babashka.file guard and absence of bare (-main)).
// 2. entrypoint path still reaches -main (guard wraps (-main), not deletes it).

test('property: CLI source always pairs a babashka.file guard with a -main definition', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  fc.assert(
    fc.property(fc.constant(src), (text) => {
      assert.match(text, /\(defn -main/);
      assert.match(text, /\(when \(= \*file\* \(System\/getProperty "babashka\.file"\)\)/);
      assert.doesNotMatch(text, /^\(-main\)$/m);
      assert.match(text, /\(when \(= \*file\* \(System\/getProperty "babashka\.file"\)\)[\s\S]*?\(-main\)/);
    }),
    { numRuns: 1 }
  );
});
