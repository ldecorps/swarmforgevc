'use strict';

// BL-1078 declared invariant 1 (property authorship rests with the coder,
// first pass - BL-654): "A Cursor seat reaches the swarm only through the same
// handoff helpers, mailbox and poke/wake path every other agent uses — never a
// private side channel."
//
// A negative invariant needs something to be negative ABOUT, and "no private
// side channel" cannot be checked by grepping for words nobody has written
// yet. So it is checked by DIFFERENCE: provision the same role twice, once on
// cursor and once on another agent, and require every line that touches a
// mailbox, a helper or the notify path to be identical. A channel of cursor's
// own shows up as a line the comparison seat does not have, whatever it is
// called.
//
// The comparison agent is swept rather than fixed at claude. Each of the
// terminal-native family (vibe, gemini, grok) generates a differently-shaped
// launch body, so a diff that only ever compared against claude could pass on
// an accident of claude's own shape.
//
// The roles are swept too, because a role's worktree and mailbox paths are
// interpolated into these lines: a seat that reached the RIGHT paths for
// documenter and the wrong ones for coder would satisfy a single-role check.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - the cursor launch body given a private drop directory
//     (`--add-dir '<root>/.swarmforge/handoffs/cursor-drop'`): RED, "the cursor
//     seat names a mailbox path no claude seat names". This break is the reason
//     the property has two comparisons rather than one: against the earlier
//     line-diff-only version it PASSED, because the private channel sat on the
//     agent's own command line, which that version excluded wholesale.
//   break 2 - the cursor provider entry's wake-style changed to :shell-run-
//     script (aider's): RED, "a cursor seat is woken by a style no other
//     chat-message seat uses".
//   break 3 - handoff-draft-path given a cursor-specific branch: RED, "a
//     cursor seat writes its draft somewhere of its own".
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const PROMPT_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'prompt_engine_lib.bb');

const ROLES = ['documenter', 'coder'];
// Every other terminal-native pane agent, plus claude. Each writes a
// differently-shaped launch body.
const COMPARISON_AGENTS = ['claude', 'vibe', 'gemini', 'grok'];

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function provision(role, agent) {
  const root = fs.realpathSync(mkTmpDir('bl1078-channels-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const r of ['specifier', 'coder', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${r}.prompt`), 'role prompt\n');
  }
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config active_backlog_max_depth -1\nwindow ${role} ${agent} ${role}\n`
  );
  const r = spawnSync(
    'zsh',
    [
      '-c',
      `source '${SWARMFORGE_SH}' '${root}'\nparse_config\n${INDEX_OF_ROLE}\n` +
        `write_role_launch_script "$(index_of_role ${role})"`,
    ],
    { encoding: 'utf8', env: { ...process.env, XDG_RUNTIME_DIR: '/tmp' }, timeout: 120000 }
  );
  assert.equal(r.status, 0, `provisioning ${role}/${agent} failed:\n${r.stdout}${r.stderr}`);
  const script = path.join(root, '.swarmforge', 'launch', `${role}.sh`);
  assert.ok(fs.existsSync(script), `no launch script for ${role}/${agent}`);
  return { root, text: fs.readFileSync(script, 'utf8') };
}

// Two comparisons, because the two halves of a launch script differ in what
// may legitimately vary.
//
// The agent's OWN invocation line differs between any two seats by
// construction - it is a different program with different flags - and every
// agent's launch body marks it by embedding ${RESUME_NOTE}. But a private side
// channel is MOST naturally added exactly there (an --add-dir, a flag, an
// env), so excluding the line wholesale would blind the property to the
// likeliest shape of the thing it forbids. Measured: an early version did
// exactly that and passed against a cursor seat handed
// `--add-dir '<root>/.swarmforge/handoffs/cursor-drop'`.
//
// So: MAILBOX paths are compared across the WHOLE script, agent line included
// - no seat may name a queue its neighbours do not. Everything else (helper
// names, notify wiring) is compared on the shared lines only, where prose
// differences between agents' first messages do not count.
const MAILBOX_PATTERN = /inbox|outbox|handoffs|in_process/;
const SHARED_CHANNEL_PATTERN = /swarm_handoff|ready_for_next|done_with_current|notify/;

const AGENT_COMMAND_MARKER = '${RESUME_NOTE}';

function normalize(line, root) {
  return line.split(root).join('<root>').trim();
}

// Every mailbox-shaped path token anywhere in the script.
function mailboxTokens(text, root) {
  return [
    ...new Set(
      normalize(text, root)
        .split(/[\s'"]+/)
        .filter((tok) => MAILBOX_PATTERN.test(tok))
    ),
  ].sort();
}

function sharedChannelLines(text, root, label) {
  const lines = text.split('\n');
  const agentCommands = lines.filter((line) => line.includes(AGENT_COMMAND_MARKER));
  assert.equal(
    agentCommands.length,
    1,
    `expected exactly one agent invocation line in ${label}, found ${agentCommands.length} - the exclusion below would be wrong`
  );
  return lines
    .filter((line) => !line.includes(AGENT_COMMAND_MARKER))
    .filter((line) => SHARED_CHANNEL_PATTERN.test(line) || MAILBOX_PATTERN.test(line))
    .map((line) => normalize(line, root))
    .sort();
}

test('BL-1078/BL-654 invariant 1: a cursor seat touches exactly the channels every other seat touches', () => {
  let compared = 0;
  for (const role of ROLES) {
    const cursor = provision(role, 'cursor');
    const cursorLines = sharedChannelLines(cursor.text, cursor.root, `${role}/cursor`);
    const cursorMailboxes = mailboxTokens(cursor.text, cursor.root);
    assert.ok(
      cursorLines.length > 0,
      `the cursor seat touches no channel at all, so this comparison proves nothing (${role})`
    );
    assert.ok(
      cursorMailboxes.length > 0,
      `the cursor seat names no mailbox path at all, so the token comparison proves nothing (${role})`
    );

    for (const agent of COMPARISON_AGENTS) {
      const other = provision(role, agent);
      assert.deepEqual(
        cursorLines,
        sharedChannelLines(other.text, other.root, `${role}/${agent}`),
        `the cursor seat carries a channel line no ${agent} seat has (${role})`
      );
      assert.deepEqual(
        cursorMailboxes,
        mailboxTokens(other.text, other.root),
        `the cursor seat names a mailbox path no ${agent} seat names (${role}) - a private channel on the agent's own command line is still a private channel`
      );
      compared += 1;
    }

    // And the difference that SHOULD exist does: the two scripts are not
    // simply identical, or the comparison above would be vacuous.
    const claude = provision(role, 'claude');
    assert.notEqual(
      cursor.text.split(cursor.root).join('<root>'),
      claude.text.split(claude.root).join('<root>'),
      `the cursor and claude launch scripts are identical, so the channel comparison proves nothing (${role})`
    );
    assert.match(cursor.text, /\bcursor-agent\b/, `the cursor seat does not start cursor-agent (${role})`);
  }

  assert.equal(
    compared,
    ROLES.length * COMPARISON_AGENTS.length,
    'every role/agent pair must be compared, or the sweep is narrower than it claims'
  );
});

test('BL-1078/BL-654 invariant 1: the wake path and the draft path are the shared ones', () => {
  const program = `
(require '[cheshire.core :as json])
(load-file "${PROMPT_LIB}")
(println (json/generate-string
          (into {} (for [a (sort prompt-engine-lib/supported-agents)]
                     [a {:wake (name (:wake-style (prompt-engine-lib/capabilities a)))
                         :draft (str (prompt-engine-lib/handoff-draft-path a))}]))))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const table = JSON.parse(res.stdout);

  assert.ok(table.cursor, 'the provider table has no cursor entry');

  // The draft path is the ONE path every agent writes - there is no
  // per-agent variant, and a cursor-specific one would be a side channel by
  // construction.
  const draftPaths = new Set(Object.values(table).map((e) => e.draft));
  assert.equal(
    draftPaths.size,
    1,
    `agents write their handoff drafts to ${draftPaths.size} different paths: ${[...draftPaths].join(', ')}`
  );

  // The wake style is shared with the other chat-message agents, not invented.
  const chatAgents = Object.keys(table).filter((a) => table[a].wake === 'chat-message');
  assert.ok(chatAgents.includes('cursor'), `cursor is woken by "${table.cursor.wake}", which no other seat uses`);
  assert.ok(
    chatAgents.length >= 4,
    `only ${chatAgents.length} agents share the chat-message wake, so "shared" is not established`
  );

  // The other direction: the table still distinguishes agents that genuinely
  // differ, so this is not passing because every entry is the same.
  assert.equal(table.aider.wake, 'shell-run-script', 'the table no longer distinguishes wake styles at all');
});
