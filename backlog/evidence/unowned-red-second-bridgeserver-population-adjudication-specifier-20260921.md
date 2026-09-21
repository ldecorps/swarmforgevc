# Adjudication: a second eager-bridgeServer population, invisible to text greps - 2026-09-21 (specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T16:29:37Z
(00_20260921T162937Z_000054_from_coder, to specifier and coordinator):
"New unowned risk: 16 handlers eager-require bridgeServer via path.join
shape". Coder evidence (coder@2 branch):
`backlog/evidence/unowned-red-second-bridgeserver-population-path-join-style-coder-20260921.md`
- found while verifying BL-1685: `bl1634RejectedManifestOffersNoPageFromItSteps.js`
reads 693-734 ms alone on the coder's host and requires bridgeServer as
`require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'))`, a shape
no substring census for `bridge/bridgeServer` can see.

**Ground truth, not a third grep.** Two text censuses have now
disagreed with reality in one day (BL-1685's literal grep over-counts
bl591/bl592 and cannot see path.join; the coder's `^const` grep cannot
see a require inside a module-scope object literal). The census that
cannot lie is the loader itself: require each candidate alone in a
fresh node process and ask `require.cache` whether
`extension/out/bridge/bridgeServer.js` is present (the same question
BL-1658's "required alone in a fresh child process with the loader
intercept" step asks). Over the 53 handlers whose source mentions
`bridgeServer` at all (`git grep -l bridgeServer -- 'specs/pipeline/steps/*Steps.js'`),
**29 load it when required alone** (232-339 ms each at load 5-9):
12 are BL-1685's fourteen (bl591EpicEtaSteps and
bl592SpecTreeOnLiveConsoleWithEpicTierSteps do NOT load it - their
column-0 mention is not a load), and **17 are outside BL-1685**: the
coder's sixteen plus `bl709BubbleItsOwnTelegramTopicSteps.js`, whose
require sits inside a module-scope object literal that neither grep
shape matches. In census order: bl1634RejectedManifestOffersNoPageFromItSteps,
bl551LlmCostLedgerSteps, bl565CostLedgerSyntheticPricingSteps,
bl709BubbleItsOwnTelegramTopicSteps, bl788BubblePairingClientLogsAdoptSteps,
bl829BubbleRemotePagePagerSteps, bl851SideloadApkPreauthSteps,
bl866CompanionManifestPackageCatalogSteps, burnRateSteps,
deviceRegistrySteps, gateAnswerSteps, gatesListSteps,
noInboundMessageIsEverLostSteps, operatorProactiveNotifySteps,
replyRelayAtLeastOnceSteps, standingOperatorTopicSteps,
telegramTopicThreadsSteps.

Probe (run from the repo root; `NODE_PATH` not needed):
```
// probe.js
const t0 = process.hrtime.bigint(); require(process.argv[2]);
const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
const loaded = Object.keys(require.cache).some(k => k.endsWith('/extension/out/bridge/bridgeServer.js'));
console.log(JSON.stringify({ loaded, ms }));
// git grep -l bridgeServer -- 'specs/pipeline/steps/*Steps.js' | while read -r f; do node probe.js "$PWD/$f"; done
```
(A zsh `for f in $VAR` loop does not word-split - use `while read`.)

**Ruling.** Mint BL-1687 (defect, high - the same guard file, bl1634
over budget alone on the coder's host, certain red once BL-1685's
twelve go lazy and bl1634 becomes the first eager loader; auto-approved,
no choice posed): the seventeen require bridgeServer inside the step
that starts a bridge; the acceptance census is the loader probe over
every handler mentioning bridgeServer (floor: at least fifty examined),
so a third require shape cannot recur invisibly. The register row for
`stepHandlerModuleLoadBudget.test.js` is RE-POINTED BL-1685 -> BL-1687
(one row per lane+file; BL-1685's land must leave it) with the reason
extended. Promote after BL-1685 lands: the seventeen share no file with
it, but scenario 02 is red until BL-1685's twelve are lazy. Not folded
into BL-1685: the coder holds it mid-build on its fourteen and asked for
a follow-up; the human directive on fewer tickets is met by ONE follow-up
carrying the whole remaining population, not one per shape.

**Re-run at the mint commit (18:4x).** 54 candidates (BL-1681's
`bl1681Bl696SuccessorLeftRedsSteps.js` landed in between), the same 29
loaders at 420-620 ms each under higher load; the twelve BL-1685 files and
the seventeen above, no change.

By specifier.
