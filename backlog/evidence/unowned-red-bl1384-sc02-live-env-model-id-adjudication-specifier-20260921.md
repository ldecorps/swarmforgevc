# Adjudication: unowned red, BL-1384 acceptance scenario 02 (model-catalogue mismatch) - 2026-09-21 (specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T14:07:38Z
(00_20260921T140738Z_000045_from_coder), sent from inside BL-1658 whose
parcel migrates `bl1384LocalSeatTopicForwardedSteps.js`: "unowned-red
BL-1384 acceptance sc02 model-catalogue mismatch (qwen)". Coder evidence
(coder@2 branch): `backlog/evidence/unowned-red-bl1384-model-catalogue-mismatch-coder-20260921.md`
- the coder stashed the BL-1658 edit and reproduced the same red on the
original file, so BL-1658 is not the cause.

**Reproduced from the master checkout** (`node specs/pipeline/cli.js
specs/features/BL-1384-...feature`, one run): scenario 02 fails at
`Then "Hello from qwen" is posted in topic 4242` with the post
`Local seat cannot answer: the endpoint is up but does not hold
"qwen2.5-coder:latest" (it holds: qwen3:14b)`.

**Mechanism.** The handler wraps the REAL `runLocalSeatTurn` and fakes
only the endpoint: `readEndpoint` returns `catalogue: ['qwen3:14b']`
(handler line 176, the module's `DEFAULT_LOCAL_SEAT_MODEL_ID`). But the
turn resolves the model it asks for with
`resolveLocalSeatModelId(process.env, deps.modelId)` (localQwenSeatLive.ts
line 206; localQwenSeat.ts lines 44-56: configured, else
`SWARMFORGE_LOCAL_SEAT_MODEL`, else the default) and the handler passes
no `modelId` and never scrubs the env var. Every live session on this
host exports `SWARMFORGE_LOCAL_SEAT_MODEL=qwen2.5-coder:latest` (read
from /proc/<pid>/environ of the coder, coder@2, QA and specifier
sessions; exported by: ). The turn asks for qwen2.5-coder, the
fixture holds qwen3:14b, the seat refuses - a test that reads the host's
environment through a seam it left open (engineering.prompt: redirect
through env seams).

**Census (BL-1445)** - callers of `runLocalSeatTurn`/`resolveLocalSeatModelId`
under `specs/pipeline/steps` and `extension/test`: 6 files.
bl1235LocalQwenSeatSteps.js pins `modelId` (11 mentions) and the env
var; bl1235LocalQwenSeat.test.js and bl1235LocalQwenSeatLive.test.js
pin both; bl1296BubbleSeatLive.test.js and telegramCursorBridgeLive.test.js
stub `runLocalSeatTurnFn` entirely; bl1384LocalSeatTopicForwardedSteps.js
is the ONE caller that reaches the real resolver with the live env.

**Why unseen until today.** BL-1384 closed 2026-09-05; no lane runs a
landed feature's acceptance (the BL-1646/changed-path lane runs it only
when its paths change), and the env var reached the live sessions with
the operator's pack work (). First sighting is the coder's, today,
because BL-1658 touches the handler's require line and the coder ran the
feature - the BL-1445 fail-open shape until someone looks.

**Ruling.** Mint BL-1680 (defect, high - a standing red; auto-approved
under the 2026-09-17 hotfix, no choice posed): the handler pins the model
id it fakes and the feature is green whatever the host exports; register
row for BL-1384's feature naming BL-1680, first_seen 2026-09-21; holder
(coder, BL-1658) noted to resume. No change to BL-1384's feature text -
its contract never promised host independence, the handler did.

**Also observed, surfaced not touched.** The shared master checkout
carries an UNCOMMITTED edit to `extension/src/tools/localQwenSeatLive.ts`
and `extension/test/bl1235LocalQwenSeatLive.test.js` (mtime 14:43
local: a briefing-file system prompt for the seat). It is not this red's
cause (the resolver path is untouched) and belongs to whoever is editing
on master; the coordinator is noted.

By specifier.
