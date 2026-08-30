'use strict';

// BL-1182: the bb -> node bridge the BoB trial lifecycle crosses to run
// BL-1178's agent-memory transfer at a trial boundary. What matters about it
// is the CONTRACT the steward reads - the exit status - because that is what
// decides whether the seat moves; an amnesiac seat reported as success is
// BL-1178's own invariant 2.

const assert = require('node:assert/strict');
const {
  parseTrialBoundaryArgs,
  runTrialBoundaryMemory,
  main,
} = require('../out/tools/trial-boundary-memory');

const ARGS = ['--role', 'coder', '--boundary', 'start', '--target', '/tmp/repo'];

function stubs({ ok = true, signal = 'inject refused' } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      buildState: (targetPath, role, transcriptSummary) => {
        calls.push({ built: { targetPath, role, transcriptSummary } });
        return { role, transcriptSummary, openParcelIds: ['p1'] };
      },
      transfer: (role, boundary, outgoing) => {
        calls.push({ transferred: { role, boundary, outgoing } });
        return ok
          ? { ok: true, captured: true, injected: true, payload: {}, injectResult: { ok: true } }
          : { ok: false, captured: true, injected: false, signal };
      },
    },
  };
}

describe('BL-1182 trial-boundary-memory bridge', () => {
  it('parses the role, boundary and target', () => {
    assert.deepEqual(parseTrialBoundaryArgs(ARGS), {
      role: 'coder',
      boundary: 'start',
      targetPath: '/tmp/repo',
      transcriptSummary: '',
    });
  });

  it('carries an optional transcript summary through', () => {
    assert.equal(
      parseTrialBoundaryArgs([...ARGS, '--summary', 'mid-parcel']).transcriptSummary,
      'mid-parcel'
    );
  });

  for (const [missing, argv] of [
    ['role', ['--boundary', 'start', '--target', '/tmp/repo']],
    ['boundary', ['--role', 'coder', '--target', '/tmp/repo']],
    ['target', ['--role', 'coder', '--boundary', 'start']],
  ]) {
    it(`refuses argv with no --${missing}`, () => {
      assert.throws(() => parseTrialBoundaryArgs(argv), new RegExp(missing));
    });
  }

  it('refuses a boundary that is neither start nor end', () => {
    assert.throws(
      () => parseTrialBoundaryArgs(['--role', 'coder', '--boundary', 'middle', '--target', '/t']),
      /start\|end/
    );
  });

  it('captures from the outgoing seat and transfers on the named boundary', () => {
    const { calls, deps } = stubs();

    const report = runTrialBoundaryMemory(parseTrialBoundaryArgs(ARGS), deps);

    assert.deepEqual(report, {
      ok: true,
      role: 'coder',
      boundary: 'start',
      captured: true,
      injected: true,
    });
    assert.deepEqual(calls[0].built, { targetPath: '/tmp/repo', role: 'coder', transcriptSummary: '' });
    assert.equal(calls[1].transferred.boundary, 'start');
    assert.deepEqual(calls[1].transferred.outgoing.openParcelIds, ['p1']);
  });

  it('reports a failed transfer as not ok, carrying the signal', () => {
    const { deps } = stubs({ ok: false, signal: 'inject refused' });

    const report = runTrialBoundaryMemory(parseTrialBoundaryArgs(ARGS), deps);

    assert.equal(report.ok, false);
    assert.equal(report.injected, false);
    assert.equal(report.signal, 'inject refused');
  });

  it('exits 2 with a reason when the arguments are unusable', () => {
    const written = [];
    const realWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      assert.equal(main(['--boundary', 'start']), 2);
    } finally {
      process.stdout.write = realWrite;
    }
    const report = JSON.parse(written.join(''));
    assert.equal(report.ok, false);
    assert.match(report.signal, /--role/);
  });
});
