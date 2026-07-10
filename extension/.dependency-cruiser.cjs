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
      // Matches the bare package specifier, not a resolved node_modules
      // path - none of these packages are installed in this project (by
      // design), so dependency-cruiser reports them as an UNRESOLVED
      // dependency whose `resolved`/`module` value is the raw specifier
      // string itself, not a node_modules/... path (verified empirically).
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
