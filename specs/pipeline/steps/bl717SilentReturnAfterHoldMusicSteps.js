'use strict';

// BL-717: step handlers for "Bubble always speaks after hold music stops".
//
// The guarantee spans two layers (backlog ticket: "the two layers are one
// ticket because the guarantee only holds if both are closed"):
//   - The BRIDGE (host) half — scenario 03 — is ordinary TypeScript reached
//     directly by requiring the compiled extension/out module and driving
//     the real processLetsTalkTurn, same posture as bl696LetsTalkSteps.js.
//   - The DEVICE half — scenarios 01/02/04/05 — is ReplyPlaybackDecision.kt,
//     pure Kotlin with no android.* type in its own signature, so per the
//     constitution's Testability Boundary — Bubble it is verified by the
//     REAL JVM unit suite (specs/pipeline/steps/lib/androidGradle.js, the
//     seam BL-769 established and BL-826 already used for this exact
//     feature file's sibling). A stubbed runner would prove nothing about
//     whether ReplyPlaybackDecisionTest/PropertyTest actually exercise each
//     branch — the ticket explicitly forbids faking these with a step that
//     asserts nothing.
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');
const { createMockCursorBridgeAgentSession } = require('../../../extension/out/bridge/cursorBridgeAgentSession');
const { processLetsTalkTurn } = require('../../../extension/out/bridge/letsTalkRoutes');
const { LETS_TALK_EMPTY_REPLY_FALLBACK_TEXT } = require('../../../extension/out/bridge/letsTalkCore');

const FEATURE_NAME = 'Bubble always speaks after hold music stops';
const TEST_REPORT_DIR = 'testDebugUnitTest';

// BL-233: explicit dictionaries, never passthrough/binary checks on Example
// column text. Each entry names a real, pre-existing (coder-authored, BL-654)
// @Test in ReplyPlaybackDecisionTest.kt / ReplyPlaybackDecisionPropertyTest.kt
// that demonstrates exactly that branch's guarantee.
const KNOWN_BRANCHES = {
  'the agent returned no speakable content': {
    classSubstring: 'ReplyPlaybackDecisionTest',
    nameSubstring: 'blank-only fields speak the fallback line',
    expectedOutcome: 'a spoken nothing-to-say fallback line',
  },
  'reply audio playback failed': {
    classSubstring: 'ReplyPlaybackDecisionPropertyTest',
    nameSubstring: 'recovery never chains past one extra speech attempt',
    expectedOutcome: 'a spoken failure line',
  },
  'speech synthesis failed': {
    classSubstring: 'ReplyPlaybackDecisionPropertyTest',
    nameSubstring: 'recovery never chains past one extra speech attempt',
    expectedOutcome: 'a spoken failure line',
  },
  'the reply watchdog expired': {
    classSubstring: 'ReplyPlaybackDecisionPropertyTest',
    nameSubstring: 'recovery never chains past one extra speech attempt',
    expectedOutcome: 'a spoken failure line',
  },
};

function repoRootFromHere() {
  return path.join(__dirname, '..', '..', '..');
}

function runJvmSuite(ctx) {
  ctx.repoRoot = repoRootFromHere();
  ctx.androidDir = path.join(ctx.repoRoot, 'android');
  ctx.result = runGradle(ctx.repoRoot, [':app:testDebugUnitTest', '--console=plain']);
  ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
}

function assertKnownTestPassed(ctx, classSubstring, nameSubstring, describeFor) {
  if (ctx.result.status !== 0) {
    throw new Error(
      `expected gradlew :app:testDebugUnitTest to exit 0 for "${describeFor}", got ${ctx.result.status}. output:\n` +
        `${ctx.result.stdout}\n${ctx.result.stderr}`
    );
  }
  const matches = ctx.junitResults.filter(
    (r) => r.classname.includes(classSubstring) && r.name.includes(nameSubstring)
  );
  if (matches.length === 0) {
    throw new Error(
      `expected a passed test in ${classSubstring} naming "${nameSubstring}" for "${describeFor}", ` +
        `found none among: ${JSON.stringify(ctx.junitResults)}`
    );
  }
  if (matches.some((r) => !r.passed)) {
    throw new Error(`expected the matching test(s) for "${describeFor}" to have passed: ${JSON.stringify(matches)}`);
  }
}

function registerSteps(registry) {
  // --- Background ---------------------------------------------------
  registry.defineScoped(
    /^the Bubble companion is paired to a reachable bridge$/,
    (ctx) => {
      ctx.repoRoot = repoRootFromHere();
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      if (!fs.existsSync(path.join(ctx.androidDir, 'gradlew'))) {
        throw new Error(`expected android/gradlew under ${ctx.androidDir}`);
      }
      const bridgeRoutes = path.join(ctx.repoRoot, 'extension', 'out', 'bridge', 'letsTalkRoutes.js');
      if (!fs.existsSync(bridgeRoutes)) {
        throw new Error(`expected the compiled bridge route module at ${bridgeRoutes} — run npm run compile`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^hold music is enabled for working intervals$/,
    (ctx) => {
      const stringsXml = path.join(
        ctx.repoRoot || repoRootFromHere(),
        'android',
        'app',
        'src',
        'main',
        'res',
        'values',
        'strings.xml'
      );
      const xml = fs.readFileSync(stringsXml, 'utf8');
      if (!/name="hold_music"/.test(xml)) {
        throw new Error(`expected a hold_music string resource in ${stringsXml}`);
      }
      ctx.holdMusicEnabled = true;
    },
    FEATURE_NAME
  );

  // --- Shared Given (scenarios 01, 02, 04, 05) -----------------------
  registry.defineScoped(
    /^a Let's Talk turn that plays hold music while the agent works$/,
    (ctx) => {
      ctx.turnStarted = true;
    },
    FEATURE_NAME
  );

  // --- Scenario 01: a normal reply speaks when the music stops -------
  registry.defineScoped(
    /^the agent returns a reply with speakable content$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^hold music stops and reply speech begins$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyPlaybackDecisionPropertyTest',
        'every non-muted input resolves to a speaking action, never silence',
        'hold music stops and reply speech begins'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the human does not hear silence in place of the reply$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyPlaybackDecisionPropertyTest',
        'the fallback line is chosen only when nothing real is speakable',
        'the human does not hear silence in place of the reply'
      );
    },
    FEATURE_NAME
  );

  // --- Scenario 02: every terminal branch ends in speech, never silence
  registry.defineScoped(
    /^the turn ends because (.+)$/,
    (ctx, branch) => {
      const known = KNOWN_BRANCHES[branch];
      if (!known) {
        throw new Error(`unknown <branch> example "${branch}" — expected one of: ${Object.keys(KNOWN_BRANCHES).join(', ')}`);
      }
      ctx.branch = branch;
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the human hears (.+)$/,
    (ctx, spokenOutcome) => {
      const known = KNOWN_BRANCHES[ctx.branch];
      if (!known) {
        throw new Error(`no branch recorded before asserting the spoken outcome (got ctx.branch=${ctx.branch})`);
      }
      if (known.expectedOutcome !== spokenOutcome) {
        throw new Error(
          `branch "${ctx.branch}" expected outcome "${known.expectedOutcome}" but the scenario said "${spokenOutcome}"`
        );
      }
      assertKnownTestPassed(ctx, known.classSubstring, known.nameSubstring, `the human hears ${spokenOutcome}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the session does not return to idle without speaking$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyPlaybackDecisionPropertyTest',
        'recovery never chains past one extra speech attempt',
        'the session does not return to idle without speaking'
      );
    },
    FEATURE_NAME
  );

  // --- Scenario 03: the bridge never reports success with nothing to say
  // Host-reachable — drives the real processLetsTalkTurn, no Kotlin needed.
  registry.defineScoped(
    /^a Let's Talk turn completes and the agent produced empty reply text$/,
    async (ctx) => {
      const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sfvc-bl717-acc-'));
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      const session = createMockCursorBridgeAgentSession(root);
      session.promptAgent = async () => ({ replyText: '', agentId: 'agent-1' });
      ctx.turnResult = await processLetsTalkTurn(
        { audioBase64: Buffer.from('audio-chunk').toString('base64') },
        {
          agentSession: session,
          transcribeAudio: async () => ({ kind: 'ok', transcript: 'status' }),
          clientTts: true,
        }
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge does not answer the companion with a successful turn$/,
    (ctx) => {
      // approval_context (BL-717): the bridge MAY answer success:true, but
      // never with nothing to say — a bare "always success:false" reading
      // of this line is not what was approved (see the very next step,
      // "receives either speakable fallback text or an explicit failure").
      const nothingToSaySuccess = ctx.turnResult.success === true && ctx.turnResult.replyText.trim().length === 0;
      if (nothingToSaySuccess) {
        throw new Error('bridge answered success:true with a blank replyText — exactly the silent-success bug BL-717 closed');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the companion receives either speakable fallback text or an explicit failure$/,
    (ctx) => {
      const result = ctx.turnResult;
      const gotFallback = result.success === true && result.replyText === LETS_TALK_EMPTY_REPLY_FALLBACK_TEXT;
      const gotExplicitFailure = result.success === false && typeof result.reason === 'string' && result.reason.length > 0;
      if (!gotFallback && !gotExplicitFailure) {
        throw new Error(`expected fallback text or an explicit failure, got: ${JSON.stringify(result)}`);
      }
    },
    FEATURE_NAME
  );

  // --- Scenario 04: the fallback never replaces a real reply ---------
  registry.defineScoped(
    /^the spoken output is that reply$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyPlaybackDecisionPropertyTest',
        'the fallback line is chosen only when nothing real is speakable',
        'the spoken output is that reply'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no nothing-to-say fallback line is spoken$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyPlaybackDecisionTest',
        'blank speech text falls back to replyText',
        'no nothing-to-say fallback line is spoken'
      );
    },
    FEATURE_NAME
  );

  // --- Scenario 05: the gap between music and speech is bounded ------
  registry.defineScoped(
    /^hold music stops at the end of the working interval$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^reply speech or a spoken failure line begins within the documented bounded gap$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyPlaybackDecisionPropertyTest',
        'recovery never chains past one extra speech attempt',
        'reply speech or a spoken failure line begins within the documented bounded gap'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no branch leaves an unbounded silent window$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyPlaybackDecisionPropertyTest',
        'every non-muted input resolves to a speaking action, never silence',
        'no branch leaves an unbounded silent window'
      );
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
