// BL-259: gated static dependency-rule checker (pinned dependency-cruiser,
// see package.json). Encodes this project's dependency-direction rules
// (architect.prompt's Review Order, local-engineering.prompt's Architecture
// Rules, and the shared engineering.prompt testable-boundary rule) as
// machine-checkable forbidden edges. This config is versioned project
// source, reviewed like any other file - never generated/regenerated
// blindly.
//
// Layer mapping (derived from the CURRENT module layout, per the ticket's
// own "mapping directories to policy/IO/view/core is a build task"):
//   - VIEW: extension/media/**  - the one real webview-side JS file
//     (panel.js) outside the extension host's own import graph.
//   - CORE: extension/src/**, EXCLUDING the small, known set of files that
//     legitimately import the VS Code API (extension.ts itself, and the
//     panel/config/notify/bridge/swarm files that genuinely need vscode -
//     grep-confirmed, see the pathNot list below). Everything else under
//     src/ is the testable core the shared engineering.prompt's boundary
//     rule already requires stay reachable without booting VS Code.
//   - POLICY: extension/src/quality/** - the one directory in this repo
//     that is genuinely pure decision/analysis code today (coChange.ts has
//     zero fs/child_process imports) - a real, not aspirational, boundary.
module.exports = {
  forbidden: [
    {
      name: 'core-not-vscode-api',
      severity: 'error',
      comment:
        'Testable-core modules must not depend on the VS Code API, the webview context, or live tmux/PTY (the shared engineering.prompt testable boundary).',
      from: {
        path: '^src/',
        pathNot:
          '^src/(extension\\.ts|panel/webviewHtml\\.ts|panel/swarmPanel\\.ts|panel/workTreePanel\\.ts|swarm/swarmLauncher\\.ts|config/targetConfig\\.ts|notify/secrets\\.ts|bridge/deviceRegistryStore\\.ts)$',
      },
      to: { path: '^vscode$' },
    },
    {
      name: 'no-io-from-policy',
      severity: 'error',
      comment: 'High-level policy (quality/analysis) modules must not import IO/filesystem/network modules.',
      from: { path: '^src/quality/' },
      to: { path: '^(fs|fs/promises|child_process|net|dns|http|https)$' },
    },
    {
      name: 'view-not-import-host-io',
      severity: 'error',
      comment: 'Webview/view code must not import extension-host modules (postMessage is the only channel - local-engineering.prompt).',
      from: { path: '^media/' },
      to: { path: '^src/' },
    },
    {
      name: 'no-process-spawn-from-view',
      severity: 'error',
      comment: 'No direct child_process/process-spawn from the view layer, bypassing the tmux substrate.',
      from: { path: '^media/' },
      to: { path: '^child_process$' },
    },
    {
      // QA bounce (6747a4812d): dependency-cruiser is an import/require-EDGE
      // analyzer - it structurally cannot see a bare global reference like
      // `localStorage.setItem(...)`, which has no import statement at all.
      // This rule therefore only ever catches a WRAPPER-PACKAGE import
      // (matches the bare, unresolved specifier - none of these packages
      // are installed in this project by design, so dependency-cruiser
      // reports them as unresolved, verified empirically) - a real but
      // secondary defense. The PRIMARY, realistic no-webview-storage
      // violation (a bare localStorage/sessionStorage global reference) is
      // caught by a SEPARATE supplementary check, dependency-gate.ts's own
      // scanMediaFilesForStorageGlobals (a file-text scan, not an
      // import-graph rule) - merged into the same "no-webview-storage"
      // rule name by dependency-gate.ts's runGate() so the architect's
      // bounce note stays consistent regardless of which mechanism caught
      // it. Both must be run together (via runGate, never
      // runDependencyCruiser alone) for this rule to actually be enforced.
      name: 'no-webview-storage',
      severity: 'error',
      comment: 'No localStorage/sessionStorage (or a browser-storage wrapper package) import from the view layer (local-engineering.prompt).',
      from: { path: '^media/' },
      to: { path: '^(idb|localforage|dexie|store2|lockr)($|/)' },
    },
    {
      name: 'acyclic',
      severity: 'error',
      comment: 'No dependency cycles.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.js$' },
  },
};
