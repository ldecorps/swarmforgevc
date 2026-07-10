'use strict';

// BL-237: step handlers for the docs-Windows-claim-fix feature. Reads the
// REAL docs/Milestone Roadmap.MD and docs/Specification.MD and
// swarmforge/constitution/articles/local-engineering.prompt straight off
// disk (repo-relative to this file) - a plain content/grep check, no
// compiled module involved (this is a documentation-only ticket).
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ROADMAP_PATH = path.join(REPO_ROOT, 'docs', 'Milestone Roadmap.MD');
const SPEC_PATH = path.join(REPO_ROOT, 'docs', 'Specification.MD');
const LOCAL_ENGINEERING_PATH = path.join(
  REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'local-engineering.prompt'
);

function readDoc(docPath) {
  return fs.readFileSync(docPath, 'utf8');
}

function registerSteps(registry) {
  registry.define(/^the product docs Milestone Roadmap\.MD and Specification\.MD$/, (ctx) => {
    ctx.roadmap = readDoc(ROADMAP_PATH);
    ctx.spec = readDoc(SPEC_PATH);
  });

  // ── no-windows-first-class-01 ─────────────────────────────────────────
  registry.define(/^the sections describing target platforms and why the extension is built as it is$/, () => {
    // Nothing to fixture - the Background already loaded the real docs.
  });

  registry.define(/^those sections are read$/, () => {
    // Nothing further to do here; the Then steps below inspect ctx.roadmap/ctx.spec directly.
  });

  registry.define(
    /^they do not claim native Windows support is first-class or the reason for owning orchestration$/,
    (ctx) => {
      const combined = ctx.roadmap + '\n' + ctx.spec;
      if (/windows is first-class/i.test(combined)) {
        throw new Error('expected no remaining "Windows is first-class" claim');
      }
      if (/native windows[^.]*(?:is|now)[^.]*first-class/i.test(combined)) {
        throw new Error('expected no remaining claim that native Windows is first-class');
      }
      if (/owns? orchestration (?:rather than|instead of) (?:depending on|being tmux-based)/i.test(combined)) {
        throw new Error('expected no remaining "owns orchestration because of Windows" rationale');
      }
      if (/driving constraint is native windows/i.test(combined)) {
        throw new Error('expected the "driving constraint is native Windows" claim to be gone');
      }
    }
  );

  // ── macos-linux-only-02 ───────────────────────────────────────────────
  registry.define(/^the sections stating supported platforms$/, () => {
    // Nothing to fixture - the Background already loaded the real docs.
  });

  registry.define(/^they state macOS and Linux only, with tmux as the process substrate$/, (ctx) => {
    if (!/macos\/linux only|macos and linux only/i.test(ctx.roadmap)) {
      throw new Error('expected Milestone Roadmap.MD to state macOS/Linux only');
    }
    if (!/macos and linux only/i.test(ctx.spec)) {
      throw new Error('expected Specification.MD to state macOS and Linux only');
    }
    if (!/tmux[^.]*process substrate/i.test(ctx.roadmap) || !/tmux[^.]*process substrate/i.test(ctx.spec)) {
      throw new Error('expected both docs to name tmux as the process substrate');
    }
  });

  // ── aligns-constitution-03 ────────────────────────────────────────────
  registry.define(
    /^local-engineering\.prompt states macOS\/Linux only and BL-091 rules native Windows out of scope$/,
    (ctx) => {
      ctx.localEngineering = readDoc(LOCAL_ENGINEERING_PATH);
      if (!/target os: macos and linux only/i.test(ctx.localEngineering)) {
        throw new Error('expected local-engineering.prompt to state "Target OS: macOS and Linux only" (has it moved?)');
      }
    }
  );

  registry.define(/^the corrected docs are compared against them$/, () => {
    // Nothing further to do - the Then step below does the comparison.
  });

  registry.define(/^no Windows-native contradiction remains between the docs and the constitution$/, (ctx) => {
    const combined = ctx.roadmap + '\n' + ctx.spec;
    if (/windows is first-class/i.test(combined) || /driving constraint is native windows/i.test(combined)) {
      throw new Error('a Windows-native contradiction still exists between the docs and local-engineering.prompt');
    }
    if (!/wsl2/i.test(combined)) {
      throw new Error('expected the docs to name WSL2 as the actual Windows-hosted path, matching BL-091');
    }
  });
}

module.exports = { registerSteps };
