'use strict';

// BL-829: step handlers for "Bubble's pager renders the bundle's pages
// without ever stranding the Talk surface"
// (specs/features/BL-829-bubble-remote-page-pager.feature).
//
// Scenarios 1-2 (bundle-pages-served-01, bundle-pages-rejected-whole-02)
// drive the REAL bridge server (out/bridge/bridgeServer.js) against the
// served UI bundle manifest's new `pages` list — same "a running swarm and
// the bridge started via its opt-in command" Given as gatesListSteps.js
// (registered unscoped there, reused here as-is).
//
// Scenarios 3-5 are the Android pure-logic half: PagerListResolver, no
// android.* type in its own signature, verified by the REAL
// `gradlew :app:testDebugUnitTest` task (specs/pipeline/steps/lib/androidGradle.js,
// the BL-769 seam, same posture as bl825BubbleUiBundleResolutionSteps.js).
// KNOWN_VALUES maps each Gherkin decision text verbatim to the
// PagerListResolverTest method that covers it — no passthrough check
// (BL-233).
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));

const FEATURE_NAME = "Bubble's pager renders the bundle's pages without ever stranding the Talk surface";
const TEST_REPORT_DIR = 'testDebugUnitTest';
const TEST_CLASS = 'PagerListResolverTest';
const TOKEN = 'aps-bl829-pager-token';

const KNOWN_VALUES = {
  'ordering the pager entries as the manifest orders its pages':
    'ordering the pager entries as the manifest orders its pages',
  'dropping a page entry the installed shell cannot honour':
    'dropping a page entry the installed shell cannot honour',
  'offering Talk alone when the resolver returned the bare outcome':
    'offering Talk alone when the resolver returned the bare outcome',
  'marking the pager entries stale when the resolver returned the stale outcome':
    'marking the pager entries stale when the resolver returned the stale outcome',
  "Talk remaining the pager's opening page whatever the bundle offers":
    "Talk remaining the pager's opening page whatever the bundle offers",
  'refusing to resolve a page id the manifest did not name':
    'refusing to resolve a page id the manifest did not name',
};

function repoRootFromHere() {
  return path.join(__dirname, '..', '..', '..');
}

function runJvmSuite(ctx) {
  if (ctx.jvmResult) {
    return; // one gradlew run serves every step within a scenario.
  }
  ctx.repoRoot = repoRootFromHere();
  ctx.androidDir = path.join(ctx.repoRoot, 'android');
  ctx.jvmResult = runGradle(ctx.repoRoot, [':app:testDebugUnitTest', '--console=plain']);
  ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
}

function operatorDir(targetPath) {
  return path.join(targetPath, '.swarmforge', 'operator');
}

function writeManifest(targetPath, manifest) {
  const dir = operatorDir(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lets-talk-ui-bundle.json'), JSON.stringify(manifest));
}

async function fetchManifest(ctx) {
  ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, {});
  const response = await fetch(`http://127.0.0.1:${ctx.bridge.port}/lets-talk/ui-bundle.json`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  ctx.manifestResponse = response;
  ctx.manifestBody = await response.json();
  ctx.bridge.stop();
}

function registerSteps(registry) {
  // ── bundle-pages-served-01 ────────────────────────────────────────────
  registry.defineScoped(
    /^the served UI bundle manifest is read$/,
    async (ctx) => {
      writeManifest(ctx.targetPath, {
        schemaVersion: 1,
        bundleVersion: 3,
        minShellVersion: 0,
        payload: '<html></html>',
        pages: [
          { id: 'live', title: 'Live', entryPath: 'live', order: 0 },
          { id: 'pipeline', title: 'Pipeline', entryPath: 'pipeline', order: 1 },
        ],
      });
      await fetchManifest(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^each page it names carries an id, a title, an entry path and an order$/,
    (ctx) => {
      const pages = ctx.manifestBody.pages;
      if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error(`expected a non-empty pages list; got: ${JSON.stringify(ctx.manifestBody)}`);
      }
      for (const page of pages) {
        const shapeOk =
          typeof page.id === 'string' && page.id.length > 0 &&
          typeof page.title === 'string' && page.title.length > 0 &&
          typeof page.entryPath === 'string' && page.entryPath.length > 0 &&
          typeof page.order === 'number' && Number.isFinite(page.order);
        if (!shapeOk) {
          throw new Error(`page entry missing a required field: ${JSON.stringify(page)}`);
        }
      }
    },
    FEATURE_NAME
  );

  // ── bundle-pages-rejected-whole-02 ────────────────────────────────────
  registry.defineScoped(
    /^the served manifest carries a malformed page list$/,
    (ctx) => {
      writeManifest(ctx.targetPath, {
        schemaVersion: 1,
        bundleVersion: 3,
        minShellVersion: 0,
        payload: '<html></html>',
        // missing `title` and `order` on the one page entry.
        pages: [{ id: 'live', entryPath: 'live' }],
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the manifest is validated$/,
    async (ctx) => {
      await fetchManifest(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is rejected whole$/,
    (ctx) => {
      if (ctx.manifestBody.payload !== '') {
        throw new Error(`expected the whole manifest rejected (default payload), got: ${JSON.stringify(ctx.manifestBody)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no page from it is offered to the shell$/,
    (ctx) => {
      if (!Array.isArray(ctx.manifestBody.pages) || ctx.manifestBody.pages.length !== 0) {
        throw new Error(`expected no pages offered, got: ${JSON.stringify(ctx.manifestBody.pages)}`);
      }
    },
    FEATURE_NAME
  );

  // ── pager-list-resolution-03 / pager-opens-on-talk-04 / page-allowlist-05
  registry.defineScoped(
    /^the Bubble Android module$/,
    (ctx) => {
      ctx.repoRoot = repoRootFromHere();
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      const resolverFile = path.join(
        ctx.androidDir,
        'app',
        'src',
        'main',
        'java',
        'com',
        'swarmforge',
        'floatcompanion',
        'PagerListResolver.kt'
      );
      if (!fs.existsSync(resolverFile)) {
        throw new Error(`expected ${resolverFile}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the JVM unit suite is run$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it exercises (.+)$/,
    (ctx, decision) => {
      const nameSubstring = KNOWN_VALUES[decision];
      if (!nameSubstring) {
        throw new Error(`no KNOWN_VALUES entry for decision "${decision}" — refusing a passthrough check (BL-233)`);
      }
      if (ctx.jvmResult.status !== 0) {
        throw new Error(
          `expected gradlew :app:testDebugUnitTest to exit 0 for "${decision}", got ${ctx.jvmResult.status}. output:\n` +
            `${ctx.jvmResult.stdout}\n${ctx.jvmResult.stderr}`
        );
      }
      const matches = ctx.junitResults.filter(
        (r) => r.classname.includes(TEST_CLASS) && r.name.includes(nameSubstring)
      );
      if (matches.length === 0) {
        throw new Error(
          `expected a passed test in ${TEST_CLASS} naming "${nameSubstring}" for "${decision}", ` +
            `found none among: ${JSON.stringify(ctx.junitResults)}`
        );
      }
      if (matches.some((r) => !r.passed)) {
        throw new Error(`expected the matching test(s) for "${decision}" to have passed: ${JSON.stringify(matches)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
