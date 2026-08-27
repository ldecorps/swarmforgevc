'use strict';

// BL-317: step handlers for "A backlog ticket can declare its required
// role set, defaulting to the full chain". Drives the REAL
// routing_manifest_lib.bb pure functions via `bb -e` (load-file +
// println), the same pattern backlogDepthSteps.js uses for
// backlog_depth_lib.bb.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ROUTING_MANIFEST_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'routing_manifest_lib.bb');

const FULL_CHAIN = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function edn(content) {
  // bb's pr-str-quoted string literal: escape backslashes/quotes, keep
  // newlines literal inside the double-quoted EDN string (bb reads a
  // literal newline inside a string fine).
  return `"${content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function readRoles(content) {
  const out = execFileSync('bb', ['-e', `(load-file "${ROUTING_MANIFEST_LIB}") (println (routing-manifest-lib/read-roles ${edn(content)}))`], {
    encoding: 'utf8',
  }).trim();
  // bb prints an EDN vector like "[specifier coder cleaner ...]" - parse it
  // back into a plain JS array of role names (no quoting inside, role
  // names are bare tokens).
  return out.replace(/^\[|\]$/g, '').split(/\s+/).filter(Boolean);
}

// BL-317 bounce fix (scope 4b): validation now runs on the ticket's WHOLE
// raw content (validate-manifest), never a pre-parsed list - the one
// entry point that can actually tell "absent" from "present but
// unparseable" apart, which a list-only validator structurally cannot.
function validateManifest(content) {
  const out = execFileSync('bb', ['-e', `(load-file "${ROUTING_MANIFEST_LIB}") (let [r (routing-manifest-lib/validate-manifest ${edn(content)})] (println (:valid? r)) (println (:reason r)))`], {
    encoding: 'utf8',
  });
  const [validLine, ...reasonLines] = out.trim().split('\n');
  return { valid: validLine === 'true', reason: reasonLines.join('\n') };
}

function registerSteps(registry) {
  // ── routing-manifest-field-01 ───────────────────────────────────────────
  registry.define(/^a ticket YAML with no roles: field$/, (ctx) => {
    ctx.ticketYaml = 'id: BL-900\nstatus: todo\nsource: "x"\n';
  });

  registry.define(/^the routing manifest is read$/, (ctx) => {
    ctx.roles = readRoles(ctx.ticketYaml);
  });

  registry.define(/^it reports the full standard pipeline chain$/, (ctx) => {
    if (JSON.stringify(ctx.roles) !== JSON.stringify(FULL_CHAIN)) {
      throw new Error(`expected the full standard chain ${JSON.stringify(FULL_CHAIN)}, got ${JSON.stringify(ctx.roles)}`);
    }
  });

  // ── routing-manifest-field-02 ───────────────────────────────────────────
  registry.define(/^a ticket YAML declaring roles: \[coder, QA\]$/, (ctx) => {
    ctx.ticketYaml = 'id: BL-901\nroles: [coder, QA]\nstatus: todo\n';
    ctx.declaredRoles = ['coder', 'QA'];
  });

  registry.define(/^it reports exactly that list$/, (ctx) => {
    if (JSON.stringify(ctx.roles) !== JSON.stringify(ctx.declaredRoles)) {
      throw new Error(`expected exactly ${JSON.stringify(ctx.declaredRoles)}, got ${JSON.stringify(ctx.roles)}`);
    }
  });

  // ── routing-manifest-field-05: block-style lists ────────────────────────
  registry.define(/^a ticket YAML declaring a block-style roles: list of coder and QA$/, (ctx) => {
    ctx.ticketYaml = 'id: BL-902\nroles:\n  - coder\n  - QA\nstatus: todo\n';
    ctx.declaredRoles = ['coder', 'QA'];
  });

  // ── routing-manifest-field-06: present but unparseable ──────────────────
  registry.define(/^a ticket YAML whose roles: field is present but cannot be parsed$/, (ctx) => {
    // Neither a flow-style [...] value nor an immediately-following
    // block-style "- item" list - genuinely unparseable, not merely an
    // unusual-but-valid form.
    ctx.ticketYaml = 'id: BL-903\nroles: coder, QA\nstatus: todo\n';
  });

  registry.define(/^it does not silently report the full standard pipeline chain$/, (ctx) => {
    if (ctx.validation.valid) {
      throw new Error('expected the unparseable manifest to be rejected, not silently accepted as the full chain');
    }
    if (!/could not be parsed/.test(ctx.validation.reason)) {
      throw new Error(`expected a parse-failure reason distinct from a coder/QA/coordinator rejection, got: ${JSON.stringify(ctx.validation.reason)}`);
    }
  });

  // ── routing-manifest-field-03 ───────────────────────────────────────────
  registry.define(/^a ticket YAML declaring a roles: list that omits coder or QA$/, (ctx) => {
    ctx.ticketYaml = 'id: BL-904\nroles: [architect, QA]\nstatus: todo\n';
    ctx.declaredRoles = ['architect', 'QA'];
  });

  registry.define(/^the routing manifest is validated$/, (ctx) => {
    ctx.validation = validateManifest(ctx.ticketYaml);
  });

  registry.define(/^it is rejected before promotion$/, (ctx) => {
    if (ctx.validation.valid !== false) {
      throw new Error(`expected the manifest to be rejected, got: ${JSON.stringify(ctx.validation)}`);
    }
  });

  // ── routing-manifest-field-04 ───────────────────────────────────────────
  registry.define(/^a ticket YAML declaring a roles: list that names coordinator or an unknown role$/, (ctx) => {
    ctx.ticketYaml = 'id: BL-905\nroles: [coder, QA, coordinator]\nstatus: todo\n';
    ctx.declaredRoles = ['coder', 'QA', 'coordinator'];
  });
}

module.exports = { registerSteps };
