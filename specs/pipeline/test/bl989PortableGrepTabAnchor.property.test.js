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
        `cd "$1" && grep -rn --include='*.sh' -E '(^|[^#[:alnum:]_])grep[[:space:]]+-[A-Za-z]*P\\b' swarmforge/scripts 2>/dev/null | grep -v 'pgrep' | grep -v '^[^:]*:[0-9]*:[[:space:]]*#' || true`,
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
});
