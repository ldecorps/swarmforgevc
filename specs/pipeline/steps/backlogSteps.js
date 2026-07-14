'use strict';

// Drives the real, testable backlog-parsing module (extension/out/panel/
// backlogReader.js) through its module surface - no VS Code API, no
// webview. Compiled output only: run `npm run compile` in extension/ first.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { readBacklogFolders } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'extension',
  'out',
  'panel',
  'backlogReader.js'
));

function writeBacklogItem(targetPath, folder, id, yamlStatus) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}-demo.yaml`),
    `id: ${id}\ntitle: "demo ticket"\nstatus: ${yamlStatus}\n`,
    'utf8'
  );
}

function registerSteps(registry) {
  registry.define(
    /^a target repo with a backlog item "([^"]+)" filed under "([^"]+)" with yaml status "([^"]+)"$/,
    (ctx, id, folder, yamlStatus) => {
      ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-backlog-'));
      writeBacklogItem(ctx.targetPath, folder, id, yamlStatus);
    }
  );

  registry.define(/^a target repo with no backlog item "([^"]+)"$/, (ctx) => {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-backlog-'));
  });

  registry.define(/^the backlog folders are read$/, (ctx) => {
    ctx.folders = readBacklogFolders(ctx.targetPath);
    fs.rmSync(ctx.targetPath, { recursive: true, force: true });
  });

  registry.define(/^"([^"]+)" appears in the "([^"]+)" folder$/, (ctx, id, folder) => {
    const items = ctx.folders[folder] || [];
    if (!items.some((item) => item.id === id)) {
      throw new Error(`expected "${id}" in folder "${folder}", found: ${JSON.stringify(items.map((i) => i.id))}`);
    }
  });

  registry.define(/^"([^"]+)" appears in no folder$/, (ctx, id) => {
    const present = Object.entries(ctx.folders).filter(([, items]) => items.some((item) => item.id === id));
    if (present.length > 0) {
      throw new Error(`expected "${id}" in no folder, found in: ${present.map(([folder]) => folder).join(', ')}`);
    }
  });
}

module.exports = { registerSteps };
