'use strict';

// BL-1832's declared invariants (property authorship rests with the coder,
// first pass - BL-654):
//
//   1. "Under rotation router, a home pane holding a live process of the
//      home role's agent or of the agent of the role the resident is
//      active as yields no proc-<home> finding and no repair."
//   2. "Where the active-role marker is not honoured (a standing pack, or
//      an absent or unknown marker), every seat is judged against its own
//      roles.tsv agent alone, exactly as today."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Drives the REAL swarmforge/scripts/babysitterd_sweep_lib.bb functions -
// `seat-expected-agents` (BL-1832's new resolver) composed with
// `check-live-session` (the existing proc-<role> decision it feeds,
// unchanged by this ticket) - via `bb -e`, never a JS restatement of either
// decision. No tmux/real git fixture is needed: both functions are pure,
// and the acceptance feature (BL-1832's own .feature, driven end to end
// through a real tmux server) already covers the live-gatherer wiring; this
// property covers the DECISION's own generator-reach breadth that a
// hand-written unit/acceptance fixture cannot practically enumerate.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). Two cells:
//   'healthy-on-either-agent' (invariant 1) derives the "live process"
//   agent DIRECTLY from the generated home/active agent pair - every run
//   draws fresh, DISTINCT agent token strings and then constructs the
//   live-process token as EITHER one of the pair (a boolean selects which),
//   so every generated case is a genuine member of the acceptable set by
//   construction, never a drawn token that might happen to match.
//   'marker-not-honoured-is-unchanged' (invariant 2) derives the "wrong"
//   agent used to prove the half-launch CRIT still fires DIRECTLY from the
//   home agent (a fixed, disjoint suffix), so it can never coincide with
//   the home agent by chance; `active-role` is always nil here (the exact
//   shape `resident-active-role` already arrives in from babysitter_check.bb
//   whenever the marker must not be honoured - BL-1345's own gate - so this
//   is the resolver's REAL input shape for that case, not a hypothetical).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitterd_sweep_lib.bb');

const HOME = 'coder';
const ACTIVE = 'QA';

// Agent tokens: non-blank alphanumeric, so neither a bb-side default
// ("claude") nor an empty string sneaks in as a false match.
const agentArb = fc.stringMatching(/^[a-z]{3,10}$/);
const distinctAgentPairArb = fc
  .tuple(agentArb, agentArb)
  .filter(([a, b]) => a !== b);

function runBb(program) {
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim().split('\n').pop();
}

function seatExpectedAgents({ rotationRouter, homeRole, activeRole, roleAgentMap }) {
  const mapEdn = Object.entries(roleAgentMap)
    .map(([k, v]) => `"${k}" "${v}"`)
    .join(' ');
  const program = `
(require '[cheshire.core :as json])
(load-file "${SWEEP_LIB}")
(println (json/generate-string
          (vec (sort (babysitterd-sweep-lib/seat-expected-agents
                      {:rotation-router? ${rotationRouter ? 'true' : 'false'}
                       :home-role "${homeRole}"
                       :active-role ${activeRole === null ? 'nil' : `"${activeRole}"`}
                       :role-agent->token {${mapEdn}}})))))`;
  return JSON.parse(runBb(program));
}

function checkLiveSession({ role, hasAgent, expectedAgent, shouldStand = true }) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${SWEEP_LIB}")
(let [r (babysitterd-sweep-lib/check-live-session
         {:role "${role}" :pane-exists? true
          :has-claude-process? ${hasAgent ? 'true' : 'false'}
          :expected-agent "${expectedAgent}"
          :expected-process "${expectedAgent}"
          :should-stand? ${shouldStand ? 'true' : 'false'}})]
  (println (json/generate-string {:finding r})))`;
  return JSON.parse(runBb(program));
}

const CELLS = ['healthy-on-either-agent', 'marker-not-honoured-is-unchanged'];

test('BL-1832/BL-654 invariants: a router home pane healthy on either agent raises no finding; with no honoured active role every seat is judged on its own agent alone', () => {
  const reach = Object.fromEntries(CELLS.map((c) => [c, 0]));
  const CELL_RUNS = runsPerCell(4 * CELLS.length, CELLS.length);

  // ── Invariant 1 ──────────────────────────────────────────────────────
  fc.assert(
    fc.property(distinctAgentPairArb, fc.boolean(), ([homeAgent, activeAgent], runningIsActive) => {
      reach['healthy-on-either-agent'] += 1;
      const roleAgentMap = { [HOME]: homeAgent, [ACTIVE]: activeAgent };
      const acceptable = seatExpectedAgents({
        rotationRouter: true,
        homeRole: HOME,
        activeRole: ACTIVE,
        roleAgentMap,
      });
      assert.deepEqual(
        new Set(acceptable),
        new Set([homeAgent, activeAgent]),
        `acceptable set does not hold exactly both agents: ${JSON.stringify(acceptable)}`
      );

      const runningAgent = runningIsActive ? activeAgent : homeAgent;
      const hasAgent = acceptable.includes(runningAgent);
      assert.ok(hasAgent, `${runningAgent} (one of the pair) was not in the acceptable set: ${JSON.stringify(acceptable)}`);

      const { finding } = checkLiveSession({ role: HOME, hasAgent, expectedAgent: homeAgent });
      assert.equal(finding, null, `a live process of ${runningAgent} still raised a finding: ${JSON.stringify(finding)}`);
      return true;
    }),
    { numRuns: CELL_RUNS }
  );

  // ── Invariant 2 ──────────────────────────────────────────────────────
  fc.assert(
    fc.property(agentArb, fc.boolean(), (homeAgent, rotationRouter) => {
      reach['marker-not-honoured-is-unchanged'] += 1;
      const wrongAgent = `${homeAgent}-other`;
      const roleAgentMap = { [HOME]: homeAgent, [ACTIVE]: wrongAgent };

      // No honoured active role - the exact shape babysitter_check.bb's own
      // `resident-active-role` carries in for a standing pack or an absent/
      // unknown marker (BL-1345 invariant 3).
      const acceptable = seatExpectedAgents({
        rotationRouter,
        homeRole: HOME,
        activeRole: null,
        roleAgentMap,
      });
      assert.deepEqual(
        acceptable,
        [homeAgent],
        `with no honoured active role the acceptable set is not the home agent alone: ${JSON.stringify(acceptable)}`
      );

      // A process of the OTHER role's agent (never the home agent) still
      // reads as a genuine absence - unchanged, BL-1345's own posture.
      const { finding } = checkLiveSession({ role: HOME, hasAgent: false, expectedAgent: homeAgent });
      assert.ok(finding, 'expected a half-launch finding when the home agent is absent');
      assert.equal(finding.key, `proc-${HOME}`, `finding key is not proc-${HOME}: ${JSON.stringify(finding)}`);
      assert.equal(finding.severity, 'CRIT', `finding is not CRIT: ${JSON.stringify(finding)}`);
      return true;
    }),
    { numRuns: CELL_RUNS }
  );

  assertReachFloor(reach, CELLS, CELL_RUNS, 'BL-1832 seat-expected-agents cell');
}, propertyLaneTimeoutMs(20000));
