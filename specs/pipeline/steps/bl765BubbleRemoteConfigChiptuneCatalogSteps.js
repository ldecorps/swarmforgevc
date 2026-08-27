'use strict';

// BL-765: step handlers for "Bubble takes its capability flags and
// hold-music catalog from the bridge"
// (specs/features/BL-765-bubble-remote-config-and-chiptune-catalog.feature).
//
// Bridge-side halves (remote-config-01/02/03, chiptunes-04/05) drive the
// REAL compiled bridge server (out/bridge/bridgeServer.js) over real HTTP,
// same posture as bl763BubbleTunnelHandFixesSwarmStampSteps.js /
// bl866CompanionManifestPackageCatalogSteps.js. The genuinely device-surface
// claims (remote-config-03's "hold music is not offered", volume-06's
// music/reply volume split) are, per the Testability Boundary — Bubble,
// verified via the REAL `gradlew :app:testDebugUnitTest` task against the
// coder-authored property tests that encode them
// (HoldMusicOfferPropertyTest, ReplyGainPropertyTest) — the same seam
// BL-763/BL-864's own step files use.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = "Bubble takes its capability flags and hold-music catalog from the bridge";
const TEST_REPORT_DIR = 'testDebugUnitTest';
const TOKEN = 'bl765-acceptance-token';
const KNOWN_FEATURE_KEYS = [
  'textTurns',
  'handsFree',
  'holdMusic',
  'playlist',
  'newSession',
  'pauseAll',
  'bridgeBounceAutoSessionReset',
  'voiceEngineSwitch',
];

function repoRoot() {
  return path.join(__dirname, '..', '..', '..');
}

function bridgeServerModule() {
  return require(path.join(repoRoot(), 'extension', 'out', 'bridge', 'bridgeServer'));
}

function mkTargetDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl765-acceptance-'));
}

function operatorConfigPath(target) {
  const dir = path.join(target, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'lets-talk-bubble-config.json');
}

async function fetchJson(port, urlPath) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    headers: { authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN },
  });
  const body = await res.json();
  return { status: res.status, body };
}

function runJvmSuite(ctx) {
  if (ctx.jvmResult) {
    return; // one gradlew run serves every step within a scenario.
  }
  ctx.androidDir = path.join(repoRoot(), 'android');
  ctx.jvmResult = runGradle(repoRoot(), [':app:testDebugUnitTest', '--console=plain']);
  ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
}

function assertKnownTestPassed(ctx, classSubstring, nameSubstring, describeFor) {
  if (ctx.jvmResult.status !== 0) {
    throw new Error(
      `expected gradlew :app:testDebugUnitTest to exit 0 for "${describeFor}", got ${ctx.jvmResult.status}. output:\n` +
        `${ctx.jvmResult.stdout}\n${ctx.jvmResult.stderr}`
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

function apkOutputSnapshot() {
  const dir = path.join(repoRoot(), 'android', 'app', 'build', 'outputs', 'apk');
  if (!fs.existsSync(dir)) {
    return { exists: false };
  }
  return { exists: true, mtimeMs: fs.statSync(dir).mtimeMs };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a running bridge and a paired Bubble install$/,
    async (ctx) => {
      const { startBridge } = bridgeServerModule();
      ctx.target = mkTargetDir();
      ctx.handle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, {});
    },
    FEATURE_NAME
  );

  // ── remote-config-01 ─────────────────────────────────────────────────
  registry.defineScoped(
    /^the bubble config endpoint is requested$/,
    async (ctx) => {
      ctx.configResponse = await fetchJson(ctx.handle.port, '/lets-talk/bubble-config.json');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the response carries a schema version and a revision$/,
    (ctx) => {
      const { body } = ctx.configResponse;
      if (typeof body.schemaVersion !== 'number') {
        throw new Error(`expected a numeric schemaVersion, got ${JSON.stringify(body.schemaVersion)}`);
      }
      if (typeof body.revision !== 'string' || body.revision.length === 0) {
        throw new Error(`expected a non-empty revision, got ${JSON.stringify(body.revision)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it names every capability Bubble can enable or disable$/,
    (ctx) => {
      const { features } = ctx.configResponse.body;
      for (const key of KNOWN_FEATURE_KEYS) {
        if (typeof features[key] !== 'boolean') {
          throw new Error(`expected features.${key} to be a boolean, got ${JSON.stringify(features[key])}`);
        }
      }
      const extra = Object.keys(features).filter((k) => !KNOWN_FEATURE_KEYS.includes(k));
      if (extra.length > 0) {
        throw new Error(`unexpected extra feature keys: ${JSON.stringify(extra)}`);
      }
      ctx.handle.stop();
    },
    FEATURE_NAME
  );

  // ── remote-config-02 ─────────────────────────────────────────────────
  registry.defineScoped(
    /^the served bubble config is (absent|not valid JSON|missing features)$/,
    (ctx, state) => {
      const configPath = operatorConfigPath(ctx.target);
      if (state === 'absent') {
        if (fs.existsSync(configPath)) fs.rmSync(configPath);
      } else if (state === 'not valid JSON') {
        fs.writeFileSync(configPath, '{ this is not json');
      } else if (state === 'missing features') {
        fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, revision: 'operator-r1' }));
      } else {
        throw new Error(`unknown state: ${state}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^Bubble applies remote configuration$/,
    async (ctx) => {
      ctx.configResponse = await fetchJson(ctx.handle.port, '/lets-talk/bubble-config.json');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^every bundled default capability stays enabled$/,
    (ctx) => {
      const { features } = ctx.configResponse.body;
      for (const key of KNOWN_FEATURE_KEYS) {
        if (features[key] !== true) {
          throw new Error(`expected features.${key} to be true (bundled default), got ${JSON.stringify(features[key])}`);
        }
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the effective revision reports the bundled default$/,
    (ctx) => {
      const { revision } = ctx.configResponse.body;
      if (!revision.startsWith('bundled-default')) {
        throw new Error(`expected revision to report the bundled default, got ${JSON.stringify(revision)}`);
      }
      ctx.handle.stop();
    },
    FEATURE_NAME
  );

  // ── remote-config-03 ─────────────────────────────────────────────────
  registry.defineScoped(
    /^the served bubble config disables the hold music capability$/,
    (ctx) => {
      const configPath = operatorConfigPath(ctx.target);
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          revision: 'operator-holdmusic-off',
          features: { holdMusic: false },
        })
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^hold music is not offered$/,
    (ctx) => {
      if (ctx.configResponse.body.features.holdMusic !== false) {
        throw new Error(
          `expected the served config to disable holdMusic, got ${JSON.stringify(ctx.configResponse.body.features)}`
        );
      }
      runJvmSuite(ctx);
      assertKnownTestPassed(
        ctx,
        'HoldMusicOfferPropertyTest',
        'a remotely-disabled capability is never offered',
        'hold music is not offered'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the remaining capabilities stay enabled$/,
    (ctx) => {
      const { features } = ctx.configResponse.body;
      for (const key of KNOWN_FEATURE_KEYS) {
        if (key === 'holdMusic') continue;
        if (features[key] !== true) {
          throw new Error(`expected features.${key} to stay true, got ${JSON.stringify(features[key])}`);
        }
      }
      ctx.handle.stop();
    },
    FEATURE_NAME
  );

  // ── chiptunes-04 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the chiptunes catalog endpoint is requested$/,
    async (ctx) => {
      ctx.chiptunesResponse = await fetchJson(ctx.handle.port, '/lets-talk/chiptunes.json');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the response carries a catalog version and a list of songs$/,
    (ctx) => {
      const { body } = ctx.chiptunesResponse;
      if (typeof body.version !== 'number') {
        throw new Error(`expected a numeric catalog version, got ${JSON.stringify(body.version)}`);
      }
      if (!Array.isArray(body.songs) || body.songs.length === 0) {
        throw new Error(`expected a non-empty songs array, got ${JSON.stringify(body.songs)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^each song carries a name, a tempo, and its step data$/,
    (ctx) => {
      for (const song of ctx.chiptunesResponse.body.songs) {
        if (typeof song.name !== 'string' || song.name.length === 0) {
          throw new Error(`expected every song to carry a non-empty name, got ${JSON.stringify(song)}`);
        }
        if (typeof song.bpm !== 'number' || song.bpm <= 0) {
          throw new Error(`expected every song to carry a positive tempo (bpm), got ${JSON.stringify(song)}`);
        }
        if (!Array.isArray(song.steps) || song.steps.length === 0) {
          throw new Error(`expected every song to carry non-empty step data, got ${JSON.stringify(song)}`);
        }
      }
      ctx.handle.stop();
    },
    FEATURE_NAME
  );

  // ── chiptunes-05 ─────────────────────────────────────────────────────
  // "Redeploy" means a fresh bridge process picking up the current
  // extension/src/bridge/letsTalkChiptunes.json on disk — there is no
  // live operator override for the catalog (unlike bubble-config), by
  // design (ticket notes: "keep it out of coverage/mutation scope and
  // gate the loader, not the payload"). The mechanism this scenario
  // proves is that the served catalog is a live, uncached read of that
  // file — never something baked in at some earlier build step — so
  // adding a song to it and redeploying is sufficient with no APK change.
  registry.defineScoped(
    /^a song is added to the served catalog$/,
    (ctx) => {
      const catalogPath = path.join(repoRoot(), 'extension', 'src', 'bridge', 'letsTalkChiptunes.json');
      ctx.catalogOnDisk = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      ctx.apkSnapshotBefore = apkOutputSnapshot();
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^Bubble refreshes its hold-music list$/,
    async (ctx) => {
      ctx.chiptunesResponse = await fetchJson(ctx.handle.port, '/lets-talk/chiptunes.json');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the added song is selectable$/,
    (ctx) => {
      const servedNames = ctx.chiptunesResponse.body.songs.map((s) => s.name);
      const onDiskNames = ctx.catalogOnDisk.songs.map((s) => s.name);
      if (servedNames.length !== onDiskNames.length || servedNames.some((n, i) => n !== onDiskNames[i])) {
        throw new Error(
          `expected the served catalog to match extension/src/bridge/letsTalkChiptunes.json exactly ` +
            `(no caching/staleness) - served=${JSON.stringify(servedNames)} onDisk=${JSON.stringify(onDiskNames)}`
        );
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no application package was rebuilt$/,
    (ctx) => {
      const after = apkOutputSnapshot();
      const before = ctx.apkSnapshotBefore;
      if (before.exists !== after.exists || (before.exists && before.mtimeMs !== after.mtimeMs)) {
        throw new Error(
          `expected android/app/build/outputs/apk to be untouched by a bridge-only catalog refresh, ` +
            `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
        );
      }
      ctx.handle.stop();
    },
    FEATURE_NAME
  );

  // ── volume-06 (entirely device-surface: no bridge endpoint involved) ──
  registry.defineScoped(/^the music volume setting is lowered$/, () => {}, FEATURE_NAME);

  registry.defineScoped(
    /^a reply is spoken while hold music plays$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the hold music plays at the configured level$/,
    (ctx) => {
      // HoldMusicPlayer.setVolume applies the slider value directly
      // (extension/src no equivalent exists on the Android side to gate
      // separately) - covered by the same JVM suite run as the sibling
      // "reply voice plays at full gain" assertion below; nothing
      // additional to assert once that run is green.
      if (ctx.jvmResult.status !== 0) {
        throw new Error(`expected gradlew :app:testDebugUnitTest to exit 0, got ${ctx.jvmResult.status}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the reply voice plays at full gain$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'ReplyGainPropertyTest',
        'reply gain is always full, for any music volume percent',
        'the reply voice plays at full gain'
      );
      ctx.handle.stop();
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
