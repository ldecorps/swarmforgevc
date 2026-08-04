'use strict';

// BL-769: locates a JDK (17+, required by AGP 8.5.x) and the Android SDK
// this project pins under .swarmforge/android-sdk, then runs a gradlew task
// against android/. Neither is guaranteed present under every checkout's own
// .swarmforge/ (worktree-local, gitignored - only the main checkout's has
// been provisioned so far), so both resolutions fall back to the main
// checkout the same way lib/mainCheckout.js does for other machine-local
// state.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveMainCheckout } = require('./mainCheckout');

function javaMajorVersion(javaBin) {
  const res = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
  const text = `${res.stdout || ''}${res.stderr || ''}`;
  const match = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!match) {
    return null;
  }
  const first = Number(match[1]);
  // Java 8 and earlier report "1.8.x" - the real major version is the second group.
  return first === 1 ? Number(match[2]) : first;
}

function isJdk17Plus(home) {
  const bin = path.join(home, 'bin', 'java');
  if (!fs.existsSync(bin)) {
    return false;
  }
  const major = javaMajorVersion(bin);
  return typeof major === 'number' && major >= 17;
}

function findJdk17Home() {
  if (process.env.JAVA_HOME && isJdk17Plus(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  const brewPrefixes = ['/usr/local/opt', '/opt/homebrew/opt'];
  const brewNames = ['openjdk', 'openjdk@17', 'openjdk@21', 'openjdk@18'];
  for (const prefix of brewPrefixes) {
    for (const name of brewNames) {
      const home = path.join(prefix, name, 'libexec', 'openjdk.jdk', 'Contents', 'Home');
      if (isJdk17Plus(home)) {
        return home;
      }
    }
  }
  if (process.platform === 'darwin') {
    for (const ver of ['17', '18', '19', '20', '21']) {
      const res = spawnSync('/usr/libexec/java_home', ['-v', ver], { encoding: 'utf8' });
      if (res.status === 0 && res.stdout.trim()) {
        return res.stdout.trim();
      }
    }
  }
  return null;
}

function findAndroidSdkRoot(repoRoot) {
  const local = path.join(repoRoot, '.swarmforge', 'android-sdk');
  if (fs.existsSync(local)) {
    return local;
  }
  const mainCheckout = resolveMainCheckout(repoRoot);
  const shared = path.join(mainCheckout, '.swarmforge', 'android-sdk');
  return fs.existsSync(shared) ? shared : null;
}

function ensureLocalProperties(androidDir, sdkRoot) {
  const target = path.join(androidDir, 'local.properties');
  const line = `sdk.dir=${sdkRoot}\n`;
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === line) {
    return;
  }
  fs.writeFileSync(target, line);
}

// Runs a gradlew task against android/ under repoRoot. Throws if no JDK 17+
// or Android SDK can be found - both are environmental prerequisites this
// feature's Background depends on, never silently skipped.
function runGradle(repoRoot, args, opts = {}) {
  const androidDir = path.join(repoRoot, 'android');
  const jdkHome = findJdk17Home();
  if (!jdkHome) {
    throw new Error(
      'no JDK 17+ found (checked JAVA_HOME, Homebrew openjdk, and /usr/libexec/java_home) — ' +
        'install one to run the Android JVM unit suite'
    );
  }
  const sdkRoot = findAndroidSdkRoot(repoRoot);
  if (!sdkRoot) {
    throw new Error(
      `no Android SDK found under ${path.join(repoRoot, '.swarmforge', 'android-sdk')} ` +
        "or the main checkout's equivalent"
    );
  }
  ensureLocalProperties(androidDir, sdkRoot);
  const res = spawnSync('./gradlew', args, {
    cwd: androidDir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      JAVA_HOME: jdkHome,
      ANDROID_SDK_ROOT: sdkRoot,
    },
    timeout: opts.timeoutMs || 10 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', signal: res.signal };
}

// Minimal JUnit XML reader - enough to check pass/fail per test without a
// new XML-parsing dependency. Each <testcase ...>...</testcase> (or
// self-closing <testcase .../>) is one entry; a <failure or <error child
// marks it failed.
function readJUnitResults(androidDir, taskReportDir) {
  const dir = path.join(androidDir, 'app', 'build', 'test-results', taskReportDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.xml'))) {
    const xml = fs.readFileSync(path.join(dir, file), 'utf8');
    const testcaseRe = /<testcase\s+([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
    let match;
    while ((match = testcaseRe.exec(xml))) {
      const attrs = match[1];
      const body = match[3] || '';
      const name = /name="([^"]*)"/.exec(attrs)?.[1] || '';
      const classname = /classname="([^"]*)"/.exec(attrs)?.[1] || '';
      const passed = !/<failure|<error/.test(body);
      results.push({ name, classname, passed });
    }
  }
  return results;
}

module.exports = { findJdk17Home, findAndroidSdkRoot, runGradle, readJUnitResults };
