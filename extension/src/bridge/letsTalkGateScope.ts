// BL-766: pure helpers for checking that every Let's Talk source file the
// live bridge server still imports stays inside the CRAP/coverage/mutation
// gate scope that guards it. Retiring a surface must drop its route, its
// acceptance scenarios and its gate entry together (declared invariant) -
// these helpers take already-read text and lists as plain arguments (no I/O)
// so callers - both the BL-766 acceptance steps and this file's own property
// test - can drive them against real bridgeServer.ts content without any
// filesystem access of their own.

export function liveImportedBaseNames(bridgeServerSource: string, candidateBaseNames: string[]): string[] {
  return candidateBaseNames.filter((name) => new RegExp(`from '\\./${name}'`).test(bridgeServerSource));
}

export function gateScopeMissingLiveSources(
  bridgeServerSource: string,
  gateScopeRelPaths: string[],
  candidateBaseNames: string[],
  dirPrefix: string
): string[] {
  const gateSet = new Set(gateScopeRelPaths);
  return liveImportedBaseNames(bridgeServerSource, candidateBaseNames)
    .map((name) => `${dirPrefix}${name}.ts`)
    .filter((relPath) => !gateSet.has(relPath));
}
