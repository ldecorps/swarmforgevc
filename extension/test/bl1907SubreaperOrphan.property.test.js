'use strict';

// BL-1907 declared invariants (coder first authorship - BL-654):
//   1. "A process whose parent is the live process that started it never
//       reads orphaned, on any host."
//   2. "A process adopted by the host's adopter of last resort (PID 1, or a
//       child subreaper such as WSL's Relay /init or systemd --user) reads
//       orphaned on every host, exactly as PID 1 adoption does today."
//   3. "No reaper that consults parent-orphaned? ever takes a daemon or
//       supervisor the swarm starts detached, nor a job registered with
//       detach_job.sh (BL-995), even though those are parented to the same
//       adopter."
//
// Invariants 1 and 2: each draw builds a REAL chain of processes,
// p1 -> p2 -> ... -> pN. The chain sits either below a Python fixture that
// made itself a child subreaper (the WSL Relay /init condition, on any
// Linux host) or below no subreaper at all, so orphans go to whatever
// adopts them here (PID 1 on a plain host). A drawn subset of p1..p(N-1)
// exits after starting its child, so every collision candidate is built in:
// at one depth an adopted orphan, at the next a child of a live starter.
// The REAL parent-orphaned? then reads p2..pN from a bb process at the
// subreaper fixture's level, which is where a reaper sits. Every live pk
// (k >= 2) reads orphaned exactly when p(k-1) exited. A link that exits is
// not judged, nor is p1, whose starter is the fixture itself (stated reason
// below).
//
// Stated reason for one sub-case of invariant 1: a process started
// DIRECTLY by the adopter (PID 1 starting a service, the Relay /init
// starting the session's login shell) has the same parent as one the
// adopter adopted, and no process-table field tells the two apart. It
// reads orphaned, as it always has under PID 1. What keeps a reaper off it
// is that reaper's candidate filter, which is invariant 3's property below
// and the architect's live census.
//
// Invariant 3: the swarm's own detached daemons are drawn from a catalog
// of their real launch command lines under a live (non-tmp) root. They are
// parented to the adopter (parent-orphaned? answers true for every one)
// and drawn as very stale. The REAL orphan janitor sweep! (stub adapters
// recording kills) and the REAL onboarder startup reap decision
// (decide-onboarder-orphan-reap) must take none of them. As in
// production, the adapters name the live operator runtime and caffeinate
// by their pidfile pids.
// Stated reason for the third reaper, BL-108's job reaper:
// handoffd_supervisor.bb calls (-main) at load, so its filter cannot be
// called in-process. Its filter is job-process-pattern (stryker,
// `node --test`, vitest) plus scope. test_handoffd_supervisor_job_reaper.sh
// case 05 pins "a live agent's run is never touched", and the architect's
// read-only census runs all three filters over the host's live adopter
// children (the ticket's architect pass).
//
// Reach floor: adopted and live-starter judgements both occur, under a
// subreaper and without one, and every catalog daemon is drawn at least
// once.
//
// Non-vacuity:
// - With parent-orphaned? reverted to the PID-1-only rule, invariant 2
//   fails on the first adopted process below the fixture subreaper.
// - With the catalog gaining a deliberately leaked shape (an onboarder
//   reconcile poll-loop on the live root), invariant 3 fails ("the
//   onboarder reap took"). Both restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const SCRIPTS = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'process_table_lib.bb');

// argv: subreaper(0|1), exits ("0101..." per p1..p(N-1)), lib path.
// Prints one JSON line {judged: [[k, expected, got], ...]}.
const CHAIN_FIXTURE = `
import ctypes, json, os, signal, subprocess, sys, time
subreaper, exits, lib = sys.argv[1] == "1", sys.argv[2], sys.argv[3]
if subreaper and ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) != 0:
    print("NO_SUBREAPER"); sys.exit(3)
n = len(exits) + 1
r, w = os.pipe()
def link(k):
    # Runs as p_k: report the pid, start p_(k+1), then exit or stay.
    os.write(w, f"{k} {os.getpid()}\\n".encode())
    if k < n:
        if os.fork() == 0:
            link(k + 1)
        if exits[k - 1] == "1":
            os._exit(0)
    time.sleep(60)
    os._exit(0)
first = os.fork()
if first == 0:
    os.close(r)
    link(1)
os.close(w)
pids, buf = {}, b""
while len(pids) < n:
    chunk = os.read(r, 4096)
    if not chunk:
        break
    buf += chunk
    for line in buf.decode().splitlines():
        k, p = line.split()
        pids[int(k)] = int(p)
os.close(r)
def ppid_of(pid):
    with open(f"/proc/{pid}/stat") as f:
        return int(f.read().rsplit(")", 1)[1].split()[1])
def alive(pid):
    try:
        os.kill(pid, 0); return os.path.exists(f"/proc/{pid}") and open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        return False
# Only links that stay alive are judged: pN, and every p_k that does not exit.
judged = [k for k in range(2, n + 1) if k == n or exits[k - 1] == "0"]
try:
    # Wait until every exiting link has exited and each judged child whose
    # starter exited has been reparented.
    for _ in range(300):
        done = all((not alive(pids[k])) == (exits[k - 1] == "1") for k in range(1, n))
        done = done and all(ppid_of(pids[k]) != pids[k - 1] for k in judged if exits[k - 2] == "1")
        if done:
            break
        time.sleep(0.01)
    prog = f'(load-file "{lib}") (println (pr-str (mapv process-table-lib/parent-orphaned? {[pids[k] for k in judged]})))'.replace(",", "")
    out = subprocess.run(["bb", "-e", prog], capture_output=True, text=True, timeout=60)
    got = [t == "true" for t in out.stdout.strip().strip("[]").split()]
    print(json.dumps({"judged": [[k, exits[k - 2] == "1", g, ppid_of(pids[k])] for k, g in zip(judged, got)],
                      "err": out.stderr[-400:]}))
finally:
    for p in pids.values():
        try:
            os.kill(p, signal.SIGKILL)
        except ProcessLookupError:
            pass
    while True:
        try:
            if os.waitpid(-1, 0)[0] <= 0:
                break
        except ChildProcessError:
            break
`;

function runChain(dir, { subreaper, exits }) {
  const file = path.join(dir, 'chain.py');
  fs.writeFileSync(file, CHAIN_FIXTURE);
  const res = spawnSync('python3', [file, subreaper ? '1' : '0', exits, LIB], { encoding: 'utf8', timeout: 120000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, out);
  const line = (res.stdout || '').trim().split('\n').pop();
  return { parsed: JSON.parse(line), out };
}

const chainDraw = fc.record({
  subreaper: fc.boolean(),
  // p1..p(N-1): 1 = exits after starting its child.
  exits: fc.array(fc.constantFrom('0', '1'), { minLength: 1, maxLength: 4 }).map((a) => a.join('')),
});

const CHAIN_EXAMPLES = [
  [{ subreaper: true, exits: '10' }],
  [{ subreaper: true, exits: '0101' }],
  [{ subreaper: false, exits: '01' }],
  // Consecutive exiting links: one is judged only once its own child is,
  // never while it is itself exiting (a shrunk counterexample, 2026-10-03).
  [{ subreaper: false, exits: '110' }],
  [{ subreaper: true, exits: '11' }],
];

test(
  'BL-1907/BL-654 invariants 1-2: a child of its live starter never reads orphaned; an adopted orphan always does, below a subreaper or not',
  () => {
    const reach = { adoptedBelowSubreaper: 0, liveBelowSubreaper: 0, adoptedPlain: 0, livePlain: 0 };
    fc.assert(
      fc.property(chainDraw, (d) => {
        const { parsed, out } = runChain(mkTmpDir('sfvc-bl1907-chain-'), d);
        // pN and every link that does not exit are judged.
        const live = [...d.exits].slice(1).filter((e) => e === '0').length + 1;
        assert.equal(parsed.judged.length, live, out);
        for (const [k, adopted, got, ppid] of parsed.judged) {
          assert.equal(got, adopted, `p${k} (parent ${ppid}) read orphaned=${got}, starter ${adopted ? 'exited' : 'live'}; ${JSON.stringify(d)}\n${out}`);
          reach[`${adopted ? 'adopted' : 'live'}${d.subreaper ? 'BelowSubreaper' : 'Plain'}`] += 1;
        }
      }),
      { numRuns: 6, examples: CHAIN_EXAMPLES }
    );
    for (const k of Object.keys(reach)) assert.ok(reach[k] >= 1, `${k} reached: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

// ── invariant 3 ──────────────────────────────────────────────────────────
const DAEMONS = {
  handoffd: (r) => `bb ${r}/swarmforge/scripts/handoffd.bb ${r}`,
  handoffdSupervisor: (r) => `bb ${r}/swarmforge/scripts/handoffd_supervisor.bb ${r}`,
  operatorRuntime: (r) => `bb ${r}/swarmforge/scripts/operator_runtime.bb ${r}`,
  babysitterd: (r) => `bb ${r}/swarmforge/scripts/babysitterd.bb ${r}`,
  frontDeskSupervisor: (r) => `bb ${r}/swarmforge/scripts/front_desk_supervisor.bb ${r}`,
  onboarderSupervisor: (r) => `bb ${r}/swarmforge/scripts/onboarder_supervisor.bb ${r}`,
  frontDeskBot: (r) => `node ${r}/extension/out/tools/telegram-front-desk-bot.js http://127.0.0.1:8765 ${r}`,
  bridgeHeadless: (r) => `node ${r}/extension/out/tools/start-bridge-headless.js ${r}`,
  tmuxServer: (r) => `tmux -S ${r}/.swarmforge/tmux.sock new-session -d -s swarmforge`,
  cloudflared: () => 'cloudflared tunnel run swarmforge',
  codeTunnel: () => 'code tunnel --name swarmforge --accept-server-license-terms',
  ollamaServe: () => '/usr/local/bin/ollama serve',
  caffeinate: () => 'caffeinate -dims',
};
const DAEMON_NAMES = Object.keys(DAEMONS);

function sweepDaemons(rows, root) {
  const program = `
(load-file ${JSON.stringify(path.join(SCRIPTS, 'orphan_janitor_sweep_lib.bb'))})
(load-file ${JSON.stringify(path.join(SCRIPTS, 'front_desk_supervisor_lib.bb'))})
(require '[cheshire.core :as json])
(let [rows (json/parse-string ${JSON.stringify(JSON.stringify(rows))} true)
      by-pid (into {} (map (juxt :pid identity)) rows)
      live (fn [n] (some #(when (= n (:name %)) (:pid %)) rows))
      killed (atom [])]
  (orphan-janitor-sweep-lib/sweep! ${JSON.stringify(root)}
    {:list-candidate-pids! (fn [] (mapv :pid rows))
     :cmdline! (fn [p] (:cmd (by-pid p)))
     :cwd! (fn [p] ${JSON.stringify(root)})
     :age-ms! (fn [p] (:age (by-pid p)))
     :parent-orphaned?! (fn [_] true)
     :live-window-pid-set! (fn [] #{})
     :live-runtime-pid! (fn [] (live "operatorRuntime"))
     :live-caffeinate-pid! (fn [] (live "caffeinate"))
     :parent-live-ollama-serve?! (fn [_] false)
     :kill-pid! (fn [p] (swap! killed conj p))
     :audit! (fn [_] nil)
     :log! (fn [_] nil)})
  (let [onboarder (front-desk-supervisor-lib/decide-onboarder-orphan-reap
                    (mapv (fn [r] {:pid (:pid r) :cmdline (:cmd r)}) rows) ${JSON.stringify(root)} (constantly true))]
    (println (json/generate-string {:janitor @killed :onboarder (:reapable onboarder)}))))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 60000 });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

const daemonDraw = fc.record({
  root: fc.constantFrom('/home/u/proj', '/srv/swarm/target', '/Users/dev/swarmforgevc'),
  names: fc.subarray(DAEMON_NAMES, { minLength: 1 }),
  // From fresh to far past every janitor threshold.
  age: fc.constantFrom(0, 60 * 60 * 1000, 30 * 24 * 60 * 60 * 1000),
});

test(
  'BL-1907/BL-654 invariant 3: no reaper that consults parent-orphaned? takes a daemon the swarm detached, though it reads orphaned',
  () => {
    const seen = new Set();
    fc.assert(
      fc.property(daemonDraw, ({ root, names, age }) => {
        const rows = names.map((name, i) => ({ name, pid: 40000 + i, cmd: DAEMONS[name](root), age }));
        const { janitor, onboarder } = sweepDaemons(rows, root);
        const named = (pids) => rows.filter((r) => pids.includes(r.pid)).map((r) => `${r.name}: ${r.cmd}`);
        assert.deepEqual(named(janitor), [], 'the orphan janitor took');
        assert.deepEqual(named(onboarder), [], 'the onboarder reap took');
        names.forEach((n) => seen.add(n));
      }),
      { numRuns: 12, examples: [[{ root: '/home/u/proj', names: DAEMON_NAMES, age: 30 * 24 * 60 * 60 * 1000 }]] }
    );
    assert.deepEqual(DAEMON_NAMES.filter((n) => !seen.has(n)), [], 'every catalog daemon drawn');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
