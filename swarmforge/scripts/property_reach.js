#!/usr/bin/env node
// property_reach.js - BL-1877 (ruling A): which property files a staged
// change reaches, so check_property_suite_drift.sh runs those instead of
// the whole property lane (493 files, about 7 minutes) on every commit.
//
// Usage: node property_reach.js <repo-root> <staged-path>...
//   staged paths are repo-relative (the guard's TRIGGER_PATHS).
//
// Prints one property file per line, relative to extension/ (the form
// `vitest run --config vitest.properties.config.mjs <files>` takes), or the
// single line ALL when the reach cannot be computed. ALL is the safe
// answer: the guard then runs the whole lane, as it did before BL-1877.
// Any thrown error exits non-zero, which the guard also reads as ALL.
//
// A property file is reached when:
//   1. it is itself staged; or
//   2. its literal require/import graph reaches a changed module (through
//      test helpers, specs/pipeline modules and other out/ modules); or
//   3. it names a reached out/ module or the changed source file by file
//      name (a spawned CLI: path.join(OUT, 'tools', 'x.js')); or
//   4. it names a swarmforge/scripts or specs/pipeline script that itself
//      names a reached out/ module (a test spawning a bb script that runs
//      node out/tools/x.js); or
//   5. it loads modules by a non-literal require, and either names a
//      reached out/ module as a bare quoted segment, or loads step handlers
//      while the change reaches one under specs/pipeline/steps (the
//      registry loaders).
// The whole lane runs instead when a staged path is not a .ts module
// under extension/src (or a property file), when a staged module was
// deleted or has no compiled out/ file, or when the change reaches the
// lane's own config or setup files.

const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['node_modules', '.git', '.stryker-tmp', 'reports', 'coverage', 'generated']);

function walk(dir, pred, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (e.isFile() && pred(p)) out.push(p);
  }
  return out;
}

const SPEC_RE = /(?:require|import)\s*\(\s*(['"`])([^'"`$]+)\1\s*\)|from\s+(['"])([^'"]+)\3/g;
const DYNAMIC_REQUIRE_RE = /require\(\s*[^'"`\s)]/;

function literalSpecifiers(text) {
  const out = [];
  for (const m of text.matchAll(SPEC_RE)) {
    const spec = m[2] || m[4];
    if (spec && spec.startsWith('.')) out.push(spec);
  }
  return out;
}

function resolveSpecifier(fromFile, spec, known) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (known.has(cand)) return cand;
  }
  return null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A name matches only WITH its file extension (`x.js`, `x.ts`, `x.bb`,
// `x.sh`), right after a quote or a `/`: that is how code names a file it
// runs ('out/tools/x.js', path.join(OUT, 'tools', 'x.js')). A bare segment
// such as 'extension' (out/extension.js) appears in nearly every path a
// test builds, prose ("record-bounce.js writes to", in a docstring) runs
// nothing, and an extensionless require is already an edge in the graph.
// Whole-line comments only: a script or test that merely MENTIONS a module
// in prose (land_step_lib.bb's ";; record-bounce.js writes to ...") does
// not run it, and counting it pulled every land-step property file into a
// one-line change to recordBounceArgs.ts.
function codeLines(text) {
  return text.split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*|;|#)/.test(line))
    .join('\n');
}

function nameRegex(names) {
  const alts = [...names].map(escapeRe).join('|');
  return alts ? new RegExp(`[/'"\`](?:${alts})\\.(?:js|ts|bb|sh)\\b`) : null;
}

// For the few property files that require by a built path
// (require(path.join(OUT, 'swarm', 'swarmState'))), the module is named
// with no extension, so a bare quoted segment counts too - only in those
// files, where it cannot drown the lane.
function bareNameRegex(names) {
  const alts = [...names].map(escapeRe).join('|');
  return alts ? new RegExp(`[/'"\`](?:${alts})(?:\\.(?:js|ts))?(?![A-Za-z0-9_.-])`) : null;
}

const LOADS_STEPS_RE = /stepRegistry|['"\/]steps['"\/]/;

function computeReach(root, staged) {
  const ext = path.join(root, 'extension');
  const outDir = path.join(ext, 'out');
  const propertyFiles = walk(path.join(ext, 'test'), (p) => p.endsWith('.property.test.js'), []);
  const reached = new Set();
  const changed = [];
  const changedSourceNames = new Set();

  for (const rel of staged) {
    const abs = path.join(root, rel);
    if (rel.endsWith('.property.test.js')) {
      if (!rel.startsWith('extension/test/')) return null;
      if (fs.existsSync(abs)) reached.add(abs);
      continue;
    }
    if (!rel.startsWith('extension/src/') || !rel.endsWith('.ts') || rel.endsWith('.d.ts')) return null;
    if (!fs.existsSync(abs)) return null;
    const compiled = path.join(outDir, rel.slice('extension/src/'.length).replace(/\.ts$/, '.js'));
    if (!fs.existsSync(compiled)) return null;
    changed.push(compiled);
    changedSourceNames.add(path.basename(rel, '.ts'));
  }
  if (changed.length === 0) return [...reached];

  const isJs = (p) => p.endsWith('.js') || p.endsWith('.mjs');
  const nodes = [
    ...walk(outDir, isJs, []),
    ...walk(path.join(ext, 'test'), isJs, []),
    ...walk(path.join(root, 'specs', 'pipeline'), isJs, []),
  ];
  const configs = fs.readdirSync(ext)
    .filter((f) => /^vitest.*\.config\.mjs$/.test(f))
    .map((f) => path.join(ext, f));
  nodes.push(...configs);
  const known = new Set(nodes);
  const texts = new Map();
  const reverse = new Map();
  for (const n of nodes) {
    const text = fs.readFileSync(n, 'utf8');
    texts.set(n, text);
    for (const spec of literalSpecifiers(text)) {
      const target = resolveSpecifier(n, spec, known);
      if (!target) continue;
      if (!reverse.has(target)) reverse.set(target, []);
      reverse.get(target).push(n);
    }
  }

  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length) {
    const cur = queue.pop();
    for (const dep of reverse.get(cur) || []) {
      if (!affected.has(dep)) {
        affected.add(dep);
        queue.push(dep);
      }
    }
  }

  const propertyConfig = path.join(ext, 'vitest.properties.config.mjs');
  const setupFiles = [...(texts.get(propertyConfig) || '').matchAll(/['"](\.\/test\/helpers\/[^'"]+\.js)['"]/g)]
    .map((m) => path.join(ext, m[1]));
  for (const lane of [...configs, ...setupFiles]) {
    if (affected.has(lane)) return null;
  }

  const names = new Set(changedSourceNames);
  for (const a of affected) {
    if (a.startsWith(outDir + path.sep)) names.add(path.basename(a, '.js'));
  }
  const firstHop = nameRegex(names);
  const scripts = [
    ...walk(path.join(root, 'swarmforge', 'scripts'),
      (p) => /\.(bb|sh|js)$/.test(p) && !p.includes(`${path.sep}test${path.sep}`), []),
    ...walk(path.join(root, 'specs', 'pipeline', 'steps', 'lib'), (p) => /\.(bb|sh)$/.test(p), []),
  ];
  const scriptNames = new Set();
  for (const s of scripts) {
    if (firstHop && firstHop.test(codeLines(fs.readFileSync(s, 'utf8')))) {
      scriptNames.add(path.basename(s).replace(/\.(bb|sh|js)$/, ''));
    }
  }
  const secondHop = nameRegex(scriptNames);
  const bareHop = bareNameRegex(names);
  const stepsDir = path.join(root, 'specs', 'pipeline', 'steps') + path.sep;
  const reachesSteps = [...affected].some((a) => a.startsWith(stepsDir));

  for (const p of propertyFiles) {
    if (reached.has(p)) continue;
    const text = codeLines(texts.get(p) ?? fs.readFileSync(p, 'utf8'));
    if (affected.has(p)
      || (firstHop && firstHop.test(text))
      || (secondHop && secondHop.test(text))
      || (DYNAMIC_REQUIRE_RE.test(text)
        && ((bareHop && bareHop.test(text)) || (reachesSteps && LOADS_STEPS_RE.test(text))))) {
      reached.add(p);
    }
  }
  return [...reached];
}

function main(argv) {
  const [root, ...staged] = argv;
  if (!root || staged.length === 0) {
    process.stdout.write('ALL\n');
    return;
  }
  const absRoot = path.resolve(root);
  const reach = computeReach(absRoot, staged);
  if (reach === null) {
    process.stdout.write('ALL\n');
    return;
  }
  const ext = path.join(absRoot, 'extension');
  const lines = reach.map((p) => path.relative(ext, p)).sort();
  process.stdout.write(lines.length ? `${lines.join('\n')}\n` : '');
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { computeReach, literalSpecifiers, nameRegex };
