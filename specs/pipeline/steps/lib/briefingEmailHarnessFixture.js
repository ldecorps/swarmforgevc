'use strict';

// BL-1419: the briefing_email_harness.bb driving boilerplate (a per-scenario
// temp briefings dir, writing one file into it, shelling to the harness and
// parsing its JSON result) was written out identically in
// briefingBodyHtmlSteps.js (BL-393) and bl1419BriefingEmailReflowSteps.js -
// factored out here at the cleaner stage (2026-09-05) so it is defined
// once. bl896BriefingOpenTicketChartSteps.js's own copy has a different
// signature (multi-file writes, variadic harness args) and predates this
// ticket - left alone, out of scope for a bounce-free NONE pass.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function ensureBriefingsDir(ctx, prefix) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }
  return ctx.briefingsDir;
}

function writeBriefing(briefingsDir, fileName, content) {
  fs.writeFileSync(path.join(briefingsDir, fileName), content);
}

function runHarness(harnessPath, briefingsDir, mode) {
  const out = execFileSync('bb', [harnessPath, briefingsDir, mode], { encoding: 'utf8' });
  return JSON.parse(out);
}

module.exports = { ensureBriefingsDir, writeBriefing, runHarness };
