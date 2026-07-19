import type { BridgeState } from './bridgeState';

export type ResidentSpyView = 'menu' | 'pipeline' | 'mono-router-feed';

export interface ResidentSpyHtmlOptions {
  view?: string;
  token?: string;
}

const VALID_VIEWS = new Set<ResidentSpyView>(['menu', 'pipeline', 'mono-router-feed']);
const MENU_ITEMS: Array<{ view: ResidentSpyView; testId: string; label: string }> = [
  { view: 'pipeline', testId: 'pipeline-grid-button', label: 'STATUS GRID' },
  { view: 'mono-router-feed', testId: 'mono-router-feed-button', label: 'mono-router RESIDENT' },
];

function normalizeView(view: string | undefined): ResidentSpyView {
  if (view && VALID_VIEWS.has(view as ResidentSpyView)) {
    return view as ResidentSpyView;
  }
  return 'menu';
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function queryString(params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, value);
    }
  }
  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : '';
}

function residentSpyHref(view: ResidentSpyView, token: string | undefined): string {
  return `/resident-spy${queryString({ view, token })}`;
}

function eventsHref(token: string | undefined): string {
  return `/events${queryString({ token })}`;
}

function menuHref(view: ResidentSpyView, token: string | undefined): string {
  return escapeHtml(residentSpyHref(view, token));
}

function renderMenuItem(
  item: { view: ResidentSpyView; testId: string; label: string },
  token: string | undefined
): string {
  return `<a class="menu-button" data-testid="${item.testId}" href="${menuHref(item.view, token)}"><span>${escapeHtml(item.label)}</span><span aria-hidden="true">&rsaquo;</span></a>`;
}

function renderShell(title: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101418; color: #f4f7fb; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; overflow-x: hidden; }
body { padding: 16px; }
a { color: inherit; text-decoration: none; }
.app { width: 100%; max-width: 520px; margin: 0 auto; }
.topbar { display: flex; align-items: center; gap: 10px; min-height: 44px; margin-bottom: 12px; }
.back { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 1px solid #354151; border-radius: 8px; background: #18202a; }
h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0; }
.menu { display: grid; gap: 12px; }
.menu-button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 58px; padding: 14px 16px; border: 1px solid #354151; border-radius: 8px; background: #18202a; font-size: 16px; font-weight: 650; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; width: 100%; }
.stage { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 12px; border: 1px solid #354151; border-radius: 8px; background: #18202a; }
.stage-name, .feed-line { min-width: 0; overflow-wrap: anywhere; }
.status { padding: 4px 8px; border-radius: 999px; background: #273241; font-size: 12px; text-transform: uppercase; }
.status-active { background: #1f6f54; color: #ffffff; }
.feed { width: 100%; min-height: 60vh; margin: 0; padding: 12px; border: 1px solid #354151; border-radius: 8px; background: #090d11; overflow-wrap: anywhere; white-space: pre-wrap; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
</style>
</head>
<body>
<main class="app">${body}</main>
${script}
</body>
</html>`;
}

function renderHeader(title: string, showBack: boolean, token: string | undefined): string {
  const back = showBack ? `<a class="back" href="${menuHref('menu', token)}" aria-label="Back">&lsaquo;</a>` : '';
  return `<div class="topbar">${back}<h1>${escapeHtml(title)}</h1></div>`;
}

function renderMenu(token: string | undefined): string {
  const items = MENU_ITEMS.map((item) => renderMenuItem(item, token)).join('\n  ');
  return `${renderHeader('SwarmForge Console', false, token)}
<nav class="menu" aria-label="Console">
  ${items}
</nav>`;
}

function renderPipeline(state: BridgeState, token: string | undefined): string {
  const stages = state.pipeline.map((stage) => {
    const statusClass = stage.status === 'active' ? 'status status-active' : 'status';
    return `<div class="stage">
  <div class="stage-name">${escapeHtml(stage.displayName)}</div>
  <div class="${statusClass}">${escapeHtml(stage.status)}</div>
</div>`;
  }).join('');

  return `${renderHeader('STATUS GRID', true, token)}
<section class="grid" data-testid="pipeline-status-grid">${stages || '<div class="stage"><div class="stage-name">No roles</div><div class="status">idle</div></div>'}</section>`;
}

function renderFeed(token: string | undefined): { body: string; script: string } {
  const eventUrl = eventsHref(token);
  const script = `<script>
(() => {
  const log = document.querySelector('[data-testid="resident-feed-log"]');
  const source = new EventSource("${escapeHtml(eventUrl)}");
  source.onmessage = (event) => {
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.textContent = event.data;
    log.prepend(line);
  };
  source.onerror = () => {
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.textContent = 'stream disconnected';
    log.prepend(line);
  };
})();
</script>`;
  const body = `${renderHeader('mono-router RESIDENT', true, token)}
<section data-testid="mono-router-resident-feed">
  <pre class="feed" data-testid="resident-feed-log"></pre>
</section>`;
  return { body, script };
}

export function buildResidentSpyHtml(state: BridgeState, options: ResidentSpyHtmlOptions = {}): string {
  const view = normalizeView(options.view);
  if (view === 'pipeline') {
    return renderShell('SwarmForge STATUS GRID', renderPipeline(state, options.token));
  }
  if (view === 'mono-router-feed') {
    const feed = renderFeed(options.token);
    return renderShell('SwarmForge mono-router RESIDENT', feed.body, feed.script);
  }
  return renderShell('SwarmForge Console', renderMenu(options.token));
}
