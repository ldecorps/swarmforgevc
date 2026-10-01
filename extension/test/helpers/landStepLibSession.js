'use strict';

// BL-1865: `ask()` in bl1343ReplayNeverDropsOwnPathInvariants.property.test.js
// used to spawn one `bb -e` per draw, and every spawn reloaded the 4071-line
// land_step_lib.bb from scratch (~1.0-1.1 s per load, measured by the
// specifier 2026-10-01) - with 27 draws per test, most of each test's time
// was spent re-parsing the same lib file. This starts ONE `bb` process per
// test that loads the lib once, then answers each draw's own expression sent
// over stdin (one line in, one JSON line back) - the lib load cost is paid
// once per test, never once per draw, while every draw still gets its answer
// freshly evaluated against the tree under test (BL-1865 invariant 2: no
// draw's answer is cached, stubbed or reused for another draw).

const { spawn } = require('node:child_process');
const readline = require('node:readline');

function startBbSession(libPath) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${libPath}")
(loop []
  (let [line (read-line)]
    (when line
      (try
        (println (json/generate-string {"ok" true "value" (eval (read-string line))}))
        (catch Exception e
          (println (json/generate-string {"ok" false "error" (.getMessage e)}))))
      (flush)
      (recur))))`;
  const child = spawn('bb', ['-e', program], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = [];
  let stderr = '';
  let exitCode = null;

  rl.on('line', (line) => {
    const next = pending.shift();
    if (next) next.resolve(line);
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('exit', (code) => {
    exitCode = code;
    while (pending.length > 0) {
      pending.shift().reject(new Error(`bb session exited (code ${code}) before answering: ${stderr}`));
    }
  });

  return {
    ask(expression) {
      if (exitCode !== null) {
        return Promise.reject(new Error(`bb session already exited (code ${exitCode}): ${stderr}`));
      }
      return new Promise((resolve, reject) => {
        pending.push({
          resolve: (line) => {
            let parsed;
            try {
              parsed = JSON.parse(line);
            } catch (err) {
              reject(new Error(`bb session answered non-JSON for ${expression}: ${line}`));
              return;
            }
            if (!parsed || parsed.ok !== true) {
              reject(new Error(`bb session failed to evaluate ${expression}: ${parsed && parsed.error}`));
              return;
            }
            resolve(parsed.value);
          },
          reject,
        });
        child.stdin.write(`${expression.replace(/\n/g, ' ')}\n`);
      });
    },
    close() {
      rl.close();
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      child.kill();
    },
  };
}

module.exports = { startBbSession };
