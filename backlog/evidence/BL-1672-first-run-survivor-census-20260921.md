# BL-1672 first-run survivor census for residentPaneLive.js - 2026-09-21 (specifier)

Source run: BL-1638's discharge of BL-775's deferred Stryker gate, the
coder's `npx stryker run stryker.bl775.config.json` on 2026-09-21 ~10:10
local (coder worktree commit 1836f592d0, evidence
`backlog/evidence/BL-1638-BL-775-mutation.md`): load 2.05 on 20 cores,
49 s, 139 tests, `out/bridge/residentPaneLive.js` 148 killed / 67
survived / 9 no-coverage (224 instrumented, score 66.07%),
`out/bridge/bubbleLiveUiHtml.js` 7/7 killed. The scoped config's
reporters were clear-text only (no mutation.json), so this census reads
the run's stdout the coder left at `/tmp/bl775-mutation-run1.log`
(50827 bytes, 10:10) - each `[Survived]`/`[NoCoverage]` line's
`out/bridge/residentPaneLive.js:<line>:<col>` attributed to the enclosing
top-level declaration of the compiled file in the coder worktree
(`.worktrees/coder/extension/out/bridge/residentPaneLive.js`). Re-run
the coder's scoped config on a quiet host to re-derive it; the parcel
re-measures over the full unit suite first (BL-1519's caveat: the
scoped include set was four test files).

## Totals by enclosing declaration (survived / no-coverage / debt)

| Declaration | Survived | No-cov | Debt |
|---|---|---|---|
| `captureResidentPaneLive` | 13 | 5 | 18 |
| `tryCaptureRolePane` | 9 | 1 | 10 |
| `captureLiveScreenPanes` | 10 | 0 | 10 |
| `captureMonoRouterLiveScreenUncached` | 10 | 0 | 10 |
| `withHeader` | 9 | 0 | 9 |
| `monoRouterActiveRoleForPane` | 6 | 0 | 6 |
| `orderLiveScreenRoles` | 2 | 1 | 3 |
| `captureCoordinatorPaneLive` | 2 | 1 | 3 |
| `derivePaneActivitySignal` | 3 | 0 | 3 |
| `paneCaptureFailedReason` | 1 | 1 | 2 |
| `decideMonoRouterLayout` | 1 | 0 | 1 |
| `liveScreenPaneLabel` | 1 | 0 | 1 |
| **total** | **67** | **9** | **76** |

## Per mutant (declaration, compiled line, status, mutator)

| Declaration | Line | Status | Mutator |
|---|---|---|---|
| `captureCoordinatorPaneLive` | 215 | NoCoverage | BlockStatement |
| `captureCoordinatorPaneLive` | 215 | Survived | ConditionalExpression |
| `captureCoordinatorPaneLive` | 219 | Survived | ConditionalExpression |
| `captureLiveScreenPanes` | 228 | Survived | BlockStatement |
| `captureLiveScreenPanes` | 228 | Survived | ConditionalExpression |
| `captureLiveScreenPanes` | 244 | Survived | ConditionalExpression |
| `captureLiveScreenPanes` | 244 | Survived | LogicalOperator |
| `captureLiveScreenPanes` | 244 | Survived | ConditionalExpression |
| `captureLiveScreenPanes` | 244 | Survived | EqualityOperator |
| `captureLiveScreenPanes` | 244 | Survived | StringLiteral |
| `captureLiveScreenPanes` | 244 | Survived | ConditionalExpression |
| `captureLiveScreenPanes` | 244 | Survived | EqualityOperator |
| `captureLiveScreenPanes` | 244 | Survived | StringLiteral |
| `captureMonoRouterLiveScreenUncached` | 253 | Survived | ConditionalExpression |
| `captureMonoRouterLiveScreenUncached` | 254 | Survived | StringLiteral |
| `captureMonoRouterLiveScreenUncached` | 254 | Survived | ObjectLiteral |
| `captureMonoRouterLiveScreenUncached` | 254 | Survived | BooleanLiteral |
| `captureMonoRouterLiveScreenUncached` | 255 | Survived | ConditionalExpression |
| `captureMonoRouterLiveScreenUncached` | 255 | Survived | ConditionalExpression |
| `captureMonoRouterLiveScreenUncached` | 255 | Survived | ArrowFunction |
| `captureMonoRouterLiveScreenUncached` | 255 | Survived | EqualityOperator |
| `captureMonoRouterLiveScreenUncached` | 255 | Survived | StringLiteral |
| `captureMonoRouterLiveScreenUncached` | 256 | Survived | StringLiteral |
| `captureResidentPaneLive` | 191 | NoCoverage | BlockStatement |
| `captureResidentPaneLive` | 191 | Survived | ConditionalExpression |
| `captureResidentPaneLive` | 197 | NoCoverage | ConditionalExpression |
| `captureResidentPaneLive` | 197 | NoCoverage | EqualityOperator |
| `captureResidentPaneLive` | 197 | NoCoverage | StringLiteral |
| `captureResidentPaneLive` | 197 | Survived | MethodExpression |
| `captureResidentPaneLive` | 197 | Survived | ArrowFunction |
| `captureResidentPaneLive` | 197 | Survived | ArrowFunction |
| `captureResidentPaneLive` | 197 | Survived | ConditionalExpression |
| `captureResidentPaneLive` | 197 | Survived | ConditionalExpression |
| `captureResidentPaneLive` | 197 | Survived | LogicalOperator |
| `captureResidentPaneLive` | 197 | Survived | ConditionalExpression |
| `captureResidentPaneLive` | 197 | Survived | EqualityOperator |
| `captureResidentPaneLive` | 197 | Survived | StringLiteral |
| `captureResidentPaneLive` | 202 | Survived | ConditionalExpression |
| `captureResidentPaneLive` | 203 | NoCoverage | BlockStatement |
| `captureResidentPaneLive` | 203 | Survived | ConditionalExpression |
| `captureResidentPaneLive` | 207 | Survived | ConditionalExpression |
| `decideMonoRouterLayout` | 143 | Survived | EqualityOperator |
| `derivePaneActivitySignal` | 78 | Survived | BlockStatement |
| `derivePaneActivitySignal` | 78 | Survived | ConditionalExpression |
| `derivePaneActivitySignal` | 78 | Survived | MethodExpression |
| `liveScreenPaneLabel` | 184 | Survived | ConditionalExpression |
| `monoRouterActiveRoleForPane` | 158 | Survived | BlockStatement |
| `monoRouterActiveRoleForPane` | 159 | Survived | ConditionalExpression |
| `monoRouterActiveRoleForPane` | 159 | Survived | LogicalOperator |
| `monoRouterActiveRoleForPane` | 159 | Survived | ConditionalExpression |
| `monoRouterActiveRoleForPane` | 159 | Survived | EqualityOperator |
| `monoRouterActiveRoleForPane` | 159 | Survived | StringLiteral |
| `orderLiveScreenRoles` | 170 | Survived | BlockStatement |
| `orderLiveScreenRoles` | 171 | NoCoverage | BlockStatement |
| `orderLiveScreenRoles` | 171 | Survived | ConditionalExpression |
| `paneCaptureFailedReason` | 84 | NoCoverage | StringLiteral |
| `paneCaptureFailedReason` | 84 | Survived | MethodExpression |
| `tryCaptureRolePane` | 88 | Survived | UnaryOperator |
| `tryCaptureRolePane` | 92 | NoCoverage | StringLiteral |
| `tryCaptureRolePane` | 93 | Survived | MethodExpression |
| `tryCaptureRolePane` | 96 | Survived | UnaryOperator |
| `tryCaptureRolePane` | 97 | Survived | LogicalOperator |
| `tryCaptureRolePane` | 100 | Survived | MethodExpression |
| `tryCaptureRolePane` | 104 | Survived | ConditionalExpression |
| `tryCaptureRolePane` | 104 | Survived | LogicalOperator |
| `tryCaptureRolePane` | 104 | Survived | ConditionalExpression |
| `tryCaptureRolePane` | 104 | Survived | EqualityOperator |
| `withHeader` | 30 | Survived | ConditionalExpression |
| `withHeader` | 30 | Survived | LogicalOperator |
| `withHeader` | 30 | Survived | BlockStatement |
| `withHeader` | 33 | Survived | ConditionalExpression |
| `withHeader` | 33 | Survived | LogicalOperator |
| `withHeader` | 33 | Survived | ConditionalExpression |
| `withHeader` | 39 | Survived | ObjectLiteral |
| `withHeader` | 44 | Survived | ObjectLiteral |
| `withHeader` | 44 | Survived | BooleanLiteral |

## The script (exact)

```
python3 - .worktrees/coder/extension/out/bridge/residentPaneLive.js <<'PY2'
import re,sys,collections
src=open(sys.argv[1]).read().split('\n'); decls=[]
for i,l in enumerate(src,1):
    m=(re.match(r'^(?:async\s+)?function\s+(\w+)\s*\(',l) or re.match(r'^(?:const|let|var)\s+(\w+)\s*=',l)
       or re.match(r'^exports\.(\w+)\s*=',l) or re.match(r'^class\s+(\w+)',l))
    if m: decls.append((i,m.group(1)))
def encl(line):
    name='<module-top>'
    for i,n in decls:
        if i<=line: name=n
        else: break
    return name
txt=open('/tmp/bl775-mutation-run1.log',errors='replace').read()
pat=re.compile(r'\[(Survived|NoCoverage)\]\s+(\w+)\s*\n\s*out/bridge/residentPaneLive\.js:(\d+):(\d+)')
rows=[(encl(int(m.group(3))),int(m.group(3)),m.group(1),m.group(2)) for m in pat.finditer(txt)]
by=collections.defaultdict(lambda: collections.Counter())
for d,ln,st,mu in rows: by[d][st]+=1
for d,c in sorted(by.items(), key=lambda x:-(x[1]['Survived']+x[1]['NoCoverage'])): print(d,c['Survived'],c['NoCoverage'])
PY2
```

By specifier.
