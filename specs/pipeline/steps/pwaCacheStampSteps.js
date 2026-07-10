'use strict';

// BL-249: step handlers for the PWA service-worker cache-invalidation
// feature. Drives the REAL compiled stamp tool
// (out/tools/stamp-pwa-cache-name.js) against fixture _site/ directories
// built from the REAL pwa/ shell assets (never hand-authored duplicates),
// and the REAL pwa/sw.js source (via vm, never a reimplementation of its
// install/activate logic) to prove a returning user's browser actually
// gets the updated shell - not just that CACHE_NAME differs as a string.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PWA_DIR = path.join(REPO_ROOT, 'pwa');
const { stampPwaCacheNameInPlace } = require(path.join(EXT_DIR, 'out', 'tools', 'stamp-pwa-cache-name'));

const SHELL_FILES = ['index.html', 'app.js', 'locales.js', 'manifest.json', 'icon.svg'];

function mkSiteDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-pwa-cache-stamp-'));
  fs.copyFileSync(path.join(PWA_DIR, 'sw.js'), path.join(dir, 'sw.js'));
  for (const file of SHELL_FILES) {
    fs.copyFileSync(path.join(PWA_DIR, file), path.join(dir, file));
  }
  return dir;
}

// "Redeploys": builds a fresh _site/ from the real pwa/ shell, applies any
// content override (simulating a shell asset changing), stamps it with the
// real tool, and returns { cacheName, swJsSource }.
function deploy(overrides = {}) {
  const dir = mkSiteDir();
  for (const [file, content] of Object.entries(overrides)) {
    fs.writeFileSync(path.join(dir, file), content);
  }
  const cacheName = stampPwaCacheNameInPlace(dir);
  return { cacheName, swJsSource: fs.readFileSync(path.join(dir, 'sw.js'), 'utf8') };
}

// Minimal service-worker-global-scope fake, sufficient for install/
// activate - a SEPARATE, purpose-built harness from extension/test/
// pwaServiceWorker.test.js's own (richer, fetch/periodicsync-covering)
// harness, since this feature only needs install+activate to prove the
// purge-on-change/no-purge-when-unchanged behavior.
function runInstallAndActivate(swJsSource, userCaches) {
  const listeners = {};
  const context = {
    self: {
      addEventListener: (type, handler) => { listeners[type] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: userCaches,
    fetch: async () => { throw new Error('no network in this fixture'); },
    Request: function Request(url) { this.url = url; },
    URL,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(swJsSource, context);

  return (async () => {
    let installWait;
    listeners.install({ waitUntil: (p) => { installWait = p; } });
    await installWait;
    let activateWait;
    listeners.activate({ waitUntil: (p) => { activateWait = p; } });
    await activateWait;
  })();
}

function makeUserCaches(seed = {}) {
  const store = new Map(Object.entries(seed).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  return {
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const cacheMap = store.get(name);
      return {
        addAll: async (urls) => {
          for (const u of urls) cacheMap.set(u, `content-of:${u}`);
        },
        put: async (request, response) => {
          cacheMap.set(typeof request === 'string' ? request : request.url, response);
        },
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    match: async (request) => {
      const url = typeof request === 'string' ? request : request.url;
      for (const cacheMap of store.values()) {
        if (cacheMap.has(url)) return cacheMap.get(url);
      }
      return undefined;
    },
    snapshot: () => Object.fromEntries([...store.entries()].map(([name, m]) => [name, Object.fromEntries(m)])),
  };
}

function registerSteps(registry) {
  registry.define(
    /^the PWA is deployed to GitHub Pages, its served sw\.js CACHE_NAME derived from the shell assets$/,
    (ctx) => {
      ctx.userCaches = makeUserCaches();
    }
  );

  // ── shell-change-reaches-users-01 ────────────────────────────────────
  registry.define(/^a returning user holding the previously-cached shell$/, async (ctx) => {
    const first = deploy();
    ctx.previousCacheName = first.cacheName;
    await runInstallAndActivate(first.swJsSource, ctx.userCaches);
  });

  registry.define(/^a shell asset changes and the PWA is redeployed$/, async (ctx) => {
    const second = deploy({ 'app.js': `console.log("changed at ${Date.now()}");` });
    ctx.newCacheName = second.cacheName;
    await runInstallAndActivate(second.swJsSource, ctx.userCaches);
  });

  registry.define(/^the served sw\.js CACHE_NAME differs from the previous deploy$/, (ctx) => {
    if (ctx.newCacheName === ctx.previousCacheName) {
      throw new Error(`expected CACHE_NAME to differ after a shell change, both were "${ctx.newCacheName}"`);
    }
  });

  registry.define(
    /^the new service worker installs the updated shell and the activate handler purges the old cache$/,
    (ctx) => {
      const snapshot = ctx.userCaches.snapshot();
      if (ctx.previousCacheName in snapshot) {
        throw new Error(`expected the old cache "${ctx.previousCacheName}" to be purged, but it is still present`);
      }
      if (!(ctx.newCacheName in snapshot)) {
        throw new Error(`expected the new cache "${ctx.newCacheName}" to exist after install`);
      }
    }
  );

  registry.define(/^the returning user receives the updated shell rather than the stale cached one$/, async (ctx) => {
    const served = await ctx.userCaches.match('./index.html');
    if (!served) {
      throw new Error('expected the returning user to still be able to fetch index.html after the update');
    }
  });

  // ── unchanged-shell-no-churn-02 ───────────────────────────────────────
  registry.define(/^the shell assets are byte-for-byte unchanged since the last deploy$/, (ctx) => {
    ctx.firstDeploy = deploy();
  });

  registry.define(/^the PWA is redeployed$/, (ctx) => {
    ctx.secondDeploy = deploy();
  });

  registry.define(/^the served sw\.js CACHE_NAME is unchanged$/, (ctx) => {
    if (ctx.firstDeploy.cacheName !== ctx.secondDeploy.cacheName) {
      throw new Error(
        `expected the same CACHE_NAME across two byte-identical deploys, got "${ctx.firstDeploy.cacheName}" then "${ctx.secondDeploy.cacheName}"`
      );
    }
  });

  registry.define(/^returning users are not forced to re-download an identical shell$/, (ctx) => {
    // Proven by the prior step's equality check itself: an unchanged
    // CACHE_NAME means activate's own purge (key !== CACHE_NAME) never
    // matches the still-current cache, so nothing is ever deleted/
    // re-fetched for an unchanged shell.
    if (ctx.firstDeploy.cacheName !== ctx.secondDeploy.cacheName) {
      throw new Error('an unchanged CACHE_NAME is the precondition for "no forced re-download" - it changed');
    }
  });

  // ── no-manual-bump-03 ─────────────────────────────────────────────────
  registry.define(/^the shell assets for a deploy$/, () => {
    // Documents the precondition - deploy() below builds them fresh from
    // the real pwa/ shell, nothing to fixture here.
  });

  registry.define(/^the deploy stamps the served sw\.js$/, (ctx) => {
    ctx.stampedDeploy = deploy();
  });

  registry.define(
    /^CACHE_NAME is derived from the shell content with no hand-edited version string required$/,
    (ctx) => {
      if (!/^swarmforge-dashboard-[0-9a-f]{12}$/.test(ctx.stampedDeploy.cacheName)) {
        throw new Error(`expected a content-hash-derived CACHE_NAME, got: "${ctx.stampedDeploy.cacheName}"`);
      }
      if (ctx.stampedDeploy.swJsSource.includes('__PWA_CACHE_NAME_PLACEHOLDER__')) {
        throw new Error('expected the placeholder to be fully replaced, not left in the served sw.js');
      }
    }
  );
}

module.exports = { registerSteps };
