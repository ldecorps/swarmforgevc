'use strict';

// BL-1163: handoffd parse hotfix after BL-668 post-QA sweep under-closed two
// defn bodies. Drives real Babashka load/invoke and the BL-728 wiring script.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'handoffd parse error from BL-668 post-QA sweep paren hotfix';
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const WIRING = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_handoffd_one_shot_flags_parse.sh'
);

const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

function ensureState(ctx) {
  if (!ctx.bl1163) ctx.bl1163 = {};
  return ctx.bl1163;
}

function mkFixtureRoot() {
  const root = mkSocketFixtureRoot('aps-bl1163-');
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
    timeout: 15000,
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
  if (/unmatched delimiter/i.test(out)) {
    throw new Error(`Babashka unmatched delimiter (${label}): ${out}`);
  }
  if (/Phase:\s*parse/i.test(out)) {
    throw new Error(`Babashka parse phase error (${label}): ${out}`);
  }
  if (status !== 0) {
    throw new Error(`expected exit 0 for ${label}; got ${status}: ${out}`);
  }
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
    ensureState(ctx).loadOut = `${res.stdout || ''}${res.stderr || ''}`;
    ensureState(ctx).loadStatus = res.status ?? 1;
  });

  scoped(
    /^the load completes without an EOF while reading or unmatched delimiter error$/,
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

  scoped(/^test_handoffd_one_shot_flags_parse\.sh runs against the parcel commit$/, () => {
    // no-op: script always runs at the checked-out parcel commit
  });

  scoped(/^every check in that script reports PASS$/, () => {
    const wiring = spawnSync('bash', [WIRING], { encoding: 'utf8', cwd: REPO_ROOT });
    if (wiring.status !== 0) {
      throw new Error(`wiring test failed: ${wiring.stdout}${wiring.stderr}`);
    }
    if (!wiring.stdout.includes('ALL PASS')) {
      throw new Error(`expected ALL PASS from wiring script; got: ${wiring.stdout}`);
    }
  });
}

module.exports = { registerSteps };
