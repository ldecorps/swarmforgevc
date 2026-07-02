// BL-049: CRAP (Change Risk Anti-Patterns) metric — comp^2 * (1-cov)^3 + comp,
// where comp is a function's cyclomatic complexity and cov is its test
// coverage fraction (0..1). Pure logic lives here so crapReport.js (the CLI
// entry point) stays a thin wrapper — mirrors salvage_lib.bb's split.
const ts = require('typescript');

function computeCrap(complexity, coverageFraction) {
  return complexity ** 2 * (1 - coverageFraction) ** 3 + complexity;
}

function isFlagged(crap, threshold = 6) {
  return crap > threshold;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

// Cyclomatic complexity: 1 (the function's base path) plus one per decision
// point in its own body — nested functions are not descended into here, they
// get their own count when extractFunctions visits them separately.
function countDecisionPoints(node) {
  let count = 0;
  function visit(current, isRoot) {
    switch (current.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.CaseClause:
        count++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const opKind = current.operatorToken && current.operatorToken.kind;
        if (
          opKind === ts.SyntaxKind.AmpersandAmpersandToken ||
          opKind === ts.SyntaxKind.BarBarToken ||
          opKind === ts.SyntaxKind.QuestionQuestionToken
        ) {
          count++;
        }
        break;
      }
      default:
        break;
    }
    if (!isRoot && isFunctionLike(current)) {
      return;
    }
    ts.forEachChild(current, (child) => visit(child, false));
  }
  visit(node, true);
  return count;
}

function functionComplexity(node) {
  return 1 + countDecisionPoints(node);
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) {
    return node.name.getText();
  }
  const parent = node.parent;
  if (parent && parent.name && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))) {
    return parent.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  return '<anonymous>';
}

// One entry per function-like node with a body, in source order.
function extractFunctions(sourceFile) {
  const functions = [];
  function visit(node) {
    if (isFunctionLike(node) && node.body) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      functions.push({
        name: functionName(node),
        startLine,
        endLine,
        complexity: functionComplexity(node),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return functions;
}

function parseSource(filePath, sourceText) {
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// fileCoverage is one entry from c8/istanbul's coverage-final.json:
// { statementMap: { id: {start:{line},end:{line}} }, s: { id: hitCount } }.
// Coverage fraction = covered statements / total statements whose start line
// falls within [startLine, endLine]. A function with no statements of its
// own (e.g. a one-line arrow) counts as fully covered — there is nothing to
// miss.
function statementCoverageFraction(fileCoverage, startLine, endLine) {
  if (!fileCoverage || !fileCoverage.statementMap) {
    return 0;
  }
  const { statementMap, s } = fileCoverage;
  let total = 0;
  let covered = 0;
  for (const key of Object.keys(statementMap)) {
    const line = statementMap[key].start.line;
    if (line >= startLine && line <= endLine) {
      total++;
      if ((s[key] || 0) > 0) {
        covered++;
      }
    }
  }
  if (total === 0) {
    return 1;
  }
  return covered / total;
}

module.exports = {
  computeCrap,
  isFlagged,
  functionComplexity,
  extractFunctions,
  parseSource,
  statementCoverageFraction,
};
