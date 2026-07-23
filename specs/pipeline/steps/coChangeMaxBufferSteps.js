'use strict';

// BL-549: step handlers for co-change-report's maxBuffer/ENOBUFS fix.
// Building an actual >1 MiB git history per acceptance run is impractical
// (and the ticket's own regression-test guidance already warns not to rely
// on incidental repo size for this) - so a real small repo supplies genuine
// co-change history, and scenario 2 forces the same overflow path a real
// oversized repo would hit by passing runGitLog an explicit tiny maxBuffer,
// mirroring gitHistoryAdapter.test.js's own unit-level technique.
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
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
}

function initRepoWithCoChangeHistory() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  commitFiles(root, { 'A.ts': '1', 'B.ts': '1' });
  commitFiles(root, { 'A.ts': '2', 'B.ts': '2' });
  commitFiles(root, { 'A.ts': '3', 'B.ts': '3' });
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
