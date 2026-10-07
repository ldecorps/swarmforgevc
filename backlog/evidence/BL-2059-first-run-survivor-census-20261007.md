# BL-2059 - localQwenSeatLive.js first-run survivor census, 2026-10-07

Source: the BL-1911 hardener's scoped Stryker run (hardender commit
`a2e54bbee9`, evidence `backlog/evidence/BL-1911-hardener-20261007.md`):
`--mutate out/tools/localSeatRepoRead.js out/tools/localQwenSeatLive.js`,
include set `test/bl1911LocalSeatRepoRead.test.js` and
`test/bl1235LocalQwenSeatLive.test.js`, `perTest`. 370 mutants in all;
`localQwenSeatLive.js` left 15 survived and 7 no-coverage, every one on
lines BL-1911's own commit (`f971c20e44`) did not touch. BL-1235 (closed)
hardened the file by a hand sweep of 7 mutants, never a Stryker run
(`6a2f0d2e9d`), so this is the file's first real run: first-run debt,
owned by BL-2059.

Census by enclosing declaration (line numbers are the compiled
`out/tools/localQwenSeatLive.js` at the hardener's run; they shift once
BL-1911 lands):

| declaration | survived | no-coverage |
|---|---|---|
| readLocalEndpoint | 5 | 3 |
| completeWithLocalModel | 4 | 1 |
| runLocalSeatTurn | 3 | 1 |
| readQwenLocalTopicId | 2 | 0 |
| readLocalSeatSystemPrompt | 1 | 0 |
| resolveReadEndpoint | 0 | 1 |
| resolveComplete | 0 | 1 |
| total | 15 | 7 |

The hardener's evidence names three functions; the per-line census
above puts three of the 22 in readQwenLocalTopicId and
readLocalSeatSystemPrompt, and two in the default-dependency resolvers.

## Per mutant

```
NoCoverage 123:99 StringLiteral       readLocalEndpoint       reason: `${endpointUrl}/api/tags answered ${res.status}${body ? `: ${b...
NoCoverage 131:42 ArrayDeclaration    readLocalEndpoint       catalogue: (parsed.models ?? []).map(...).filter(...)
NoCoverage 131:74 StringLiteral       readLocalEndpoint       catalogue: (parsed.models ?? []).map((m) => String(m.name ?? ''))...
NoCoverage 173:38 StringLiteral       completeWithLocalModel  return String(parsed.response ?? '').trim();
NoCoverage 192:34 ArrowFunction       resolveReadEndpoint     return deps.readEndpoint ?? (() => readLocalEndpoint());
NoCoverage 196:30 ArrowFunction       resolveComplete         return deps.complete ?? ((m, p, url, system) => completeWithLocalModel(...
NoCoverage 206:41 BlockStatement      runLocalSeatTurn        if (deps.topicId === undefined) {
Survived   87:11  BlockStatement      readLocalSeatSystemPrompt  catch {
Survived   98:83  StringLiteral       readQwenLocalTopicId    JSON.parse(fs.readFileSync(localSeatTopicMapPath(targetPath), 'utf8'))
Survived   101:11 BlockStatement      readQwenLocalTopicId    catch {
Survived   116:35 StringLiteral       readLocalEndpoint       await fetchFn(`${endpointUrl}/api/tags`)
Survived   118:26 MethodExpression    readLocalEndpoint       (await res.text()).trim().slice(0, 200)
Survived   125:28 ArrayDeclaration    readLocalEndpoint       catalogue: [],
Survived   131:24 MethodExpression    readLocalEndpoint       (parsed.models ?? []).map(...).filter(...)
Survived   137:24 ArrayDeclaration    readLocalEndpoint       catalogue: [],
Survived   164:17 StringLiteral       completeWithLocalModel  method: 'POST',
Survived   165:18 ObjectLiteral       completeWithLocalModel  headers: { 'content-type': 'application/json' },
Survived   165:36 StringLiteral       completeWithLocalModel  'application/json'
Survived   170:80 MethodExpression    completeWithLocalModel  throw new Error(`${endpointUrl}/api/generate answered ${res.status}: ${raw...
Survived   204:20 ArrayDeclaration    runLocalSeatTurn        const posted = [];
Survived   206:13 ConditionalExpression runLocalSeatTurn      if (deps.topicId === undefined) {
Survived   245:19 StringLiteral       runLocalSeatTurn        kind: 'refuse',
```

## How it was counted

From the hardener worktree (`.worktrees/hardender/extension`), on its
`reports/mutation/mutation.json` (2026-10-07 08:39):

```
node -e '
const r=require("./reports/mutation/mutation.json");
for (const [f,v] of Object.entries(r.files)) { if(!f.includes("localQwenSeatLive")) continue;
 const src=v.source.split("\n");
 for (const m of v.mutants) if (m.status==="Survived"||m.status==="NoCoverage") {
  const l=m.location.start.line;
  console.log(m.status, l+":"+m.location.start.column, m.mutatorName, "|", src[l-1].trim());
 }}'
```

Each line was attributed to the top-level `function` declaration whose
start line is the greatest one at or before it (declarations at lines 82
readLocalSeatSystemPrompt, 96 readQwenLocalTopicId, 114
readLocalEndpoint, 162 completeWithLocalModel, 191 resolveReadEndpoint,
195 resolveComplete, 200 resolveSearchRepo, 203 runLocalSeatTurn).
22 rows: 15 Survived, 7 NoCoverage.

By specifier.
