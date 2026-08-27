'use strict';

// BL-1164: acceptance for Article 4.5 / QA.prompt / how-to changed-path gate.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'QA changed-path unit test gate';

function gitShow(relPath) {
  return execFileSync('git', ['show', `HEAD:${relPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function readTracked(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  if (fs.existsSync(abs)) {
    return fs.readFileSync(abs, 'utf8');
  }
  return gitShow(relPath);
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(pattern, fn, FEATURE);

  scoped(/^the constitution article on quality gates at the parcel commit$/, (ctx) => {
    ctx.articleText = readTracked('swarmforge/constitution/articles/04_quality_gates.md');
    ctx.amendmentText = readTracked(
      'swarmforge/constitution/articles/reference/changed-path-unit-test-gate-amendment-2026-08-27.md'
    );
  });

  scoped(/^Article 4 is read for changed-path obligations$/, (ctx) => {
    ctx.articleBundle = `${ctx.articleText}\n${ctx.amendmentText}`;
  });

  scoped(
    /^it requires QA to run mapped unit wiring or suite-manifest tests for each changed production path$/,
    (ctx) => {
      assert.match(ctx.articleBundle, /changed.?path/i);
      assert.match(ctx.articleBundle, /suite-manifest|mapped unit|wiring/i);
    }
  );

  scoped(
    /^it requires bouncing to coder when changed production code has no mapped automated test$/,
    (ctx) => {
      assert.match(ctx.articleBundle, /bounce/i);
      assert.match(ctx.articleBundle, /coder/i);
      assert.match(ctx.articleBundle, /no.*(?:mapped|registered|automated).*test/i);
    }
  );

  scoped(
    /^it requires recording each changed-path command in the Article 4\.4 inventory$/,
    (ctx) => {
      assert.match(ctx.articleBundle, /4\.4|Article 4\.4|inventory/i);
      assert.match(ctx.articleBundle, /RUN|BLOCKED BY|record/i);
    }
  );

  scoped(/^swarmforge roles QA\.prompt at the parcel commit$/, (ctx) => {
    ctx.qaPrompt = readTracked('swarmforge/roles/QA.prompt');
  });

  scoped(/^the Verification Order section is read$/, (ctx) => {
    const idx = ctx.qaPrompt.indexOf('Verification Order');
    assert.ok(idx >= 0, 'Verification Order section missing');
    ctx.verificationOrder = ctx.qaPrompt.slice(idx, idx + 2500);
  });

  scoped(
    /^it instructs QA to diff the parcel against origin main for changed production files$/,
    (ctx) => {
      // QA.prompt names the gate; Article 4.5 amendment spells the diff command.
      const blob = `${ctx.verificationOrder}\n${readTracked('swarmforge/constitution/articles/reference/changed-path-unit-test-gate-amendment-2026-08-27.md')}`;
      assert.match(blob, /changed production path|origin\/main\.\.\.HEAD|mapped unit/i);
    }
  );

  scoped(
    /^it instructs QA to run mapped unit or wiring tests from suite-manifest\.tsv and repo conventions$/,
    (ctx) => {
      const blob = `${ctx.verificationOrder}\n${readTracked('swarmforge/constitution/articles/reference/changed-path-unit-test-gate-amendment-2026-08-27.md')}`;
      assert.match(blob, /suite-manifest\.tsv|mapped unit\/wiring|wiring tests/i);
    }
  );

  scoped(
    /^it names bouncing to coder with failureClass unit when no test maps to a changed path$/,
    (ctx) => {
      assert.match(ctx.verificationOrder, /failureClass:\s*unit|`failureClass: unit`/);
      assert.match(ctx.verificationOrder, /bounce|coder/i);
    }
  );

  scoped(
    /^it cites test_handoffd_one_shot_flags_parse\.sh as the handoffd\.bb example$/,
    (ctx) => {
      const amendment = readTracked(
        'swarmforge/constitution/articles/reference/changed-path-unit-test-gate-amendment-2026-08-27.md'
      );
      const blob = `${ctx.verificationOrder}\n${amendment}`;
      assert.match(blob, /test_handoffd_one_shot_flags_parse\.sh/);
      assert.match(blob, /handoffd\.bb/);
    }
  );

  scoped(/^the documenter corpus at the parcel commit$/, (ctx) => {
    ctx.howto = readTracked('docs/how-to/BL-1164-qa-changed-path-unit-test-gate.md');
    ctx.docsIndex = readTracked('docs/index.md');
  });

  scoped(/^docs are searched for changed-path QA inventory guidance$/, (ctx) => {
    assert.match(ctx.docsIndex, /BL-1164|changed-path/i);
    ctx.howtoHit = ctx.howto;
  });

  scoped(
    /^a how-to page explains manifest grep and the narrowest command per changed path$/,
    (ctx) => {
      assert.match(ctx.howtoHit, /manifest|suite-manifest|grep/i);
      assert.match(ctx.howtoHit, /narrowest|command/i);
    }
  );

  scoped(
    /^that page explains bouncing to coder when a changed production path has no mapped test$/,
    (ctx) => {
      assert.match(ctx.howtoHit, /bounce/i);
      assert.match(ctx.howtoHit, /coder/i);
    }
  );

  scoped(
    /^that page explains recording RUN or BLOCKED BY for each changed-path command in bounce evidence$/,
    (ctx) => {
      assert.match(ctx.howtoHit, /RUN/);
      assert.match(ctx.howtoHit, /BLOCKED BY/);
    }
  );
}

module.exports = { registerSteps };
