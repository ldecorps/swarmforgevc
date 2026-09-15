# BL-1583 - sampled reach-floor census, 2026-09-15 (specifier, mint time)

Drained from `backlog/archive/INTAKE-operator-question-1789505022651.md`
(operator-relayed human ask, queue-jump). This file is the census the
sweep slices pin (BL-1445: a derived population must pin its count and
its idiom) and the record of how it was counted, so the coder and the
architect re-run it rather than re-derive it.

## Working tree

`main` at `42e2979ed5`, 407 files matching `extension/test/*.property.test.js`.

## Three greps, in order, and what each found

1. **The human's grep** (the intake's own census):
   `grep -rlE 'reach floor|reached.*floor|both arms.*reached' extension/test/*.property.test.js`
   -> 48 files. Blind to the dominant idiom: neither file the register
   owned that day (`bl1295RevertAttributionInvariants`, BL-1580;
   `bl1358MutantTimeCeilingInvariants`, BL-1581) matches it, and 18 of its
   48 hits are comments or unrelated assertions (bl1113/1115/1136's
   "reach floor" is a comment; bl1304, bl1427, pilotSafeDefects have no
   floor).
2. **Counter-idiom grep**, unioned with 1:
   `seen\.[A-Za-z_]+ *>=? *[0-9]|reached\.[A-Za-z_]+ *>=? *[0-9]|never produced|was never (drawn|produced|exercised|reached|seen)|never (drew|reached|saw)|(hit|covered|observed|counts?)\.[A-Za-z_]+ *>=? *[0-9]|assertReachFloor`
   -> 102 files. Still matches comments.
3. **Assertion-anchored pass** (`scratch: detect.pl`, reproduced below):
   a file is a hit when it calls `assertReachFloor(` or when the argument
   text of an `assert(...)`/`assert.<fn>(...)` call carries one of the
   phrases: `never produced|reached|exercised|drew|saw|generated|built|
   answered|refused|left|worked|drawn`, `too rare`, `reach floor`,
   `reachability floor`, `silently lost`, `pass vacuously`, `both arms`,
   `were reached`, `was reached`. -> 104 files. Hand-reading the 26 files
   this dropped from grep 2 found 13 REAL floors in phrasings the list
   missed (`generator coverage: ... reached only`, `generator must reach`,
   `the generator reached X only N time(s), floor`, `only ${n} draws were`,
   `must be common by construction`, `never created a ledger row`,
   `no flat-placement parcel ever sampled`, `assert.equal(reached.x, N)`)
   and 13 non-floors. Those 13 are added back below; the 13 are listed as
   false positives of grep 1/2 so nobody re-derives them.

No regex is the one notion. BL-1584 builds the classifier with the phrase
list pinned and a FROZEN fixture corpus of today's idioms; until it
lands, THIS table is the population.

Detector used for pass 3 (perl, `-0777`-equivalent):

```
my $vocab = qr/never (?:produced|reached|exercised|drew|saw|generated|built|answered|refused|left|worked|drawn)|too rare|reach(?:ability)? floor|silently lost|pass vacuously|both arms|were reached|was reached/i;
hit if content =~ /assertReachFloor\(/
   or any /\bassert(?:\.\w+)?\(((?:[^;]|\n){0,600}?)\);/ argument =~ $vocab
bucket: 'constructed' if /runsPerCell\(/; else by the SMALLEST literal
        `numRuns: <int>`: le30 / 31-99 / ge100; no literal and a
        non-literal `numRuns:` -> unresolved; no numRuns at all ->
        default100 (fast-check's default).
```

## Population: 108 files to sweep

117 files carry a reach floor (104 from pass 3 plus the 13 added back).
Minus 7 already reached by construction through
`runsPerCell` (bl1048, bl1281, bl1364, bl1429, bl1529, bl622,
meanTicketTimeCost) and minus 2 owned by open tickets (bl1295 BL-1580
active, bl1358 BL-1581 paused; they are NOT in any slice, orthogonality)
-> **108**. Note bl1364 and bl1429 are constructed for ONE invariant each
(BL-1553, BL-1572) and still sample in their other invariants; they are
left to BL-1584's classifier to re-flag once it reads per `fc.assert`
rather than per file, and are recorded here so that gap is known.

Slices are ordered by the smallest literal draw budget in the file
(risk first: a floor after 3 draws misses far more often than one after
25) and then by name. Column `min runs` is the smallest literal
`numRuns:` in the file; `-` means every `numRuns` is a constant the file
computes (unresolved) or absent (fast-check default 100).


### BL-1585 - sweep 1 of 6 (8 draws or fewer, first half) - 16 files

| file | min runs | bucket |
|---|---|---|
| `extension/test/bl1225SyncRestartTrailInvariants.property.test.js` | 8 | le30 |
| `extension/test/bl1279FrontDeskFixtureClosure.property.test.js` | 1 | le30 |
| `extension/test/bl1280MkdtempMigrationInvariants.property.test.js` | 1 | le30 |
| `extension/test/bl1296BubbleSeatInvariants.property.test.js` | 6 | le30 |
| `extension/test/bl1297MergeOwnPathsInvariants.property.test.js` | 8 | le30 |
| `extension/test/bl1306AuditKeyBasisInvariants.property.test.js` | 1 | le30 |
| `extension/test/bl1309LandDecideEntanglementInvariants.property.test.js` | 2 | le30 |
| `extension/test/bl1323StampOffInvariants.property.test.js` | 5 | le30 |
| `extension/test/bl1327DescentLadderInvariants.property.test.js` | 3 | le30 |
| `extension/test/bl1332SharedPathRefusesInvariants.property.test.js` | 3 | le30 |
| `extension/test/bl1333StampOffInvariants.property.test.js` | 2 | le30 |
| `extension/test/bl1335ExhaustionPromotionInvariants.property.test.js` | 5 | le30 |
| `extension/test/bl1336ForkCeilingInvariants.property.test.js` | 4 | le30 |
| `extension/test/bl1337ProfileCastInvariants.property.test.js` | 8 | le30 |
| `extension/test/bl1339LandApprovalRootInvariants.property.test.js` | 2 | le30 |
| `extension/test/bl1341MergeDropsEitherSideInvariants.property.test.js` | 6 | le30 |

### BL-1586 - sweep 2 of 6 (8 draws or fewer, second half) - 16 files

| file | min runs | bucket |
|---|---|---|
| `extension/test/bl1342CrashloopStampInvariants.property.test.js` | 2 | le30 |
| `extension/test/bl1344WaiveInvariants.property.test.js` | 2 | le30 |
| `extension/test/bl1345StaleMarkerInvariants.property.test.js` | 2 | le30 |
| `extension/test/bl1346RcRepairStampInvariants.property.test.js` | 1 | le30 |
| `extension/test/bl1350KeepaliveInvariants.property.test.js` | 4 | le30 |
| `extension/test/bl1352EscalationVisibilityInvariants.property.test.js` | 4 | le30 |
| `extension/test/bl1354SharedPathLandedSiblingInvariants.property.test.js` | 3 | le30 |
| `extension/test/bl1362ReviewEvidenceByToolInvariants.property.test.js` | 3 | le30 |
| `extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js` | 2 | le30 |
| `extension/test/bl1380ExpediteNeverAnswersUnshownQuestion.property.test.js` | 3 | le30 |
| `extension/test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js` | 3 | le30 |
| `extension/test/bl1460IdleEventsOneSnapshotInvariants.property.test.js` | 8 | le30 |
| `extension/test/bl1481SharedPathContentCheckInvariants.property.test.js` | 3 | le30 |
| `extension/test/bl1538Bl1028RunnerFixtureClosureInvariants.property.test.js` | 1 | le30 |
| `extension/test/bl1546ClosedOwnerNeverSilentlyExcludesInvariants.property.test.js` | 3 | le30 |
| `extension/test/bl687EpicTileSurfaceUntouched.property.test.js` | 6 | le30 |

### BL-1587 - sweep 3 of 6 (9 to 16 draws) - 11 files

| file | min runs | bucket |
|---|---|---|
| `extension/test/bl1218RemoteControlConfigInvariants.property.test.js` | 12 | le30 |
| `extension/test/bl1239SuiteManifestAccountsForEveryTestFile.property.test.js` | 15 | le30 |
| `extension/test/bl1254LedgerCertificationNeedsAHuman.property.test.js` | 12 | le30 |
| `extension/test/bl1275RefusalEvidenceInvariants.property.test.js` | 10 | le30 |
| `extension/test/bl1305FixtureAgentBinary.property.test.js` | 12 | le30 |
| `extension/test/bl1308SiblingDetectorCoversReplay.property.test.js` | 12 | le30 |
| `extension/test/bl1315OwnPathsFullRangeInvariants.property.test.js` | 12 | le30 |
| `extension/test/bl1317AdaptEffortInvariants.property.test.js` | 12 | le30 |
| `extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js` | 9 | le30 |
| `extension/test/bl1445StaffingGateWiringTestDecidesOverrideInvariants.property.test.js` | 12 | le30 |
| `extension/test/bl1495BaiGatewayInvariants.property.test.js` | 10 | le30 |

### S3 (unminted, epic remaining_slices) - sweep 4 of 6 (17 to 30 draws) - 16 files

| file | min runs | bucket |
|---|---|---|
| `extension/test/bl1210IconMarkerStoreInvariants.property.test.js` | 20 | le30 |
| `extension/test/bl1243PaneActivityInvariants.property.test.js` | 30 | le30 |
| `extension/test/bl1254MissingVerdictNeverBounces.property.test.js` | 25 | le30 |
| `extension/test/bl1340SelfConvertingDraftInvariants.property.test.js` | 24 | le30 |
| `extension/test/bl1356StampOffInvariants.property.test.js` | 20 | le30 |
| `extension/test/bl1365RitualLedgerInvariants.property.test.js` | 25 | le30 |
| `extension/test/bl1383ProviderChatSeatInvariants.property.test.js` | 25 | le30 |
| `extension/test/bl1384LocalSeatTopicForwardedInvariants.property.test.js` | 30 | le30 |
| `extension/test/bl1398GuardFixtureDerivedSet.property.test.js` | 25 | le30 |
| `extension/test/bl1402FrontDeskPhotoPassthroughInvariants.property.test.js` | 20 | le30 |
| `extension/test/bl1455RependedApprovalAskInvariants.property.test.js` | 25 | le30 |
| `extension/test/bl1471BounceRevertScopeInvariants.property.test.js` | 20 | le30 |
| `extension/test/bl1477ContextTelemetryTornTailInvariants.property.test.js` | 20 | le30 |
| `extension/test/bl1484HookFixturesDeriveTheirSet.property.test.js` | 30 | le30 |
| `extension/test/bl1539SelfRootingDerivationStability.property.test.js` | 24 | le30 |
| `extension/test/bl1565CoordinatorNeverReceivesGitHandoffInvariants.property.test.js` | 20 | le30 |

### S4/S5 (unminted, split at mint) - sweeps 5a/5b of 6 (31 to 99 draws, unresolved constants, fast-check default) - 33 files

| file | min runs | bucket |
|---|---|---|
| `extension/test/bl1000FreshnessPinnedFixture.property.test.js` | - | unresolved |
| `extension/test/bl1003BusyVerdictParity.property.test.js` | - | default100 |
| `extension/test/bl1030RefusalCostsNothing.property.test.js` | - | default100 |
| `extension/test/bl1030StopFlagTokenBoundary.property.test.js` | - | default100 |
| `extension/test/bl1040SeatIdentityObservationPath.property.test.js` | - | unresolved |
| `extension/test/bl1064LogGroundingSource.property.test.js` | 80 | 31-99 |
| `extension/test/bl1078UncertifiedCursorRefused.property.test.js` | - | default100 |
| `extension/test/bl1081PaneTranscriptSurvives.property.test.js` | - | default100 |
| `extension/test/bl1081StructuredSeatControl.property.test.js` | - | default100 |
| `extension/test/bl1089FrontDeskLivenessFixture.property.test.js` | - | unresolved |
| `extension/test/bl1232ShiftVelocityChartInvariants.property.test.js` | 40 | 31-99 |
| `extension/test/bl1235LocalQwenSeatInvariants.property.test.js` | 40 | 31-99 |
| `extension/test/bl1264OptionalKeyAbsenceInvariants.property.test.js` | 60 | 31-99 |
| `extension/test/bl1277StepCollisionInvariants.property.test.js` | - | unresolved |
| `extension/test/bl1288OnlyRejectionDiscardsInvariants.property.test.js` | - | unresolved |
| `extension/test/bl1313BatchGuardVisibilityInvariants.property.test.js` | 60 | 31-99 |
| `extension/test/bl1367ApprovalCarriesItsRuling.property.test.js` | 40 | 31-99 |
| `extension/test/bl1371StepDiscoveryInvariants.property.test.js` | - | unresolved |
| `extension/test/bl1373PathSetCacheInvariants.property.test.js` | - | default100 |
| `extension/test/bl1474ReplayCommitRefusalReasonInvariants.property.test.js` | 40 | 31-99 |
| `extension/test/bl1509SendDocumentTokenRedactionInvariant.property.test.js` | 50 | 31-99 |
| `extension/test/bl1536BounceNeverStampedInvariants.property.test.js` | 40 | 31-99 |
| `extension/test/bl604TrendAnalysisInvariants.property.test.js` | 60 | 31-99 |
| `extension/test/bl654PreEpochTrend.property.test.js` | - | default100 |
| `extension/test/bl670StageQualifierInvariants.property.test.js` | 40 | 31-99 |
| `extension/test/bl682MistralVibeRouting.property.test.js` | - | unresolved |
| `extension/test/bl968MaterializedGuardSensitivity.property.test.js` | - | unresolved |
| `extension/test/cursorBridgeRunLog.property.test.js` | - | unresolved |
| `extension/test/cursorSeatDriver.property.test.js` | - | unresolved |
| `extension/test/heldSince.property.test.js` | - | unresolved |
| `extension/test/intakeConsolidationCore.property.test.js` | - | default100 |
| `extension/test/metricsTickGate.property.test.js` | - | default100 |
| `extension/test/pipelineBoardHeld.property.test.js` | - | unresolved |

### S6 (unminted) - sweep 6 of 6 (100 draws or more) - 16 files

| file | min runs | bucket |
|---|---|---|
| `extension/test/bl1005OnboarderGateNonVacuity.property.test.js` | 200 | ge100 |
| `extension/test/bl1060TelegramButtonUrlScheme.property.test.js` | 200 | ge100 |
| `extension/test/bl1061TunnelFixtureIsolation.property.test.js` | 120 | ge100 |
| `extension/test/bl687TopicMakeTopActiveDependencyInert.property.test.js` | 400 | ge100 |
| `extension/test/bl687WithinEpicLiveItems.property.test.js` | 400 | ge100 |
| `extension/test/bl811HostQueueInvariants.property.test.js` | 500 | ge100 |
| `extension/test/bl896BriefingOpenCountInvariants.property.test.js` | 300 | ge100 |
| `extension/test/bl909BottleneckProcessingRankInvariants.property.test.js` | 100 | ge100 |
| `extension/test/bl946EpicIconPoolInvariants.property.test.js` | 300 | ge100 |
| `extension/test/bl948SocketFixtureInvariants.property.test.js` | 200 | ge100 |
| `extension/test/bl984FixtureSweep.property.test.js` | 100 | ge100 |
| `extension/test/bl990BounceCorrectionInvariants.property.test.js` | 250 | ge100 |
| `extension/test/bounceKeyPairArb.property.test.js` | 100 | ge100 |
| `extension/test/costHealthSidecar.property.test.js` | 200 | ge100 |
| `extension/test/epicTopicSlugMatch.property.test.js` | 300 | ge100 |
| `extension/test/pipelineBoard.property.test.js` | 100 | ge100 |

## False positives of the human's grep and grep 2 (no reach floor; NOT swept)

availabilityLedgerReaderProvenance (comment), bl1113CursorHotfixStampOff,
bl1115MainSyncStatusCliStampOff, bl1136BabysitterdCursorForgeStampOff
("reach floor" in a comment; the assertions are ledger lookups),
bl1188PipelineGridLiveStageParityInvariants, bl1252UnexpectedFailureNeverPassesInvariant
(`fc.pre`), bl1272LandedSiblingInvariants, bl1304DryRunSpawnsNothing,
bl1427LoadGuardCoversEveryScriptInvariants, bl796NvmNodePathFollowUpAdoptInvariants,
bl994LiveScreenGrid, boyScoutRun, pilotSafeDefects, bl1296BubbleSeatInvariants'
comment hit (its real floors are in its assertions and it IS swept),
bl1356StampOffInvariants' comment hit (same, swept).

## The fix, per file (the recipe every slice applies)

Three shapes, one outcome each; the slice's evidence records which
branch each file took:

1. **Sampled** - a counter accumulated inside the property and asserted
   after `fc.assert` (`seen.x > 0`, `reached.k >= N`, a `sawX` boolean,
   `count > 0`): iterate the population as cells - an outer loop over the
   values the floor names, one `fc.assert` per cell with
   `numRuns: runsPerCell(<the file's unchanged budget>, cells)` and the
   cell's value a constant inside - and assert the floor through
   `assertReachFloor(coverage, values, floor, label)`. The draw budget,
   the floor's value and the per-draw body do not change (BL-1578,
   BL-1580, BL-1581 are the worked examples).
2. **Constructed by hand** - already an outer loop over the cells with
   a per-cell `numRuns` constant (bl1279, bl1280, bl1306, bl1538, bl968
   and others): migrate the constant to `runsPerCell(budget, cells)` and
   any raw floor assertion to `assertReachFloor`; no loop change.
3. **Not a floor after all** - the census matched an assertion that is a
   property, not a reach floor: leave the file unchanged, say so in the
   evidence with the assertion quoted, so the epic's census is corrected.

Never: lower a floor, widen a tolerance, pin a seed, add a retry, raise
or lower a draw budget.
