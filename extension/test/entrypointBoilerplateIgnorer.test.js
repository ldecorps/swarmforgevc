const assert = require('node:assert/strict');
const {
  classifyMutantLocation,
  isRequireMainGuardNode,
  isEsModuleBoilerplateNode,
  isIdentifierNamed,
  isAstNode,
  isNodeOfType,
  isRequireMainMemberExpression,
  isEqualityOperator,
  isRequireModuleEquality,
  isObjectDefinePropertyCallee,
  isEsModuleStringLiteralArg,
  isEsModuleCallArguments,
  isThisMemberNamed,
  isThisGuardedHelperReference,
  isTscImportHelperInit,
  isTscImportHelperDeclarator,
  isTscImportHelperVariableDeclaration,
  TSC_IMPORT_HELPER_NAMES,
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
  assert.equal(classifyMutantLocation({ isRequireMainGuard: false, isEsModuleBoilerplate: false, isTscImportHelper: false }), 'kept');
});

test('BL-498: a tsc import-helper preamble location is excluded', () => {
  assert.equal(classifyMutantLocation({ isRequireMainGuard: false, isEsModuleBoilerplate: false, isTscImportHelper: true }), 'excluded');
});

// ── shared AST-shape fixture builders ──────────────────────────────────────

function identifierNode(name) {
  return { type: 'Identifier', name };
}

function memberExpr(objectName, propertyName) {
  return { type: 'MemberExpression', object: identifierNode(objectName), property: identifierNode(propertyName) };
}

// A value whose `typeof` is 'function', never 'object' - so isAstNode's own
// first clause is false and short-circuits safely - but which still carries
// a real, readable `.type` string property, unlike a primitive (whose
// property reads are always undefined). This is the only way to make an
// AND-clause mutant that turns isAstNode's guard into `||` (or replaces its
// first clause with `true`) observably diverge from the real function
// without tripping over a thrown exception first.
function nonObjectWithType(type) {
  const fn = function nonObjectWithTypeFixture() {};
  fn.type = type;
  return fn;
}

// ── isAstNode / isNodeOfType / isIdentifierNamed (pure AST-shape predicates) ──
// Cleaner note: these were extracted from isRequireMainGuardNode /
// isEsModuleBoilerplateNode to bring each function's own cyclomatic
// complexity under the CRAP <= 6 gate (10.60 and 13.40 before the split).
// Each is a short guard-clause chain (isAstNode/isNodeOfType/isIdentifierNamed
// all read as `A && B && C`), and Stryker mutates every clause and every
// operator independently - reaching a specific inner clause mutant through 2-3
// layers of composed callers needs an AST shape engineered to hold every OTHER
// clause fixed while isolating the one under test, which gets combinatorially
// unreadable fast. Testing each predicate directly, once, is the same
// "small pure function, unit-tested directly" shape the project already uses
// for classifyMutantLocation itself.

test('BL-447: isAstNode recognizes a plain object carrying a string .type', () => {
  assert.equal(isAstNode({ type: 'Identifier' }), true);
});

test('BL-447: isAstNode rejects a primitive (not an object at all)', () => {
  assert.equal(isAstNode(42), false);
});

test('BL-447: isAstNode rejects null without dereferencing it', () => {
  assert.equal(isAstNode(null), false);
});

test('BL-447: isAstNode rejects an object whose .type is not a string', () => {
  assert.equal(isAstNode({ type: 123 }), false);
});

test('BL-447: isAstNode rejects a non-object value even when it carries a string .type property', () => {
  // Pins each clause independently: typeof-is-object is false here, so the
  // real function must stop there - it must never fall through and let a
  // borrowed .type property (or a weakened `||` in place of `&&`) sneak this
  // past as a real AST node.
  assert.equal(isAstNode(nonObjectWithType('Identifier')), false);
});

test('BL-447: isNodeOfType matches only the exact requested type', () => {
  assert.equal(isNodeOfType({ type: 'Foo' }, 'Foo'), true);
  assert.equal(isNodeOfType({ type: 'Foo' }, 'Bar'), false);
});

test('BL-447: isNodeOfType rejects a non-AstNode even if a `type` property happens to match', () => {
  assert.equal(isNodeOfType(nonObjectWithType('Bar'), 'Bar'), false);
});

test('BL-447: isIdentifierNamed matches only an Identifier node with the exact name', () => {
  assert.equal(isIdentifierNamed(identifierNode('main'), 'main'), true);
});

test('BL-447: isIdentifierNamed rejects a matching name on the wrong node type', () => {
  assert.equal(isIdentifierNamed({ type: 'NotIdentifier', name: 'main' }, 'main'), false);
});

test('BL-447: isIdentifierNamed rejects an Identifier node with the wrong name', () => {
  assert.equal(isIdentifierNamed(identifierNode('notMain'), 'main'), false);
});

test('BL-447: isIdentifierNamed rejects null without dereferencing it', () => {
  assert.equal(isIdentifierNamed(null, 'main'), false);
});

// ── isRequireMainMemberExpression / isRequireModuleEquality ───────────────

test('BL-447: isRequireMainMemberExpression recognizes require.main', () => {
  assert.equal(isRequireMainMemberExpression(memberExpr('require', 'main')), true);
});

test('BL-447: isRequireMainMemberExpression rejects the right shape on the wrong node type', () => {
  assert.equal(isRequireMainMemberExpression({ type: 'NotMemberExpr', object: identifierNode('require'), property: identifierNode('main') }), false);
});

test('BL-447: isRequireMainMemberExpression rejects a member expression naming something other than require', () => {
  assert.equal(isRequireMainMemberExpression(memberExpr('notRequire', 'main')), false);
});

test('BL-447: isEqualityOperator accepts only === and !==', () => {
  assert.equal(isEqualityOperator('==='), true);
  assert.equal(isEqualityOperator('!=='), true);
  assert.equal(isEqualityOperator('=='), false);
});

test('BL-447: isRequireModuleEquality recognizes require.main paired with module', () => {
  assert.equal(isRequireModuleEquality(memberExpr('require', 'main'), identifierNode('module')), true);
});

test('BL-447: isRequireModuleEquality rejects a non-require.main left operand even when right is module', () => {
  assert.equal(isRequireModuleEquality(identifierNode('notRequireMain'), identifierNode('module')), false);
});

test('BL-447: isRequireModuleEquality rejects a right operand that is not the module identifier', () => {
  assert.equal(isRequireModuleEquality(memberExpr('require', 'main'), identifierNode('notModule')), false);
});

// ── isObjectDefinePropertyCallee / isEsModuleStringLiteralArg / isEsModuleCallArguments ──

test('BL-447: isObjectDefinePropertyCallee recognizes Object.defineProperty', () => {
  assert.equal(isObjectDefinePropertyCallee(memberExpr('Object', 'defineProperty')), true);
});

test('BL-447: isObjectDefinePropertyCallee rejects the right shape on the wrong node type', () => {
  assert.equal(isObjectDefinePropertyCallee({ type: 'NotMemberExpr', object: identifierNode('Object'), property: identifierNode('defineProperty') }), false);
});

test('BL-447: isObjectDefinePropertyCallee rejects a member expression naming something other than Object', () => {
  assert.equal(isObjectDefinePropertyCallee(memberExpr('NotObject', 'defineProperty')), false);
});

test('BL-447: isEsModuleStringLiteralArg recognizes the "__esModule" string literal', () => {
  assert.equal(isEsModuleStringLiteralArg({ type: 'StringLiteral', value: '__esModule' }), true);
});

test('BL-447: isEsModuleStringLiteralArg rejects the right value on the wrong node type', () => {
  assert.equal(isEsModuleStringLiteralArg({ type: 'NotStringLiteral', value: '__esModule' }), false);
});

test('BL-447: isEsModuleStringLiteralArg rejects a string literal with a different value', () => {
  assert.equal(isEsModuleStringLiteralArg({ type: 'StringLiteral', value: 'notEsModule' }), false);
});

test('BL-447: isEsModuleCallArguments requires a real array, never an array-like object', () => {
  assert.equal(isEsModuleCallArguments({ 0: 'x', 1: { type: 'StringLiteral', value: '__esModule' }, length: 2 }), false);
});

test('BL-447: isEsModuleCallArguments rejects a real array whose second argument is not the __esModule literal', () => {
  assert.equal(isEsModuleCallArguments(['x', { type: 'StringLiteral', value: 'notEsModule' }]), false);
});

test('BL-447: isEsModuleCallArguments accepts exactly 2 arguments (the >= 2 boundary, not only >2)', () => {
  assert.equal(isEsModuleCallArguments(['x', { type: 'StringLiteral', value: '__esModule' }]), true);
});

test('BL-447: isEsModuleCallArguments requires length >= 2, not just a valid element sitting at index 1', () => {
  // A Proxy is needed here, not a plain array: assigning past a real array's
  // .length auto-extends it, so there is no way to hold a real array's
  // reported .length below 2 while index 1 still carries a real element -
  // lying about .length through a Proxy is the only way to decouple the two
  // and pin this exact boundary (Array.isArray sees through a Proxy to its
  // target, so this still passes the Array.isArray check for real).
  const target = ['x', { type: 'StringLiteral', value: '__esModule' }];
  const shortLengthProxy = new Proxy(target, {
    get(obj, prop) {
      return prop === 'length' ? 1 : obj[prop];
    },
  });
  assert.equal(isEsModuleCallArguments(shortLengthProxy), false);
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

test('BL-447: an operator other than === or !== is never mistaken for the entrypoint guard', () => {
  assert.equal(isRequireMainGuardNode(requireMainGuardIf({ operator: '==' })), false);
});

test('BL-447: a non-IfStatement node is rejected on its own type even when its nested .test looks like the guard', () => {
  // Pins that the outer `node.type === 'IfStatement'` check is load-bearing on
  // its own: a node carrying a fully guard-shaped `.test` must still be
  // rejected if the node itself is not an IfStatement - proves this isn't
  // rejected only incidentally by a later check finding nothing to work with.
  assert.equal(
    isRequireMainGuardNode({
      type: 'NotAnIfStatement',
      test: { type: 'BinaryExpression', operator: '===', left: memberExpr('require', 'main'), right: identifierNode('module') },
    }),
    false
  );
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

test('BL-447: a non-ExpressionStatement node is rejected on its own type even when its nested .expression looks like the boilerplate call', () => {
  const node = esModuleDeclarationStatement();
  node.type = 'NotExpressionStatement';
  assert.equal(isEsModuleBoilerplateNode(node), false);
});

test('BL-447: a non-CallExpression is rejected on its own type even when its .callee looks like Object.defineProperty', () => {
  const node = esModuleDeclarationStatement();
  node.expression.type = 'NotCallExpression';
  assert.equal(isEsModuleBoilerplateNode(node), false);
});

// ── BL-498: tsc import-helper preamble (pure, plain-object AST shape) ─────

function thisMemberNode(name) {
  return { type: 'MemberExpression', object: { type: 'ThisExpression' }, property: identifierNode(name) };
}

function thisGuardedHelperRef(name) {
  return { type: 'LogicalExpression', operator: '&&', left: { type: 'ThisExpression' }, right: thisMemberNode(name) };
}

// The right-hand `body` is deliberately a plain, arbitrary node by default -
// isTscImportHelperInit must never care about its shape (tsc emits a
// different body per helper: a conditional, an IIFE, a plain function).
function tscImportHelperInit(name, body = { type: 'FunctionExpression' }) {
  return { type: 'LogicalExpression', operator: '||', left: thisGuardedHelperRef(name), right: body };
}

function tscImportHelperVariableDeclarationNode(name, init = tscImportHelperInit(name)) {
  return {
    type: 'VariableDeclaration',
    declarations: [{ type: 'VariableDeclarator', id: identifierNode(name), init }],
  };
}

test('BL-498: isThisMemberNamed recognizes this.<name>', () => {
  assert.equal(isThisMemberNamed(thisMemberNode('__importStar'), '__importStar'), true);
});

test('BL-498: isThisMemberNamed rejects the right shape on the wrong node type', () => {
  assert.equal(isThisMemberNamed({ type: 'NotMemberExpr', object: { type: 'ThisExpression' }, property: identifierNode('__importStar') }, '__importStar'), false);
});

test('BL-498: isThisMemberNamed rejects a member expression whose object is not `this`', () => {
  assert.equal(isThisMemberNamed(memberExpr('notThis', '__importStar'), '__importStar'), false);
});

test('BL-498: isThisGuardedHelperReference recognizes `this && this.<name>`', () => {
  assert.equal(isThisGuardedHelperReference(thisGuardedHelperRef('__importStar'), '__importStar'), true);
});

test('BL-498: isThisGuardedHelperReference rejects the right shape on the wrong node type', () => {
  const node = thisGuardedHelperRef('__importStar');
  node.type = 'NotLogicalExpression';
  assert.equal(isThisGuardedHelperReference(node, '__importStar'), false);
});

test('BL-498: isThisGuardedHelperReference rejects an operator other than &&', () => {
  const node = thisGuardedHelperRef('__importStar');
  node.operator = '||';
  assert.equal(isThisGuardedHelperReference(node, '__importStar'), false);
});

test('BL-498: isThisGuardedHelperReference rejects a left operand that is not a bare `this`', () => {
  const node = thisGuardedHelperRef('__importStar');
  node.left = identifierNode('notThis');
  assert.equal(isThisGuardedHelperReference(node, '__importStar'), false);
});

test('BL-498: isTscImportHelperInit recognizes `(this && this.<name>) || (…)` regardless of the right-hand body shape', () => {
  assert.equal(isTscImportHelperInit(tscImportHelperInit('__importStar', { type: 'CallExpression' }), '__importStar'), true);
  assert.equal(isTscImportHelperInit(tscImportHelperInit('__createBinding', { type: 'ConditionalExpression' }), '__createBinding'), true);
});

test('BL-498: isTscImportHelperInit rejects the right shape on the wrong node type', () => {
  const node = tscImportHelperInit('__importStar');
  node.type = 'NotLogicalExpression';
  assert.equal(isTscImportHelperInit(node, '__importStar'), false);
});

test('BL-498: isTscImportHelperInit rejects an operator other than ||', () => {
  const node = tscImportHelperInit('__importStar');
  node.operator = '&&';
  assert.equal(isTscImportHelperInit(node, '__importStar'), false);
});

test('BL-498: isTscImportHelperInit rejects a left operand that is not the this-guarded reference', () => {
  const node = tscImportHelperInit('__importStar');
  node.left = { type: 'NumericLiteral', value: 1 };
  assert.equal(isTscImportHelperInit(node, '__importStar'), false);
});

for (const helper of TSC_IMPORT_HELPER_NAMES) {
  test(`BL-498 mutation-gate-excludes-tsc-import-helpers-01: recognizes the real compiled shape for ${helper}`, () => {
    assert.equal(isTscImportHelperDeclarator({ type: 'VariableDeclarator', id: identifierNode(helper), init: tscImportHelperInit(helper) }), true);
    assert.equal(isTscImportHelperVariableDeclaration(tscImportHelperVariableDeclarationNode(helper)), true);
  });
}

// isTscImportHelperVariableDeclaration's own declarations.length===1 guard short-circuits
// before ever calling isTscImportHelperDeclarator on a bad shape, so its guard clause
// (node type / id type) needs direct coverage of its own.
test('BL-498: isTscImportHelperDeclarator rejects a non-VariableDeclarator node', () => {
  assert.equal(isTscImportHelperDeclarator({ type: 'NotVariableDeclarator', id: identifierNode('__importStar'), init: tscImportHelperInit('__importStar') }), false);
});

test('BL-498: isTscImportHelperDeclarator rejects a declarator whose id is not an Identifier', () => {
  assert.equal(isTscImportHelperDeclarator({ type: 'VariableDeclarator', id: { type: 'ObjectPattern', properties: [] }, init: tscImportHelperInit('__importStar') }), false);
});

test('BL-498: TSC_IMPORT_HELPER_NAMES is exactly the four import-related helpers this ticket scopes', () => {
  assert.deepEqual([...TSC_IMPORT_HELPER_NAMES].sort(), ['__createBinding', '__importDefault', '__importStar', '__setModuleDefault'].sort());
});

test('BL-498 mutation-gate-excludes-tsc-import-helpers-02: a variable named like a helper but without the tsc init shape is kept (anti-vacuous)', () => {
  const node = tscImportHelperVariableDeclarationNode('__importStar', { type: 'NumericLiteral', value: 1 });
  assert.equal(isTscImportHelperVariableDeclaration(node), false);
});

test('BL-498: a helper-named declarator guarded by `this && this.<OTHER name>` (name mismatch) is kept', () => {
  const node = tscImportHelperVariableDeclarationNode('__importStar', tscImportHelperInit('__importDefault'));
  assert.equal(isTscImportHelperVariableDeclaration(node), false);
});

test('BL-498: a declarator whose name is not in the closed helper set is kept, even with the exact guard shape', () => {
  const node = tscImportHelperVariableDeclarationNode('__notATscHelper');
  assert.equal(isTscImportHelperVariableDeclaration(node), false);
});

test('BL-498 mutation-gate-excludes-tsc-import-helpers-03: an ordinary variable declaration is kept (anti-vacuous)', () => {
  const node = {
    type: 'VariableDeclaration',
    declarations: [{ type: 'VariableDeclarator', id: identifierNode('total'), init: { type: 'BinaryExpression', operator: '+', left: identifierNode('a'), right: identifierNode('b') } }],
  };
  assert.equal(isTscImportHelperVariableDeclaration(node), false);
});

test('BL-498: a non-VariableDeclaration node is never mistaken for the tsc import-helper preamble', () => {
  assert.equal(isTscImportHelperVariableDeclaration({ type: 'ExpressionStatement', expression: { type: 'CallExpression' } }), false);
});

test('BL-498: a VariableDeclaration with more than one declarator is never mistaken for the tsc import-helper preamble', () => {
  const node = tscImportHelperVariableDeclarationNode('__importStar');
  node.declarations.push({ type: 'VariableDeclarator', id: identifierNode('other'), init: null });
  assert.equal(isTscImportHelperVariableDeclaration(node), false);
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

test('BL-498: the Ignorer excludes a tsc import-helper preamble NodePath, naming a reason', () => {
  const ignorer = new EntrypointBoilerplateIgnorer();
  const reason = ignorer.shouldIgnore({ node: tscImportHelperVariableDeclarationNode('__importStar') });
  assert.equal(typeof reason, 'string');
  assert.ok(reason.length > 0);
});

test('BL-498: the Ignorer never excludes a same-named variable lacking the tsc init shape', () => {
  const ignorer = new EntrypointBoilerplateIgnorer();
  const reason = ignorer.shouldIgnore({ node: tscImportHelperVariableDeclarationNode('__importStar', { type: 'NumericLiteral', value: 1 }) });
  assert.equal(reason, undefined);
});
