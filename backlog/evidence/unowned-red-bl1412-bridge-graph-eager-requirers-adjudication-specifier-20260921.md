# Adjudication: unowned red, bl1412SpecTreeTextFilterSteps.js over the module-load budget - 2026-09-21 (specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T15:24:19Z
(00_20260921T152419Z_000050_from_coder): "unowned-red
bl1412SpecTreeTextFilterSteps.js borderline 400-800ms flake". Coder
evidence (coder@2 branch):
`backlog/evidence/unowned-red-bl1412-borderline-load-flake-coder-20260921.md`
- six readings today, five over the 400 ms budget (414-768 ms), one
under (290-300 ms at load 13).

**Not borderline for long - the whole bridge graph, charged to whoever
requires it first.** The handler's only heavy line is
`const { startBridge } = require('../../../extension/out/bridge/bridgeServer')`
at module scope (line 18; its jsdom is already lazy, BL-1630). Measured
from the master checkout: requiring the handler alone loads 287 modules
(172 under extension/out - bridge 70, metrics 33, swarm 18 - plus
@connectrpc 52, @bufbuild 49, @cursor 11) in 823-1089 ms at load 13;
requiring `bridgeServer` alone loads 286 of them in 664-782 ms at load
15-19. The graph IS bridgeServer, and it is a superset of the
cursor-bridge session graph BL-1658's fifteen load. The guard's census
is sequential and charges a shared graph to the alphabetically first
eager requirer (BL-1658's own finding), so today bl1412 pays only what
bl1050..bl1384 (eager, earlier in the order) have not already loaded -
hence "borderline". The moment BL-1658 lands and those go lazy, bl1412
is the first eager requirer of the bridge graph and pays all of it,
every run.

**Census (BL-1445), byte-safe:** `git grep -l 'bridge/bridgeServer' --
'specs/pipeline/steps/*Steps.js'` = 32 handlers; `/usr/bin/grep -c
'^const .*require(.*bridge/bridgeServer' <file>` = 1 for 17 of them
(eager at module scope). Three are BL-1658's fifteen (bl545, bl696,
bl697 - amendment (3) directs BL-1658 to move their bridgeServer require
too). The fourteen outside BL-1658, in the census order the guard
charges them: bl1412SpecTreeTextFilterSteps, bl538ConsolePausedTicketPagerSteps,
bl572EpicReorderConsoleSteps, bl591EpicEtaSteps,
bl592SpecTreeOnLiveConsoleWithEpicTierSteps,
bl665ContextTelemetryProducerWiringSteps, bl672EpicMakeTopPrioritySteps,
bl673TopicMakeTopPrioritySteps, bl674EpicDrilldownUiSteps,
bl686EpicDrilldownSlugMatchSteps, bl687EpicReorderIncludesActiveChildrenSteps,
bl766MiniAppLetsTalkRetiredSteps, bl905HideChildlessEpicsReorderSteps,
gh23ContextBudgetDashboardSteps. Fixing bl1412 alone re-arms the guard
on bl538 - the cascade BL-1658 already paid for once (bl1050 -> bl1146).

**Ruling.** Mint BL-1685 (defect, high - a standing red on the guard
file that BL-1658's land turns from borderline to certain; auto-approved,
no choice posed): every one of the fourteen requires bridgeServer inside
the step that starts a bridge; scenario pins the fourteen and the grep
counts. The register is one row per (lane, file)
(`standing_red_register_lib.bb` indexes by [lane file]), so the existing
row for `stepHandlerModuleLoadBudget.test.js` (owner BL-1658) is
RE-POINTED to BL-1685 with the reason extended - BL-1658's land then
leaves it in place, correctly, because the guard stays red until
BL-1685 lands. QA (holding BL-1658 at 1d70418d08) and the coder noted.
Not folded into BL-1658: it is at QA on its fifth contract; the fourteen
are a sitting of their own, promoted right after it (four handlers -
bl592, bl674, bl686, bl687 - are in both, so orthogonality queues it).

By specifier.
