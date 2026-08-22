'use strict';

// BL-916: step handlers for "Stamp Bubble cold-start expand fixes (overlay
// trampoline, splash, panel dismiss)"
// (specs/features/BL-916-bubble-cold-start-expand-swarm-stamp.feature).
//
// Per the ticket's own "HONEST SCOPE" comment and the BL-769 Testability
// Boundary — Bubble, every behaviour this hotfix touches is device-surface
// (a running Service, the overlay window, the activity lifecycle) and is
// reachable by neither the JVM unit suite nor this Node acceptance runner.
// These five scenarios are deliberately CONFIGURATION AND STRUCTURE guards —
// each reads the real landed source/manifest/theme file and pins one fact
// whose silent reversal would restore one of the three freezes described in
// the ticket. They are a regression net, not proof the bubble opens; that
// evidence is the ticket's qa_e2e_procedure, run by a human on a device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE_NAME = 'Stamp Bubble cold-start expand fixes (overlay trampoline, splash, panel dismiss)';

const ANDROID_MAIN = path.join(__dirname, '..', '..', '..', 'android', 'app', 'src', 'main');
const OVERLAY_SERVICE_FILE = path.join(ANDROID_MAIN, 'java', 'com', 'swarmforge', 'floatcompanion', 'OverlayService.kt');
const MAIN_ACTIVITY_FILE = path.join(ANDROID_MAIN, 'java', 'com', 'swarmforge', 'floatcompanion', 'MainActivity.kt');
const MANIFEST_FILE = path.join(ANDROID_MAIN, 'AndroidManifest.xml');
const THEMES_FILE = path.join(ANDROID_MAIN, 'res', 'values', 'themes.xml');
const THEMES_V31_FILE = path.join(ANDROID_MAIN, 'res', 'values-v31', 'themes.xml');

const KNOWN_SPLASH_PROPERTIES = {
  'a transparent splash animated icon': /android:windowSplashScreenAnimatedIcon">@android:color\/transparent</,
  'a zero splash animation duration': /android:windowSplashScreenAnimationDuration">0</,
};

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`bl916: expected file to exist: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// Isolates the private openTalkPanel() method body from the rest of
// OverlayService.kt so "it targets MainActivity" / "never names
// TalkPanelActivity" pin the actual trampoline path, not just the file as a
// whole (the file also references MainActivity elsewhere, e.g. the
// notification's own PendingIntent).
function extractOpenTalkPanelBody(source) {
  const start = source.indexOf('private fun openTalkPanel()');
  if (start === -1) {
    throw new Error('bl916: expected OverlayService.kt to declare openTalkPanel()');
  }
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }
  throw new Error('bl916: could not find the end of openTalkPanel()');
}

// Isolates the <activity android:name=".MainActivity" ...> element from the
// manifest so "it is exported" / "launch mode is singleTop" pin that one
// declaration, not any other activity in the file.
function extractManifestActivity(source, activityName) {
  const marker = `android:name="${activityName}"`;
  const nameIdx = source.indexOf(marker);
  if (nameIdx === -1) {
    throw new Error(`bl916: expected AndroidManifest.xml to declare ${activityName}`);
  }
  const tagStart = source.lastIndexOf('<activity', nameIdx);
  const tagEnd = source.indexOf('>', nameIdx);
  if (tagStart === -1 || tagEnd === -1) {
    throw new Error(`bl916: could not isolate the <activity> element for ${activityName}`);
  }
  return source.slice(tagStart, tagEnd + 1);
}

function extractOnCreateBody(source) {
  const start = source.indexOf('override fun onCreate(');
  if (start === -1) {
    throw new Error('bl916: expected MainActivity.kt to declare onCreate()');
  }
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }
  throw new Error('bl916: could not find the end of onCreate()');
}

// Isolates the Theme.FloatCompanion.Panel <style> block used by
// TalkPanelActivity, per the manifest's own android:theme attribute.
function extractPanelThemeBlock(source) {
  const nameMarker = 'name="Theme.FloatCompanion.Panel"';
  const nameIdx = source.indexOf(nameMarker);
  if (nameIdx === -1) {
    throw new Error('bl916: expected themes.xml to declare Theme.FloatCompanion.Panel');
  }
  const tagStart = source.lastIndexOf('<style', nameIdx);
  const tagEnd = source.indexOf('</style>', nameIdx);
  if (tagStart === -1 || tagEnd === -1) {
    throw new Error('bl916: could not isolate the Theme.FloatCompanion.Panel style block');
  }
  return source.slice(tagStart, tagEnd + '</style>'.length);
}

function registerSteps(registry) {
  // ── overlay-never-starts-the-panel-directly-01 ─────────────────────────
  registry.defineScoped(
    /^the overlay service's open-Talk path$/,
    (ctx) => {
      ctx.openTalkPanelBody = extractOpenTalkPanelBody(readFile(OVERLAY_SERVICE_FILE));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it targets MainActivity$/,
    (ctx) => {
      assert.match(ctx.openTalkPanelBody, /Intent\(this, MainActivity::class\.java\)/);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it never names TalkPanelActivity, whose direct start is what Samsung dropped$/,
    (ctx) => {
      assert.doesNotMatch(ctx.openTalkPanelBody, /TalkPanelActivity/);
    },
    FEATURE_NAME
  );

  // ── trampoline-target-stays-launchable-02 ──────────────────────────────
  registry.defineScoped(
    /^the Android manifest declaration for MainActivity$/,
    (ctx) => {
      ctx.mainActivityElement = extractManifestActivity(readFile(MANIFEST_FILE), '.MainActivity');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is exported$/,
    (ctx) => {
      assert.match(ctx.mainActivityElement, /android:exported="true"/);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its launch mode is singleTop, so a re-entrant open reuses the task$/,
    (ctx) => {
      assert.match(ctx.mainActivityElement, /android:launchMode="singleTop"/);
    },
    FEATURE_NAME
  );

  // ── launcher-activity-does-not-finish-its-own-task-03 ──────────────────
  registry.defineScoped(
    /^MainActivity's creation path$/,
    (ctx) => {
      ctx.mainActivitySource = readFile(MAIN_ACTIVITY_FILE);
      ctx.onCreateBody = extractOnCreateBody(ctx.mainActivitySource);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not finish or remove its own task there$/,
    (ctx) => {
      assert.doesNotMatch(ctx.onCreateBody, /finish\(\)|finishAndRemoveTask\(\)/);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the pairing screen is left on screen as the accepted trade-off$/,
    (ctx) => {
      // The whole file, not just onCreate(): the accepted trade-off is that
      // NOTHING in MainActivity finishes its own task, ever - not just on
      // the entry path onCreate() covers.
      assert.doesNotMatch(ctx.mainActivitySource, /finish\(\)|finishAndRemoveTask\(\)/);
    },
    FEATURE_NAME
  );

  // ── panel-survives-the-overlay-finger-up-04 ────────────────────────────
  registry.defineScoped(
    /^the dialog theme used by the Talk panel$/,
    (ctx) => {
      ctx.panelThemeBlock = extractPanelThemeBlock(readFile(THEMES_FILE));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^closing on a touch outside the window is disabled$/,
    (ctx) => {
      assert.match(ctx.panelThemeBlock, /android:windowCloseOnTouchOutside">false</);
    },
    FEATURE_NAME
  );

  // ── splash-cannot-stay-on-screen-05 (Scenario Outline) ─────────────────
  registry.defineScoped(
    /^the API 31\+ theme for the companion$/,
    (ctx) => {
      ctx.themeV31Source = readFile(THEMES_V31_FILE);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^(.+) is set so no launcher icon can remain on screen$/,
    (ctx, property) => {
      const pattern = KNOWN_SPLASH_PROPERTIES[property];
      if (!pattern) {
        throw new Error(`bl916: unrecognized <splash property> example value "${property}"`);
      }
      assert.match(ctx.themeV31Source, pattern);
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
