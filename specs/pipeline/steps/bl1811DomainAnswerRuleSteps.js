'use strict';

// BL-1811: step handlers for "IO-near code calls the module that owns a
// domain answer" - read-only checks against the four prose files the
// specifier landed at mint (Article 5.3/BL-798: prose is the specifier's
// to write, never a coder's). This handler pins the wording, it does not
// author it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'BL-1811 IO-near code calls the module that owns a domain answer';

const FILES = {
  engineering: path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'engineering.prompt'),
  engineeringDetailed: path.join(
    REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'reference', 'engineering-detailed.prompt'
  ),
  architect: path.join(REPO_ROOT, 'swarmforge', 'roles', 'architect.prompt'),
  cleaner: path.join(REPO_ROOT, 'swarmforge', 'roles', 'cleaner.prompt'),
};

const ROLE_PROMPT = new Map([
  ['architect', FILES.architect],
  ['cleaner', FILES.cleaner],
]);

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

// Extracts the text of a `## <heading>` section (up to the next `## `
// heading or end of file) - never the whole file, so a scenario naming a
// specific section only matches a literal actually inside it.
function readSection(text, headingPrefix) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (startIdx === -1) {
    throw new Error(`bl1811: no heading starting with "${headingPrefix}" found`);
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the shared engineering article is read$/, (ctx) => {
    ctx.engineeringText = readFile(FILES.engineering);
    ctx.engineeringDetailedText = readFile(FILES.engineeringDetailed);
  });

  scoped(/^its Design And Testability section contains "([^"]+)"$/, (ctx, literal) => {
    const section = readSection(ctx.engineeringText, '## Design And Testability');
    assert.ok(
      section.includes(literal),
      `expected the Design And Testability section to contain "${literal}", got:\n${section}`
    );
  });

  scoped(/^the detailed engineering reference contains "([^"]+)" and names "([^"]+)"$/, (ctx, literal, ticket) => {
    assert.ok(
      ctx.engineeringDetailedText.includes(literal),
      `expected engineering-detailed.prompt to contain "${literal}"`
    );
    assert.ok(
      ctx.engineeringDetailedText.includes(ticket),
      `expected engineering-detailed.prompt to name "${ticket}"`
    );
  });

  scoped(/^the (\S+) role prompt is read$/, (ctx, role) => {
    const filePath = ROLE_PROMPT.get(role);
    assert.ok(filePath, `bl1811: unrecognized role "${role}"`);
    ctx.role = role;
    ctx.rolePromptText = readFile(filePath);
  });

  scoped(/^it names "([^"]+)" and upstream commit "([^"]+)"$/, (ctx, ticket, commit) => {
    assert.ok(
      ctx.rolePromptText.includes(ticket),
      `expected the ${ctx.role} role prompt to name "${ticket}"`
    );
    assert.ok(
      ctx.rolePromptText.includes(commit),
      `expected the ${ctx.role} role prompt to name upstream commit "${commit}"`
    );
  });

  scoped(/^the Mutation-Site Size section of the cleaner role prompt is read$/, (ctx) => {
    const text = readFile(FILES.cleaner);
    ctx.mutationSiteSection = readSection(text, '## Mutation-Site Size');
  });

  scoped(/^it contains "([^"]+)" and names upstream commit "([^"]+)"$/, (ctx, literal, commit) => {
    assert.ok(
      ctx.mutationSiteSection.includes(literal),
      `expected the Mutation-Site Size section to contain "${literal}", got:\n${ctx.mutationSiteSection}`
    );
    assert.ok(
      ctx.mutationSiteSection.includes(commit),
      `expected the Mutation-Site Size section to name upstream commit "${commit}", got:\n${ctx.mutationSiteSection}`
    );
  });
}

module.exports = { registerSteps, readSection };
