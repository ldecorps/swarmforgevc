'use strict';

// BL-1078: step handlers for "a pack window line naming cursor staffs a real
// seat".
//
// Every scenario drives the REAL launcher (swarmforge/scripts/swarmforge.sh)
// or the REAL provider table, never a JS restatement of either. The launcher
// is zsh and is sourced the way this repo's own launcher tests source it
// (test_alternate_runtime_launch.sh, test_swarmforge_pack_export.sh): source
// it against a fixture root, run parse_config, then call the one function
// under test. That is what makes "the token is accepted" a fact about the
// allow-list that actually runs rather than about a copy of it.
//
// The four wiring places this slice touches are deliberately exercised
// separately, because the defect being fixed is precisely that a token can be
// known in one of them and unknown in the others while every check reads
// green: the allow-list (01), the dependency check (02), the provider table
// (03) and the launch-command builder (04).
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const PROMPT_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'prompt_engine_lib.bb');
const GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'cursor_seat_guard_lib.bb');
const GUARD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'cursor_seat_guard.bb');

const FIXTURE_PREFIX = 'bl1078-launcher-';

// BL-421: every Examples column value resolves through an explicit lookup, so
// a gherkin-mutator edit into an unrecognised value fails the scenario rather
// than slipping into an else branch.
const KNOWN_AGENTS = {
  cursor: { verdict: 'accepted', binary: 'cursor-agent' },
  claude: { verdict: 'accepted', binary: 'claude' },
  cursorly: { verdict: 'refused' },
};
const KNOWN_VERDICTS = new Set(['accepted', 'refused']);
const KNOWN_ROLES = new Set(['documenter', 'coder']);
const KNOWN_ESCAPES = { unset: false, set: true };
const KNOWN_SEAT_VERDICTS = { refused: false, admitted: true };
const KNOWN_STATED_REASONS = {
  'the escape that would admit it': 'escape',
  'that the identity is uncertified': 'uncertified',
};

// The zsh snippet the repo's own launcher tests use to find a role's index.
const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function sweepStale() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

// The same fixture shape test_alternate_runtime_launch.sh's mk_root builds.
function makeRoot(ctx, windowLines) {
  sweepStale();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of ['specifier', 'coder', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    ['config active_backlog_max_depth -1', ...windowLines].join('\n') + '\n'
  );
  ctx.root = root;
  return root;
}

function zsh(script, env = {}) {
  return spawnSync('zsh', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, XDG_RUNTIME_DIR: '/tmp', ...env },
    timeout: 120000,
  });
}

function bbJson(program) {
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(res.status, 0, `the Babashka side failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function registerSteps(registry) {
  const FEATURE = 'a pack window line naming cursor staffs a real seat';
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Given, shared by 01/02/04/06 ──────────────────────────────────────
  define(/^a pack window line naming role (\S+) with agent (\S+)$/, (ctx, role, agent) => {
    assert.ok(
      KNOWN_ROLES.has(role) || role === 'documenter',
      `unknown role "${role}" - known: ${[...KNOWN_ROLES].join(', ')}`
    );
    ctx.role = role;
    ctx.agent = agent;
    ctx.known = KNOWN_AGENTS[agent];
    // 01's refused row names an agent no table knows, deliberately; the other
    // scenarios all use a token that must be known.
    // The third column is the role's BRANCH. `master` binds the role to the
    // master checkout (Article 1: coordinator and specifier live there), so a
    // role named with `master` has role_worktree == WORKING_DIR and scenario
    // 04's own-worktree assertion would be checking the wrong directory.
    // documenter and coder each get their own.
    ctx.windowLine = `window ${role} ${agent} ${role}`;
  });

  // ── cursor-agent-token-accepted-by-the-launcher-01 ────────────────────
  define(/^the launcher validates that line's agent$/, (ctx) => {
    // validate_agent is the ONE allow-list - the launcher's own comment says
    // the coordinator's agent check funnels through it rather than a second
    // case statement. Extracted and run on its own so a refusal's `exit 1`
    // does not take the harness with it.
    const fn = fs
      .readFileSync(SWARMFORGE_SH, 'utf8')
      .match(/^validate_agent\(\) \{[\s\S]*?^\}$/m);
    assert.ok(fn, 'validate_agent could not be located in the launcher');
    assert.ok(
      /error_msg "Unsupported agent/.test(fn[0]),
      'the extracted function is not the allow-list - it names no refusal'
    );
    const r = zsh(
      `error_msg() { echo "$*" >&2; }\n${fn[0]}\nvalidate_agent '${ctx.agent}' '${ctx.role}'`
    );
    ctx.exitCode = r.status;
    ctx.output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  });

  define(/^the agent token is (\S+)$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown verdict "${verdict}"`);
    assert.equal(ctx.known?.verdict, verdict, `the Examples row for "${ctx.agent}" is not the ${verdict} case`);
    if (verdict === 'accepted') {
      assert.equal(ctx.exitCode, 0, `the launcher refused "${ctx.agent}":\n${ctx.output}`);
    } else {
      assert.notEqual(ctx.exitCode, 0, `the launcher accepted "${ctx.agent}":\n${ctx.output}`);
      // The token was widened, not the check loosened (qa_e2e step 5).
      assert.match(ctx.output, /Unsupported agent/, ctx.output);
    }
  });

  // ── cursor-agent-token-accepted-by-the-launcher-02 ────────────────────
  define(/^the launcher checks that pack's backend dependencies$/, (ctx) => {
    makeRoot(ctx, [ctx.windowLine]);
    // check_dependency is replaced by a recorder, so the REAL
    // check_backend_dependencies case statement decides WHICH binary is
    // checked while nothing is required to exist on this host.
    const r = zsh(
      `source '${SWARMFORGE_SH}' '${ctx.root}'\n` +
        `parse_config\n` +
        `check_dependency() { echo "DEP:$1"; }\n` +
        `check_backend_dependencies`
    );
    assert.equal(r.status, 0, `the dependency check failed:\n${r.stdout}${r.stderr}`);
    ctx.deps = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('DEP:')).map((l) => l.slice(4));
  });

  define(/^the cursor agent binary is among the dependencies checked$/, (ctx) => {
    assert.ok(ctx.deps.length > 0, 'no dependency was checked at all, so this proves nothing');
    assert.ok(
      ctx.deps.includes('cursor-agent'),
      `the cursor binary is not checked; checked: ${ctx.deps.join(', ')}`
    );
    // The TOKEN is not the BINARY. Checking `cursor` would look like a
    // dependency check while verifying nothing.
    assert.ok(!ctx.deps.includes('cursor'), 'the launcher checks the agent token instead of the real binary');
  });

  define(/^a host without that binary is refused before any window is opened$/, (ctx) => {
    // The REAL check_dependency, with the binary genuinely absent: a bin dir
    // that has everything except cursor-agent is not needed here, because
    // check_dependency resolves by name through `command -v` and a PATH of
    // one empty directory removes every candidate at once.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
    const r = zsh(
      `source '${SWARMFORGE_SH}' '${ctx.root}'\n` +
        `parse_config\n` +
        `PATH='${empty}'\n` +
        `check_backend_dependencies`
    );
    assert.notEqual(r.status, 0, 'a host with no cursor-agent was not refused');
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.match(out, /cursor-agent/, `the refusal must name the missing binary:\n${out}`);
    // Before any window: the check runs in the launcher's preflight, so no
    // launch script has been written.
    assert.deepEqual(
      fs.readdirSync(path.join(ctx.root, '.swarmforge', 'launch')),
      [],
      'a window was provisioned despite the missing dependency'
    );
  });

  // ── cursor-agent-token-accepted-by-the-launcher-03 ────────────────────
  define(/^the agent-runtime provider table$/, (ctx) => {
    ctx.table = bbJson(`
(require '[cheshire.core :as json])
(load-file "${PROMPT_LIB}")
(println (json/generate-string
          {:agents (vec (sort (keys prompt-engine-lib/provider-capabilities)))
           :supported (vec (sort prompt-engine-lib/supported-agents))
           :cursorWake (some-> (:wake-style (get prompt-engine-lib/provider-capabilities "cursor")) name)
           :normalized (prompt-engine-lib/normalize-agent "cursor")
           :unknownNormalized (prompt-engine-lib/normalize-agent "cursorly")
           :capabilitiesForCursor (some-> (prompt-engine-lib/capabilities "cursor") keys vec (->> (mapv name)))}))`);
  });

  define(/^the wake style for agent cursor is resolved$/, (ctx) => {
    assert.ok(ctx.table, 'the provider table was never read');
    ctx.wake = ctx.table.cursorWake;
  });

  define(/^it comes from a provider entry declared for cursor$/, (ctx) => {
    assert.ok(
      ctx.table.agents.includes('cursor'),
      `the provider table has no cursor entry; it knows: ${ctx.table.agents.join(', ')}`
    );
    assert.ok(ctx.wake, 'the cursor entry declares no wake style');
    assert.ok(
      ctx.table.capabilitiesForCursor.includes('wake-style'),
      `the cursor entry carries no wake-style key: ${ctx.table.capabilitiesForCursor.join(', ')}`
    );
  });

  define(/^agent cursor is not normalised to the unknown-agent fallback$/, (ctx) => {
    assert.equal(
      ctx.table.normalized,
      'cursor',
      `normalize-agent turned cursor into "${ctx.table.normalized}" - a cursor seat would be woken with the wrong wake style while every check read green`
    );
    assert.ok(ctx.table.supported.includes('cursor'), 'cursor is absent from supported-agents');
    // The fallback still exists and still catches a genuinely unknown token,
    // so this asserts a widened table rather than a removed guard.
    assert.equal(
      ctx.table.unknownNormalized,
      'claude',
      'the unknown-agent fallback was removed rather than the table widened'
    );
  });

  // ── cursor-agent-token-accepted-by-the-launcher-04 ────────────────────
  define(/^the launcher builds that seat's launch command$/, (ctx) => {
    assert.ok(KNOWN_ROLES.has(ctx.role), `unknown role "${ctx.role}"`);
    makeRoot(ctx, [ctx.windowLine]);
    // write_agent_instruction_file is what composes a role's bundle (through
    // prompt_engine_cli.bb); write_role_launch_script only NAMES it. Both are
    // run, so "carries that role's composed prompt bundle" is a file that
    // exists and holds this role's prompt rather than a path in a string.
    const r = zsh(
      `source '${SWARMFORGE_SH}' '${ctx.root}'\n` +
        `parse_config\n${INDEX_OF_ROLE}\n` +
        `i="$(index_of_role ${ctx.role})"\n` +
        `write_agent_instruction_file "${ctx.role}" "$PROMPTS_DIR/${ctx.role}.md" ` +
        `"\${AGENTS[$i]}" "" "\${STAGES[$i]}"\n` +
        `write_role_launch_script "$i"`
    );
    assert.equal(r.status, 0, `writing the launch script failed:\n${r.stdout}${r.stderr}`);
    ctx.launchScript = path.join(ctx.root, '.swarmforge', 'launch', `${ctx.role}.sh`);
    assert.ok(fs.existsSync(ctx.launchScript), `no launch script was written for ${ctx.role}`);
    ctx.launchText = fs.readFileSync(ctx.launchScript, 'utf8');
  });

  define(/^the command starts the cursor agent in that role's worktree$/, (ctx) => {
    assert.match(ctx.launchText, /\bcursor-agent\b/, ctx.launchText);
    assert.match(
      ctx.launchText,
      new RegExp(`--workspace '[^']*\\.worktrees/${ctx.role}'`),
      `the seat is not started in ${ctx.role}'s own worktree:\n${ctx.launchText}`
    );
    // --workspace, never -w/--worktree: cursor-agent's --worktree creates its
    // OWN worktree under ~/.cursor/worktrees, fighting the one SwarmForge
    // provisioned. One letter away in the flag name, and silent.
    assert.ok(
      !/(^|\s)(-w|--worktree)(\s|$)/.test(ctx.launchText),
      `the launch body uses cursor-agent's own --worktree, which fights the provisioned one:\n${ctx.launchText}`
    );
  });

  define(/^it carries that role's composed prompt bundle$/, (ctx) => {
    assert.match(
      ctx.launchText,
      new RegExp(`prompts/${ctx.role}\\.md`),
      `the launch body carries no prompt bundle for ${ctx.role}:\n${ctx.launchText}`
    );
    const bundle = path.join(ctx.root, '.swarmforge', 'prompts', `${ctx.role}.md`);
    assert.ok(fs.existsSync(bundle), `the bundle it names was never composed: ${bundle}`);
    assert.ok(fs.readFileSync(bundle, 'utf8').length > 0, 'the composed bundle is empty');
  });

  // ── cursor-agent-token-accepted-by-the-launcher-05 ────────────────────
  define(/^a cursor seat provisioned by the launcher$/, (ctx) => {
    ctx.role = 'documenter';
    ctx.windowLine = 'window documenter cursor documenter';
    makeRoot(ctx, [ctx.windowLine]);
    const r = zsh(
      `source '${SWARMFORGE_SH}' '${ctx.root}'\n` +
        `parse_config\n${INDEX_OF_ROLE}\n` +
        `write_role_launch_script "$(index_of_role documenter)"`
    );
    assert.equal(r.status, 0, `provisioning failed:\n${r.stdout}${r.stderr}`);
    ctx.launchText = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'launch', 'documenter.sh'), 'utf8');
  });

  define(/^the channels it uses to take work and to hand work on are enumerated$/, (ctx) => {
    ctx.channels = bbJson(`
(require '[cheshire.core :as json])
(load-file "${PROMPT_LIB}")
(println (json/generate-string
          {:wakeStyle (name (:wake-style (prompt-engine-lib/capabilities "cursor")))
           :claudeWakeStyle (name (:wake-style (prompt-engine-lib/capabilities "claude")))
           :draftPath (str (prompt-engine-lib/handoff-draft-path "cursor"))
           :claudeDraftPath (str (prompt-engine-lib/handoff-draft-path "claude"))}))`);
  });

  define(/^its wake is delivered by the shared agent-runtime notify path$/, (ctx) => {
    // Same wake style the shared notify path already drives for every other
    // chat-message agent - not a cursor-specific delivery.
    assert.equal(ctx.channels.wakeStyle, 'chat-message');
    assert.equal(
      ctx.channels.wakeStyle,
      ctx.channels.claudeWakeStyle,
      'a cursor seat is woken by a style no other seat uses'
    );
  });

  define(/^its handoff draft path is the path every other agent writes$/, (ctx) => {
    assert.equal(
      ctx.channels.draftPath,
      ctx.channels.claudeDraftPath,
      `a cursor seat writes its draft somewhere of its own: ${ctx.channels.draftPath}`
    );
  });

  define(/^no enumerated channel reaches the swarm outside the mailbox$/, (ctx) => {
    // Compared against a CLAUDE seat's script rather than pattern-matched for
    // forbidden words. Every generated launch script carries the shared
    // RESUME-ON-START preamble (BL-323), which reads this role's own
    // inbox/in_process - that IS the mailbox, and forbidding the word would
    // forbid the shared machinery every agent uses.
    //
    // What the invariant actually forbids is a channel of cursor's OWN. So:
    // generate the same role on claude, take every mailbox-touching line from
    // each, and require the sets to be identical. A cursor-specific side
    // channel shows up as a line the claude seat does not have.
    const claudeRoot = makeRoot({}, [`window ${ctx.role} claude ${ctx.role}`]);
    const r = zsh(
      `source '${SWARMFORGE_SH}' '${claudeRoot}'\n` +
        `parse_config\n${INDEX_OF_ROLE}\n` +
        `write_role_launch_script "$(index_of_role ${ctx.role})"`
    );
    assert.equal(r.status, 0, `the claude comparison seat failed to provision:\n${r.stdout}${r.stderr}`);
    const claudeText = fs.readFileSync(
      path.join(claudeRoot, '.swarmforge', 'launch', `${ctx.role}.sh`),
      'utf8'
    );

    const mailboxLines = (text, root) =>
      text
        .split('\n')
        .filter((line) => /inbox|handoffs|outbox|in_process/.test(line))
        .map((line) => line.split(root).join('<root>').trim())
        .sort();

    const cursorLines = mailboxLines(ctx.launchText, ctx.root);
    const claudeLines = mailboxLines(claudeText, claudeRoot);
    assert.ok(cursorLines.length > 0, 'neither seat touches a mailbox at all, so this comparison proves nothing');
    assert.deepEqual(
      cursorLines,
      claudeLines,
      'the cursor seat carries a mailbox channel no other seat has'
    );

    assert.ok(
      !ctx.channels.draftPath.includes('inbox'),
      `the draft path points into a mailbox: ${ctx.channels.draftPath}`
    );
  });

  // ── cursor-agent-token-accepted-by-the-launcher-06 ────────────────────
  define(/^the cursor identity is not certified in the model steward registry$/, (ctx) => {
    makeRoot(ctx, [ctx.windowLine]);
    // Assert the premise rather than assume it: a registry that happened to
    // certify this identity would make both rows vacuous.
    const status = bbJson(`
(require '[cheshire.core :as json])
(load-file "${GUARD_LIB}")
(println (json/generate-string
          {:status (cursor-seat-guard-lib/identity-status nil "cursor" "auto")}))`);
    assert.equal(status.status, 'unknown', 'the fixture identity is not uncertified');
  });

  define(/^the uncertified-cursor escape is (\S+)$/, (ctx, label) => {
    const set = KNOWN_ESCAPES[label];
    assert.notEqual(set, undefined, `unknown escape state "${label}"`);
    ctx.escapeSet = set;
  });

  define(/^the launcher provisions that seat$/, (ctx) => {
    const escapeName = bbJson(`
(require '[cheshire.core :as json])
(load-file "${GUARD_LIB}")
(println (json/generate-string {:env cursor-seat-guard-lib/escape-env
                                :value cursor-seat-guard-lib/escape-value}))`);
    ctx.escapeEnv = escapeName.env;
    const env = ctx.escapeSet ? { [escapeName.env]: escapeName.value } : {};
    const r = spawnSync('bb', [GUARD_CLI, 'check', ctx.root, ctx.role, ''], {
      encoding: 'utf8',
      env: { ...process.env, [escapeName.env]: '', ...env },
    });
    ctx.exitCode = r.status;
    ctx.output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  });

  define(/^the seat is (\S+)$/, (ctx, label) => {
    const admitted = KNOWN_SEAT_VERDICTS[label];
    assert.notEqual(admitted, undefined, `unknown seat verdict "${label}"`);
    if (admitted) {
      assert.equal(ctx.exitCode, 0, `the seat was refused with the escape set:\n${ctx.output}`);
    } else {
      assert.notEqual(ctx.exitCode, 0, `an uncertified seat was admitted with no escape:\n${ctx.output}`);
    }
  });

  define(/^the launcher states (.+)$/, (ctx, label) => {
    const kind = KNOWN_STATED_REASONS[label.trim()];
    assert.ok(kind, `unknown stated reason "${label}" - known: ${Object.keys(KNOWN_STATED_REASONS).join(' | ')}`);
    if (kind === 'escape') {
      assert.ok(
        ctx.output.includes(ctx.escapeEnv),
        `the refusal must name the escape that would admit it:\n${ctx.output}`
      );
    } else {
      assert.match(ctx.output, /UNCERTIFIED/, `the run must be told the identity is uncertified:\n${ctx.output}`);
    }
  });
}

module.exports = { registerSteps };
