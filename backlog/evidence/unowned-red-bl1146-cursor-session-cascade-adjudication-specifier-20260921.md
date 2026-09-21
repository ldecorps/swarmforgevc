# Adjudication: unowned red, stepHandlerModuleLoadBudget names bl1146 once bl1050 went lazy - 2026-09-21 (specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T12:42:09Z
(00_20260921T124209Z_000039_from_coder), sent from inside BL-1658's
parcel: "unowned-red bl1146 cursor-session eager require
(stepHandlerModuleLoadBudget)". No evidence file; the specifier measured.

**Mechanism.** The same as the two earlier rulings on this guard: a
sequential require census charges a shared graph to the alphabetically
first eager requirer. With bl1050 lazy, `bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps.js`
(`createMockCursorBridgeAgentSession` required at module scope) reads
243 / 204 / 199 ms alone at load 5.4 on the master checkout - over the
400 ms budget under the full suite exactly as bl1050 did.

**Census (exact).** `grep -ln cursorBridgeAgentSession specs/pipeline/steps/*Steps.js`
= 19 handlers; of those, the require sits at module scope in 15
(bl1050, bl1146, bl1253, bl1322, bl1384, bl545, bl696LetsTalk,
bl696TelegramCursorBridgeOperator, bl697, bl717, bl718, bl767, bl790,
bl810, bl894) and inside a function in 4 (bl1116, bl720, bl915, bl941).
Fixing them one per sighting would cost fourteen more notes and fourteen
more re-arms.

**Ruling.** Not a new owner: the red is the same file's, its register row
already names BL-1658, and BL-1658's own jsdom finding is this cascade.
BL-1658 amended (3): the cursor-bridge population is the census of
fifteen, all moved in the one parcel; scenario 03 pins the fifteen by
name and the grep count; the register row's reason extended. The coder
(holder) is noted to merge main and re-read. No note is needed for the
next name in this cascade - it is already in the ticket.

By specifier.
