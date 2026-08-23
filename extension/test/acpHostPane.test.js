'use strict';

// BL-1081: in-process coverage for the ACP pane-host entry point.
// main()/runAcpHostPane must be exercised here — a subprocess smoke test
// cannot feed Stryker or CRAP (CLI main()-thin-wrapper rule).

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  runAcpHostPane,
  main,
  createDefaultAcpHostPaneDeps,
} = require('../out/tools/acp-host-pane');

function mkRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl1081-acp-host-'));
}

function fakeChild(stdoutLines = [], exitCode = 0, stderrLines = []) {
  const child = new EventEmitter();
  child.stdout = Readable.from(stdoutLines.map((l) => `${l}\n`));
  child.stderr = Readable.from(stderrLines.map((l) => `${l}\n`));
  // Resolve close only after both streams end so readline 'line' handlers run
  // first (mirrors a real process: streams drain, then exit).
  let pending = 2;
  const onEnd = () => {
    pending -= 1;
    if (pending === 0) queueMicrotask(() => child.emit('close', exitCode));
  };
  child.stdout.on('end', onEnd);
  child.stderr.on('end', onEnd);
  return child;
}

function mkDeps(overrides = {}) {
  const lines = [];
  const snapshots = [];
  const spawns = [];
  return {
    lines,
    snapshots,
    spawns,
    deps: {
      writeLine: (line) => lines.push(line),
      writeSnapshotFile: (absPath, body) => {
        snapshots.push({ absPath, body });
      },
      spawnAgent: (argv, opts) => {
        spawns.push({ argv, opts });
        return overrides.child ? overrides.child(argv, opts) : fakeChild();
      },
      resolveRepoRoot: () => overrides.repoRoot || '/repo',
    },
  };
}

function baseArgs(repoRoot) {
  return {
    help: false,
    role: 'coder',
    agent: 'vibe',
    workdir: '/wt',
    promptFile: '/p.md',
    firstMessage: 'hello',
    repoRoot,
  };
}

test('runAcpHostPane --help prints usage and never spawns', async () => {
  const root = mkRepo();
  try {
    const h = mkDeps({ repoRoot: root });
    const code = await runAcpHostPane({ ...baseArgs(root), help: true }, h.deps);
    assert.equal(code, 0);
    assert.equal(h.spawns.length, 0);
    assert.match(h.lines.join('\n'), /Usage: acp-host-pane/);
    assert.match(h.lines.join('\n'), /vibe/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runAcpHostPane writes an acp:true snapshot before the agent speaks', async () => {
  const root = mkRepo();
  try {
    const h = mkDeps({ repoRoot: root });
    const code = await runAcpHostPane(baseArgs(root), h.deps);
    assert.equal(code, 0);
    assert.ok(h.snapshots.length >= 1, 'at least the boot snapshot');
    const boot = JSON.parse(h.snapshots[0].body);
    assert.equal(boot.acp, true);
    assert.equal(boot.role, 'coder');
    assert.equal(
      h.snapshots[0].absPath,
      path.join(root, '.swarmforge', 'acp', 'coder.json')
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runAcpHostPane spawns vibe with ACP=1 and the planned argv', async () => {
  const root = mkRepo();
  try {
    const h = mkDeps({ repoRoot: root });
    await runAcpHostPane(
      { ...baseArgs(root), addDir: '/repo', extraCli: '--model x' },
      h.deps
    );
    assert.equal(h.spawns.length, 1);
    assert.deepEqual(h.spawns[0].argv.slice(0, 5), [
      'vibe',
      '--yolo',
      '--trust',
      '--workdir',
      '/wt',
    ]);
    assert.ok(h.spawns[0].argv.includes('--add-dir'));
    assert.ok(h.spawns[0].argv.includes('--model'));
    assert.ok(h.spawns[0].argv.includes('hello'));
    assert.equal(h.spawns[0].opts.cwd, '/wt');
    assert.equal(h.spawns[0].opts.env.ACP, '1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runAcpHostPane ingests agent stdout into the pane transcript', async () => {
  const root = mkRepo();
  try {
    const chunk = JSON.stringify({
      method: 'session/update',
      params: {
        update: { sessionUpdate: 'agent_message_chunk', content: 'hello pane' },
      },
    });
    const h = mkDeps({
      repoRoot: root,
      child: () => fakeChild(['banner line', chunk]),
    });
    await runAcpHostPane(baseArgs(root), h.deps);
    assert.ok(h.lines.includes('banner line'));
    assert.ok(h.lines.includes('hello pane'));
    // Protocol facts must refresh the seat snapshot via the session callback —
    // the boot write alone does not prove writeSnapshot is wired.
    assert.ok(h.snapshots.length >= 2, `expected post-ingest snapshot, got ${h.snapshots.length}`);
    const last = JSON.parse(h.snapshots[h.snapshots.length - 1].body);
    assert.equal(last.acp, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runAcpHostPane ingests agent stderr the same way as stdout', async () => {
  const root = mkRepo();
  try {
    const chunk = JSON.stringify({
      method: 'session/update',
      params: {
        update: { sessionUpdate: 'agent_message_chunk', content: 'from stderr' },
      },
    });
    const h = mkDeps({
      repoRoot: root,
      child: () => fakeChild([], 0, ['stderr banner', chunk]),
    });
    await runAcpHostPane(baseArgs(root), h.deps);
    assert.ok(h.lines.includes('stderr banner'));
    assert.ok(h.lines.includes('from stderr'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runAcpHostPane returns 1 when spawn errors', async () => {
  const root = mkRepo();
  try {
    const h = mkDeps({
      repoRoot: root,
      child: () => {
        const child = new EventEmitter();
        child.stdout = Readable.from([]);
        child.stderr = Readable.from([]);
        queueMicrotask(() => child.emit('error', new Error('ENOENT vibe')));
        return child;
      },
    });
    const code = await runAcpHostPane(baseArgs(root), h.deps);
    assert.equal(code, 1);
    assert.match(h.lines.join('\n'), /failed to spawn agent: ENOENT vibe/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runAcpHostPane treats a null close code as 0', async () => {
  const root = mkRepo();
  try {
    const h = mkDeps({
      repoRoot: root,
      child: () => {
        const child = new EventEmitter();
        child.stdout = Readable.from([]);
        child.stderr = Readable.from([]);
        queueMicrotask(() => child.emit('close', null));
        return child;
      },
    });
    assert.equal(await runAcpHostPane(baseArgs(root), h.deps), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main() returns 64 on a refused non-spike agent', async () => {
  const prevErr = process.stderr.write;
  let err = '';
  process.stderr.write = (chunk) => {
    err += String(chunk);
    return true;
  };
  try {
    const code = await main([
      '--role',
      'coder',
      '--agent',
      'gemini',
      '--workdir',
      '/wt',
      '--prompt-file',
      '/p.md',
      '--repo',
      '/repo',
    ]);
    assert.equal(code, 64);
    assert.match(err, /refusing to host agent/);
  } finally {
    process.stderr.write = prevErr;
  }
});

test('main() --help exits 0 via real deps without spawning vibe', async () => {
  const prevOut = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += String(chunk);
    return true;
  };
  try {
    const code = await main(['--help']);
    assert.equal(code, 0);
    assert.match(out, /Usage: acp-host-pane/);
  } finally {
    process.stdout.write = prevOut;
  }
});

test('createDefaultAcpHostPaneDeps resolveRepoRoot returns process.cwd()', () => {
  const defaults = createDefaultAcpHostPaneDeps();
  assert.equal(defaults.resolveRepoRoot(), process.cwd());
});

test('createDefaultAcpHostPaneDeps writeSnapshotFile creates dirs and writes utf8', () => {
  const root = mkRepo();
  try {
    const defaults = createDefaultAcpHostPaneDeps();
    // Deep path: recursive:true is load-bearing (single-level mkdir works without it).
    const abs = path.join(root, 'a', 'b', 'c', 'seat.json');
    defaults.writeSnapshotFile(abs, 'café\n');
    assert.equal(fs.readFileSync(abs, 'utf8'), 'café\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createDefaultAcpHostPaneDeps spawnAgent honours cwd and piped stdio', async () => {
  const root = mkRepo();
  try {
    const defaults = createDefaultAcpHostPaneDeps();
    const child = defaults.spawnAgent(
      ['node', '-e', 'process.stdout.write(process.cwd()+"\\n")'],
      { cwd: root, env: process.env }
    );
    assert.ok(child.stdout, 'stdout must be piped for the ACP host to read ACP lines');
    assert.ok(child.stderr, 'stderr must be piped so banner lines still reach the pane');
    assert.equal(child.stdin, null, 'stdin must be ignore — the host never writes prompts to the agent CLI');
    const chunks = [];
    for await (const chunk of child.stdout) chunks.push(String(chunk));
    assert.equal(chunks.join('').trim(), root);
    await new Promise((resolve) => child.on('close', resolve));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main() defaults argv to process.argv.slice(2)', async () => {
  const root = mkRepo();
  const prevArgv = process.argv;
  const prevErr = process.stderr.write;
  process.stderr.write = () => true;
  try {
    fs.writeFileSync(path.join(root, 'p.md'), 'hi\n');
    // Deliberately omit the node/script prefix: slice(2) drops the first two
    // flags and fails; the mutant that passes process.argv through succeeds.
    process.argv = [
      '--role',
      'coder',
      '--workdir',
      root,
      '--prompt-file',
      path.join(root, 'p.md'),
    ];
    const h = mkDeps({ repoRoot: root });
    const code = await main(undefined, {
      ...h.deps,
      resolveRepoRoot: () => root,
    });
    assert.equal(code, 64, 'slice(2) must drop --role/--workdir and refuse the parse');
    assert.equal(h.spawns.length, 0);
  } finally {
    process.argv = prevArgv;
    process.stderr.write = prevErr;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main() threads resolveRepoRoot into parse when --repo is omitted', async () => {
  const root = mkRepo();
  try {
    fs.writeFileSync(path.join(root, 'p.md'), 'hi\n');
    const h = mkDeps({ repoRoot: root });
    const code = await main(
      ['--role', 'coder', '--workdir', root, '--prompt-file', path.join(root, 'p.md')],
      {
        ...h.deps,
        resolveRepoRoot: () => root,
      }
    );
    assert.equal(code, 0);
    assert.equal(h.snapshots[0].absPath, path.join(root, '.swarmforge', 'acp', 'coder.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
