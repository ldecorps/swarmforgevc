'use strict';

// BL-668: post-QA deterministic branch sweep — drives post_qa_branch_sweep_cli.bb
// (real lib, injected role facts, fake fast-forward adapter — no real git).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'test', 'post_qa_branch_sweep_cli.bb');

const PIPELINE_ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter'];

function mkDaemonDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl668-'));
}

function baseFacts(landedSha, headSha) {
  const facts = {};
  for (const role of PIPELINE_ROLES) {
    facts[role] = {
      headSha,
      dirty: false,
      inProcess: false,
      canFf: true,
    };
  }
  return facts;
}

function toFactsMap(raw) {
  const out = {};
  for (const [role, f] of Object.entries(raw)) {
    out[role] = {
      'head-sha': f.headSha,
      'dirty?': f.dirty,
      'in-process?': f.inProcess,
      'can-ff?': f.canFf,
      // BL-1433: every fixture here describes a HEAD that lacks the landed
      // commit unless it explicitly says otherwise - absence must never
      // be read as containment (invariant 3 is about an UNREADABLE fact,
      // not an absent fixture key).
      'contains-landed?': Boolean(f.containsLanded),
    };
  }
  return out;
}

function runSweep(ctx) {
  const roles = ctx.roles || PIPELINE_ROLES;
  const facts = toFactsMap(ctx.roleFacts || baseFacts(ctx.landedSha, ctx.baseHeadSha || 'base1'));
  const out = execFileSync(
    'bb',
    [CLI, ctx.daemonDir, ctx.landedSha, JSON.stringify(roles), JSON.stringify(facts)],
    { encoding: 'utf8' }
  );
  ctx.result = JSON.parse(out.trim());
}

function registerSteps(registry) {
  registry.define(/^a fixture repo with five pipeline role branches registered in roles\.tsv$/, (ctx) => {
    ctx.daemonDir = mkDaemonDir();
    ctx.roles = [...PIPELINE_ROLES];
    ctx.landedSha = 'landedsha1';
    ctx.baseHeadSha = 'basehead1';
    ctx.roleFacts = baseFacts(ctx.landedSha, ctx.baseHeadSha);
  });

  registry.define(/^QA has landed an approved commit on main$/, (ctx) => {
    if (!ctx.landedSha) {
      ctx.landedSha = 'landedsha1';
    }
  });

  registry.define(/^three role worktrees are clean and their branches can fast-forward to the landed commit$/, (ctx) => {
    for (const role of ['coder', 'cleaner', 'architect']) {
      ctx.roleFacts[role] = { headSha: 'behind1', dirty: false, inProcess: false, canFf: true };
    }
  });

  registry.define(/^one role worktree is dirty$/, (ctx) => {
    ctx.roleFacts.hardender = { headSha: 'behind2', dirty: true, inProcess: false, canFf: true };
  });

  registry.define(/^one role branch is genuinely divergent from the landed commit$/, (ctx) => {
    ctx.roleFacts.documenter = { headSha: 'diverge1', dirty: false, inProcess: false, canFf: false };
  });

  registry.define(/^one role worktree is dirty and one role branch cannot fast-forward$/, (ctx) => {
    ctx.roleFacts = {
      coder: { headSha: 'behind1', dirty: true, inProcess: false, canFf: true },
      cleaner: { headSha: 'diverge1', dirty: false, inProcess: false, canFf: false },
    };
    ctx.roles = ['coder', 'cleaner'];
  });

  registry.define(/^a role worktree is clean and fast-forwardable$/, (ctx) => {
    ctx.roles = ['coder'];
    ctx.roleFacts = {
      coder: { headSha: 'behind1', dirty: false, inProcess: false, canFf: true },
    };
  });

  registry.define(/^that role's inbox in_process holds a parcel$/, (ctx) => {
    ctx.roleFacts.coder.inProcess = true;
  });

  registry.define(/^any mix of clean dirty divergent or in_process role states$/, (ctx) => {
    ctx.roleFacts = {
      coder: { headSha: 'behind1', dirty: false, inProcess: false, canFf: true },
      cleaner: { headSha: 'behind2', dirty: true, inProcess: false, canFf: true },
      architect: { headSha: 'diverge1', dirty: false, inProcess: false, canFf: false },
      hardender: { headSha: 'behind3', dirty: false, inProcess: true, canFf: true },
    };
    ctx.roles = ['coder', 'cleaner', 'architect', 'hardender'];
  });

  registry.define(/^the post-QA deterministic branch sweep has already settled every clean branch$/, (ctx) => {
    for (const role of ['coder', 'cleaner', 'architect']) {
      ctx.roleFacts[role] = { headSha: 'behind1', dirty: false, inProcess: false, canFf: true };
    }
    ctx.roleFacts.hardender = { headSha: 'behind2', dirty: true, inProcess: false, canFf: true };
    ctx.roleFacts.documenter = { headSha: 'diverge1', dirty: false, inProcess: false, canFf: false };
    runSweep(ctx);
    ctx.firstResult = ctx.result;
    ctx.firstSettleCalls = ctx.result.settleCalls;
  });

  registry.define(/^the post-QA deterministic branch sweep runs$/, (ctx) => {
    runSweep(ctx);
  });

  registry.define(/^the post-QA deterministic branch sweep runs again$/, (ctx) => {
    runSweep(ctx);
  });

  registry.define(/^exactly those three clean branches fast-forward to the landed commit$/, (ctx) => {
    const settled = (ctx.result.actions || []).filter((a) => a.type === 'settled');
    if (settled.length !== 3) {
      throw new Error(`expected 3 settled branches, got ${JSON.stringify(ctx.result)}`);
    }
    const names = settled.map((a) => a.role).sort();
    const expected = ['coder', 'cleaner', 'architect'].sort();
    if (names.join(',') !== expected.join(',')) {
      throw new Error(`expected ${expected.join(',')} settled, got ${names.join(',')}`);
    }
    if (ctx.result.settleCalls !== 3) {
      throw new Error(`expected 3 ff settle calls, got ${ctx.result.settleCalls}`);
    }
  });

  registry.define(/^the dirty and divergent roles are not touched by the sweep$/, (ctx) => {
    const touched = (ctx.result.actions || []).filter((a) => a.role === 'hardender' || a.role === 'documenter');
    const settled = touched.filter((a) => a.type === 'settled');
    if (settled.length !== 0) {
      throw new Error(`expected dirty/divergent roles not settled: ${JSON.stringify(touched)}`);
    }
  });

  registry.define(/^the audit trail logs two surfaced skips naming each role and its skip reason$/, (ctx) => {
    const surfaced = (ctx.result.actions || []).filter((a) => a.type === 'surfaced');
    if (surfaced.length !== 2) {
      throw new Error(`expected 2 surfaced skips, got ${JSON.stringify(ctx.result)}`);
    }
    const byRole = Object.fromEntries(surfaced.map((a) => [a.role, a.reason]));
    if (byRole.coder !== 'dirty-worktree') {
      throw new Error(`expected coder dirty skip, got ${JSON.stringify(byRole)}`);
    }
    if (byRole.cleaner !== 'divergent-branch') {
      throw new Error(`expected cleaner divergent skip, got ${JSON.stringify(byRole)}`);
    }
    const log = (ctx.result.logLines || []).join('\n');
    if (!/post-qa-branch-sweep-surfaced/.test(log)) {
      throw new Error(`expected surfaced lines in audit log: ${log}`);
    }
  });

  registry.define(/^the merge-up story remains reconstructable from the log$/, (ctx) => {
    const log = (ctx.result.logLines || []).join('\n');
    if (!/dirty worktree/.test(log) || !/cannot fast-forward/.test(log)) {
      throw new Error(`log missing reconstructable reasons: ${log}`);
    }
  });

  registry.define(/^that role branch is not fast-forwarded$/, (ctx) => {
    const settled = (ctx.result.actions || []).filter((a) => a.type === 'settled');
    if (settled.length !== 0 || ctx.result.settleCalls !== 0) {
      throw new Error(`expected no settle, got ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the skip reason names in_process work$/, (ctx) => {
    const surfaced = (ctx.result.actions || []).find((a) => a.type === 'surfaced');
    if (!surfaced || surfaced.reason !== 'in-process-work') {
      throw new Error(`expected in-process-work skip, got ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the sweep performs only fast-forward updates on branches it settles$/, (ctx) => {
    if (!ctx.result.ffOnly) {
      throw new Error('expected sweep to use fast-forward only');
    }
  });

  registry.define(/^it never merges rebases stashes or hard-resets any worktree$/, (ctx) => {
    if (!ctx.result.ffOnly) {
      throw new Error('expected no merge/rebase/stash/reset operations');
    }
  });

  registry.define(/^no branch moves and no duplicate settle records are written$/, (ctx) => {
    if ((ctx.result.actions || []).length !== 0) {
      throw new Error(`expected rerun noop actions, got ${JSON.stringify(ctx.result.actions)}`);
    }
    if (ctx.result.settleCalls !== 0) {
      throw new Error(`expected no additional settle calls on rerun, got ${ctx.result.settleCalls}`);
    }
  });

  registry.define(/^surfaced skip reasons from the first run remain the authoritative story$/, (ctx) => {
    const firstSurfaced = (ctx.firstResult.state.surfaced || []).length;
    const secondSurfaced = (ctx.result.state.surfaced || []).length;
    if (secondSurfaced !== firstSurfaced) {
      throw new Error(`expected surfaced story preserved: first=${firstSurfaced} second=${secondSurfaced}`);
    }
  });
}

module.exports = { registerSteps };
