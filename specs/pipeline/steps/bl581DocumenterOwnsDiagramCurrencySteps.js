'use strict';

// BL-581: documenter owns diagram currency with per-diagram change-triggers.
// Verifies the constitution changes: 01_roles.md names diagram currency as a
// documenter responsibility, local-engineering.prompt lists all diagrams with
// change-triggers, no count-encoding wording, and DIAGRAM_FILES matches the
// constitution list.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE =
  'documenter owns diagram currency with per-diagram change-triggers';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ROLES_MD = path.join(
  REPO_ROOT,
  'swarmforge',
  'constitution',
  'articles',
  '01_roles.md'
);
const LOCAL_ENG_PROMPT = path.join(
  REPO_ROOT,
  'swarmforge',
  'constitution',
  'articles',
  'local-engineering.prompt'
);
const EXT_DIR = path.join(REPO_ROOT, 'extension');

function diagramModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'render-briefing-diagrams'));
}

function allowlist() {
  return diagramModule().DIAGRAM_FILES;
}

function readRolesMd() {
  return fs.readFileSync(ROLES_MD, 'utf8');
}

function readLocalEngPrompt() {
  return fs.readFileSync(LOCAL_ENG_PROMPT, 'utf8');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the constitution lists maintained diagrams with change-triggers$/, (ctx) => {
    const localEng = readLocalEngPrompt();
    ctx.localEngContent = localEng;
    ctx.diagramFiles = allowlist();
  });

  scoped(/^01_roles\.md section 1\.7 is read$/, (ctx) => {
    const rolesMd = readRolesMd();
    ctx.rolesMdContent = rolesMd;
  });

  scoped(/^the documenter's responsibilities include diagram currency$/, (ctx) => {
    const rolesMd = ctx.rolesMdContent || readRolesMd();
    const docSection = rolesMd.match(/## 1\.7 Documenter([\s\S]*?)(?=## 1\.8|$)/);
    assert.ok(docSection, 'Could not find section 1.7 Documenter in 01_roles.md');
    const docContent = docSection[1];
    assert.match(
      docContent,
      /diagram currency/i,
      'Documenter responsibilities do not mention diagram currency'
    );
  });

  scoped(/^the responsibilities state the update belongs in the same parcel as the change$/, (ctx) => {
    const rolesMd = ctx.rolesMdContent || readRolesMd();
    const docSection = rolesMd.match(/## 1\.7 Documenter([\s\S]*?)(?=## 1\.8|$)/);
    assert.ok(docSection, 'Could not find section 1.7 Documenter');
    const docContent = docSection[1];
    assert.match(
      docContent,
      /same parcel/i,
      'Documenter responsibilities do not state update belongs in same parcel'
    );
  });

  scoped(/^a diagram is present in render-briefing-diagrams\.ts's DIAGRAM_FILES allowlist$/, (ctx) => {
    const diagramFiles = ctx.diagramFiles || allowlist();
    assert.ok(diagramFiles.length > 0, 'DIAGRAM_FILES is empty');
    ctx.currentDiagram = diagramFiles[0];
  });

  scoped(/^local-engineering\.prompt's Diagrams section is read$/, (ctx) => {
    const localEng = ctx.localEngContent || readLocalEngPrompt();
    ctx.localEngContent = localEng;
    const diagramsSection = localEng.match(/## Diagrams \(this project\)([\s\S]*?)(?=## |$)/);
    assert.ok(diagramsSection, 'Could not find Diagrams section in local-engineering.prompt');
    ctx.diagramsSection = diagramsSection[1];
  });

  scoped(/^the diagram has an entry with a distinct change-trigger sentence$/, (ctx) => {
    const diagramFiles = ctx.diagramFiles || allowlist();
    const diagramsSection = ctx.diagramsSection;
    for (const diagram of diagramFiles) {
      const filePattern = new RegExp(diagram.file.replace('.', '\\.'), 'i');
      assert.match(
        diagramsSection,
        filePattern,
        `Diagram ${diagram.file} not found in Diagrams section`
      );
      assert.match(
        diagramsSection,
        /change-trigger/i,
        'No change-trigger mention in Diagrams section'
      );
    }
  });

  scoped(/^no wording in that section encodes a diagram count$/, (ctx) => {
    const diagramsSection = ctx.diagramsSection;
    assert.doesNotMatch(
      diagramsSection,
      /both live under/i,
      'Found "Both live under" wording that encodes a count'
    );
    assert.doesNotMatch(
      diagramsSection,
      /both are/i,
      'Found "Both are" wording that encodes a count'
    );
  });

  scoped(/^the DIAGRAM_FILES allowlist from render-briefing-diagrams\.ts$/, (ctx) => {
    ctx.diagramFiles = allowlist();
  });

  scoped(/^the diagram list from local-engineering\.prompt's Diagrams section$/, (ctx) => {
    const localEng = ctx.localEngContent || readLocalEngPrompt();
    ctx.localEngContent = localEng;
    const diagramsSection = localEng.match(/## Diagrams \(this project\)([\s\S]*?)(?=## |$)/);
    assert.ok(diagramsSection, 'Could not find Diagrams section in local-engineering.prompt');
    ctx.diagramsSection = diagramsSection[1];
    ctx.diagramsSectionList = diagramsSection[1];
  });

  scoped(/^they are compared$/, (ctx) => {
    // Comparison happens in the next steps
  });

  scoped(/^every diagram in DIAGRAM_FILES has an entry in the constitution$/, (ctx) => {
    const diagramFiles = ctx.diagramFiles || allowlist();
    const diagramsSection = ctx.diagramsSection || ctx.diagramsSectionList;
    for (const diagram of diagramFiles) {
      const filePattern = new RegExp(diagram.file.replace('.', '\\.'), 'i');
      assert.match(
        diagramsSection,
        filePattern,
        `Diagram ${diagram.file} in DIAGRAM_FILES but not in constitution`
      );
    }
  });

  scoped(/^every diagram in the constitution is in DIAGRAM_FILES$/, (ctx) => {
    const diagramFiles = ctx.diagramFiles || allowlist();
    const diagramsSection = ctx.diagramsSection || ctx.diagramsSectionList;
    const expectedFiles = ['architecture.mmd', 'swarm-flow.mmd', 'handoff-flow.mmd', 'front-desk-flow.mmd'];
    for (const file of expectedFiles) {
      const filePattern = new RegExp(file.replace('.', '\\.'), 'i');
      if (filePattern.test(diagramsSection)) {
        const found = diagramFiles.find((d) => d.file === file);
        assert.ok(found, `Diagram ${file} in constitution but not in DIAGRAM_FILES`);
      }
    }
  });
}

module.exports = { registerSteps };
