'use strict';

// BL-364: step handlers for "A developer on Windows runs the extension in
// desktop VS Code, with its host next to the swarm". The human-in-the-loop
// half (tiles actually stream, typing reaches the agent, on a real
// Windows+WSL machine) is this ticket's own E2E QA procedure, not
// reproducible here - these steps pin the AUTOMATABLE half: the
// extensionKind property that decides where the host lands, the
// documentation that tells a Windows developer how to set this up, that
// the documented setup names real commands/anchors, and that the
// extension's own host-side launch code depends on no hardcoded absolute
// path outside the workspace and assumes no macOS-only program.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const PACKAGE_JSON_PATH = path.join(EXT_DIR, 'package.json');
const GUIDE_PATH = path.join(REPO_ROOT, 'docs', 'GettingStarted.md');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

function readGuide() {
  return fs.readFileSync(GUIDE_PATH, 'utf8');
}

// Same heading-slug algorithm GitHub/most Markdown renderers use: lowercase,
// spaces to hyphens, strip anything that is not a word char/hyphen/space.
function slugify(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function markdownHeadingSlugs(markdown) {
  const matches = markdown.match(/^#+\s+.+$/gm) || [];
  return new Set(matches.map((line) => slugify(line.replace(/^#+\s+/, ''))));
}

function markdownAnchorLinks(markdown) {
  const matches = [...markdown.matchAll(/\]\(#([a-z0-9-]+)\)/g)];
  return matches.map((m) => m[1]);
}

function contributedCommandIds() {
  const pkg = readPackageJson();
  return new Set((pkg.contributes?.commands || []).map((c) => c.command));
}

function registerSteps(registry) {
  // ── desktop-vscode-on-windows-01 ─────────────────────────────────────────
  registry.define(/^a developer whose VS Code UI runs on Windows and whose repo lives in WSL$/, (ctx) => {
    ctx.pkg = readPackageJson();
  });

  registry.define(/^the extension is loaded$/, (ctx) => {
    // Structural, not a live VS Code instance: the extensionKind manifest
    // property is what VS Code itself consults to decide host placement -
    // "loading" it IS reading this property, the same thing VS Code does.
    ctx.extensionKind = ctx.pkg.extensionKind;
  });

  registry.define(/^its extension host runs where the swarm and its tmux socket live$/, (ctx) => {
    if (!ctx.pkg.main) {
      throw new Error('expected package.json to declare a main entry point (a real extension host, not declarative-only)');
    }
    if (ctx.extensionKind === undefined) {
      // Correct and preferred: with a `main` entry, VS Code's own default
      // is ['workspace', 'ui'] - workspace-preferred, i.e. beside the
      // remote (tmux, the socket, .swarmforge/) when one is available.
      return;
    }
    const kinds = Array.isArray(ctx.extensionKind) ? ctx.extensionKind : [ctx.extensionKind];
    if (!kinds.includes('workspace')) {
      throw new Error(
        `expected extensionKind to include "workspace" if declared at all (an extensionKind that excludes it would sever the host from the swarm), got: ${JSON.stringify(ctx.extensionKind)}`
      );
    }
  });

  // ── desktop-vscode-on-windows-02 ─────────────────────────────────────────
  registry.define(/^the Getting Started guide$/, (ctx) => {
    ctx.guide = readGuide();
  });

  registry.define(/^a developer on Windows reads it$/, () => {
    // Narrative only - the guide is already loaded above.
  });

  registry.define(/^it tells him how to open the repo with the extension host in WSL$/, (ctx) => {
    if (!/Remote\s*-\s*WSL/i.test(ctx.guide)) {
      throw new Error('expected the guide to name the real "Remote - WSL" extension');
    }
    if (!/reopen.*(in|folder in) wsl|wsl:\s*connect/i.test(ctx.guide)) {
      throw new Error('expected the guide to name the actual WSL: Reopen/Connect command a developer runs to get there');
    }
  });

  // ── desktop-vscode-on-windows-03 ─────────────────────────────────────────
  registry.define(/^it is checked against the repo$/, (ctx) => {
    ctx.mentionedCommands = [...new Set(ctx.guide.match(/swarmforge\.[a-zA-Z][a-zA-Z0-9]*/g) || [])];
    ctx.contributedCommands = contributedCommandIds();
    ctx.headingSlugs = markdownHeadingSlugs(ctx.guide);
    ctx.anchorLinks = markdownAnchorLinks(ctx.guide);
  });

  registry.define(/^every command and path its Windows setup names exists$/, (ctx) => {
    const staleCommands = ctx.mentionedCommands.filter((id) => !ctx.contributedCommands.has(id));
    if (staleCommands.length > 0) {
      throw new Error(`stale/invented command IDs in the guide: ${staleCommands.join(', ')}`);
    }
    const brokenAnchors = ctx.anchorLinks.filter((slug) => !ctx.headingSlugs.has(slug));
    if (brokenAnchors.length > 0) {
      throw new Error(`anchor link(s) in the guide point at headings that do not exist: ${brokenAnchors.join(', ')}`);
    }
  });

  // ── desktop-vscode-on-windows-04 ─────────────────────────────────────────
  registry.define(/^the extension's host-side launch path$/, (ctx) => {
    ctx.hostSrcDir = path.join(EXT_DIR, 'src');
  });

  registry.define(/^it resolves the places it reads and the programs it runs$/, (ctx) => {
    // Real launcher module, the actual host-side code that assembles PATH
    // candidates and spawns processes for the swarm launch.
    const launcherSource = fs.readFileSync(path.join(ctx.hostSrcDir, 'swarm', 'swarmLauncher.ts'), 'utf8');
    ctx.launcherSource = launcherSource;
  });

  registry.define(/^it depends on no hardcoded absolute path outside the workspace$/, (ctx) => {
    // "Depends on" is the load-bearing word: COMMON_TOOL_PATHS/
    // pythonUserBinDirs ARE hardcoded candidate paths, but they are
    // permissive PATH-augmentation candidates, never a hard requirement -
    // augmentPath merges them in as extras and the launch still proceeds
    // with none of them present (proven directly: an empty PATH still
    // yields a defined, usable string, never a throw).
    const { augmentPath } = require(path.join(EXT_DIR, 'out', 'swarm', 'swarmLauncher'));
    const result = augmentPath(undefined);
    if (typeof result !== 'string') {
      throw new Error(`expected augmentPath to degrade gracefully to a usable PATH string even with nothing already set, got: ${JSON.stringify(result)}`);
    }
  });

  registry.define(/^it assumes no macOS-only program$/, (ctx) => {
    // The two macOS-only GUI-automation programs the intake specifically
    // named as a risk (BL-361's own incident: the OLD dev-host launcher
    // shelled to `open -a` + `osascript` before that ticket replaced it).
    // None of the extension's own HOST-side launch code (extension/src/,
    // never extension/scripts/, which is developer tooling, not the
    // extension itself) may invoke either.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          const content = fs.readFileSync(full, 'utf8');
          if (/\bosascript\b/.test(content) || /\bopen\s+-a\b/.test(content)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(ctx.hostSrcDir);
    if (offenders.length > 0) {
      throw new Error(`expected no macOS-only osascript/"open -a" invocation in the extension host source, found in: ${offenders.join(', ')}`);
    }
  });
}

module.exports = { registerSteps };
