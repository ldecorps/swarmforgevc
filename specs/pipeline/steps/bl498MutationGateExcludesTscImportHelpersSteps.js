'use strict';

// BL-498: step handlers for "the mutation gate excludes tsc's import-helper
// preamble as structurally-unkillable boilerplate". Drives the REAL compiled
// EntrypointBoilerplateIgnorer (extension/out/mutation/
// entrypointBoilerplateIgnorer.js) against plain-object AST-node fixtures -
// never a hand-rolled substitute for the real classifier, mirroring
// entrypointBoilerplateIgnorer.test.js's own fixture shape.
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { EntrypointBoilerplateIgnorer, TSC_IMPORT_HELPER_NAMES } = require(path.join(EXT_OUT, 'mutation', 'entrypointBoilerplateIgnorer'));

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough that would lump a mutated token into a
// silent default.
const KNOWN_HELPER_NAMES = new Set(TSC_IMPORT_HELPER_NAMES);

const BOILERPLATE_SHAPE_NODES = {
  'require.main === module entrypoint guard': {
    type: 'IfStatement',
    test: {
      type: 'BinaryExpression',
      operator: '===',
      left: { type: 'MemberExpression', object: { type: 'Identifier', name: 'require' }, property: { type: 'Identifier', name: 'main' } },
      right: { type: 'Identifier', name: 'module' },
    },
    consequent: { type: 'BlockStatement', body: [] },
  },
  'Object.defineProperty(exports, "__esModule", { value:true })': {
    type: 'ExpressionStatement',
    expression: {
      type: 'CallExpression',
      callee: { type: 'MemberExpression', object: { type: 'Identifier', name: 'Object' }, property: { type: 'Identifier', name: 'defineProperty' } },
      arguments: [{ type: 'Identifier', name: 'exports' }, { type: 'StringLiteral', value: '__esModule' }, { type: 'ObjectExpression', properties: [] }],
    },
  },
};

function parseHelperName(token) {
  if (!KNOWN_HELPER_NAMES.has(token)) {
    throw new Error(`unknown tsc import-helper name: ${token}`);
  }
  return token;
}

function parseShape(token) {
  if (!(token in BOILERPLATE_SHAPE_NODES)) {
    throw new Error(`unknown boilerplate shape: ${token}`);
  }
  return BOILERPLATE_SHAPE_NODES[token];
}

function identifierNode(name) {
  return { type: 'Identifier', name };
}

function tscImportHelperInit(name) {
  return {
    type: 'LogicalExpression',
    operator: '||',
    left: {
      type: 'LogicalExpression',
      operator: '&&',
      left: { type: 'ThisExpression' },
      right: { type: 'MemberExpression', object: { type: 'ThisExpression' }, property: identifierNode(name) },
    },
    right: { type: 'FunctionExpression' },
  };
}

function variableDeclarationNode(name, init) {
  return { type: 'VariableDeclaration', declarations: [{ type: 'VariableDeclarator', id: identifierNode(name), init }] };
}

function registerSteps(registry) {
  registry.define(/^the entrypoint-boilerplate ignorer classifies a single compiled AST node$/, (ctx) => {
    ctx.ignorer = new EntrypointBoilerplateIgnorer();
    ctx.node = undefined;
  });

  registry.define(/^a tsc-generated helper assignment "var (\S+) = \(this && this\.\S+\) \|\| \(…\)"$/, (ctx, helper) => {
    const name = parseHelperName(helper);
    ctx.node = variableDeclarationNode(name, tscImportHelperInit(name));
  });

  registry.define(/^a variable assignment named "(\S+)" whose initializer is not the "\(this && this\.\S+\) \|\| \(…\)" tsc shape$/, (ctx, name) => {
    parseHelperName(name);
    ctx.node = variableDeclarationNode(name, { type: 'NumericLiteral', value: 1 });
  });

  registry.define(/^an ordinary variable assignment "const total = a \+ b"$/, (ctx) => {
    ctx.node = variableDeclarationNode('total', { type: 'BinaryExpression', operator: '+', left: identifierNode('a'), right: identifierNode('b') });
  });

  registry.define(/^the "(.+)" boilerplate node$/, (ctx, shape) => {
    ctx.node = parseShape(shape);
  });

  registry.define(/^the ignorer classifies the node$/, (ctx) => {
    ctx.reason = ctx.ignorer.shouldIgnore({ node: ctx.node });
  });

  registry.define(/^the node is excluded from mutation$/, (ctx) => {
    assert.equal(typeof ctx.reason, 'string');
    assert.ok(ctx.reason.length > 0);
  });

  registry.define(/^the node is kept for mutation$/, (ctx) => {
    assert.equal(ctx.reason, undefined);
  });
}

module.exports = { registerSteps };
