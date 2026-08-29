'use strict';

// BL-1194: the hygiene gate's duplicate-id check never counts the subject as
// another holder of its own id. Drives the REAL specifier_backlog_hygiene_gate.bb
// against fixture corpora via the same BACKLOG_HYGIENE_* seams BL-1105 uses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');
const FEATURE =
  "the hygiene gate's duplicate-id check never counts the subject as another holder of its own id";

const KNOWN_POOLS = new Set(['paused', 'active', 'hold', 'done']);

function writeTicket(dir, rel, id) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    [
      `id: ${id}`,
      'title: "fixture"',
      'type: feature',
      'epic: swarm-reliability',
      'milestone: M8',
      'priority: 1',
      '',
    ].join('\n')
  );
  return full;
}

function runGate(env, paths) {
  const result = spawnSync('bb', [GATE, ...paths], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function gateEnv(ctx) {
  const env = { BACKLOG_HYGIENE_ROOT: ctx.bl1194.root };
  if (ctx.bl1194.unreadablePublished) {
    env.BACKLOG_HYGIENE_PUBLISHED_UNREADABLE = '1';
  } else {
    env.BACKLOG_HYGIENE_PUBLISHED_ROOT = ctx.bl1194.published;
  }
  return env;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a backlog corpus the hygiene gate reads ticket ids from$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1194-backlog-'));
    const published = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1194-published-'));
    for (const pool of KNOWN_POOLS) {
      fs.mkdirSync(path.join(root, pool), { recursive: true });
      fs.mkdirSync(path.join(published, pool), { recursive: true });
    }
    ctx.bl1194 = { root, published, unreadablePublished: false };
  });

  // ── Givens ──────────────────────────────────────────────────────────
  scoped(/^the corpus does not contain "([^"]+)" locally$/, (ctx, id) => {
    // No local entry for this id — just a marker for the When step.
    ctx.bl1194.expectAbsentLocal = id;
  });

  scoped(/^the corpus already contains a ticket with id "([^"]+)" in "([^"]+)"$/, (ctx, id, pool) => {
    if (!KNOWN_POOLS.has(pool)) {
      throw new Error(`BL-1194: unrecognized pool "${pool}" — not in KNOWN_VALUES`);
    }
    const rel = path.join(pool, `${id}-existing-slug.yaml`);
    writeTicket(ctx.bl1194.root, rel, id);
    ctx.bl1194.existingRel = rel;
    ctx.bl1194.existingId = id;
  });

  scoped(
    /^the published corpus already contains that exact "([^"]+)" ticket file, unchanged$/,
    (ctx, id) => {
      // The same basename as the local existing file, written into the
      // published fixture — stands in for origin/main's prior copy of the
      // same ticket. The bug was that this entry was reported as "another
      // holder" instead of being recognized as the subject's own copy.
      const rel = ctx.bl1194.existingRel;
      const srcPath = path.join(ctx.bl1194.root, rel);
      const dstPath = path.join(ctx.bl1194.published, rel);
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  );

  scoped(/^the published corpus contains a different ticket file with id "([^"]+)"$/, (ctx, id) => {
    // A DIFFERENT file (different basename) under the same id in the
    // published fixture — must still be reported as a duplicate.
    writeTicket(ctx.bl1194.published, path.join('done', `${id}-published-different.yaml`), id);
  });

  // ── Whens ───────────────────────────────────────────────────────────
  scoped(
    /^the specifier runs the hygiene gate on a new ticket whose id is "([^"]+)" using a "([^"]+)" path$/,
    (ctx, id, pathForm) => {
      if (pathForm !== 'relative' && pathForm !== 'absolute') {
        throw new Error(`BL-1194: unrecognized path_form "${pathForm}" — not in KNOWN_VALUES`);
      }
      const rel = path.join('paused', `${id}-minted-now.yaml`);
      const absolutePath = writeTicket(ctx.bl1194.root, rel, id);
      // The gate is always invoked from the fixture root's parent so the
      // "relative" path resolves against a known cwd.
      const cwd = path.dirname(ctx.bl1194.root);
      const relativePath = path.relative(cwd, absolutePath);
      const subjectPath = pathForm === 'absolute' ? absolutePath : relativePath;
      const result = spawnSync('bb', [GATE, subjectPath], {
        encoding: 'utf8',
        cwd,
        env: { ...process.env, ...gateEnv(ctx) },
      });
      ctx.bl1194.result = {
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
      };
      ctx.bl1194.subject = absolutePath;
    }
  );

  scoped(
    /^the specifier runs the hygiene gate on the existing "([^"]+)" ticket using a "([^"]+)" path$/,
    (ctx, id, pathForm) => {
      if (pathForm !== 'relative' && pathForm !== 'absolute') {
        throw new Error(`BL-1194: unrecognized path_form "${pathForm}" — not in KNOWN_VALUES`);
      }
      const absolutePath = path.join(ctx.bl1194.root, ctx.bl1194.existingRel);
      const cwd = path.dirname(ctx.bl1194.root);
      const relativePath = path.relative(cwd, absolutePath);
      const subjectPath = pathForm === 'absolute' ? absolutePath : relativePath;
      const result = spawnSync('bb', [GATE, subjectPath], {
        encoding: 'utf8',
        cwd,
        env: { ...process.env, ...gateEnv(ctx) },
      });
      ctx.bl1194.result = {
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
      };
      ctx.bl1194.subject = absolutePath;
    }
  );

  // ── Thens ───────────────────────────────────────────────────────────
  scoped(/^the gate fails$/, (ctx) => {
    assert.notEqual(ctx.bl1194.result.status, 0, `expected failure:\n${ctx.bl1194.result.output}`);
  });

  scoped(/^the gate does not report a duplicate ticket id$/, (ctx) => {
    assert.ok(
      !/DUPLICATE-ID/.test(ctx.bl1194.result.output),
      `expected no DUPLICATE-ID report:\n${ctx.bl1194.result.output}`
    );
    // And the gate must pass (exit 0) when no other violations are in play.
    assert.equal(ctx.bl1194.result.status, 0, `expected exit 0:\n${ctx.bl1194.result.output}`);
  });

  scoped(/^the output reports a duplicate ticket id$/, (ctx) => {
    assert.match(ctx.bl1194.result.output, /DUPLICATE-ID/);
  });
}

module.exports = { registerSteps };
