'use strict';

// BL-968: the standing guard's core, shared between the vitest guard
// (extension/test/bl968StepRegistryMaterializedTreeGuard.test.js), the
// invariant-2 property lane (bl968MaterializedGuardSensitivity.property.
// test.js), and the BL-968 acceptance step handlers - one materialization,
// one planting mechanism, one verdict path, so every lane drives the SAME
// guard, never a re-statement.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// BL-420/BL-771: temp roots come from the shared helper, never a raw
// mkdtemp (tmpDirMigrationGuard). mkSharedTmpDir's per-FILE afterAll sweep
// is the vitest backstop; every caller here still removes its tree
// explicitly (the sweep tolerates already-gone paths), and outside vitest
// (the acceptance step handlers) no sweep ever runs, so explicit removal
// remains the one cleanup path there.
const { mkSharedTmpDir } = require('./tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RESOLVER = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js');

// The same shape pre_qa_gate_gather_lib.bb materializes: specs/pipeline
// mirrored under a fresh NON-git temp root, node_modules and extension
// symlinked in from this checkout as infrastructure.
//
// Contract (BL-968 architect bounce D1): either returns a valid
// {root, pipelineDir} or leaves NO temp dir behind - the copy/symlink work
// after mkSharedTmpDir can throw (concurrent writer mid-copy, ENOSPC,
// permission error), and only THIS function has the root in scope on that
// path, so the failure cleanup lives here, for every caller. Outside
// vitest (the acceptance step handlers) no sweep exists, making this the
// one cleanup path there. `sourceRoot`/`prefix` are test seams for the
// failure-path guard test only - production callers pass nothing.
function materializeCurrentPipeline({ sourceRoot = REPO_ROOT, prefix = 'bl968-materialized-' } = {}) {
  const root = mkSharedTmpDir(prefix);
  try {
    const dest = path.join(root, 'specs', 'pipeline');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(path.join(sourceRoot, 'specs', 'pipeline'), dest, { recursive: true });
    for (const sibling of ['node_modules', 'extension']) {
      const target = path.join(sourceRoot, sibling);
      if (fs.existsSync(target)) {
        fs.symlinkSync(fs.realpathSync(target), path.join(root, sibling));
      }
    }
    return { root, pipelineDir: dest };
  } catch (err) {
    fs.rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

// The REAL resolver's verdict over a materialized tree - loaded STRICTER
// than the live gate loads it, deliberately: the child's PATH points at an
// empty directory, so a load-time subprocess that would SUCCEED on a live
// PATH (the bl936 shape: `command -v bb` works fine outside a repo, so
// pure loadability never sees it) fails its binary lookup loudly instead.
// require() never consults PATH, so a registry whose load-time work really
// is only requires and pure constants (invariant 1) is indifferent to the
// neutering; the resolver itself is spawned by ABSOLUTE path
// (process.execPath) because the child-env PATH is what the OS uses for
// the lookup. Residual blind spot, accepted and recorded: a load-time
// subprocess invoked by absolute path with no repo/tree dependency (e.g.
// /bin/echo) still loads clean - no declared offender class has that
// shape.
// On an unloadable registry the direct require probe (same neutered env)
// re-runs the failure to capture the require STACK, which NAMES the file
// whose load-time work killed the chain - the resolver's own error carries
// only the failure message.
function registryLoadVerdict(pipelineDir, workDir) {
  const irPath = path.join(workDir, 'bl968-empty-feature-ir.json');
  fs.writeFileSync(irPath, JSON.stringify({ name: 'bl968-guard', scenarios: [] }));
  const neuteredBin = path.join(workDir, 'bl968-neutered-path');
  fs.mkdirSync(neuteredBin, { recursive: true });
  const env = { ...process.env, PATH: neuteredBin };
  const res = spawnSync(process.execPath, [RESOLVER, pipelineDir, irPath], { encoding: 'utf8', env });
  let verdict;
  if (res.status !== 0 || !res.stdout) {
    verdict = { loadable: false, error: `resolver exited ${res.status}: ${res.stderr || ''}`.trim() };
  } else {
    verdict = JSON.parse(res.stdout.trim().split('\n').pop());
  }
  if (!verdict.loadable) {
    const probe = spawnSync(
      process.execPath,
      ['-e', `try { require(${JSON.stringify(path.join(pipelineDir, 'steps', 'index.js'))}); } catch (e) { console.error(e.stack); process.exit(1); }`],
      { encoding: 'utf8', env }
    );
    verdict.detail = probe.stderr || '';
  }
  return verdict;
}

// Plants one offender step file into a materialized tree and registers it
// FIRST in steps/index.js's DOMAINS list. `files` maps a steps/-relative
// path to its source, so an offender can also live in a lib module a
// clean-looking step file requires (the chain-depth axis). Returns a
// restore() that unpatches the index and removes every planted file, so a
// shared tree can be reused across draws.
function plantOffender(pipelineDir, { registerRelPath, files }) {
  const indexPath = path.join(pipelineDir, 'steps', 'index.js');
  const originalIndex = fs.readFileSync(indexPath, 'utf8');
  const marker = 'const DOMAINS = [';
  if (!originalIndex.includes(marker)) {
    throw new Error(`steps/index.js no longer carries the '${marker}' registration marker the guard patches`);
  }
  const planted = [];
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(pipelineDir, 'steps', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
    planted.push(full);
  }
  fs.writeFileSync(indexPath, originalIndex.replace(marker, `${marker}\n  require('./${registerRelPath}'),`));
  return {
    restore() {
      fs.writeFileSync(indexPath, originalIndex);
      for (const full of planted) {
        fs.rmSync(full, { force: true });
      }
    },
  };
}

module.exports = { materializeCurrentPipeline, registryLoadVerdict, plantOffender };
