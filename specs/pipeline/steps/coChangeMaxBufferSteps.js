'use strict';

// BL-549: step handlers for co-change-report's maxBuffer/ENOBUFS fix.
// The Background builds a repo whose full-history name-status output
// genuinely exceeds 1 MiB (a bulk commit of many long-named files, on top
// of the real A.ts/B.ts co-change history) - a few hundred ms, no need for
// a real multi-year repo - so scenario 1 exercises runGitLog's *default*
// maxBuffer (no override) against the actual old 1 MiB regression boundary,
// not just an explicit tiny stand-in. Scenario 2 still forces overflow
// deterministically via an explicit tiny maxBuffer, covering the
// diagnostic-logging path, mirroring gitHistoryAdapter.test.js's technique.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runGitLog } = require(path.join(EXT_OUT, 'metrics', 'gitHistoryAdapter'));
const { computeCoChangeReport, DEFAULT_CO_CHANGE_OPTIONS } = require(path.join(EXT_OUT, 'quality', 'coChange'));
const { formatCoChangeReport } = require(path.join(EXT_OUT, 'tools', 'co-change-report'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-cochange-maxbuffer-'));
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  });
}

function commitFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
}

const ONE_MIB = 1024 * 1024;

// Pads the repo's full-history name-status output past the old 1 MiB
// execFileSync default via one bulk commit of many long-named files - kept
// in its own commit, separate from A.ts/B.ts, so it adds bytes to the
// history without becoming a co-changer of the file under test.
function addOversizePaddingCommit(root) {
  const subdir = 'd'.repeat(200);
  fs.mkdirSync(path.join(root, subdir));
  for (let i = 0; i < 3000; i++) {
    const name = String(i).padStart(6, '0') + 'x'.repeat(190);
    fs.writeFileSync(path.join(root, subdir, name), '1');
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'bulk padding to exceed 1 MiB history']);
}

function initRepoWithCoChangeHistory() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  commitFiles(root, { 'A.ts': '1', 'B.ts': '1' });
  commitFiles(root, { 'A.ts': '2', 'B.ts': '2' });
  commitFiles(root, { 'A.ts': '3', 'B.ts': '3' });
  addOversizePaddingCommit(root);

  const rawOutput = git(root, [
    'log', 'HEAD', '--format=COMMIT%x09%H%x09%cI', '--name-status', '-M', '--reverse', '--', '.'
  ]);
  if (Buffer.byteLength(rawOutput) <= ONE_MIB) {
    throw new Error(
      `test fixture must itself exceed 1 MiB to guard the real BL-549 boundary; was ${Buffer.byteLength(rawOutput)} bytes`
    );
  }

  return root;
}

function withCapturedStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  const chunks = [];
  process.stderr.write = (chunk) => {
    chunks.push(chunk);
    return true;
  };
  try {
    return { result: fn(), stderr: chunks.join('') };
  } finally {
    process.stderr.write = original;
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^a git repository whose full-history name-status output exceeds execFileSync's default 1 MiB buffer$/,
    (ctx) => {
      ctx.root = initRepoWithCoChangeHistory();
      ctx.targetFile = 'A.ts';
    }
  );

  // ── co-change-maxbuffer-01 ───────────────────────────────────────────
  registry.define(
    /^a file with real co-change history in a repository whose full name-status log exceeds 1 MiB$/,
    () => {
      // Background already built the repo and picked the target file.
    }
  );

  registry.define(/^the co-change report runs for that file$/, (ctx) => {
    const history = runGitLog(ctx.root, '.');
    const report = computeCoChangeReport([ctx.targetFile], history, DEFAULT_CO_CHANGE_OPTIONS);
    ctx.output = formatCoChangeReport(report);
  });

  registry.define(/^the report lists that file's co-changers with their co-change counts$/, (ctx) => {
    if (!/B\.ts: 3 co-change\(s\)/.test(ctx.output)) {
      throw new Error(`expected B.ts listed with its co-change count; got: ${ctx.output}`);
    }
  });

  registry.define(/^it does not report "no co-changers found"$/, (ctx) => {
    if (/no co-changers found/.test(ctx.output)) {
      throw new Error(`expected co-changers to be reported, not the empty-history fallback; got: ${ctx.output}`);
    }
  });

  // ── co-change-maxbuffer-02 ───────────────────────────────────────────
  registry.define(/^a git-log read that exceeds even an explicit maxBuffer configured on the adapter$/, (ctx) => {
    ctx.tinyMaxBuffer = 10;
  });

  registry.define(/^the co-change report runs$/, (ctx) => {
    const { result: history, stderr } = withCapturedStderr(() => runGitLog(ctx.root, '.', 'HEAD', ctx.tinyMaxBuffer));
    ctx.stderrOutput = stderr;
    const report = computeCoChangeReport([ctx.targetFile], history, DEFAULT_CO_CHANGE_OPTIONS);
    ctx.output = formatCoChangeReport(report);
  });

  registry.define(/^the tool surfaces a diagnostic identifying the overflow$/, (ctx) => {
    if (!/runGitLog.*failed/i.test(ctx.stderrOutput)) {
      throw new Error(`expected a diagnostic identifying the overflow on stderr; got: ${JSON.stringify(ctx.stderrOutput)}`);
    }
  });

  registry.define(/^it does not silently render an empty co-changers result$/, (ctx) => {
    if (!ctx.stderrOutput) {
      throw new Error('expected the empty co-changers result to be accompanied by a diagnostic, not rendered silently');
    }
  });
}

module.exports = { registerSteps };
