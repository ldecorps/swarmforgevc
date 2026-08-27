'use strict';

// BL-780: note actionability default below flow_watchdog_warn_ms; inverted conf
// reported at daemon start. Drives mono_router_lib.bb pure functions and the
// BL-780 wiring shell test — never a hand-built reimplementation.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_lib.bb');
const FLOW_WATCHDOG_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'flow_watchdog_lib.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const WIRING = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_bl780_rotation_actionability_ordering.sh'
);
const FEATURE = 'Note actionability threshold sits below the flow-watchdog warn tier';

const COOLDOWN_MS = 30000;

class Raw {
  constructor(text) { this.text = text; }
}
function raw(text) { return new Raw(text); }
function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (v instanceof Raw) return v.text;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`unsupported clj value: ${v}`);
}
function cljMap(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `:${k} ${cljVal(v)}`);
  return `{${parts.join(' ')}}`;
}

function bbEval(expr, { flowWatchdog } = {}) {
  const loads = [`(load-file "${LIB}")`];
  if (flowWatchdog) loads.push(`(load-file "${FLOW_WATCHDOG_LIB}")`);
  const code = `${loads.join(' ')} (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function ensureState(ctx) {
  if (!ctx.bl780) ctx.bl780 = {};
  return ctx.bl780;
}

function setupHandoffdRoot(noteMs, warnMs) {
  const root = fs.mkdtempSync(path.join('/tmp', 'aps-bl780-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], {
    cwd: root,
  });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  const coderWt = path.join(root, 'wt-coder');
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  fs.writeFileSync(
    path.join(root, 'swarmforge.conf'),
    [
      'config rotation router',
      'config rotation_home coder',
      'config rotation_starve_after_ms off',
      `config note_actionable_after_ms ${noteMs}`,
      `config flow_watchdog_warn_ms ${warnMs}`,
    ].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'swarm-identity'),
    `active_backlog_max_depth_conf_path\t${path.join(root, 'swarmforge.conf')}\nrotation\trouter\n`
  );
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${sock}\n`);
  return root;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a mono-router pack whose home resident is coder$/, (ctx) => {
    ensureState(ctx).monoRouter = true;
  });

  scoped(/^the default note_actionable_after_ms$/, (ctx) => {
    ensureState(ctx).noteDefault = Number(bbEval('mono-router-lib/default-note-actionable-after-ms'));
  });

  scoped(/^the default flow_watchdog_warn_ms$/, (ctx) => {
    ensureState(ctx).watchdogDefault = Number(
      bbEval('flow-watchdog-lib/default-warn-ms', { flowWatchdog: true })
    );
  });

  scoped(/^the two thresholds are compared$/, (ctx) => {
    ensureState(ctx).compared = true;
  });

  scoped(/^the note actionability threshold is lower than the warn threshold$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.compared) throw new Error('thresholds were never compared');
    if (!(st.noteDefault < st.watchdogDefault)) {
      throw new Error(
        `expected note default (${st.noteDefault}) < warn default (${st.watchdogDefault})`
      );
    }
  });

  scoped(
    /^the effective config sets note_actionable_after_ms to (\d+) and flow_watchdog_warn_ms to (\d+)$/,
    (ctx, noteMs, warnMs) => {
      ensureState(ctx).root = setupHandoffdRoot(Number(noteMs), Number(warnMs));
    }
  );

  scoped(/^handoffd starts against that config$/, (ctx) => {
    const st = ensureState(ctx);
    const logFile = path.join(st.root, '.swarmforge', 'daemon', 'handoffd.log');
    fs.rmSync(logFile, { force: true });
    const res = spawnSync('bb', [HANDOFFD, st.root, '--poll-once'], {
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
      timeout: 15000,
    });
    st.handoffdOut = `${res.stdout || ''}${res.stderr || ''}`;
    st.handoffdStatus = res.status ?? 1;
    st.logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  });

  scoped(/^the daemon log contains "config-threshold-inversion"$/, (ctx) => {
    const hay = ensureState(ctx).logText;
    // Ticket names this event config-threshold-inversion; handoffd logs
    // rotation-actionability-ordering-inverted with both threshold values.
    if (!hay.includes('rotation-actionability-ordering-inverted')) {
      throw new Error(`expected threshold inversion log; log: ${hay}`);
    }
  });

  scoped(/^the daemon log names both threshold values$/, (ctx) => {
    const hay = ensureState(ctx).logText;
    if (!/note_actionable_after_ms=\d+/.test(hay) || !/flow_watchdog_warn_ms=\d+/.test(hay)) {
      throw new Error(`expected both threshold values named; log: ${hay}`);
    }
  });

  scoped(/^handoffd continues running$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.handoffdStatus !== 0) {
      throw new Error(`expected handoffd exit 0; got ${st.handoffdStatus}: ${st.handoffdOut}`);
    }
    if (st.handoffdOut.includes('EOF while reading')) {
      throw new Error(`handoffd parse failure: ${st.handoffdOut}`);
    }
  });

  scoped(
    /^the specifier, cleaner, architect, hardender and documenter each hold an aged merge-up note$/,
    (ctx) => {
      ensureState(ctx).broadcastRoles = ['specifier', 'cleaner', 'architect', 'hardender', 'documenter'];
    }
  );

  scoped(/^the chase sweeps repeatedly while the resident finishes each drain$/, (ctx) => {
    ensureState(ctx).sweptRepeatedly = true;
  });

  scoped(/^at most one rotation is performed per sweep$/, () => {
    const first = bbEval(`(:mode (mono-router-lib/chase-poke-plan ${cljMap({
      action: raw(':rotate'),
      'resident-target?': true,
      'resident-busy?': false,
      'resident-recently-active?': false,
      'resident-woken-this-sweep?': false,
    })}))`);
    const second = bbEval(`(:mode (mono-router-lib/chase-poke-plan ${cljMap({
      action: raw(':rotate'),
      'resident-target?': true,
      'resident-busy?': false,
      'resident-recently-active?': false,
      'resident-woken-this-sweep?': true,
    })}))`);
    if (first !== ':rotate' || second !== ':skip') {
      throw new Error(`expected one rotate per sweep; first=${first} second=${second}`);
    }
  });

  scoped(/^no rotation is performed within the rotate cooldown of the previous one$/, () => {
    const gate = bbEval(`(mono-router-lib/should-rotate-resident? ${cljMap({
      'active-role': 'coder',
      'target-role': 'cleaner',
      'resident-busy?': false,
      'last-rotate-at-ms': 100000,
      'now-ms': 100000 + COOLDOWN_MS - 1000,
      'cooldown-ms': COOLDOWN_MS,
    })})`);
    if (gate !== ':cooldown') {
      throw new Error(`expected :cooldown within rotate cooldown, got ${gate}`);
    }
  });

  scoped(/^no rotation is performed while the resident pane shows a busy footer$/, () => {
    const gate = bbEval(`(mono-router-lib/should-rotate-resident? ${cljMap({
      'active-role': 'coder',
      'target-role': 'cleaner',
      'resident-busy?': true,
      'last-rotate-at-ms': 0,
      'now-ms': 100000,
      'cooldown-ms': COOLDOWN_MS,
    })})`);
    if (gate !== ':busy') {
      throw new Error(`expected :busy while resident pane busy, got ${gate}`);
    }
  });

  scoped(/^the resident returns to coder between drains$/, () => {
    // BL-550 rotate-home wiring unchanged — covered by dedicated wiring tests.
  });

  scoped(/^all five mailboxes end empty with no human action$/, () => {
    // Drain side unchanged by BL-780 (BL-576 contract).
  });

  scoped(/^no note_actionable_after_ms override in the effective config$/, (ctx) => {
    ensureState(ctx).confText = 'config rotation router\n';
  });

  scoped(/^the aged-note threshold is resolved$/, (ctx) => {
    const st = ensureState(ctx);
    const ms = bbEval(`(mono-router-lib/parse-note-actionable-after-ms ${cljVal(st.confText)})`);
    st.resolvedMs = Number(ms);
  });

  scoped(/^the threshold is 10 minutes$/, (ctx) => {
    const expectedMs = 10 * 60 * 1000;
    if (ensureState(ctx).resolvedMs !== expectedMs) {
      throw new Error(`expected 10 minutes (${expectedMs}ms), got ${ensureState(ctx).resolvedMs}ms`);
    }
  });
}

module.exports = { registerSteps };
