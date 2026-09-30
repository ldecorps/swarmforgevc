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

// BL-1815: every stub carries a recording (never real-disk) persistPayload,
// so none of these tests writes under the fake /tmp/repo target path.
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
          ? { ok: true, captured: true, injected: true, payload: { role, continuitySummary: outgoing.transcriptSummary }, injectResult: { ok: true } }
          : { ok: false, captured: true, injected: false, signal };
      },
      persistPayload: (targetPath, role, payload, capturedAt) => {
        calls.push({ persisted: { targetPath, role, payload, capturedAt } });
        return `${targetPath}/.swarmforge/agent-memory/${role}/payload.json`;
      },
      now: () => '2026-09-30T00:00:00.000Z',
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

  it('carries an optional --summary-file path through, omitted when absent', () => {
    assert.equal(parseTrialBoundaryArgs(ARGS).summaryFile, undefined);
    assert.equal(
      parseTrialBoundaryArgs([...ARGS, '--summary-file', '/tmp/brief.md']).summaryFile,
      '/tmp/brief.md'
    );
  });

  it('omitting --summary-file keeps the parsed shape identical to before BL-1815', () => {
    assert.deepEqual(parseTrialBoundaryArgs(ARGS), {
      role: 'coder',
      boundary: 'start',
      targetPath: '/tmp/repo',
      transcriptSummary: '',
    });
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

  it('reads --summary-file (trimmed) as the transcript summary in place of --summary', () => {
    const { calls, deps } = stubs();
    deps.readSummaryFile = (path) => {
      calls.push({ readSummaryFile: path });
      return '  the outgoing seat brief  \n';
    };

    const args = parseTrialBoundaryArgs([...ARGS, '--summary-file', '/tmp/brief.md']);
    runTrialBoundaryMemory(args, deps);

    assert.deepEqual(calls[0].readSummaryFile, '/tmp/brief.md');
    assert.equal(calls[1].built.transcriptSummary, 'the outgoing seat brief');
  });

  it('persists the payload with capturedAt only after a successful transfer', () => {
    const { calls, deps } = stubs({ ok: true });

    runTrialBoundaryMemory(parseTrialBoundaryArgs(ARGS), deps);

    const persisted = calls.find((c) => c.persisted).persisted;
    assert.equal(persisted.targetPath, '/tmp/repo');
    assert.equal(persisted.role, 'coder');
    assert.equal(persisted.capturedAt, '2026-09-30T00:00:00.000Z');
    assert.equal(persisted.payload.role, 'coder');
  });

  it('never persists a payload when the transfer fails', () => {
    const { calls, deps } = stubs({ ok: false, signal: 'inject refused' });

    runTrialBoundaryMemory(parseTrialBoundaryArgs(ARGS), deps);

    assert.equal(calls.some((c) => c.persisted), false);
  });

  it('reports a failed transfer as not ok, carrying the signal', () => {
    const { deps } = stubs({ ok: false, signal: 'inject refused' });

    const report = runTrialBoundaryMemory(parseTrialBoundaryArgs(ARGS), deps);

    assert.equal(report.ok, false);
    assert.equal(report.captured, true);
    assert.equal(report.injected, false);
    assert.equal(report.signal, 'inject refused');
  });

  it('passes through a false captured flag when the capture step itself failed', () => {
    const deps = {
      buildState: () => ({ role: 'coder', transcriptSummary: '', openParcelIds: [] }),
      transfer: () => ({ ok: false, captured: false, injected: false, signal: 'capture failed' }),
    };

    const report = runTrialBoundaryMemory(parseTrialBoundaryArgs(ARGS), deps);

    assert.equal(report.captured, false);
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

  function withCapturedStdout(fn) {
    const written = [];
    const realWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      return { result: fn(), report: () => JSON.parse(written.join('')) };
    } finally {
      process.stdout.write = realWrite;
    }
  }

  it('exits 0 and reports ok when the transfer succeeds', () => {
    const { deps } = stubs({ ok: true });

    const { result, report } = withCapturedStdout(() => main(ARGS, deps));

    assert.equal(result, 0);
    assert.equal(report().ok, true);
  });

  it('exits 1 and reports the failure signal when the transfer fails', () => {
    const { deps } = stubs({ ok: false, signal: 'inject refused' });

    const { result, report } = withCapturedStdout(() => main(ARGS, deps));

    assert.equal(result, 1);
    assert.equal(report().ok, false);
    assert.equal(report().signal, 'inject refused');
  });
});
