'use strict';

// BL-663: step handlers for "promote_and_route enforces every promotion gate
// at one chokepoint". Drives the REAL promote_and_route_next.sh and
// route_backlog_to_coder.sh (and, transitively, the real promotion_gates_cli.bb
// / promotion_gates_lib.bb chokepoint) against a real fixture git repo - same
// "drive the real script against a real fixture repo" pattern as
// bl760DuplicateChainGuardSteps.js and readyForNextPromotionSteps.js.
//
// Deliberately does NOT stub out route_backlog_to_coder.sh the way
// test_promote_and_route_next_priority.sh does for its own (unrelated)
// priority-ordering assertion: this feature's own acceptance is ABOUT
// route_backlog_to_coder.sh's real routing decision, so scenarios 2/7 must
// exercise the genuine script. The fixture has no live tmux socket, so
// delivery ends "queued" (outbox) rather than "delivered" (inbox/new) and
// the two route scripts can legitimately exit non-zero on that unrelated
// delivery-verification tail - assertions below check filesystem state and
// output text, never the whole script's exit code, for the "promoted"
// scenarios (mirrors bl760's own "tolerate any non-2 exit as sent" posture).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMOTE_SCRIPT = path.join(SCRIPTS_DIR, 'promote_and_route_next.sh');
const ROUTE_SCRIPT = path.join(SCRIPTS_DIR, 'route_backlog_to_coder.sh');

const FEATURE_NAME = 'promote_and_route enforces every promotion gate at one chokepoint';
const TICKET_ID = 'BL-9663';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Never {...process.env} - an explicit allowlist, never leak this box's own
// broader environment into a spawned bash/bb subprocess (same posture as
// bl760DuplicateChainGuardSteps.js's processEnvAllowlist).
function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function writeConf(ctx, cap) {
  mkdirp(path.join(ctx.root, 'swarmforge'));
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

function writeRoles(ctx) {
  const coderDir = path.join(ctx.root, 'coder');
  mkdirp(coderDir);
  const rows = [
    `coder\tcoder-wt\t${coderDir}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `specifier\tmaster\t${ctx.root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
  ];
  mkdirp(path.join(ctx.root, '.swarmforge'));
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

function initRoot(ctx) {
  if (ctx.root) {
    return;
  }
  ctx.root = mkTmp('bl663-promotion-gates-');
  ctx.locations = {};
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['config', 'user.email', 't@t']);
  git(ctx.root, ['config', 'user.name', 't']);
  git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  writeConf(ctx, 5);
  writeRoles(ctx);
}

function ticketYaml(id, fields) {
  const lines = [`id: ${id}`, `title: "fixture ${id}"`];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeTicket(ctx, id, location, fields) {
  const dir = path.join(ctx.root, 'backlog', location);
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), ticketYaml(id, fields));
  ctx.locations[id] = location;
}

function commitAll(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['commit', '-q', '-m', message]);
}

function findYamlStartingWith(dir, prefix) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  const match = fs.readdirSync(dir).find((name) => name.startsWith(`${prefix}-`) && name.endsWith('.yaml'));
  return match ? path.join(dir, match) : null;
}

function activeFile(ctx, id) {
  return findYamlStartingWith(path.join(ctx.root, 'backlog', 'active'), id);
}

function originalFile(ctx, id) {
  return findYamlStartingWith(path.join(ctx.root, 'backlog', ctx.locations[id]), id);
}

function assertPromoted(ctx, id) {
  if (!activeFile(ctx, id)) {
    throw new Error(`expected ${id} to be promoted into backlog/active/, but it is not there. output:\n${combinedOutput(ctx.result)}`);
  }
  if (ctx.locations[id] !== 'active' && originalFile(ctx, id)) {
    throw new Error(`expected ${id} to have moved out of backlog/${ctx.locations[id]}/, but a copy is still there`);
  }
}

function assertNotPromoted(ctx, id) {
  if (activeFile(ctx, id)) {
    throw new Error(`expected ${id} NOT to be promoted, but found it in backlog/active/. output:\n${combinedOutput(ctx.result)}`);
  }
  if (!originalFile(ctx, id)) {
    throw new Error(`expected ${id} to remain in backlog/${ctx.locations[id]}/, but it is gone. output:\n${combinedOutput(ctx.result)}`);
  }
}

function currentTicketContent(ctx, id) {
  const found = activeFile(ctx, id) || originalFile(ctx, id);
  if (!found) {
    throw new Error(`could not locate ${id} anywhere under backlog/ to inspect its content`);
  }
  return fs.readFileSync(found, 'utf8');
}

function runScript(ctx, scriptPath, args) {
  const res = spawnSync('bash', [scriptPath, ...args], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: processEnvAllowlist(),
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function registerSteps(registry) {
  // ── Given: a candidate ticket in backlog/paused/ ────────────────────────

  registry.defineScoped(/^a paused ticket whose human_approval is (pending|approved)$/, (ctx, value) => {
    initRoot(ctx);
    ctx.ticketId = TICKET_ID;
    writeTicket(ctx, TICKET_ID, 'paused', {
      type: 'feature',
      priority: 50,
      epic: 'bl663-fixture-epic',
      human_approval: value,
    });
    commitAll(ctx, `seed human_approval:${value} fixture`);
  }, FEATURE_NAME);

  registry.defineScoped(/^a paused ticket whose assigned_to is specifier$/, (ctx) => {
    initRoot(ctx);
    ctx.ticketId = TICKET_ID;
    writeTicket(ctx, TICKET_ID, 'paused', {
      type: 'feature',
      priority: 50,
      epic: 'bl663-spec-route-epic',
      human_approval: 'approved',
      assigned_to: 'specifier',
    });
    commitAll(ctx, 'seed assigned_to:specifier fixture');
  }, FEATURE_NAME);

  // Documentary no-ops (BL-663 scenario 05): the fixture ticket already
  // satisfies these by construction - no assigned_to override (defaults to
  // the correct coder routing), the sole paused candidate (trivially
  // "correctly-laned" under Article 3.2.4), and a roomy cap with no active
  // occupant (no depth/orthogonality/hold violation possible). Same
  // "documentary no-op step" precedent as bl760's own "no other role holds a
  // live parcel for BL-901".
  registry.defineScoped(/^its assigned_to correctly reflects the spec-stage-first routing$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^it is the correctly-laned next candidate under Article 3\.2\.4$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^it violates no depth, orthogonality, or hold gate$/, () => {}, FEATURE_NAME);

  registry.defineScoped(/^a paused defect ticket with severity high$/, (ctx) => {
    initRoot(ctx);
    ctx.defectId = 'BL-9663';
    writeTicket(ctx, ctx.defectId, 'paused', {
      type: 'defect',
      severity: 'high',
      priority: 80,
      epic: 'bl663-defect-epic',
      human_approval: 'approved',
    });
  }, FEATURE_NAME);

  registry.defineScoped(/^a paused feature ticket with a numerically better priority sits alongside it$/, (ctx) => {
    ctx.featureId = 'BL-9664';
    writeTicket(ctx, ctx.featureId, 'paused', {
      type: 'feature',
      priority: 5,
      epic: 'bl663-feature-epic',
      human_approval: 'approved',
    });
    commitAll(ctx, 'seed expedite-lane fixtures');
  }, FEATURE_NAME);

  registry.defineScoped(/^a paused ticket blocked by the (.+) gate$/, (ctx, gate) => {
    initRoot(ctx);
    ctx.ticketId = TICKET_ID;
    if (gate === 'active_backlog_max_depth') {
      writeConf(ctx, 1);
      writeTicket(ctx, 'BL-9670', 'active', { type: 'feature', priority: 1, epic: 'bl663-occupant-epic' });
      writeTicket(ctx, TICKET_ID, 'paused', {
        type: 'feature',
        priority: 50,
        epic: 'bl663-depth-candidate-epic',
        human_approval: 'approved',
      });
    } else if (gate === 'orthogonality') {
      writeTicket(ctx, 'BL-9671', 'active', { type: 'feature', priority: 1, epic: 'bl663-collide-epic' });
      writeTicket(ctx, TICKET_ID, 'paused', {
        type: 'feature',
        priority: 50,
        epic: 'bl663-collide-epic',
        human_approval: 'approved',
      });
    } else if (gate === 'hold marker') {
      // promote_and_route_next.sh requires backlog/paused/ to exist at all
      // (its own leading sanity check), even for a by-name lookup that
      // resolves entirely out of backlog/hold/ - an empty paused/ is the
      // faithful fixture for "nothing eligible is waiting, only a held
      // ticket exists".
      mkdirp(path.join(ctx.root, 'backlog', 'paused'));
      writeTicket(ctx, TICKET_ID, 'hold', {
        type: 'feature',
        priority: 50,
        epic: 'bl663-held-epic',
        human_approval: 'approved',
      });
    } else {
      throw new Error(`unknown gate fixture requested: "${gate}"`);
    }
    commitAll(ctx, `seed ${gate} fixture`);
  }, FEATURE_NAME);

  registry.defineScoped(/^an active ticket whose assigned_to is specifier$/, (ctx) => {
    initRoot(ctx);
    ctx.ticketId = TICKET_ID;
    writeTicket(ctx, TICKET_ID, 'active', {
      type: 'feature',
      priority: 50,
      epic: 'bl663-standalone-route-epic',
      human_approval: 'approved',
      assigned_to: 'specifier',
    });
    commitAll(ctx, 'seed active assigned_to:specifier fixture');
  }, FEATURE_NAME);

  // ── When ─────────────────────────────────────────────────────────────

  registry.defineScoped(/^promote_and_route evaluates it as a promotion candidate$/, (ctx) => {
    ctx.result = runScript(ctx, PROMOTE_SCRIPT, [ctx.ticketId, ctx.root]);
  }, FEATURE_NAME);

  registry.defineScoped(/^promote_and_route promotes and routes it$/, (ctx) => {
    ctx.result = runScript(ctx, PROMOTE_SCRIPT, [ctx.ticketId, ctx.root]);
  }, FEATURE_NAME);

  registry.defineScoped(/^promote_and_route selects the next candidate$/, (ctx) => {
    ctx.result = runScript(ctx, PROMOTE_SCRIPT, [ctx.root]);
  }, FEATURE_NAME);

  registry.defineScoped(/^promote_and_route is asked to promote that ticket by name$/, (ctx) => {
    ctx.result = runScript(ctx, PROMOTE_SCRIPT, [ctx.ticketId, ctx.root]);
  }, FEATURE_NAME);

  registry.defineScoped(/^the routing step is invoked on its own, outside a promotion$/, (ctx) => {
    ctx.result = runScript(ctx, ROUTE_SCRIPT, [ctx.ticketId, ctx.root]);
  }, FEATURE_NAME);

  // ── Then ─────────────────────────────────────────────────────────────

  registry.defineScoped(/^the ticket is not promoted$/, (ctx) => {
    assertNotPromoted(ctx, ctx.ticketId);
  }, FEATURE_NAME);

  registry.defineScoped(/^the refusal names the (.+) gate as the reason$/, (ctx, gate) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(gate)) {
      throw new Error(`expected the refusal to name the "${gate}" gate, got:\n${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the ticket is routed to the specifier$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/Routing[^\n]*\bspecifier\b/.test(out)) {
      throw new Error(`expected a "Routing ... specifier" line, got:\n${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(
    /^assigned_to is not silently rewritten to coder as a side effect of the (?:promote commit|routing step)$/,
    (ctx) => {
      const content = currentTicketContent(ctx, ctx.ticketId);
      if (/^assigned_to:\s*coder\s*$/m.test(content)) {
        throw new Error(`expected assigned_to to remain "specifier", but it reads "coder". content:\n${content}`);
      }
      if (!/^assigned_to:\s*specifier\s*$/m.test(content)) {
        throw new Error(`expected assigned_to: specifier to still be present. content:\n${content}`);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(/^the expedited defect is promoted$/, (ctx) => {
    assertPromoted(ctx, ctx.defectId);
  }, FEATURE_NAME);

  registry.defineScoped(/^the feature ticket is not promoted ahead of it$/, (ctx) => {
    assertNotPromoted(ctx, ctx.featureId);
  }, FEATURE_NAME);

  registry.defineScoped(/^the ticket is promoted and routed exactly as today$/, (ctx) => {
    assertPromoted(ctx, ctx.ticketId);
    const content = currentTicketContent(ctx, ctx.ticketId);
    if (!/^assigned_to:\s*coder\s*$/m.test(content)) {
      throw new Error(`expected assigned_to: coder (unchanged default routing). content:\n${content}`);
    }
    const out = combinedOutput(ctx.result);
    if (!/Routing[^\n]*\bcoder\b/.test(out)) {
      throw new Error(`expected a "Routing ... coder" line, got:\n${out}`);
    }
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
