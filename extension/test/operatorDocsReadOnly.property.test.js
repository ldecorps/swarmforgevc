'use strict';

const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  operatorDocsRoutesAreReadOnly,
  OPERATOR_DOCS_READ_ROUTE_PATHS,
} = require('../out/bridge/operatorDocsCore');

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

test('property: Operator docs routes never accept write methods from the browser client', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...WRITE_METHODS), { minLength: 0, maxLength: 4 }),
      fc.array(fc.constantFrom(...WRITE_METHODS), { minLength: 0, maxLength: 4 }),
      fc.array(fc.constantFrom(...WRITE_METHODS), { minLength: 0, maxLength: 4 }),
      (indexWrites, pageWrites, shellWrites) => {
        const methodsByPath = new Map([
          ['/operator-docs', new Set(['GET', ...shellWrites])],
          ['/operator-docs-index', new Set(['GET', ...indexWrites])],
          ['/operator-docs-page', new Set(['GET', ...pageWrites])],
          ['/gate-answer', new Set(['POST'])],
        ]);
        const hasWrite = [...OPERATOR_DOCS_READ_ROUTE_PATHS].some((routePath) => {
          const methods = methodsByPath.get(routePath) ?? new Set();
          return [...methods].some((method) => WRITE_METHODS.includes(method));
        });
        assert.equal(operatorDocsRoutesAreReadOnly(methodsByPath), !hasWrite);
      }
    ),
    { numRuns: 100 }
  );
});
