// BL-447: excludes structurally-unkillable CLI-entrypoint boilerplate from
// the mutation gate without hiding real logic. Every tools/CLI module ends
// with the shared `if (require.main === module) { runCliMain(main); }`
// guard (swarm-metrics.ts's runCliMain, ~52 call sites) and tsc emits
// `Object.defineProperty(exports, "__esModule", { value: true })` at the
// top of every compiled file. Neither can EVER be killed: an in-process
// main() test never executes the guard line at all (NoCoverage), and a
// subprocess smoke test spawns a fresh node process that never carries
// Stryker's in-memory activeMutant/coverage globals (they live only in the
// instrumented vitest worker), so it can never register a kill for
// anything it runs, guard included. So a module that follows every
// existing thin-wrapper/in-process-main() rule perfectly still shows
// unkillable survivors on this fixed residue (BL-445: 9/42 on
// check-suite-duration-budget.ts, including the NoCoverage guard block).
//
// DISTINCT FROM BL-446 (the activation defect - 0 mutants killed
// repo-wide). This is the opposite, surfacing once kills work again: real
// kills happen, but this fixed boilerplate always survives regardless.
//
// ANTI-VACUOUS (the load-bearing constraint): the exclusion is decided by
// STRUCTURAL LOCATION only - classifyMutantLocation below takes no
// coverage/kill signal at all, so it structurally cannot classify an
// untested real-logic mutant as boilerplate. Never broaden this beyond the
// two named shapes.
export interface MutantLocationFacts {
  isRequireMainGuard: boolean;
  isEsModuleBoilerplate: boolean;
}

export type MutantDisposition = 'excluded' | 'kept';

export function classifyMutantLocation(facts: MutantLocationFacts): MutantDisposition {
  return facts.isRequireMainGuard || facts.isEsModuleBoilerplate ? 'excluded' : 'kept';
}

// ── AST-shape recognition (the thin wiring's own extraction step) ────────
// Structural checks over a plain, duck-typed AST node - Stryker's Ignorer
// contract (@stryker-mutator/api/ignore) hands shouldIgnore a real Babel
// NodePath, but declares its own NodePath type as an EMPTY marker interface
// (consumers aren't meant to depend on @babel/traverse's own types
// directly). These functions only ever read `.type` and a handful of
// shape-specific fields, so a plain object matching that shape - real
// Babel node or a fixture literal - is all either one needs; this is what
// keeps classifyMutantLocation's own "pure, in-process-testable" contract
// real: these two are unit-tested with plain literals, no live Babel
// traversal required.
interface AstNode {
  type: string;
  [key: string]: unknown;
}

// Exported (beyond the two AST-shape recognizers below) so each small
// structural predicate can be unit-tested directly - the composed guard
// checks below chain 2-3 of these together, and a fixture reaching one
// specific mutated clause several calls deep gets combinatorially awkward
// fast, whereas each predicate here is trivial to pin on its own.
export function isIdentifierNamed(node: unknown, name: string): boolean {
  return isAstNode(node) && node.type === 'Identifier' && node.name === name;
}

export function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function isNodeOfType(value: unknown, type: string): value is AstNode {
  return isAstNode(value) && value.type === type;
}

export function isRequireMainMemberExpression(node: unknown): boolean {
  return isNodeOfType(node, 'MemberExpression') && isIdentifierNamed(node.object, 'require') && isIdentifierNamed(node.property, 'main');
}

export function isEqualityOperator(operator: unknown): boolean {
  return operator === '===' || operator === '!==';
}

export function isRequireModuleEquality(left: unknown, right: unknown): boolean {
  return isRequireMainMemberExpression(left) && isIdentifierNamed(right, 'module');
}

// Matches `require.main === module` in either operand order, and either
// equality operator - a defensive margin around the one exact form tsc
// emits today (confirmed: `if (require.main === module)`), never a reason
// to broaden what counts as "boilerplate" beyond this one guard shape.
export function isRequireMainGuardNode(node: unknown): boolean {
  if (!isNodeOfType(node, 'IfStatement')) {
    return false;
  }
  const test = node.test;
  if (!isNodeOfType(test, 'BinaryExpression') || !isEqualityOperator(test.operator)) {
    return false;
  }
  const { left, right } = test;
  return isRequireModuleEquality(left, right) || isRequireModuleEquality(right, left);
}

export function isObjectDefinePropertyCallee(callee: unknown): boolean {
  return isNodeOfType(callee, 'MemberExpression') && isIdentifierNamed(callee.object, 'Object') && isIdentifierNamed(callee.property, 'defineProperty');
}

export function isEsModuleStringLiteralArg(arg: unknown): boolean {
  return isNodeOfType(arg, 'StringLiteral') && arg.value === '__esModule';
}

export function isEsModuleCallArguments(args: unknown): boolean {
  return Array.isArray(args) && args.length >= 2 && isEsModuleStringLiteralArg(args[1]);
}

// Matches tsc's generated `Object.defineProperty(exports, "__esModule", {
// value: true })` - the one head-of-file statement every compiled module
// carries. Deliberately narrow to this exact callee + the "__esModule"
// property name; an ordinary Object.defineProperty call naming any other
// property is real code, never excluded.
export function isEsModuleBoilerplateNode(node: unknown): boolean {
  if (!isNodeOfType(node, 'ExpressionStatement')) {
    return false;
  }
  const expr = node.expression;
  if (!isNodeOfType(expr, 'CallExpression') || !isObjectDefinePropertyCallee(expr.callee)) {
    return false;
  }
  return isEsModuleCallArguments(expr.arguments);
}

// ── Stryker Ignorer wiring ────────────────────────────────────────────────
// Registered as a PluginKind.Ignore plugin (stryker-plugin.ts) alongside the
// existing Reporter - mirrors @stryker-mutator/instrumenter's own
// AngularIgnorer shape (shouldIgnore(path) => reason|undefined). Stryker's
// IgnorerBookkeeper calls this once per AST node during traversal and,
// once a node is flagged, treats every descendant as ignored too until that
// SAME node is left - so flagging the enclosing IfStatement/
// ExpressionStatement covers everything inside it (the guard's own `===`
// comparison, the runCliMain call, the boilerplate's `true` literal) in one
// shot, never a per-mutant special case.
const IGNORE_REASON = 'BL-447: structurally-unkillable CLI-entrypoint guard / generated module boilerplate - never covered in-process (NoCoverage) nor killable via a subprocess smoke test (no Stryker coverage globals there)';

export class EntrypointBoilerplateIgnorer {
  shouldIgnore(path: { node: unknown }): string | undefined {
    const disposition = classifyMutantLocation({
      isRequireMainGuard: isRequireMainGuardNode(path.node),
      isEsModuleBoilerplate: isEsModuleBoilerplateNode(path.node),
    });
    return disposition === 'excluded' ? IGNORE_REASON : undefined;
  }
}
