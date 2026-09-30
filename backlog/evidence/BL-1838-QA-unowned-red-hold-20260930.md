# BL-1838 - QA unowned-red hold, 2026-09-30

Parcel: documenter c43a819b37, merged into QA as e0506976f0 (through
f067812de8, below), synced with origin/main d60e9e8e60 as 601a664267.
parcel_commit: 601a664267

BL-1838's own gates are green; approval is withheld under Article 4.2
because the property lane carries one red file with no open owner. The
parcel does not touch that file; it is not bounced.

## Unowned red (no row in backlog/standing-reds.tsv, no open ticket)

red: extension/test/bl1061TunnelFixtureIsolation.property.test.js
  Verbatim (qa-gather properties run, one run, not re-run as a lane):

      FAIL  test/bl1061TunnelFixtureIsolation.property.test.js > property (invariant 2): no committed test fixture binds a production tunnel name
      Error: ENOENT: no such file or directory, stat '/home/carillon/swarmforgevc/.worktrees/QA/extension/test/bl868-fixture-11637-1yyx5u0myft-2.property.test.js'
       ❯ test/bl1061TunnelFixtureIsolation.property.test.js:239:13
          237|     if (!name.endsWith('.js')) continue;
          238|     const full = path.join(testDir, name);
          239|     if (!fs.statSync(full).isFile()) continue;

  Mechanism, read from the assertion (not inferred from a re-run):
  invariant 2 lists extension/test/ with readdirSync, then statSyncs
  each entry. A sibling property test in the same run (bl868's lane
  fixture, basename bl868-fixture-<pid>-<rand>-<n>.property.test.js)
  created and removed its fixture between the readdir and the stat, so
  the stat throws ENOENT. Deterministic whenever a bl868/bl871 fixture
  lives and dies inside that window; not a tunnel-name finding.
  Owner grep: `grep -rl bl1061TunnelFixtureIsolation backlog/` hits only
  evidence files (BL-1287, BL-1583, BL-1061); no active, paused or held
  ticket names the file. register_join: absent.
  Full lane output: tmp/BL-1838-gather.json (kept until the land).

## BL-1838's own gates (all on 601a664267, one run each)

- qa-sibling-check status: VERIFY BL-1838.
- standing-red register: 3 rows, all owned (BL-1836 x2, BL-1844); unowned [].
- pre_qa_gate.sh BL-1838 601a664267 (required_wiring): OK.
- Unit (npm test): exit 0.
- Properties (npm run test:properties): exit 1, the one file above only;
  bl1838QwenProviderWindow.property.test.js green. The 4 unhandled
  errors are the allowlisted BL-871 `onTaskUpdate` timeouts.
- qa_e2e 1, acceptance (run_acceptance.sh BL-1838 feature): 4/4 ok.
- qa_e2e 2, test_bl1829_local_model_qwen_settings.sh: ALL PASS.
- qa_e2e 3, mkdtemp root under tmp/, fake /api/show answering num_ctx
  49152, writer called for --model ista-iq3s-coder:latest: one entry,
  contextWindowSize 49152, extra_body.think false, envKey
  OLLAMA_API_KEY, the existing coreTools key kept.
- Article 4.5 changed paths: local_model_qwen_provider_lib_test_runner.bb,
  local_model_window_gate_lib_test_runner.bb,
  test_bl1838_qwen_provider_entry_via_launch_script.sh,
  test_bl1838_qwen_provider_no_known_window.sh,
  test_local_model_window_gate_cli.sh: all ALL PASS.
- Stragglers before/after: none of QA's (the after-run rows are the
  coder worktree's own BL-1830 commit guard).
- Register rows owned by BL-1838 on the tip: none. "Until BL-1838 lands"
  in swarmforge/roles/*.prompt: none.
- Step handler: discovered from its own file (BL-1371 retired the
  index.js require list), so the ticket's "registered in index.js"
  wording needs no edit there.
- Docs: docs/how-to/BL-1052-local-model-seat-launch.md carries the
  BL-1838 section (served window, fallback, warn-and-skip).

## Live reading (read-only, not a gate)

- `/api/show` for ista-iq3s-coder:latest: parameters "num_ctx 49152";
  `/api/ps` context_length 49152, size == size_vram. served-window
  would budget coder@iq3 to 49152 today.
- qwen's own settings loader (installed @qwen-code, chunk-F7TNAPZ4.js
  mergeSettings / chunk-JSC3H3TD.js schema): workspace settings merge
  after user settings, modelProviders is mergeStrategy "replace", and
  it is not in WORKSPACE_RESTRICTED_SETTINGS - so the worktree entry
  replaces the user's provider list for the seat. The live coder@iq3
  qwen process's environment carries OLLAMA_API_KEY (the entry's
  envKey); security.folderTrust is unset in ~/.qwen/settings.json.

## Merge notes

- The documenter branch carries its own 2026-09-30 briefing
  (bb2051750e) while main already holds that day's (a32c9cb5e1), and
  check_documenter_briefing_tip.sh refused the plain merge. QA merged
  through f067812de8 (the parcel with docs/briefings/2026-09-30.md set
  to origin/main's blob), so no second briefing entered QA's tree. The
  documenter's own briefing land request gets its answer separately.
- Bounced BL-1816's parcel and bounced BL-1830's land-step rebuild ride
  this lineage; QA's b2cae04efb keeps both at origin/main content.

By QA.
