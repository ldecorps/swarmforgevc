'use strict';

// BL-634: slice size envelope promotion gate — drives promotion_gates_cli.bb.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'promotion flags oversized slice envelopes before a coder starts';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATES_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
const SLICE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'slice_size_envelope_gate_lib.bb');

function ensure(ctx) {
  if (!ctx.bl634) {
    ctx.bl634 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl634-promo-')),
      ticketPath: null,
      lines: [
        'id: BL-6634',
        'human_approval: approved',
        'epic: solo',
        'mutation_cost: medium',
      ],
      conf: 'config active_backlog_max_depth 5\n',
      lastOut: '',
    };
    fs.mkdirSync(path.join(ctx.bl634.root, 'swarmforge'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl634.root, 'backlog', 'paused'), { recursive: true });
  }
  return ctx.bl634;
}

function writeTicket(ctx) {
  const st = ensure(ctx);
  st.ticketPath = path.join(st.root, 'backlog', 'paused', 'BL-6634-test.yaml');
  fs.writeFileSync(st.ticketPath, `${st.lines.join('\n')}\n`, 'utf8');
}

function writeConf(ctx) {
  const st = ensure(ctx);
  fs.writeFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), st.conf, 'utf8');
}

function evaluate(ctx) {
  const st = ensure(ctx);
  writeTicket(ctx);
  writeConf(ctx);
  const result = spawnSync('bb', [GATES_CLI, 'evaluate', st.root, st.ticketPath, 'false', '5'], {
    encoding: 'utf8',
  });
  st.lastOut = `${result.stdout || ''}${result.stderr || ''}`.trim();
  st.lastCode = result.status;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ticket eligible for promotion into the active backlog$/, () => {});

  scoped(/^the candidate declares (\d+) expected insertions$/, (ctx, n) => {
    ensure(ctx).lines.push(`size_envelope_insertions: ${n}`);
  });

  scoped(/^the candidate declares a high size envelope band$/, (ctx) => {
    const st = ensure(ctx);
    st.lines = st.lines.filter((l) => !l.startsWith('mutation_cost:'));
    st.lines.push('mutation_cost: high');
    st.lines.push('slice_size_envelope: high');
  });

  scoped(/^the candidate has no size envelope decision$/, (ctx) => {
    ensure(ctx).lines = ensure(ctx).lines.filter((l) => !l.startsWith('size_envelope_decision:'));
  });

  scoped(/^the candidate records a justified size envelope decision$/, (ctx) => {
    ensure(ctx).lines.push('size_envelope_decision: justified');
  });

  scoped(/^the promotion gate uses a p90 flag of (\d+) insertions$/, (ctx, n) => {
    const st = ensure(ctx);
    st.conf = `config active_backlog_max_depth 5\nconfig slice_size_p90_flag ${n}\n`;
  });

  scoped(/^the coordinator promotes the next eligible ticket$/, (ctx) => {
    evaluate(ctx);
  });

  scoped(/^the promotion is refused$/, (ctx) => {
    const st = ensure(ctx);
    if (st.lastCode === 0) {
      throw new Error(`expected refusal, got ALLOW: ${st.lastOut}`);
    }
    assert.match(st.lastOut, /REFUSE\|/);
  });

  scoped(/^the refusal names the slice size envelope gate$/, (ctx) => {
    assert.match(ensure(ctx).lastOut, /slice_size_envelope/);
    assert.match(ensure(ctx).lastOut, /split-or-justify/);
  });

  scoped(/^the candidate is promoted$/, (ctx) => {
    const st = ensure(ctx);
    if (st.lastCode !== 0) {
      throw new Error(`expected ALLOW, got: ${st.lastOut}`);
    }
    assert.match(st.lastOut, /^ALLOW$/m);
  });

  scoped(/^QA records actual slice size as (\d+) insertions and (\d+) files$/, (ctx, ins, files) => {
    const bb = spawnSync('bb', [
      '-e',
      `(load-file "${SLICE_LIB.replace(/\\/g, '/')}") (println (slice-size-envelope-gate-lib/format-actual-size-recording ${ins} ${files}))`,
    ], { encoding: 'utf8' });
    ctx.bl634 = ctx.bl634 || {};
    ctx.bl634.actualYaml = (bb.stdout || '').trim();
  });

  scoped(/^the ticket carries actual_insertions and actual_files fields$/, (ctx) => {
    const yaml = ctx.bl634?.actualYaml || '';
    assert.match(yaml, /actual_insertions: 1929/);
    assert.match(yaml, /actual_files: 18/);
  });
}

module.exports = { registerSteps };
