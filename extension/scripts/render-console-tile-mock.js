#!/usr/bin/env node
'use strict';

// BL-1046: write a phone-width HTML mock of the eight-tile console grid with
// sample held tickets to backlog/evidence/ for operator UI approval.
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const extensionRoot = path.join(repoRoot, 'extension');
const { getResidentSpyUiHtml } = require(path.join(extensionRoot, 'out', 'bridge', 'residentSpyUiHtml'));
const { JSDOM } = require(path.join(extensionRoot, 'node_modules', 'jsdom'));

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getResidentSpyUiHtml() output');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const now = Date.now();
const roles = [
  { id: 'coordinator', label: 'Coordinator', ticketId: 'BL-1041', title: 'Coordinator sample ticket' },
  { id: 'specifier', label: 'Specifier' },
  { id: 'coder', label: 'Coder', ticketId: 'BL-1042', title: 'Coder sample ticket' },
  { id: 'cleaner', label: 'Cleaner', ticketId: 'BL-1010', title: 'Oldest batch parcel', heldParcelCount: 3 },
  { id: 'architect', label: 'Architect' },
  { id: 'hardender', label: 'Hardender', ticketId: 'BL-1035', title: 'Front desk stall guard' },
  { id: 'documenter', label: 'Documenter' },
  { id: 'QA', label: 'Qa', ticketId: 'BL-1011', title: 'QA sample ticket' },
];

const panes = roles.map((role) => ({
  id: role.id,
  label: role.label,
  pane: {
    available: true,
    roleLabel: role.label,
    modelLabel: 'Sonnet 5',
    paneText: `${role.label} live output`,
    ...(role.ticketId
      ? {
          ticketId: role.ticketId,
          ticketTitle: role.title,
          claimEnteredAtMs: now - 15 * 60 * 1000,
          ...(role.heldParcelCount ? { heldParcelCount: role.heldParcelCount } : {}),
        }
      : {}),
  },
}));

async function renderMockBody() {
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  try {
    dom.window.fetch = (url, opts) => {
      const href = String(url);
      if (href.startsWith('/web-ui-font-size')) {
        if (opts && opts.method === 'PUT') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, fontSizePx: 13 }),
        });
      }
      if (href.startsWith('/resident-pane')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true, monoRouterLayout: false, panes }),
        });
      }
      return Promise.reject(new Error('unexpected fetch: ' + href));
    };
    dom.window.eval(extractInlineScript(html));
    await flush();
    return dom.window.document.documentElement.outerHTML;
  } finally {
    dom.window.close();
  }
}

async function main() {
  const rendered = await renderMockBody();
  const mock = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, width=375"/>
<title>BL-1046 console tile mock</title></head>
<body style="max-width:375px;margin:0 auto;">
<p style="font:12px sans-serif;padding:8px;">BL-1046 phone-width mock — sample held tickets on grid tiles.</p>
${rendered}
</body></html>`;

  const outDir = path.join(repoRoot, 'backlog', 'evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const htmlName = `BL-1046-console-tile-mock-${date}.html`;
  const mdName = `BL-1046-console-tile-mock-delivery-${date}.md`;
  const outPath = path.join(outDir, htmlName);
  fs.writeFileSync(outPath, mock);

  const deliveryMd = `# BL-1046 console tile mock — operator delivery

Generated: ${new Date().toISOString()}

## Mock artifact

- HTML: \`${path.relative(repoRoot, outPath)}\`
- Viewport: phone-width (375px)
- Sample holding seats: coordinator (BL-1041), coder (BL-1042), cleaner (BL-1010 +2), hardender (BL-1035), QA (BL-1011)

## Operator email / Approvals ask

Per BL-1046 approval_context, this mock is linked from the Approvals ask so Approve is informed by the rendered grid (not a blind tap).

When \`RESEND_API_KEY\` and operator inbox are configured, deliver via \`daemon_alarm_lib.bb\` \`send-alarm-email!\` with the HTML mock attached or linked — reuse the existing alarm mailer; do not mint a second sender.

Evidence path for QA: \`${path.relative(repoRoot, outPath)}\`
`;
  fs.writeFileSync(path.join(outDir, mdName), deliveryMd);
  console.log(outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
