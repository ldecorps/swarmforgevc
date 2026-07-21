const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-364 target-repo-use-case-inventory scenario 01: "The extension host
// runs beside the swarm, never on the UI side" - under VS Code remoting
// (Remote-WSL, or a Remote-Tunnel), a WORKSPACE extension's host runs
// INSIDE the remote (next to tmux, the swarm socket, .swarmforge/, the
// daemons); a UI extension's host runs on the LOCAL (Windows) side,
// severed from every one of those. package.json currently declares no
// extensionKind at all, which - because this extension HAS a `main` entry
// (a real Node extension, not a declarative/theme-only one) - defaults to
// VS Code's own ['workspace', 'ui'] (prefer workspace, i.e. run beside the
// remote when one is available). This test pins that property: an
// extensionKind that declares ONLY 'ui' (or omits 'workspace' entirely)
// would sever the host from the swarm and is a regression, not a feature,
// per this ticket's own load-bearing-property note.
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

test('package.json declares a main entry (a real extension host, not a declarative-only extension)', () => {
  const pkg = readPackageJson();
  assert.ok(pkg.main, 'expected package.json to declare a main entry point');
});

test('package.json never declares an extensionKind that excludes workspace (would sever the host from the swarm under remoting)', () => {
  const pkg = readPackageJson();
  if (pkg.extensionKind === undefined) {
    // Unset is correct and preferred: with a `main` entry present, VS
    // Code's own default is ['workspace', 'ui'] - workspace-preferred,
    // exactly the property this test exists to protect.
    return;
  }
  const kinds = Array.isArray(pkg.extensionKind) ? pkg.extensionKind : [pkg.extensionKind];
  assert.ok(
    kinds.includes('workspace'),
    `expected extensionKind to include "workspace" if declared at all, got: ${JSON.stringify(pkg.extensionKind)}`
  );
});
