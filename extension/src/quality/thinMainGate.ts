// BL-534: pure pass/fail for the thin-main CRAP-visible CLI gate.
// Tools CLIs under extension/src/tools/ must keep main() a thin exported
// wrapper (cyclomatic complexity <= 2). Parcel mode never allowlists;
// full-repo mode may skip basenames from a shrink-only allowlist.
import * as ts from 'typescript';
import * as path from 'path';

export const MAX_MAIN_COMPLEXITY = 2;

export type ThinMainMode = 'parcel' | 'full';

export interface ThinMainFinding {
  filePath: string;
  basename: string;
  reason: 'not-exported' | 'complexity';
  complexity: number;
}

export interface ThinMainGateResult {
  passed: boolean;
  findings: ThinMainFinding[];
  report: string;
  exitCode: number;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

const DECISION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.CaseClause,
]);

const BINARY_DECISION_OPS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function binaryIsDecision(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) {
    return false;
  }
  return BINARY_DECISION_OPS.has(node.operatorToken.kind);
}

function decisionPointDelta(node: ts.Node): number {
  if (DECISION_KINDS.has(node.kind) || binaryIsDecision(node)) {
    return 1;
  }
  return 0;
}

function countDecisionPoints(node: ts.Node): number {
  let count = 0;
  function visit(current: ts.Node, isRoot: boolean): void {
    count += decisionPointDelta(current);
    if (!isRoot && isFunctionLike(current)) {
      return;
    }
    ts.forEachChild(current, (child) => visit(child, false));
  }
  visit(node, true);
  return count;
}

function functionComplexity(node: ts.Node): number {
  return 1 + countDecisionPoints(node);
}

function identifierText(name: ts.Node | undefined): string | undefined {
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

function functionName(node: ts.FunctionLikeDeclaration): string | undefined {
  const own = identifierText(node.name);
  if (own !== undefined) {
    return own;
  }
  const parent = node.parent;
  if (!parent || !ts.isVariableDeclaration(parent)) {
    return undefined;
  }
  return identifierText(parent.name);
}

function findMainNode(sourceFile: ts.SourceFile): ts.FunctionLikeDeclaration | undefined {
  let found: ts.FunctionLikeDeclaration | undefined;
  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (isFunctionLike(node) && (node as ts.FunctionLikeDeclaration).body) {
      if (functionName(node as ts.FunctionLikeDeclaration) === 'main') {
        found = node as ts.FunctionLikeDeclaration;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function hasExportKeyword(mods: ts.NodeArray<ts.ModifierLike> | undefined): boolean {
  return Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function functionDeclIsExported(mainNode: ts.FunctionLikeDeclaration): boolean {
  return ts.isFunctionDeclaration(mainNode) && hasExportKeyword(mainNode.modifiers);
}

function variableMainIsExported(mainNode: ts.FunctionLikeDeclaration): boolean {
  if (!ts.isVariableDeclaration(mainNode.parent)) {
    return false;
  }
  let n: ts.Node = mainNode.parent;
  while (n) {
    if (ts.isVariableStatement(n) && hasExportKeyword(n.modifiers)) {
      return true;
    }
    n = n.parent;
  }
  return false;
}

function exportClauseListsMain(clause: ts.NamedExports): boolean {
  return clause.elements.some((el) => el.name.text === 'main');
}

function statementExportsMain(stmt: ts.Statement): boolean {
  if (!ts.isExportDeclaration(stmt) || !stmt.exportClause) {
    return false;
  }
  if (!ts.isNamedExports(stmt.exportClause)) {
    return false;
  }
  return exportClauseListsMain(stmt.exportClause);
}

function namedExportIncludesMain(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statementExportsMain);
}

function mainIsExported(sourceFile: ts.SourceFile, mainNode: ts.FunctionLikeDeclaration): boolean {
  return (
    functionDeclIsExported(mainNode) ||
    variableMainIsExported(mainNode) ||
    namedExportIncludesMain(sourceFile)
  );
}

/** Analyze one source text. Files with no main() produce no finding. */
export function analyzeThinMainSource(filePath: string, sourceText: string): ThinMainFinding | null {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const mainNode = findMainNode(sourceFile);
  if (!mainNode) {
    return null;
  }
  const complexity = functionComplexity(mainNode);
  const basename = path.basename(filePath);
  if (!mainIsExported(sourceFile, mainNode)) {
    return { filePath, basename, reason: 'not-exported', complexity };
  }
  if (complexity > MAX_MAIN_COMPLEXITY) {
    return { filePath, basename, reason: 'complexity', complexity };
  }
  return null;
}

export function parseAllowlist(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    names.add(path.basename(trimmed));
  }
  return names;
}

/** Invariant 2: allowlist may only shrink after first land. */
export function allowlistOnlyShrinks(previous: Iterable<string>, next: Iterable<string>): boolean {
  const prev = new Set(previous);
  for (const name of next) {
    if (!prev.has(name)) {
      return false;
    }
  }
  return true;
}

export function applyAllowlist(
  findings: ThinMainFinding[],
  mode: ThinMainMode,
  allowlist: Set<string>
): ThinMainFinding[] {
  if (mode === 'parcel') {
    return findings;
  }
  return findings.filter((f) => !allowlist.has(f.basename));
}

export function formatFinding(finding: ThinMainFinding): string {
  if (finding.reason === 'not-exported') {
    return `${finding.filePath}: main is not exported (complexity ${finding.complexity})`;
  }
  return `${finding.filePath}: main cyclomatic complexity ${finding.complexity} > ${MAX_MAIN_COMPLEXITY}`;
}

export function renderThinMainResult(findings: ThinMainFinding[]): ThinMainGateResult {
  const report = findings.map(formatFinding).join('\n');
  const passed = findings.length === 0;
  return {
    passed,
    findings,
    report,
    exitCode: passed ? 0 : 1,
  };
}

export function evaluateThinMainSources(
  files: Array<{ filePath: string; sourceText: string }>,
  mode: ThinMainMode,
  allowlist: Set<string> = new Set()
): ThinMainGateResult {
  const raw: ThinMainFinding[] = [];
  for (const file of files) {
    const finding = analyzeThinMainSource(file.filePath, file.sourceText);
    if (finding) {
      raw.push(finding);
    }
  }
  return renderThinMainResult(applyAllowlist(raw, mode, allowlist));
}

/** Parcel mode never consults the allowlist (invariant 1). */
export function parcelIgnoresAllowlist(
  finding: ThinMainFinding,
  allowlist: Set<string>
): ThinMainFinding[] {
  return applyAllowlist([finding], 'parcel', allowlist);
}
