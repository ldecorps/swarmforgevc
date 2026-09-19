'use strict';

// BL-1635: step handlers for "BL-1635 The Android JVM build reads sources
// as UTF-8 regardless of locale"
// (specs/features/BL-1635-the-android-jvm-build-reads-sources-as-utf-8-regardless-of-locale.feature).
//
// Scenarios 01 and 03 are pure source/file checks - no JVM launched, no
// Gradle daemon touched. Scenario 02 drives the handlers' own exported
// buildGradleEnv directly (milliseconds), never a real gradlew spawn - the
// suite actually going green is QA's e2e step (BL-1541), not a scenario
// here.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildGradleEnv } = require('./lib/androidGradle');

const FEATURE_NAME = 'BL-1635 The Android JVM build reads sources as UTF-8 regardless of locale';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ANDROID_DIR = path.join(REPO_ROOT, 'android');

function walkKotlinFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkKotlinFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.kt')) {
      out.push(full);
    }
  }
  return out;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── jvm-build-reads-sources-as-utf-8-01 ──────────────────────────────
  scoped(/^the Android build's Gradle properties and the app module's build script are read$/, (ctx) => {
    ctx.gradleProperties = fs.readFileSync(path.join(ANDROID_DIR, 'gradle.properties'), 'utf8');
    ctx.appBuildScript = fs.readFileSync(path.join(ANDROID_DIR, 'app', 'build.gradle.kts'), 'utf8');
  });

  scoped(/^the Gradle daemon JVM arguments pin file\.encoding to UTF-8$/, (ctx) => {
    const line = ctx.gradleProperties.split('\n').find((l) => l.startsWith('org.gradle.jvmargs='));
    assert.ok(line, 'expected an org.gradle.jvmargs line in gradle.properties');
    assert.match(line, /-Dfile\.encoding=UTF-8/, `expected org.gradle.jvmargs to pin file.encoding=UTF-8, got: ${line}`);
  });

  scoped(/^the Kotlin compile daemon JVM arguments pin file\.encoding to UTF-8$/, (ctx) => {
    const line = ctx.gradleProperties.split('\n').find((l) => l.startsWith('kotlin.daemon.jvmargs='));
    assert.ok(line, 'expected a kotlin.daemon.jvmargs line in gradle.properties');
    assert.match(line, /-Dfile\.encoding=UTF-8/, `expected kotlin.daemon.jvmargs to pin file.encoding=UTF-8, got: ${line}`);
  });

  scoped(/^the app module's Java compile options set the encoding to UTF-8$/, (ctx) => {
    const compileOptionsMatch = /compileOptions\s*\{([^}]*)\}/.exec(ctx.appBuildScript);
    assert.ok(compileOptionsMatch, "expected a compileOptions { ... } block in the app module's build script");
    assert.match(compileOptionsMatch[1], /encoding\s*=\s*"UTF-8"/, `expected compileOptions to set encoding = "UTF-8", got: ${compileOptionsMatch[1]}`);
  });

  // ── jvm-build-reads-sources-as-utf-8-02 ──────────────────────────────
  scoped(/^a base environment carrying only PATH and HOME$/, (ctx) => {
    ctx.baseEnv = { PATH: '/usr/bin:/bin', HOME: '/home/swarm' };
  });

  scoped(/^the handlers' Gradle lib builds the environment it launches gradlew with$/, (ctx) => {
    ctx.builtEnv = buildGradleEnv(ctx.baseEnv);
  });

  scoped(/^that environment sets LC_ALL and LANG to a UTF-8 locale$/, (ctx) => {
    assert.match(ctx.builtEnv.LANG || '', /utf-?8/i, `expected LANG to name a UTF-8 locale, got: ${ctx.builtEnv.LANG}`);
    assert.match(ctx.builtEnv.LC_ALL || '', /utf-?8/i, `expected LC_ALL to name a UTF-8 locale, got: ${ctx.builtEnv.LC_ALL}`);
    // The base environment's own keys survive the merge - the builder adds
    // a locale, it does not replace the caller's environment.
    assert.equal(ctx.builtEnv.PATH, ctx.baseEnv.PATH);
    assert.equal(ctx.builtEnv.HOME, ctx.baseEnv.HOME);
  });

  scoped(/^it sets JAVA_TOOL_OPTIONS to pin file\.encoding to UTF-8$/, (ctx) => {
    assert.match(
      ctx.builtEnv.JAVA_TOOL_OPTIONS || '',
      /-Dfile\.encoding=UTF-8/,
      `expected JAVA_TOOL_OPTIONS to pin file.encoding=UTF-8, got: ${ctx.builtEnv.JAVA_TOOL_OPTIONS}`
    );
  });

  // ── jvm-build-reads-sources-as-utf-8-03 ──────────────────────────────
  scoped(/^every Kotlin source under android\/app\/src is read as bytes$/, (ctx) => {
    const files = walkKotlinFiles(path.join(ANDROID_DIR, 'app', 'src'));
    const invalid = [];
    for (const file of files) {
      const bytes = fs.readFileSync(file);
      const hasNul = bytes.includes(0);
      let invalidUtf8 = false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        invalidUtf8 = true;
      }
      if (hasNul || invalidUtf8) {
        invalid.push({ file: path.relative(REPO_ROOT, file), hasNul, invalidUtf8 });
      }
    }
    ctx.kotlinFileCount = files.length;
    ctx.invalidKotlinFiles = invalid;
  });

  scoped(/^none contains a NUL byte or an invalid UTF-8 sequence$/, (ctx) => {
    assert.equal(
      ctx.invalidKotlinFiles.length,
      0,
      `expected no Kotlin source with a NUL byte or invalid UTF-8, got: ${JSON.stringify(ctx.invalidKotlinFiles)}`
    );
  });

  scoped(/^the population read is at least 70 files$/, (ctx) => {
    assert.ok(ctx.kotlinFileCount >= 70, `expected at least 70 .kt files under android/app/src, got: ${ctx.kotlinFileCount}`);
  });
}

module.exports = { registerSteps };
