'use strict';

// BL-728: verify handoffd deliver! paren fix independently of BL-636's
// commit-message claim. Drives real Babashka load/invoke and reads the
// durable evidence report — never a parallel reimplementation.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE =
  'handoffd deliver! paren fix verified independently of BL-636 commit-message claims';
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const WIRING = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_handoffd_one_shot_flags_parse.sh'
);
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');
const EVIDENCE_PREFIX = 'BL-728-handoffd-deliver-paren-verification-';
const BL636_LAND = '6a2e4aaf6';

const ONE_SHOT_ROWS = [
  { flag: '--poll-once', doneLine: 'poll-once done' },
  { flag: '--sweep-once', doneLine: 'sweep-once done' },
  { flag: '--chase-sweep-once', doneLine: 'chase-sweep-once done' },
];

const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { findLatestEvidenceFile } = require('./lib/evidenceReport');

function ensureState(ctx) {
  if (!ctx.bl728) ctx.bl728 = {};
  return ctx.bl728;
}

function mkFixtureRoot() {
  const root = mkSocketFixtureRoot('aps-bl728-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${sock}\n`);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  return root;
}

function runHandoffd(root, flag) {
  const res = spawnSync('bb', [HANDOFFD, root, flag], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
  });
  const logFile = path.join(root, '.swarmforge', 'daemon', 'handoffd.log');
  const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  return {
    status: res.status ?? 1,
    out: `${res.stdout || ''}${res.stderr || ''}`,
    logText,
  };
}

function assertNoBabashkaParseFailure(out, status, label) {
  if (out.includes('EOF while reading')) {
    throw new Error(`Babashka parse failure (${label}): ${out}`);
  }
  if (/Phase:\s*parse/i.test(out)) {
    throw new Error(`Babashka parse phase error (${label}): ${out}`);
  }
  if (status !== 0) {
    throw new Error(`expected exit 0 for ${label}; got ${status}: ${out}`);
  }
}

function oneShotSucceeded(run, doneLine) {
  const hay = `${run.out}${run.logText}`;
  return run.status === 0 && hay.includes(doneLine) && !run.out.includes('EOF while reading');
}

function readBl728Evidence(st) {
  if (!st.evidenceText) {
    st.evidencePath = findLatestEvidenceFile(EVIDENCE_DIR, EVIDENCE_PREFIX, 'BL-728');
    st.evidenceText = fs.readFileSync(st.evidencePath, 'utf8');
  }
  return st.evidenceText;
}

function extractDeliverForm(source) {
  const start = source.indexOf('(defn deliver!');
  if (start < 0) throw new Error('deliver! not found in handoffd.bb');
  let depth = 0;
  let started = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      depth += 1;
      started = true;
    } else if (ch === ')') {
      depth -= 1;
      if (started && depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error('unbalanced deliver! form in handoffd.bb');
}

function countParens(form) {
  let open = 0;
  let close = 0;
  for (const ch of form) {
    if (ch === '(') open += 1;
    if (ch === ')') close += 1;
  }
  return { open, close };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a throwaway project root with a fake tmux socket and roles\.tsv$/, (ctx) => {
    ensureState(ctx).root = mkFixtureRoot();
  });

  scoped(/^handoffd\.bb is invoked from that fixture root$/, (ctx) => {
    if (!ensureState(ctx).root) ensureState(ctx).root = mkFixtureRoot();
  });

  scoped(/^handoffd\.bb is loaded by Babashka from the fixture root$/, (ctx) => {
    const st = ensureState(ctx);
    const parseScript = `
(try
  (loop [r (java.io.PushbackReader. (java.io.StringReader. (slurp "${HANDOFFD}")))]
    (let [form (read r false ::eof)]
      (if (= form ::eof)
        (println "parsed")
        (recur r))))
  (catch Exception e
    (binding [*out* *err*]
      (println "parse-error" (.getMessage e)))
    (System/exit 1)))
`;
    const res = spawnSync('bb', ['-e', parseScript], { encoding: 'utf8' });
    st.loadOut = `${res.stdout || ''}${res.stderr || ''}`;
    st.loadStatus = res.status ?? 1;
  });

  scoped(
    /^the load completes without a syntax or unmatched-delimiter error$/,
    (ctx) => {
      const st = ensureState(ctx);
      assertNoBabashkaParseFailure(st.loadOut, st.loadStatus, 'loading handoffd.bb');
    }
  );

  scoped(/^handoffd\.bb is invoked with "([^"]+)"$/, (ctx, flag) => {
    const st = ensureState(ctx);
    st.lastFlag = flag;
    st.lastRun = runHandoffd(st.root, flag);
  });

  scoped(/^the daemon log contains "([^"]+)"$/, (ctx, doneLine) => {
    const st = ensureState(ctx);
    const hay = `${st.lastRun?.out || ''}${st.lastRun?.logText || ''}`;
    if (!hay.includes(doneLine)) {
      throw new Error(
        `expected log line "${doneLine}" for ${st.lastFlag}; stdout/stderr: ${st.lastRun?.out}; log: ${st.lastRun?.logText}`
      );
    }
  });

  scoped(/^handoffd exits without a load-time syntax failure$/, (ctx) => {
    const st = ensureState(ctx);
    assertNoBabashkaParseFailure(st.lastRun.out, st.lastRun.status, st.lastFlag);
  });

  scoped(
    /^the source of swarmforge\/scripts\/handoffd\.bb at the parcel commit$/,
    (ctx) => {
      ensureState(ctx).handoffdSource = fs.readFileSync(HANDOFFD, 'utf8');
    }
  );

  scoped(/^the deliver! form is extracted and its parentheses are counted$/, (ctx) => {
    const st = ensureState(ctx);
    const form = extractDeliverForm(st.handoffdSource);
    st.deliverCounts = countParens(form);
  });

  scoped(/^open and close counts are equal$/, (ctx) => {
    const { open, close } = ensureState(ctx).deliverCounts;
    if (open !== close) {
      throw new Error(`deliver! unbalanced: open=${open} close=${close}`);
    }
  });

  scoped(
    /^verification has traced deliver! on main and the BL-636 landing commit 6a2e4aaf6$/,
    (ctx) => {
      readBl728Evidence(ensureState(ctx));
    }
  );

  scoped(/^the evidence file for this ticket is written$/, (ctx) => {
    if (!ensureState(ctx).evidenceText) {
      throw new Error('evidence file missing — run verification first');
    }
  });

  scoped(/^it states whether the one-shot flag bug is fixed on main today$/, (ctx) => {
    const text = readBl728Evidence(ensureState(ctx));
    if (!/bug IS fixed on current main/i.test(text)) {
      throw new Error('evidence must state whether the bug is fixed on main');
    }
  });

  scoped(
    /^it names the commit that actually balanced deliver! with commit references$/,
    (ctx) => {
      const text = readBl728Evidence(ensureState(ctx));
      if (!/536c16ffb/.test(text) || !/5f9a79511/.test(text)) {
        throw new Error('evidence must name closing commit(s) with references');
      }
    }
  );

  scoped(
    /^it records that 6a2e4aaf6's own patch did not restore deliver! or change its closing parens$/,
    (ctx) => {
      const st = ensureState(ctx);
      const text = readBl728Evidence(st);
      const patch = execFileSync(
        'git',
        ['diff', `${BL636_LAND}^..${BL636_LAND}`, '--', 'swarmforge/scripts/handoffd.bb'],
        { cwd: REPO_ROOT, encoding: 'utf8' }
      );
      if (/deliver!/.test(patch)) {
        throw new Error('6a2e4aaf6 patch must not mention deliver!');
      }
      if (
        !/6a2e4aaf6/.test(text) ||
        !/deliver!/.test(text) ||
        !/(did not touch|does not appear|paren fix absent|not in its patch)/i.test(text)
      ) {
        throw new Error('evidence must record 6a2e4aaf6 did not restore deliver! parens');
      }
    }
  );

  scoped(
    /^verification finds a one-shot flag that fails to reach its done log$/,
    (ctx) => {
      const st = ensureState(ctx);
      st.root = st.root || mkFixtureRoot();
      st.failedFlags = ONE_SHOT_ROWS.filter(
        ({ flag, doneLine }) => !oneShotSucceeded(runHandoffd(st.root, flag), doneLine)
      ).map(({ flag }) => flag);
      st.needsRepair = st.failedFlags.length > 0;
    }
  );

  scoped(/^the parcel completes$/, (ctx) => {
    ensureState(ctx).parcelHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  });

  scoped(/^the defect is repaired on main in this parcel$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.needsRepair) return;
    const wiring = spawnSync('bash', [WIRING], { encoding: 'utf8', cwd: REPO_ROOT });
    if (wiring.status !== 0) {
      throw new Error(`repair wiring test failed: ${wiring.stdout}${wiring.stderr}`);
    }
  });

  scoped(/^the evidence file records the repair commit$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.needsRepair) {
      if (!/bug IS fixed on current main/i.test(readBl728Evidence(st))) {
        throw new Error('vacuous repair scenario requires evidence stating bug is fixed');
      }
      return;
    }
    if (!st.evidenceText.includes(st.parcelHead.slice(0, 10))) {
      throw new Error('evidence must record the repair commit when repair was needed');
    }
  });
}

module.exports = { registerSteps };
