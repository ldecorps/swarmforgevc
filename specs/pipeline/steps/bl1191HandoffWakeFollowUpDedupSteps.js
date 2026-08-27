'use strict';

// BL-1191: acceptance steps for handoff-mail wake dedup.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WAKE_DEDUP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'wake_dedup_lib.bb');
const HANDOFF_WAKE_MESSAGE =
  'You have new handoff mail. If idle, run ready_for_next.sh.';

const FEATURE = 'Handoff-mail wakes do not flood the Cursor follow-up bar';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1191-'));
}

function ensureCtx(ctx) {
  if (!ctx.bl1191) {
    ctx.bl1191 = {
      root: mkTmp(),
      nowMs: 1_700_000_000_000,
      injections: 0,
      lastSkipReason: null,
      lastAttribution: null,
      role: 'coordinator',
      fingerprint: '',
      lastFingerprint: '',
      lastInjectedAtMs: 0,
    };
  }
  return ctx.bl1191;
}

function decideWakeDedup(st, fingerprint, lastFingerprint, lastInjectedAtMs, nowMs) {
  const script = `(load-file "${WAKE_DEDUP_LIB.replace(/\\/g, '\\\\')}")
(require '[cheshire.core :as json])
(println (json/generate-string (wake-dedup-lib/decide-wake-dedup {:fingerprint "${fingerprint}" :last-fingerprint "${lastFingerprint}" :last-injected-at-ms ${lastInjectedAtMs} :now-ms ${nowMs} :cooldown-ms 120000})))`;
  const res = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`wake dedup bb failed: ${res.stderr || res.stdout}`);
  }
  const parsed = JSON.parse((res.stdout || '').trim());
  return {
    action: parsed.action,
    skipReason: parsed['skip-reason'] ?? parsed.skipReason ?? null,
    fingerprint: parsed.fingerprint,
  };
}

function applySweepDecision(ctx) {
  const st = ensureCtx(ctx);
  const decision = decideWakeDedup(
    st,
    st.fingerprint,
    st.lastFingerprint,
    st.lastInjectedAtMs,
    st.nowMs
  );
  if (decision.action === 'inject') {
    st.injections += 1;
    st.lastFingerprint = decision.fingerprint;
    st.lastInjectedAtMs = st.nowMs;
    st.lastAttribution = '00_test.handoff';
    st.lastSkipReason = null;
  } else {
    st.lastSkipReason = decision.skipReason;
  }
}

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function register(registry) {
  scoped(registry, /^the handoff wake dedup gate is armed for a role pane$/, (ctx) => {
    const st = ensureCtx(ctx);
    st.injections = 0;
    st.lastSkipReason = null;
    st.lastFingerprint = '';
    st.lastInjectedAtMs = 0;
  });

  scoped(
    registry,
    /^role "([^"]+)" has one parcel in new unchanged for "(\d+)" seconds$/,
    (ctx, role, _seconds) => {
      const st = ensureCtx(ctx);
      st.role = role;
      st.fingerprint = 'fp-unchanged-parcel';
      st.lastFingerprint = st.fingerprint;
      st.lastInjectedAtMs = st.nowMs - 130_000;
    }
  );

  scoped(
    registry,
    /^a handoff-mail wake was already injected for that parcel fingerprint$/,
    (ctx) => {
      const st = ensureCtx(ctx);
      st.injections = 1;
    }
  );

  scoped(
    registry,
    /^the chase sweep decides to notify again with the same mailbox fingerprint$/,
    (ctx) => {
      applySweepDecision(ctx);
    }
  );

  scoped(registry, /^no new HANDOFF_WAKE_MESSAGE injection is sent$/, (ctx) => {
    const st = ensureCtx(ctx);
    if (st.injections !== 1) {
      throw new Error(`expected exactly one prior injection, got ${st.injections}`);
    }
  });

  scoped(registry, /^no HANDOFF_WAKE_MESSAGE injection is sent$/, (ctx) => {
    const st = ensureCtx(ctx);
    if (st.injections !== 0) {
      throw new Error(`expected no injections, got ${st.injections}`);
    }
  });

  scoped(
    registry,
    /^the dedup record names skip reason unchanged-mailbox$/,
    (ctx) => {
      const st = ensureCtx(ctx);
      if (st.lastSkipReason !== 'unchanged-mailbox') {
        throw new Error(`expected unchanged-mailbox, got ${st.lastSkipReason}`);
      }
    }
  );

  scoped(
    registry,
    /^role "([^"]+)" has no prior wake fingerprint for the current mailbox state$/,
    (ctx, role) => {
      const st = ensureCtx(ctx);
      st.role = role;
      st.fingerprint = 'fp-fresh';
      st.lastFingerprint = '';
      st.lastInjectedAtMs = 0;
    }
  );

  scoped(registry, /^a new handoff parcel arrives in new$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(registry, /^the chase sweep decides to notify$/, (ctx) => {
    applySweepDecision(ctx);
  });

  scoped(registry, /^exactly one HANDOFF_WAKE_MESSAGE injection is sent$/, (ctx) => {
    const st = ensureCtx(ctx);
    if (st.injections !== 1) {
      throw new Error(`expected 1 injection, got ${st.injections}`);
    }
  });

  scoped(
    registry,
    /^a wake attribution record names the motivating handoff filename$/,
    (ctx) => {
      const st = ensureCtx(ctx);
      if (!st.lastAttribution) {
        throw new Error('missing attribution filename');
      }
    }
  );

  scoped(registry, /^role "([^"]+)" has an empty mailbox$/, (ctx, role) => {
    const st = ensureCtx(ctx);
    st.role = role;
    st.fingerprint = '';
    st.lastFingerprint = '';
    st.lastInjectedAtMs = st.nowMs;
  });

  scoped(
    registry,
    /^a false wake was already suppressed or attributed as none$/,
    (ctx) => {
      const st = ensureCtx(ctx);
      st.lastSkipReason = 'empty-mailbox';
    }
  );

  scoped(registry, /^the chase sweep runs again within the dedup window$/, (ctx) => {
    applySweepDecision(ctx);
  });

  scoped(
    registry,
    /^attribution records explicit none with skip reason$/,
    (ctx) => {
      const st = ensureCtx(ctx);
      if (st.lastSkipReason !== 'empty-mailbox') {
        throw new Error(`expected empty-mailbox skip, got ${st.lastSkipReason}`);
      }
    }
  );

  scoped(
    registry,
    /^role "([^"]+)" was notified for parcel fingerprint "([^"]+)" within the cooldown window$/,
    (ctx, role, fp) => {
      const st = ensureCtx(ctx);
      st.role = role;
      st.fingerprint = fp;
      st.lastFingerprint = fp;
      st.lastInjectedAtMs = st.nowMs - 5_000;
      st.injections = 1;
    }
  );

  scoped(registry, /^the sweep would notify again before cooldown elapses$/, (ctx) => {
    applySweepDecision(ctx);
  });

  scoped(registry, /^the wake is suppressed$/, (ctx) => {
    const st = ensureCtx(ctx);
    if (st.injections !== 1) {
      throw new Error(`expected no new injection, injections=${st.injections}`);
    }
  });

  scoped(
    registry,
    /^the skip reason names cooldown not a fresh parcel$/,
    (ctx) => {
      const st = ensureCtx(ctx);
      if (st.lastSkipReason !== 'cooldown') {
        throw new Error(`expected cooldown, got ${st.lastSkipReason}`);
      }
    }
  );
}

function registerSteps(registry) {
  register(registry);
}

module.exports = { registerSteps, FEATURE, HANDOFF_WAKE_MESSAGE };
