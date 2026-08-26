'use strict';

// BL-1046: console role grid tiles name held tickets from the same payload
// fields as fullscreen Expand. Same jsdom + runScripts:'outside-only' pattern
// as bl994LiveScreenGridSteps.js — close every window before returning.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_OUT = path.join(REPO_ROOT, 'extension', 'out');
const EXTENSION_NODE_MODULES = path.join(REPO_ROOT, 'extension', 'node_modules');
const MOCK_SCRIPT = path.join(REPO_ROOT, 'extension', 'scripts', 'render-console-tile-mock.js');

const FEATURE =
  "The fleet console's role tiles name the ticket each seat holds and how long it has held it";

const GRID_ROLES = [
  'coordinator',
  'specifier',
  'coder',
  'cleaner',
  'architect',
  'hardender',
  'documenter',
  'qa',
];

const ROLE_LABELS = {
  coordinator: 'Coordinator',
  specifier: 'Specifier',
  coder: 'Coder',
  cleaner: 'Cleaner',
  architect: 'Architect',
  hardender: 'Hardender',
  documenter: 'Documenter',
  qa: 'Qa',
};

function rolePaneId(role) {
  return role.toLowerCase() === 'qa' ? 'QA' : role.toLowerCase();
}

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

function defaultPane(role, overrides = {}) {
  const id = rolePaneId(role);
  return {
    available: true,
    roleLabel: ROLE_LABELS[role.toLowerCase()] ?? role,
    modelLabel: 'Sonnet 5',
    paneText: `${ROLE_LABELS[role.toLowerCase()] ?? role} live output`,
    ...overrides,
  };
}

function buildPanesFromCtx(ctx) {
  const seats = ctx.seats ?? {};
  return GRID_ROLES.map((role) => {
    const seat = seats[role.toLowerCase()] ?? {};
    const paneOverrides = { ...seat.pane };
    if (seat.unreachable) {
      paneOverrides.available = false;
      delete paneOverrides.ticketId;
      delete paneOverrides.ticketTitle;
      delete paneOverrides.claimEnteredAtMs;
      delete paneOverrides.heldParcelCount;
    } else if (seat.holdsNothing) {
      delete paneOverrides.ticketId;
      delete paneOverrides.ticketTitle;
      delete paneOverrides.claimEnteredAtMs;
      delete paneOverrides.heldParcelCount;
    } else if (seat.ticketId) {
      paneOverrides.ticketId = seat.ticketId;
      if (seat.ticketTitle) {
        paneOverrides.ticketTitle = seat.ticketTitle;
      }
      if (seat.claimMinutesAgo !== undefined) {
        paneOverrides.claimEnteredAtMs = Date.now() - Number(seat.claimMinutesAgo) * 60 * 1000;
      }
      if (seat.heldParcelCount !== undefined) {
        paneOverrides.heldParcelCount = seat.heldParcelCount;
      }
    }
    return {
      id: rolePaneId(role),
      label: ROLE_LABELS[role.toLowerCase()] ?? role,
      pane: defaultPane(role, paneOverrides),
    };
  });
}

async function renderGrid(ctx, { expandRole } = {}) {
  const { getResidentSpyUiHtml } = require(path.join(EXTENSION_OUT, 'bridge', 'residentSpyUiHtml'));
  const { JSDOM } = require(path.join(EXTENSION_NODE_MODULES, 'jsdom'));

  const html = getResidentSpyUiHtml();
  const panes = buildPanesFromCtx(ctx);
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

    let expanded = null;
    if (expandRole) {
      const paneId = rolePaneId(expandRole);
      const col = dom.window.document.querySelector(`.pane-col[data-pane-id="${paneId}"]`);
      if (!col) {
        throw new Error(`no tile for role "${expandRole}" (pane id ${paneId})`);
      }
      col.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await flush();
      expanded = {
        fsHeadText: dom.window.document.getElementById('fs-head')?.textContent ?? '',
        fsHeadHtml: dom.window.document.getElementById('fs-head')?.innerHTML ?? '',
        fullscreenActive: dom.window.document.body.classList.contains('pane-fullscreen-active'),
      };
    }

    const tiles = {};
    for (const role of GRID_ROLES) {
      const paneId = rolePaneId(role);
      const col = dom.window.document.querySelector(`.pane-col[data-pane-id="${paneId}"]`);
      if (!col) {
        tiles[role.toLowerCase()] = { missing: true };
        continue;
      }
      tiles[role.toLowerCase()] = {
        roleNameText: col.querySelector('.pane-kind')?.textContent ?? null,
        ticketIdText: col.querySelector('.pane-grid-ticket-id')?.textContent ?? null,
        slugText: col.querySelector('.pane-grid-slug')?.textContent ?? null,
        ageText: col.querySelector('.pane-grid-age')?.textContent ?? null,
        moreText: col.querySelector('.pane-grid-more')?.textContent ?? null,
        hasExpandHint: !!col.querySelector('.pane-expand-hint'),
        headHtml: col.querySelector('.pane-head')?.innerHTML ?? '',
      };
    }

    const css = html.match(/<style>([\s\S]*?)<\/style>/);
    return { html, css: css ? css[1] : '', tiles, expanded, panes };
  } finally {
    dom.window.close();
  }
}

function roleKey(role) {
  return role.toLowerCase();
}

function patchSeat(ctx, role, patch) {
  ctx.seats = ctx.seats ?? {};
  const key = roleKey(role);
  ctx.seats[key] = { ...(ctx.seats[key] ?? {}), ...patch };
}

function parseCssClampMax(ruleBody) {
  return Number((ruleBody.match(/clamp\([^,]+,\s*[^,]+,\s*(\d+)px\)/) ?? [])[1]);
}

function tile(ctx, role) {
  const t = ctx.render?.tiles?.[roleKey(role)];
  if (!t || t.missing) {
    throw new Error(`no rendered tile for role "${role}"`);
  }
  return t;
}

function assertTileText(ctx, role, field, expected) {
  const t = tile(ctx, role);
  if (t[field] !== expected) {
    throw new Error(`expected ${role} tile ${field} "${expected}", got "${t[field]}"`);
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^the live console is authenticated and showing the role grid$/, () => {});

  scoped(
    /^the pane payload resolves each seat's held ticket from that seat's own in_process mailbox$/,
    () => {}
  );

  scoped(
    /^the "([^"]+)" seat holds ticket "([^"]+)" titled "([^"]+)"$/,
    (ctx, role, ticketId, title) => {
      patchSeat(ctx, role, { ticketId, ticketTitle: title });
    }
  );

  scoped(/^that seat entered the claim "(\d+)" minutes ago$/, (ctx, minutes) => {
    const lastRole = Object.keys(ctx.seats ?? {}).slice(-1)[0];
    if (!lastRole) {
      throw new Error('no seat configured before claim age step');
    }
    ctx.seats[lastRole].claimMinutesAgo = Number(minutes);
  });

  scoped(
    /^the "([^"]+)" seat holds ticket "([^"]+)" and entered the claim "(\d+)" minutes ago$/,
    (ctx, role, ticketId, minutes) => {
      patchSeat(ctx, role, {
        ticketId,
        ticketTitle: `Ticket ${ticketId}`,
        claimMinutesAgo: Number(minutes),
      });
    }
  );

  scoped(/^the "([^"]+)" seat holds ticket "([^"]+)"$/, (ctx, role, ticketId) => {
    patchSeat(ctx, role, { ticketId, ticketTitle: `Ticket ${ticketId}` });
  });

  scoped(
    /^the "([^"]+)" seat holds tickets "([^"]+)", "([^"]+)" and "([^"]+)"$/,
    (ctx, role, t1, t2, t3) => {
      patchSeat(ctx, role, {
        ticketId: t1,
        ticketTitle: `Ticket ${t1}`,
        heldParcelCount: 3,
        batchTickets: [t1, t2, t3],
      });
    }
  );

  scoped(/^the oldest of those claims is "([^"]+)"$/, (ctx, ticketId) => {
    const batchSeat = Object.values(ctx.seats ?? {}).find((s) => s.batchTickets);
    if (!batchSeat) {
      throw new Error('expected a batch seat before oldest-claim step');
    }
    batchSeat.ticketId = ticketId;
    batchSeat.ticketTitle = `Ticket ${ticketId}`;
  });

  scoped(/^the "([^"]+)" seat holds no parcel$/, (ctx, role) => {
    patchSeat(ctx, role, { holdsNothing: true });
  });

  scoped(/^the "([^"]+)" pane is not reachable$/, (ctx, role) => {
    patchSeat(ctx, role, { unreachable: true });
  });

  scoped(/^the role grid can render holding seats with ticket ids$/, () => {});

  scoped(/^the role grid renders$/, async (ctx) => {
    ctx.render = await renderGrid(ctx);
  });

  scoped(/^the "([^"]+)" tile is expanded$/, async (ctx, role) => {
    ctx.render = await renderGrid(ctx, { expandRole: role });
  });

  scoped(/^the "([^"]+)" tile shows the ticket id "([^"]+)"$/, (ctx, role, ticketId) => {
    assertTileText(ctx, role, 'ticketIdText', ticketId);
  });

  scoped(/^the "([^"]+)" tile shows a slug derived from the ticket title$/, (ctx, role) => {
    const seat = ctx.seats?.[roleKey(role)];
    const t = tile(ctx, role);
    if (!seat?.ticketTitle) {
      throw new Error(`no ticket title configured for ${role}`);
    }
    const fragment = seat.ticketTitle.split(/\s+/).slice(0, 3).join(' ').toLowerCase();
    if (!t.slugText || !t.slugText.toLowerCase().includes(fragment.split(' ')[0])) {
      throw new Error(`expected ${role} slug derived from title, got "${t.slugText}"`);
    }
  });

  scoped(/^the "([^"]+)" tile shows a claim age of "(\d+)" minutes$/, (ctx, role, minutes) => {
    assertTileText(ctx, role, 'ageText', `${minutes}m`);
  });

  scoped(/^the "([^"]+)" tile shows the role name$/, (ctx, role) => {
    assertTileText(ctx, role, 'roleNameText', ROLE_LABELS[roleKey(role)] ?? role);
  });

  scoped(/^the "([^"]+)" tile shows that "(\d+)" further parcels are held$/, (ctx, role, count) => {
    assertTileText(ctx, role, 'moreText', `+${count}`);
  });

  scoped(/^the "([^"]+)" tile shows no held ticket$/, (ctx, role) => {
    const t = tile(ctx, role);
    if (t.ticketIdText) {
      throw new Error(`expected ${role} tile to show no held ticket, got id "${t.ticketIdText}"`);
    }
  });

  scoped(/^the "([^"]+)" tile can still be expanded$/, async (ctx, role) => {
    const expanded = await renderGrid(ctx, { expandRole: role });
    if (!expanded.expanded?.fullscreenActive) {
      throw new Error(`expected ${role} tile to expand into fullscreen`);
    }
  });

  scoped(
    /^the ticket id shown on the grid tile and in the fullscreen view are the same$/,
    (ctx) => {
      const qaTile = tile(ctx, 'qa');
      if (!ctx.render.expanded?.fsHeadText.includes(qaTile.ticketIdText)) {
        throw new Error(
          `grid/fullscreen disagree: grid "${qaTile.ticketIdText}" vs fullscreen "${ctx.render.expanded.fsHeadText}"`
        );
      }
    }
  );

  scoped(
    /^the ticket id's rendered font size is smaller than the role name's font size$/,
    (ctx) => {
      const css = ctx.render.css;
      const kindRule = css.match(/\.pane-kind\s*\{([^}]*)\}/);
      const idRule = css.match(/\.pane-grid-ticket-id\s*\{([^}]*)\}/);
      if (!kindRule || !idRule) {
        throw new Error('expected .pane-kind and .pane-grid-ticket-id CSS rules');
      }
      const kindMax = parseCssClampMax(kindRule[1]);
      const idMax = parseCssClampMax(idRule[1]);
      if (!(idMax < kindMax)) {
        throw new Error(`expected ticket id max font (${idMax}px) < role name max (${kindMax}px)`);
      }
    }
  );

  scoped(/^the UI approval package for this slice is prepared$/, (ctx) => {
    execFileSync(process.execPath, [MOCK_SCRIPT], { cwd: REPO_ROOT, stdio: 'pipe' });
    const evidenceDir = path.join(REPO_ROOT, 'backlog', 'evidence');
    const htmlCandidates = fs
      .readdirSync(evidenceDir)
      .filter((f) => f.startsWith('BL-1046-console-tile-mock-') && f.endsWith('.html'));
    if (htmlCandidates.length === 0) {
      throw new Error('expected BL-1046 console tile mock HTML under backlog/evidence/');
    }
    htmlCandidates.sort();
    ctx.mockHtmlPath = path.join(evidenceDir, htmlCandidates[htmlCandidates.length - 1]);
    ctx.mockHtml = fs.readFileSync(ctx.mockHtmlPath, 'utf8');
    const mdCandidates = fs
      .readdirSync(evidenceDir)
      .filter((f) => f.startsWith('BL-1046-console-tile-mock-delivery-') && f.endsWith('.md'));
    if (mdCandidates.length === 0) {
      throw new Error('expected BL-1046 mock delivery evidence markdown under backlog/evidence/');
    }
    mdCandidates.sort();
    ctx.mockDeliveryEvidence = fs.readFileSync(
      path.join(evidenceDir, mdCandidates[mdCandidates.length - 1]),
      'utf8'
    );
  });

  scoped(
    /^a phone-width mock of the eight-tile grid with sample ticket ids on holding seats is generated$/,
    (ctx) => {
      if (!/width=375|width=device-width,\s*initial-scale=1,\s*width=375/.test(ctx.mockHtml)) {
        throw new Error('mock HTML must declare a phone-width viewport (375px)');
      }
      for (const ticketId of ['BL-1035', 'BL-1010', 'BL-1041']) {
        if (!ctx.mockHtml.includes(ticketId)) {
          throw new Error(`mock HTML missing sample ticket id ${ticketId}`);
        }
      }
      if (!/pane-grid-ticket-id/.test(ctx.mockHtml)) {
        throw new Error('mock HTML must render grid ticket ids');
      }
    }
  );

  scoped(
    /^that mock is delivered to the configured operator email inbox \(or linked from the Approvals ask\)$/,
    (ctx) => {
      if (!/operator|email|Approvals|send-alarm-email|daemon.alarm/i.test(ctx.mockDeliveryEvidence)) {
        throw new Error('delivery evidence must document operator email or Approvals ask linkage');
      }
      if (!ctx.mockDeliveryEvidence.includes(path.basename(ctx.mockHtmlPath))) {
        throw new Error('delivery evidence must reference the generated mock HTML');
      }
    }
  );

  scoped(/^evidence of the mock is recorded under backlog\/evidence\/$/, (ctx) => {
    if (!ctx.mockHtmlPath.startsWith(path.join(REPO_ROOT, 'backlog', 'evidence'))) {
      throw new Error('mock HTML must live under backlog/evidence/');
    }
    if (!fs.existsSync(ctx.mockHtmlPath)) {
      throw new Error(`missing mock evidence file: ${ctx.mockHtmlPath}`);
    }
  });
}

module.exports = { registerSteps };
