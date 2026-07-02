const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeCrap,
  isFlagged,
  extractFunctions,
  parseSource,
  statementCoverageFraction,
} = require('../scripts/crapLib');

// ── computeCrap / isFlagged (pure math) ──────────────────────────────────

test('computeCrap of a fully-covered function equals its complexity', () => {
  // (1-1)^3 term vanishes, so CRAP == complexity when coverage is 100%.
  assert.equal(computeCrap(3, 1), 3);
});

test('computeCrap of an uncovered function is complexity^2 + complexity', () => {
  assert.equal(computeCrap(3, 0), 3 ** 2 + 3);
});

test('computeCrap grows steeply with complexity when coverage is low', () => {
  const lowComplexity = computeCrap(2, 0);
  const highComplexity = computeCrap(10, 0);
  assert.ok(highComplexity > lowComplexity * 10, 'CRAP must scale super-linearly with complexity');
});

// BL-049 crap-02 / crap-03
test('isFlagged: a high-complexity, low-coverage function exceeds the threshold', () => {
  const crap = computeCrap(8, 0.1); // complex, barely covered
  assert.ok(crap > 6);
  assert.equal(isFlagged(crap), true);
});

test('isFlagged: a simple, well-covered function does not exceed the threshold', () => {
  const crap = computeCrap(2, 1); // trivial, fully covered
  assert.ok(crap <= 6);
  assert.equal(isFlagged(crap), false);
});

test('isFlagged respects a custom threshold', () => {
  assert.equal(isFlagged(5, 4), true);
  assert.equal(isFlagged(3, 4), false);
});

// ── extractFunctions / complexity (real TS AST) — BL-049 crap-01 ────────

function extract(source) {
  return extractFunctions(parseSource('fixture.ts', source));
}

test('a trivial function has complexity 1 (a single path, no branches)', () => {
  const fns = extract('export function add(a: number, b: number): number {\n  return a + b;\n}\n');
  assert.equal(fns.length, 1);
  assert.equal(fns[0].name, 'add');
  assert.equal(fns[0].complexity, 1);
});

test('each if/else-if branch adds one to complexity', () => {
  const fns = extract(`
    export function classify(n: number): string {
      if (n < 0) {
        return 'negative';
      } else if (n === 0) {
        return 'zero';
      }
      return 'positive';
    }
  `);
  // base path (1) + if (1) + else-if (1) = 3
  assert.equal(fns[0].complexity, 3);
});

test('logical && / || operators each add one to complexity', () => {
  const fns = extract('export function both(a: boolean, b: boolean): boolean {\n  return a && b || !a;\n}\n');
  // base (1) + && (1) + || (1) = 3
  assert.equal(fns[0].complexity, 3);
});

test('a nested function gets its own complexity, not folded into the outer one', () => {
  const fns = extract(`
    export function outer(items: number[]): number[] {
      return items.filter(function inner(x) {
        if (x > 0) {
          return true;
        }
        return false;
      });
    }
  `);
  const outer = fns.find((f) => f.name === 'outer');
  const inner = fns.find((f) => f.name === 'inner');
  assert.equal(outer.complexity, 1, 'the outer function has no branches of its own');
  assert.equal(inner.complexity, 2, 'the inner function owns its own if-branch');
});

test('an arrow function assigned to a const is named after the variable', () => {
  const fns = extract('export const double = (n: number): number => n * 2;\n');
  assert.equal(fns[0].name, 'double');
  assert.equal(fns[0].complexity, 1);
});

test('a class method is extracted with the class-body method name', () => {
  const fns = extract(`
    export class Thing {
      compute(x: number): number {
        if (x > 10) {
          return x;
        }
        return 0;
      }
    }
  `);
  assert.equal(fns.length, 1);
  assert.equal(fns[0].name, 'compute');
  assert.equal(fns[0].complexity, 2);
});

// ── statementCoverageFraction ─────────────────────────────────────────────

function fakeCoverage(statements) {
  const statementMap = {};
  const s = {};
  statements.forEach(([line, hits], i) => {
    statementMap[i] = { start: { line }, end: { line } };
    s[i] = hits;
  });
  return { statementMap, s };
}

test('statementCoverageFraction is the ratio of covered statements within the line range', () => {
  const coverage = fakeCoverage([
    [10, 5], // covered, in range
    [11, 0], // uncovered, in range
    [12, 3], // covered, in range
    [20, 1], // covered, OUT of range
  ]);
  assert.equal(statementCoverageFraction(coverage, 10, 15), 2 / 3);
});

test('statementCoverageFraction is 1 when a function has no statements of its own', () => {
  const coverage = fakeCoverage([[50, 1]]);
  assert.equal(statementCoverageFraction(coverage, 10, 12), 1);
});

test('statementCoverageFraction is 0 when the file has no coverage entry at all', () => {
  assert.equal(statementCoverageFraction(undefined, 1, 5), 0);
});

test('statementCoverageFraction is 0 for a completely uncovered function', () => {
  const coverage = fakeCoverage([
    [10, 0],
    [11, 0],
  ]);
  assert.equal(statementCoverageFraction(coverage, 10, 12), 0);
});
