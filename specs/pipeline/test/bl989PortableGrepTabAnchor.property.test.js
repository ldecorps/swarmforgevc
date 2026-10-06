'use strict';

/**
 * BL-989 invariant: shell helpers the suites drive must not rely on GNU-only
 * `grep -P`. Stock macOS BSD grep rejects -P; agent shells shadow grep with
 * ripgrep and hide the bug — so this test greps sources, not runtime grep.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const REPO = path.join(__dirname, '..', '..', '..');
const TARGETS = [
  'swarmforge/scripts/test/test_role_lifecycle_cli.sh',
  'swarmforge/scripts/test/test_backlog_depth_pack_override.sh',
  'swarmforge/scripts/test/test_coordinator_provider_configurable.sh',
];

describe('BL-989 portable grep tab anchors', () => {
  it('named shell helpers contain no grep -P / -qP / -oP', () => {
    for (const rel of TARGETS) {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
      assert.doesNotMatch(
        src,
        /grep\s+-[A-Za-z]*P\b/,
        `${rel} must not use GNU-only grep -P`
      );
      assert.match(
        src,
        /printf\s+'[^']*\\t'/,
        `${rel} must keep an explicit tab anchor via printf '...\\t'`
      );
    }
    // Lifecycle predicates: both has and lacks must keep the tab (hardener).
    const life = fs.readFileSync(
      path.join(REPO, 'swarmforge/scripts/test/test_role_lifecycle_cli.sh'),
      'utf8'
    );
    const hasLine = life.split('\n').find((l) => /roles_tsv_has\s*\(/.test(l));
    const lacksLine = life.split('\n').find((l) => /roles_tsv_lacks\s*\(/.test(l));
    assert.ok(hasLine && /\\t/.test(hasLine), 'roles_tsv_has must printf a tab');
    assert.ok(lacksLine && /\\t/.test(lacksLine), 'roles_tsv_lacks must printf a tab');
  });

  it('stock /usr/bin/grep accepts the portable printf tab pattern', () => {
    const grepBin = '/usr/bin/grep';
    if (!fs.existsSync(grepBin)) {
      // Non-macOS CI may lack this path; skip rather than false-green on agent grep.
      return;
    }
    const fixture = path.join(
      require('node:os').tmpdir(),
      `bl989-roles-${process.pid}.tsv`
    );
    fs.writeFileSync(
      fixture,
      ['coder\tmaster\t/x', 'cod\tmaster\t/y', 'QA\tmaster\t/z'].join('\n') + '\n'
    );
    const hasCoder = spawnSync(
      'bash',
      ['-c', `grep -q "$(printf '^%s\\t' "coder")" "$1"`, 'x', fixture],
      { encoding: 'utf8' }
    );
    assert.equal(hasCoder.status, 0, hasCoder.stderr);
    // Prefix must not match: "cod" is not the "coder" row.
    const codHits = spawnSync(
      'bash',
      ['-c', `grep "$(printf '^%s\\t' "cod")" "$1" | wc -l`, 'x', fixture],
      { encoding: 'utf8' }
    );
    assert.equal(codHits.stdout.trim(), '1', 'tab anchor must not treat coder as cod');
    const coderHits = spawnSync(
      'bash',
      ['-c', `grep "$(printf '^%s\\t' "coder")" "$1" | wc -l`, 'x', fixture],
      { encoding: 'utf8' }
    );
    assert.equal(coderHits.stdout.trim(), '1');
    // Prove stock BSD grep still rejects -P on this host when present.
    const gnuOnly = spawnSync(grepBin, ['-P', '^coder\t'], {
      input: fs.readFileSync(fixture),
      encoding: 'utf8',
    });
    if (gnuOnly.status !== 0 && /invalid option/.test(gnuOnly.stderr || '')) {
      assert.match(gnuOnly.stderr, /invalid option/);
    }
    fs.unlinkSync(fixture);
  });

  it('tree sweep finds no remaining GNU PCRE grep invocations in *.sh helpers', () => {
    const sweep = spawnSync(
      'bash',
      [
        '-c',
        // Match command invocations only (not comments): start of token `grep` then flags containing P.
        // Exclude hardener *mutation_sweep.sh — those deliberately encode the antipattern as mutants.
        `cd "$1" && grep -rn --include='*.sh' -E '(^|[^#[:alnum:]_])grep[[:space:]]+-[A-Za-z]*P\\b' swarmforge/scripts 2>/dev/null | grep -v 'pgrep' | grep -v 'mutation_sweep\\.sh' | grep -v '^[^:]*:[0-9]*:[[:space:]]*#' || true`,
        'x',
        REPO,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(sweep.status, 0, sweep.stderr);
    assert.equal(
      sweep.stdout.trim(),
      '',
      `expected zero grep PCRE-flag sites in swarmforge/scripts/*.sh, got:\n${sweep.stdout}`
    );
  });

  it('tree sweep finds no single-quoted grep -E pattern carrying a literal \\t in swarmforge/scripts', () => {
    // BL-2040: GNU grep reads \t in an ERE as a literal t, so a single-quoted
    // -E/-qE/-Ee pattern with \t matches nothing and passes on any input
    // (6038e612b4 found three such dead checks in test_bl1861_local_llm_remove.sh).
    // The portable form builds the pattern with printf.
    const sweep = spawnSync(
      'bash',
      [
        '-c',
        `cd "$1" && grep -rn --include='*.sh' -E "(^|[^#[:alnum:]_])grep[[:space:]]+-[A-Za-z]*E[a-zA-z]*[[:space:]]+'[^']*\\\\\\\\t[^']*'" swarmforge/scripts 2>/dev/null | grep -v 'mutation_sweep\\.sh' | grep -v '^[^:]*:[0-9]*:[[:space:]]*#' || true`,
        'x',
        REPO,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(sweep.status, 0, sweep.stderr);
    assert.equal(
      sweep.stdout.trim(),
      '',
      `expected zero single-quoted grep -E patterns with a literal \\t in swarmforge/scripts/*.sh, got:\n${sweep.stdout}`
    );
    // Prove the sweep is not vacuous: a fixture line in the fail-open shape
    // must be flagged.
    const fixture = path.join(
      require('node:os').tmpdir(),
      `bl989-ere-tab-${process.pid}.sh`
    );
    fs.writeFileSync(fixture, "grep -qE '^coder@2\\t|^coder@iq3\\t' \"$f\" && fail\n");
    const probe = spawnSync(
      'bash',
      [
        '-c',
        `grep -n -E "(^|[^#[:alnum:]_])grep[[:space:]]+-[A-Za-z]*E[a-zA-z]*[[:space:]]+'[^']*\\\\\\\\t[^']*'" "$1"`,
        'x',
        fixture,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(
      probe.stdout,
      /1:grep -qE '\^coder@2\\t/,
      'the sweep must flag a single-quoted grep -E pattern containing \\t'
    );
    fs.unlinkSync(fixture);
  });
});
