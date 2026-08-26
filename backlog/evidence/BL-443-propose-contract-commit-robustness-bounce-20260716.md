# BL-443 QA bounce — 2026-07-16

1. **Failing command** — the defect-3 test run with a fake `$HOME` carrying a
   global git identity, simulating any ordinary developer machine or CI
   runner (neither the test nor `mkTmpDir`/`tmpDirSetup.js` isolate `HOME`,
   so `git config user.name` inside the test's fresh `git init` fixture
   falls through to whatever the REAL machine has configured globally):

   ```sh
   FAKE_HOME=$(mktemp -d)
   cat > "$FAKE_HOME/.gitconfig" <<'EOF'
   [user]
   	name = Developer
   	email = dev@example.com
   EOF
   cd extension && HOME="$FAKE_HOME" npx vitest run test/config.test.js -t "BL-443 defect 3"
   ```

2. **Commit hash checked out and tested**: `270d7b1e39` (QA worktree HEAD,
   documenter merge of `50744af5ac`).

3. **First error excerpt**:

   ```
   FAIL  test/config.test.js > BL-443 defect 3: the commit succeeds with a fallback author identity when the target has no git identity configured
   AssertionError: Expected values to be strictly equal:

   + actual - expected

   + 'Developer <dev@example.com>'
   - 'SwarmForge <noreply@swarmforge>'

    ❯ test/config.test.js:433:10
      431|   assert.equal(result.committed, true);
      432|   const authorLine = execSync("git log -1 --format='%an <%ae>'", { cwd…
      433|   assert.equal(authorLine, 'SwarmForge <noreply@swarmforge>');
   ```

   On THIS sandbox the test happens to pass, only because this particular
   box has no `~/.gitconfig` and no system git config (confirmed by hand:
   `git config --global user.name` / `--system user.name` both return
   nothing here) — it passes by incidental machine state, not by design.

4. **Failure class**: `unit`. The production code under test
   (`hasGitIdentityConfigured`/`resolveCommitIdentityOverrides` in
   `extension/src/config/targetBootstrap.ts`) is arguably doing exactly
   what its own comment says: "Queries the EFFECTIVE identity the same way
   `git commit` itself would resolve it" (local, then global, then
   system) — that is correct, intentional production behaviour. The defect
   is that the TEST's own premise ("the target has no git identity
   configured") is never actually enforced: neither `test/config.test.js`
   nor the shared `mkTmpDir`/`tmpDirSetup.js` helper isolates `HOME` (or
   otherwise scrubs global/system git config) before asserting the fallback
   identity landed, so the assertion silently tests whatever identity the
   REAL machine running the suite happens to have — which is not "no
   identity", the moment that machine has an ordinary developer or CI git
   setup.

5. **Expected vs observed**: Expected — `BL-443 defect 3`'s own stated
   scenario ("the target has no git identity configured") is enforced by
   its fixture regardless of which machine runs the suite, and the
   assertion on the fallback author (`SwarmForge <noreply@swarmforge>`)
   holds everywhere. Observed — the fixture only achieves "no identity" by
   omission (never calling `git config user.name/email` in the tmp repo)
   and relies on the CI/developer machine having no global/system identity
   either; the moment it does (simulated above via a fake `$HOME`), the
   commit lands under the REAL machine's identity instead of the fallback,
   and the hardcoded assertion fails. This is the same class of defect the
   engineering article's own `env -u SWARMFORGE_CONFIG` and `env -u` guard
   rules already exist to prevent (BL-315, BL-404) — a developer's or
   runner's real environment state silently substituting for the fixture
   state a test claims to construct — just manifesting through git config
   resolution rather than `process.env`. A green run on THIS box is not
   proof the test holds on any other box that runs this suite (a
   contributor's laptop, a CI runner with a configured git identity for
   checkout operations, or any future worktree host).

   Remediation direction (not prescriptive): isolate the git identity
   lookup the same way the codebase already isolates `cwd`/`HOME` for other
   tests — point `HOME` (and ideally `GIT_CONFIG_GLOBAL`/
   `GIT_CONFIG_SYSTEM` env overrides, which real `git` respects) at an
   empty fixture directory for the duration of this test (and defect 2's
   sibling, which shares the same risk if it ever asserts on committer
   identity), so `hasGitIdentityConfigured`'s local/global/system
   resolution genuinely has nothing to find, on any machine.
