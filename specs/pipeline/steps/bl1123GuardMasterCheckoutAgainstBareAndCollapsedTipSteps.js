'use strict';

// BL-1123: bare=true heal + tip-floor guard.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1123 guard master checkout against bare and collapsed tip';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_checkout_integrity_cli.bb');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_checkout_integrity_lib.bb');

function sh(dir, args) {
  execFileSync(args[0], args.slice(1), { cwd: dir, stdio: 'pipe' });
}

function ensure(ctx) {
  if (!ctx.bl1123) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1123-acc-'));
    sh(dir, ['git', 'init', '-q']);
    sh(dir, ['git', 'symbolic-ref', 'HEAD', 'refs/heads/main']);
    sh(dir, ['git', 'config', 'user.email', 't@t']);
    sh(dir, ['git', 'config', 'user.name', 't']);
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.txt`), `${i}\n`);
    }
    sh(dir, ['git', 'add', '.']);
    sh(dir, ['git', 'commit', '-q', '-m', 'full']);
    ctx.bl1123 = { dir, floor: 10 };
  }
  return ctx.bl1123;
}

function cleanup(ctx) {
  if (ctx.bl1123?.dir) fs.rmSync(ctx.bl1123.dir, { recursive: true, force: true });
  ctx.bl1123 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture git repo whose config has core\.bare set to true$/, (ctx) => {
    const st = ensure(ctx);
    sh(st.dir, ['git', 'config', 'core.bare', 'true']);
  });

  scoped(/^the master-checkout bare guard runs against that repo$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('bb', [CLI, st.dir, '--tip-floor', '10'], { encoding: 'utf8' });
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
    st.status = r.status;
    try {
      st.json = JSON.parse((r.stdout || '').trim().split('\n').pop());
    } catch {
      st.json = null;
    }
  });

  scoped(/^core\.bare is false afterward or the guard exits non-zero with a bare-checkout alarm$/, (ctx) => {
    const st = ensure(ctx);
    const bare = execFileSync('git', ['-C', st.dir, 'config', '--bool', 'core.bare'], { encoding: 'utf8' }).trim();
    const healed = bare === 'false';
    const alarmed = st.status !== 0 && /BARE/i.test(st.raw);
    assert.ok(healed || alarmed, `bare=${bare} status=${st.status} raw=${st.raw}`);
    st.healed = healed;
  });

  scoped(/^git rev-parse --is-inside-work-tree reports true after a successful heal$/, (ctx) => {
    const st = ensure(ctx);
    if (st.healed) {
      const inside = execFileSync('git', ['-C', st.dir, 'rev-parse', '--is-inside-work-tree'], {
        encoding: 'utf8',
      }).trim();
      assert.equal(inside, 'true');
    }
    cleanup(ctx);
  });

  scoped(/^a fixture repo whose main tip already has a full file-count tree$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a candidate commit whose tree size is (.+)$/, (ctx, size) => {
    const st = ensure(ctx);
    const kind = size.trim();
    assert.ok(
      kind === 'below the safe floor' || kind === 'a full file-count',
      `unknown or mutated size prose: ${JSON.stringify(kind)}`
    );
    st.sizeKind = kind;
    if (kind === 'below the safe floor') {
      const tiny = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1123-tiny-'));
      sh(tiny, ['git', 'init', '-q']);
      sh(tiny, ['git', 'symbolic-ref', 'HEAD', 'refs/heads/main']);
      sh(tiny, ['git', 'config', 'user.email', 't@t']);
      sh(tiny, ['git', 'config', 'user.name', 't']);
      fs.writeFileSync(path.join(tiny, 'solo.txt'), 'x\n');
      sh(tiny, ['git', 'add', '.']);
      sh(tiny, ['git', 'commit', '-q', '-m', 'tiny']);
      st.candidateDir = tiny;
    } else {
      st.candidateDir = st.dir;
    }
  });

  scoped(/^the tip-floor guard evaluates moving main to that candidate$/, (ctx) => {
    const st = ensure(ctx);
    const script = `
(load-file "${LIB}")
(println (name (:verdict (master-checkout-integrity-lib/check-tip-floor!
  {:project-root "${st.candidateDir}" :candidate-rev "HEAD" :tip-floor ${st.floor}}))))
(println (master-checkout-integrity-lib/tree-file-count "${st.dir}" "HEAD"))
`;
    const r = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = r.stdout || '';
    const lines = st.raw.trim().split('\n');
    st.verdict = lines[0];
    st.headCount = Number(lines[1]);
  });

  scoped(/^the move is (.+)$/, (ctx, verdict) => {
    const st = ensure(ctx);
    const v = verdict.trim();
    if (v === 'refused or restored to the last full tip') {
      assert.equal(st.verdict, 'refused');
      return;
    }
    if (v === 'allowed') {
      assert.equal(st.verdict, 'allowed');
      return;
    }
    assert.fail(`unknown or mutated verdict prose: ${JSON.stringify(v)}`);
  });

  scoped(/^HEAD still lists at least the configured safe number of paths$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.headCount >= st.floor, `headCount=${st.headCount}`);
    if (st.candidateDir && st.candidateDir !== st.dir) {
      fs.rmSync(st.candidateDir, { recursive: true, force: true });
    }
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
