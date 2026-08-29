'use strict';

// BL-1276: step handlers for "a ticket's own declared acceptance contract is
// not another ticket's work". Drives the REAL swarm_handoff.bb end to end
// through specs/pipeline/steps/lib/bl1276AcceptanceExemptionCli.sh, which
// mirrors BL-1192's own fixture conventions - this ticket changes one
// predicate inside the gate that driver already exercises, so an acceptance or
// refusal observed here is the actual send path.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "A ticket's own declared acceptance contract is not another ticket's work";

const CLI = path.join(__dirname, 'lib', 'bl1276AcceptanceExemptionCli.sh');

// The Examples table writes the two shapes in prose; the fixture needs paths.
const DECLARED_ALIASES = {
  'no acceptance contract': 'NONE',
};

function runGate(taskTicket, declared, changedPath, ticketMode) {
  const out = execFileSync(
    'bash',
    [CLI, taskTicket, DECLARED_ALIASES[declared] || declared, changedPath, ticketMode],
    { encoding: 'utf8', timeout: 120000 }
  );
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a swarm repository whose roles send parcels with swarm_handoff\.sh$/, (ctx) => {
    ctx.bl1276 = { ticketMode: 'landed' };
  });

  scoped(/^the landed ticket "([^"]+)" declares its acceptance contract as (.+)$/, (ctx, ticket, declared) => {
    ctx.bl1276.taskTicket = ticket;
    ctx.bl1276.declared = declared.trim();
  });

  scoped(
    /^the sender's uncommitted working copy of that ticket declares (.+) instead$/,
    (ctx, workingCopyDeclares) => {
      // The fixture rewrites the working copy to declare the CHANGED path, so
      // a gate reading the working tree would wrongly exempt it. Recorded here
      // as the mode; the driver applies it after the cited commit exists.
      ctx.bl1276.ticketMode = 'working-copy';
      ctx.bl1276.workingCopyDeclares = workingCopyDeclares.trim();
    }
  );

  scoped(/^the ticket "([^"]+)" cannot be resolved on any landed ref or in the working tree$/, (ctx, ticket) => {
    ctx.bl1276.taskTicket = ticket;
    ctx.bl1276.declared = 'NONE';
    ctx.bl1276.ticketMode = 'unresolvable';
  });

  scoped(/^a commit tagged for that task whose own diff changes (.+)$/, (ctx, changedPath) => {
    ctx.bl1276.changedPath = changedPath.trim();
  });

  scoped(/^the coder sends a git_handoff for task ticket "([^"]+)" citing that commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1276;
    st.taskTicket = taskTicket;
    st.result = runGate(taskTicket, st.declared, st.changedPath, st.ticketMode);
  });

  scoped(/^the send is (refused|accepted)$/, (ctx, outcome) => {
    const { result, declared, changedPath, ticketMode } = ctx.bl1276;
    const context = `declared=${declared} changed=${changedPath} mode=${ticketMode} stderr=${result.stderr}`;
    if (outcome === 'accepted') {
      assert.equal(result.delivered, true, `expected the send to be delivered; ${context}`);
      assert.equal(result.exitCode, 0, `expected exit 0; ${context}`);
      return;
    }
    assert.equal(result.delivered, false, `expected the send to be refused; ${context}`);
    assert.notEqual(result.exitCode, 0, `expected a non-zero exit; ${context}`);
  });

  scoped(/^the refusal records that the acceptance-contract exemption could not be evaluated$/, (ctx) => {
    const { result } = ctx.bl1276;
    assert.match(
      result.stderr,
      /acceptance-contract exemption could not be evaluated/,
      `the refusal did not say the exemption was unevaluable, so its recipient is sent to rebuild for the wrong reason:\n${result.stderr}`
    );
  });
}

module.exports = { registerSteps };
