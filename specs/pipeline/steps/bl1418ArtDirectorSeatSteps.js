'use strict';

// BL-1418: step handlers for "the Art Director is a real seat". Drives the
// REAL swarmforge.sh (parse_config/write_roles_file/prepare_worktrees),
// the REAL swarm_handoff.bb/ready_for_next.bb mailbox path, and the REAL
// prompt_engine_cli.bb composer against a fixture project root under
// mkdtemp - never the live checkout (BL-1390). Mirrors bl982SecondSeatSteps.js's
// own zshSource fixture convention for driving swarmforge.sh's functions
// directly without a full ./swarm launch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'BL-1418 The Art Director is a real seat: addressable by handoff, listed wherever roles are listed, and booted with its own prompt';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const SWARM_HANDOFF_BB = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
// BL-983's own step handler convention: ready_for_next.sh's shell wrapper
// `cd`s to the REAL scripts dir before exec-ing into ready_for_next_task.sh
// (so its OWN relative paths resolve regardless of the caller's cwd) -
// which breaks fixture-root testing, since git-root then resolves to
// THIS repo, not the fixture. ready_for_next_task.bb driven directly, with
// cwd set to the fixture worktree, is the equivalent and correct way to
// exercise the same claim logic against a fixture (specs/pipeline/steps/bl983StageQueueSteps.js
// does the same).
const READY_FOR_NEXT_TASK_BB = path.join(SCRIPTS_DIR, 'ready_for_next_task.bb');
const PROMPT_ENGINE_CLI = path.join(SCRIPTS_DIR, 'prompt_engine_cli.bb');
const TOPIC_ICON_TS = path.join(REPO_ROOT, 'extension', 'src', 'concierge', 'topicIcon.ts');

// The full-forge pack's own shape, minimal (a handful of roles, not all
// nine) - the fixture is about the Art Director's own seat mechanics, not
// re-testing every other role's staffing.
const FIXTURE_CONF = [
  'window specifier claude master --model claude-opus-5 --effort xhigh',
  'window coder claude coder --model claude-sonnet-5 --effort xhigh',
  'window art-director claude art-director --model claude-sonnet-5 --effort medium',
];

function mkRoot(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1418-art-director-'));
  ctx.roots = ctx.roots || [];
  ctx.roots.push(root);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'c\n');
  for (const r of ['coordinator', 'specifier', 'coder', 'art-director']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${r}.prompt`), `${r}\n`);
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), FIXTURE_CONF.join('\n') + '\n');
  return root;
}

function cleanup(ctx) {
  for (const r of ctx.roots || []) {
    fs.rmSync(r, { recursive: true, force: true });
  }
  ctx.roots = [];
}

function zshSource(root, shFile, body) {
  return spawnSync('zsh', ['-c', `source '${shFile}' '${root}'; ${body}`], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, XDG_RUNTIME_DIR: '/tmp', SWARMFORGE_CONFIG: '' },
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a swarm launched from the full-forge pack with the Art Director declared$/, (ctx) => {
    ctx.root = mkRoot(ctx);
    const res = zshSource(ctx.root, SWARMFORGE_SH, 'parse_config; prepare_workspace; prepare_worktrees');
    if (res.status !== 0) {
      throw new Error(`fixture swarm setup failed (status ${res.status}): ${res.stdout}\n${res.stderr}`);
    }
    ctx.rolesTsv = fs.readFileSync(path.join(root_state_dir(ctx.root), 'roles.tsv'), 'utf8');
  });

  function root_state_dir(root) {
    return path.join(root, '.swarmforge');
  }

  function rolesTsvRow(ctx, role) {
    return (ctx.rolesTsv || '')
      .split('\n')
      .map((l) => l.split('\t'))
      .find((cols) => cols[0] === role);
  }

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the specifier sends a note to art-director through swarm_handoff\.sh$/, (ctx) => {
    const draftPath = path.join(ctx.root, 'tmp-bl1418-handoff-draft.txt');
    fs.writeFileSync(draftPath, 'type: note\nto: art-director\npriority: 50\nmessage: hello\n');
    ctx.sendResult = spawnSync('bb', [SWARM_HANDOFF_BB, draftPath], {
      cwd: ctx.root,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'specifier' },
    });
  });

  scoped(/^the note lands in the art director's mailbox$/, (ctx) => {
    if (ctx.sendResult.status !== 0) {
      throw new Error(`swarm_handoff.bb failed: ${ctx.sendResult.stdout}\n${ctx.sendResult.stderr}`);
    }
    const row = rolesTsvRow(ctx, 'art-director');
    assert.ok(row, 'expected an art-director row in roles.tsv');
    const worktreePath = row[2];
    const inboxDir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'new');
    const files = fs.existsSync(inboxDir) ? fs.readdirSync(inboxDir) : [];
    ctx.mailboxFiles = files;
    assert.ok(files.length > 0, `expected a delivered handoff file under ${inboxDir}, got: ${JSON.stringify(files)}`);
  });

  scoped(/^ready_for_next\.sh run as art-director returns that note$/, (ctx) => {
    const row = rolesTsvRow(ctx, 'art-director');
    const worktreePath = row[2];
    const res = spawnSync('bb', [READY_FOR_NEXT_TASK_BB], {
      cwd: worktreePath,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'art-director' },
    });
    if (!/hello/.test(res.stdout || '')) {
      cleanup(ctx);
      throw new Error(`expected ready_for_next to return the delivered note, got stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    }
    cleanup(ctx);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  // prompt_engine_cli.bb compose takes no root argument - it is inherently
  // SCRIPT_DIR-relative and always reads THIS repo's own real
  // swarmforge/roles/art-director.prompt (already landed by the specifier
  // per the ticket's own notes), never a fixture copy. For "claude" (a
  // :generic bootstrap style, unlike aider's own path-naming sentence -
  // prompt_engine_lib.bb's generic-bootstrap-text) the role file's CONTENT
  // is inlined directly rather than its path being named in prose, so the
  // real proof is that the real file's own content reached the composed
  // output.
  scoped(/^the art director's pane boots$/, (ctx) => {
    const row = rolesTsvRow(ctx, 'art-director');
    assert.ok(row, 'expected an art-director row in roles.tsv');
    ctx.artDirectorWorktreePath = row[2];
    const composeResult = spawnSync('bb', [PROMPT_ENGINE_CLI, 'compose', 'claude', 'art-director'], {
      encoding: 'utf8',
    });
    if (composeResult.status !== 0) {
      throw new Error(`prompt_engine_cli.bb compose failed: ${composeResult.stdout}\n${composeResult.stderr}`);
    }
    ctx.composedPrompt = composeResult.stdout;
    ctx.realArtDirectorPromptContent = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'roles', 'art-director.prompt'), 'utf8');
  });

  scoped(/^it runs in \.worktrees\/art-director on its own branch$/, (ctx) => {
    const expectedPath = path.join(ctx.root, '.worktrees', 'art-director');
    assert.equal(ctx.artDirectorWorktreePath, expectedPath, `expected the worktree path to be ${expectedPath}`);
    assert.ok(fs.existsSync(path.join(expectedPath, '.git')), 'expected a real git worktree at that path');
    const branchResult = spawnSync('git', ['-C', expectedPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
    assert.equal(branchResult.stdout.trim(), 'primary/art-director', 'expected the worktree to sit on branch primary/art-director');
  });

  scoped(/^its boot prefix contains swarmforge\/roles\/art-director\.prompt$/, (ctx) => {
    // A distinguishing, non-boilerplate line from the real role prompt
    // file (its first non-blank heading line) - proves the ACTUAL file's
    // content, not merely some generic role-section text, was composed in.
    const distinguishingLine = ctx.realArtDirectorPromptContent
      .split('\n')
      .find((l) => l.trim().length > 10);
    assert.ok(distinguishingLine, 'expected the real art-director.prompt to have real content');
    try {
      assert.ok(
        ctx.composedPrompt.includes(distinguishingLine),
        `expected the composed prompt to include the real art-director.prompt's own content ("${distinguishingLine}"), got a prompt of length ${ctx.composedPrompt.length}`
      );
    } finally {
      cleanup(ctx);
    }
  });

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  const REGISTRY_CHECKS = {
    "the role-topic store's swarm roles": () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'src', 'concierge', 'roleTopicMapStore.ts'), 'utf8');
      return src.includes("'art-director'");
    },
    'the topic icon map': () => {
      const src = fs.readFileSync(TOPIC_ICON_TS, 'utf8');
      return /'art-director':\s*'[^']+'/.test(src);
    },
    "the model factory's swarm roles": () => {
      const src = fs.readFileSync(path.join(SCRIPTS_DIR, 'model_factory_lib.bb'), 'utf8');
      return /\(def swarm-roles \[[^\]]*"art-director"[^\]]*\]\)/.test(src);
    },
    '.swarmforge/roles.tsv': (ctx) => Boolean(rolesTsvRow(ctx, 'art-director')),
  };

  scoped(/^(.+) is read$/, (ctx, registry) => {
    ctx.registryChecked = registry;
  });

  scoped(/^it names art-director$/, (ctx) => {
    try {
      const check = REGISTRY_CHECKS[ctx.registryChecked];
      assert.ok(check, `unknown <registry>: ${ctx.registryChecked}`);
      assert.ok(check(ctx), `expected ${ctx.registryChecked} to name art-director`);
    } finally {
      cleanup(ctx);
    }
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the role topics are ensured$/, (ctx) => {
    const { ROLE_TOPIC_ICON } = require(path.join(REPO_ROOT, 'extension', 'out', 'concierge', 'topicIcon'));
    ctx.roleTopicIcon = ROLE_TOPIC_ICON;
  });

  scoped(/^a topic exists for art-director$/, (ctx) => {
    assert.ok(ctx.roleTopicIcon['art-director'], 'expected an art-director entry in ROLE_TOPIC_ICON');
  });

  scoped(/^its icon collides with no other role topic icon$/, (ctx) => {
    try {
      const icons = Object.entries(ctx.roleTopicIcon);
      const artIcon = ctx.roleTopicIcon['art-director'];
      const collisions = icons.filter(([role, icon]) => role !== 'art-director' && icon === artIcon);
      assert.deepEqual(collisions, [], `expected no other role to share art-director's icon (${artIcon}), got: ${JSON.stringify(collisions)}`);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps, cleanup };
