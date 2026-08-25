const assert = require('node:assert/strict');
const {
  analyzeThinMainSource,
  applyAllowlist,
  allowlistOnlyShrinks,
  evaluateThinMainSources,
  formatFinding,
  parseAllowlist,
  parcelIgnoresAllowlist,
  renderThinMainResult,
  MAX_MAIN_COMPLEXITY,
} = require('../out/quality/thinMainGate');

test('CC > 2 exported main is a complexity finding', () => {
  const src = `
export function main(): void {
  if (true) {
    if (false) {
      console.log('x');
    }
  }
}
`;
  const f = analyzeThinMainSource('src/tools/fat.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
  assert.ok(f.complexity > MAX_MAIN_COMPLEXITY);
});

test('CC <= 2 exported main is clean', () => {
  const src = `
export function main(): void {
  run();
}
`;
  assert.equal(analyzeThinMainSource('src/tools/thin.ts', src), null);
});

test('defined but unexported main is a finding', () => {
  const src = `
function main(): void {
  run();
}
`;
  const f = analyzeThinMainSource('src/tools/hidden.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'not-exported');
});

test('file with no main is ignored', () => {
  assert.equal(analyzeThinMainSource('src/tools/helpers.ts', 'export const x = 1;\n'), null);
});

test('exported const arrow main counts as main', () => {
  const clean = `
export const main = (): void => {
  run();
};
`;
  assert.equal(analyzeThinMainSource('src/tools/arrow.ts', clean), null);

  const fat = `
export const main = (): void => {
  if (a) {
    if (b) {
      c();
    }
  }
};
`;
  const f = analyzeThinMainSource('src/tools/arrow-fat.ts', fat);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
});

test('export { main } after declaration counts as exported', () => {
  const src = `
function main(): void {
  run();
}
export { main };
`;
  assert.equal(analyzeThinMainSource('src/tools/reexport.ts', src), null);
});

test('nested helper functions do not inflate main CC', () => {
  // Nested function's own if must not be charged to main (isRoot skip).
  const src = `
export function main(): void {
  function helper(): void {
    if (true) {
      if (false) {
        x();
      }
    }
  }
  helper();
}
`;
  assert.equal(analyzeThinMainSource('src/tools/nested.ts', src), null);
});

test('boolean operators and ternary raise complexity', () => {
  const src = `
export function main(): void {
  const x = a && b || c ?? d ? e : f;
}
`;
  const f = analyzeThinMainSource('src/tools/ops.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
  assert.ok(f.complexity > MAX_MAIN_COMPLEXITY);
});

test('for/while/catch/case decision points raise complexity', () => {
  const src = `
export function main(): void {
  for (const x of ys) {
    while (x) {
      try {
        use(x);
      } catch (e) {
        switch (e) {
          case 1:
            break;
        }
      }
    }
  }
}
`;
  const f = analyzeThinMainSource('src/tools/loops.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
});

test('parcel mode never drops an allowlisted finding (invariant 1)', () => {
  const finding = {
    filePath: 'src/tools/fat.ts',
    basename: 'fat.ts',
    reason: 'complexity',
    complexity: 5,
  };
  const allow = new Set(['fat.ts']);
  assert.deepEqual(parcelIgnoresAllowlist(finding, allow), [finding]);
  assert.deepEqual(applyAllowlist([finding], 'parcel', allow), [finding]);
});

test('full mode skips allowlisted basenames', () => {
  const finding = {
    filePath: 'src/tools/fat.ts',
    basename: 'fat.ts',
    reason: 'complexity',
    complexity: 5,
  };
  assert.deepEqual(applyAllowlist([finding], 'full', new Set(['fat.ts'])), []);
  assert.deepEqual(applyAllowlist([finding], 'full', new Set()), [finding]);
});

test('allowlist may only shrink (invariant 2)', () => {
  assert.equal(allowlistOnlyShrinks(['a.ts', 'b.ts'], ['a.ts']), true);
  assert.equal(allowlistOnlyShrinks(['a.ts'], ['a.ts', 'c.ts']), false);
  assert.equal(allowlistOnlyShrinks([], []), true);
});

test('parseAllowlist ignores comments and blanks and basenames paths', () => {
  const set = parseAllowlist('# seed\nfat.ts\n\n# more\nsubdir/other.ts\n');
  assert.deepEqual([...set].sort(), ['fat.ts', 'other.ts']);
});

test('formatFinding distinguishes not-exported vs complexity', () => {
  assert.match(
    formatFinding({
      filePath: 'a.ts',
      basename: 'a.ts',
      reason: 'not-exported',
      complexity: 1,
    }),
    /not exported/
  );
  assert.match(
    formatFinding({
      filePath: 'b.ts',
      basename: 'b.ts',
      reason: 'complexity',
      complexity: 9,
    }),
    /cyclomatic complexity 9/
  );
});

test('renderThinMainResult exit codes and empty report', () => {
  assert.deepEqual(renderThinMainResult([]).exitCode, 0);
  assert.equal(renderThinMainResult([]).report, '');
  assert.equal(renderThinMainResult([]).passed, true);
  const bad = renderThinMainResult([
    { filePath: 'x.ts', basename: 'x.ts', reason: 'complexity', complexity: 4 },
  ]);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.passed, false);
  assert.match(bad.report, /x\.ts/);
});

test('evaluateThinMainSources parcel reports fat main', () => {
  const result = evaluateThinMainSources(
    [
      {
        filePath: 'extension/src/tools/demo.ts',
        sourceText: `export function main(): void {\n  if (a) { if (b) { c(); } }\n}\n`,
      },
    ],
    'parcel',
    new Set(['demo.ts'])
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.report, /demo\.ts/);
  assert.match(result.report, /main/);
});

test('evaluateThinMainSources full mode can clear via allowlist', () => {
  const result = evaluateThinMainSources(
    [
      {
        filePath: 'extension/src/tools/demo.ts',
        sourceText: `export function main(): void {\n  if (a) { if (b) { c(); } }\n}\n`,
      },
    ],
    'full',
    new Set(['demo.ts'])
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.findings.length, 0);
});


test('CC exactly MAX is clean; MAX+1 fails (kills > vs >=)', () => {
  const atMax = `
export function main(): void {
  if (flag) {
    run();
  }
}
`;
  assert.equal(analyzeThinMainSource('src/tools/at-max.ts', atMax), null);
  const over = `
export function main(): void {
  if (a) {
    if (b) {
      run();
    }
  }
}
`;
  const f = analyzeThinMainSource('src/tools/over.ts', over);
  assert.ok(f);
  assert.equal(f.complexity, MAX_MAIN_COMPLEXITY + 1);
});

test('&& alone raises complexity', () => {
  const src = `
export function main(): void {
  const x = a && b && c && d;
}
`;
  const f = analyzeThinMainSource('src/tools/and.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
});

test('|| alone raises complexity', () => {
  const src = `
export function main(): void {
  const x = a || b || c || d;
}
`;
  const f = analyzeThinMainSource('src/tools/or.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
});

test('?? alone raises complexity', () => {
  const src = `
export function main(): void {
  const x = a ?? b ?? c ?? d;
}
`;
  const f = analyzeThinMainSource('src/tools/qq.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
});

test('ternary alone raises complexity', () => {
  const src = `
export function main(): void {
  const x = a ? b : c ? d : e ? f : g;
}
`;
  const f = analyzeThinMainSource('src/tools/tern.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'complexity');
});

test('plain + does not raise complexity', () => {
  const src = `
export function main(): void {
  const x = a + b + c + d;
}
`;
  assert.equal(analyzeThinMainSource('src/tools/add.ts', src), null);
});

test('parseAllowlist trims surrounding whitespace', () => {
  const set = parseAllowlist('  spaced.ts  \n');
  assert.deepEqual([...set], ['spaced.ts']);
});

test('renderThinMainResult joins findings with newlines', () => {
  const r = renderThinMainResult([
    { filePath: 'a.ts', basename: 'a.ts', reason: 'complexity', complexity: 4 },
    { filePath: 'b.ts', basename: 'b.ts', reason: 'not-exported', complexity: 1 },
  ]);
  assert.match(r.report, /a\.ts[\s\S]*\nb\.ts/);
  assert.ok(r.report.indexOf('\n') > 0);
});

test('evaluateThinMainSources skips files without main (does not push null)', () => {
  const result = evaluateThinMainSources(
    [
      { filePath: 'extension/src/tools/helpers.ts', sourceText: 'export const x = 1;\n' },
      {
        filePath: 'extension/src/tools/demo.ts',
        sourceText: `export function main(): void {\n  if (a) { if (b) { c(); } }\n}\n`,
      },
    ],
    'parcel',
    new Set()
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].basename, 'demo.ts');
});

test('async function main without export is not-exported', () => {
  const src = `
async function main(): Promise<void> {
  await run();
}
`;
  const f = analyzeThinMainSource('src/tools/async-hidden.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'not-exported');
});


test('export async function main still counts as exported (kills every-modifier)', () => {
  const src = `
export async function main(): Promise<void> {
  await run();
}
`;
  assert.equal(analyzeThinMainSource('src/tools/async-export.ts', src), null);
});

test('export { other } does not mark unexported main as exported', () => {
  const src = `
function main(): void {
  run();
}
export { other };
function other(): void {}
`;
  const f = analyzeThinMainSource('src/tools/other-export.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'not-exported');
});

test('method named main is found and not module-exported', () => {
  const src = `
export class C {
  main(): void {
    if (a) {
      if (b) {
        c();
      }
    }
  }
}
`;
  const f = analyzeThinMainSource('src/tools/method-main.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'not-exported');
});


test('export { main, other } counts as exported (kills every vs some)', () => {
  const src = `
function main(): void {
  run();
}
function other(): void {}
export { main, other };
`;
  assert.equal(analyzeThinMainSource('src/tools/multi-export.ts', src), null);
});

test('export * from does not mark unexported main as exported', () => {
  const src = `
function main(): void {
  run();
}
export * from './elsewhere';
`;
  const f = analyzeThinMainSource('src/tools/star-export.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'not-exported');
});


test('first non-main function-like must not steal main (kills name===main → true)', () => {
  const src = `
export function helper(): void {
  if (a) {
    if (b) {
      c();
    }
  }
}
export function main(): void {
  run();
}
`;
  assert.equal(analyzeThinMainSource('src/tools/helper-first.ts', src), null);
});

test('first of two mains wins (kills found early-return empty)', () => {
  const src = `
export function main(): void {
  run();
}
export function main(): void {
  if (a) {
    if (b) {
      c();
    }
  }
}
`;
  // First main is thin; if early-return is dropped, second fat main overwrites → finding.
  assert.equal(analyzeThinMainSource('src/tools/two-mains.ts', src), null);
});

test('unexported const arrow main is not-exported (kills VariableStatement if(true))', () => {
  const src = `
const main = (): void => {
  run();
};
`;
  const f = analyzeThinMainSource('src/tools/hidden-arrow.ts', src);
  assert.ok(f);
  assert.equal(f.reason, 'not-exported');
});

test('overload signature without body is skipped (kills isFunctionLike||body)', () => {
  const src = `
export function main(): void;
export function main(): void {
  run();
}
`;
  assert.equal(analyzeThinMainSource('src/tools/overload.ts', src), null);
});
