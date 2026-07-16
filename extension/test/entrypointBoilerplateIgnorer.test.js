const assert = require('node:assert/strict');
const {
  classifyMutantLocation,
  isRequireMainGuardNode,
  isEsModuleBoilerplateNode,
  EntrypointBoilerplateIgnorer,
} = require('../out/mutation/entrypointBoilerplateIgnorer');

// ── classifyMutantLocation (pure) — BL-447 entrypoint-boilerplate-excluded-01/02 ──

test('BL-447: a require.main entrypoint guard location is excluded', () => {
  assert.equal(classifyMutantLocation({ isRequireMainGuard: true, isEsModuleBoilerplate: false }), 'excluded');
});

test('BL-447: a generated __esModule boilerplate location is excluded', () => {
  assert.equal(classifyMutantLocation({ isRequireMainGuard: false, isEsModuleBoilerplate: true }), 'excluded');
});

test('BL-447: exported business logic (neither structural fact holds) is kept', () => {
  assert.equal(classifyMutantLocation({ isRequireMainGuard: false, isEsModuleBoilerplate: false }), 'kept');
});

test('BL-447 entrypoint-boilerplate-excluded-02: exported business logic that no test covers is still kept, never excluded by absence-of-coverage - classifyMutantLocation takes no coverage signal at all', () => {
  // The function's own signature is proof: it accepts only structural facts,
  // never a "covered?"/"killed?" flag - there is no coverage input it COULD
  // key off of, so an untested real-logic mutant can never be misclassified
  // as boilerplate.
  assert.equal(classifyMutantLocation({ isRequireMainGuard: false, isEsModuleBoilerplate: false }), 'kept');
});

// ── isRequireMainGuardNode (pure, plain-object AST shape) ─────────────────

function requireMainGuardIf({ left = 'require.main', operator = '===' } = {}) {
  const requireMainMember = { type: 'MemberExpression', object: { type: 'Identifier', name: 'require' }, property: { type: 'Identifier', name: 'main' } };
  const moduleIdentifier = { type: 'Identifier', name: 'module' };
  const [testLeft, testRight] = left === 'require.main' ? [requireMainMember, moduleIdentifier] : [moduleIdentifier, requireMainMember];
  return {
    type: 'IfStatement',
    test: { type: 'BinaryExpression', operator, left: testLeft, right: testRight },
    consequent: { type: 'BlockStatement', body: [] },
  };
}

test('BL-447: recognizes the real compiled shape - if (require.main === module) { ... }', () => {
  assert.equal(isRequireMainGuardNode(requireMainGuardIf()), true);
});

test('BL-447: recognizes the guard regardless of operand order - if (module === require.main)', () => {
  assert.equal(isRequireMainGuardNode(requireMainGuardIf({ left: 'module' })), true);
});

test('BL-447: recognizes the guard written with !== too', () => {
  assert.equal(isRequireMainGuardNode(requireMainGuardIf({ operator: '!==' })), true);
});

test('BL-447: an ordinary if-statement is never mistaken for the entrypoint guard', () => {
  assert.equal(
    isRequireMainGuardNode({
      type: 'IfStatement',
      test: { type: 'BinaryExpression', operator: '===', left: { type: 'Identifier', name: 'a' }, right: { type: 'Identifier', name: 'b' } },
      consequent: { type: 'BlockStatement', body: [] },
    }),
    false
  );
});

test('BL-447: a non-IfStatement node is never mistaken for the entrypoint guard', () => {
  assert.equal(isRequireMainGuardNode({ type: 'ExpressionStatement', expression: { type: 'CallExpression' } }), false);
});

// ── isEsModuleBoilerplateNode (pure, plain-object AST shape) ──────────────

function esModuleDeclarationStatement() {
  return {
    type: 'ExpressionStatement',
    expression: {
      type: 'CallExpression',
      callee: { type: 'MemberExpression', object: { type: 'Identifier', name: 'Object' }, property: { type: 'Identifier', name: 'defineProperty' } },
      arguments: [
        { type: 'Identifier', name: 'exports' },
        { type: 'StringLiteral', value: '__esModule' },
        { type: 'ObjectExpression', properties: [] },
      ],
    },
  };
}

test('BL-447: recognizes the real compiled shape - Object.defineProperty(exports, "__esModule", { value: true })', () => {
  assert.equal(isEsModuleBoilerplateNode(esModuleDeclarationStatement()), true);
});

test('BL-447: an unrelated Object.defineProperty call is never mistaken for the __esModule boilerplate', () => {
  const node = esModuleDeclarationStatement();
  node.expression.arguments[1] = { type: 'StringLiteral', value: 'someOtherProperty' };
  assert.equal(isEsModuleBoilerplateNode(node), false);
});

test('BL-447: an unrelated call expression is never mistaken for the __esModule boilerplate', () => {
  assert.equal(
    isEsModuleBoilerplateNode({
      type: 'ExpressionStatement',
      expression: { type: 'CallExpression', callee: { type: 'Identifier', name: 'runCliMain' }, arguments: [] },
    }),
    false
  );
});

test('BL-447: a non-ExpressionStatement node is never mistaken for the __esModule boilerplate', () => {
  assert.equal(isEsModuleBoilerplateNode({ type: 'IfStatement' }), false);
});

// ── EntrypointBoilerplateIgnorer (thin Stryker Ignorer wiring) ────────────

test('BL-447: the Ignorer excludes a require.main guard NodePath, naming a reason', () => {
  const ignorer = new EntrypointBoilerplateIgnorer();
  const reason = ignorer.shouldIgnore({ node: requireMainGuardIf() });
  assert.equal(typeof reason, 'string');
  assert.ok(reason.length > 0);
});

test('BL-447: the Ignorer excludes an __esModule boilerplate NodePath, naming a reason', () => {
  const ignorer = new EntrypointBoilerplateIgnorer();
  const reason = ignorer.shouldIgnore({ node: esModuleDeclarationStatement() });
  assert.equal(typeof reason, 'string');
  assert.ok(reason.length > 0);
});

test('BL-447: the Ignorer never excludes an ordinary node - real logic stays mutatable', () => {
  const ignorer = new EntrypointBoilerplateIgnorer();
  const reason = ignorer.shouldIgnore({ node: { type: 'BinaryExpression', operator: '>=', left: { type: 'Identifier', name: 'durationMs' }, right: { type: 'Identifier', name: 'budgetMs' } } });
  assert.equal(reason, undefined);
});
