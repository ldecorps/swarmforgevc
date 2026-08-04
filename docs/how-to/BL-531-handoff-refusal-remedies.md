# BL-531/BL-761: Handling Pre-QA Gate Handoff Refusals

When you attempt a `git_handoff` to QA and `swarm_handoff.sh` prints `PRE_QA_GATE_FAIL`, your parcel has been refused. This is by design: the gate catches work defects before the expensive QA review. This runbook explains each class of refusal and how to fix it.

## Refusal Classes

Every refusal line is machine-greppable:
```
PRE_QA_GATE_FAIL <class> <ticket-id> <detail>
```

where `<class>` is one of: `ancestry`, `wiring`, `manifest`, or
`acceptance-contract`.

## Ancestry Refusals

**What it means:** Your parcel is missing a commit that the ticket demanded.

**Example output:**
```
PRE_QA_GATE_FAIL ancestry BL-531 e57a237b on swarmforge-coder
  remedy: merge commit e57a237b into your branch and re-send, or
  remedy: list the sha in this ticket's `abandoned_commits:` field if dropped deliberately
```

**How to fix:**

### Option 1: Merge the Stranded Commit

The commit exists on another agent's branch (in this example, `swarmforge-coder`)
but never made it into your parcel's ancestry. You must merge it:

```bash
# Fetch the commit from the agent's branch
git fetch  # or git pull if it's already tracked

# Check out the branch holding the commit
git checkout swarmforge-coder
git log --oneline | grep e57a237b  # verify it's there

# Go back to your branch
git checkout swarmforge-documenter  # or your current branch

# Merge the commit
git merge --no-ff e57a237b

# Resolve any conflicts
# ... edit, test, commit as needed ...

# Re-send the handoff
swarm_handoff.sh ./tmp/handoff.txt
```

### Option 2: Abandon the Commit Deliberately

If the commit is a discarded experiment or deliberately isolated work, list it
in the ticket's `abandoned_commits:` field to tell the gate to ignore it:

```yaml
# In backlog/active/BL-531-....yaml
abandoned_commits:
  - e57a237b  # discarded experiment, not part of this delivery
```

Then commit this change and re-send:

```bash
git add backlog/active/BL-531-....yaml
git commit -m "BL-531: mark e57a237b as abandoned"
swarm_handoff.sh ./tmp/handoff.txt
```

## Wiring Refusals

**What it means:** Your ticket declared a required call site in
`required_wiring:`, but the code doesn't wire it.

**Example output:**
```
PRE_QA_GATE_FAIL wiring BL-531 swarmforge/scripts/swarm_handoff.bb pattern not found "pre_qa_gate_lib"
  remedy: land the wiring in swarmforge/scripts/swarm_handoff.bb and re-send, or  
  remedy: remove this entry from the ticket if it is no longer required
```

**How to fix:**

### Option 1: Land the Required Wiring

The pattern must appear as a literal string in the file. Add the call site and
commit:

```bash
# Edit the file to add the call site
# In swarmforge/scripts/swarm_handoff.bb, add: (pre_qa_gate_lib ...)

vim swarmforge/scripts/swarm_handoff.bb
# ... add the call ...

git add swarmforge/scripts/swarm_handoff.bb
git commit -m "BL-531: wire pre_qa_gate_lib into swarm_handoff validation"

# Re-send
swarm_handoff.sh ./tmp/handoff.txt
```

**Important:** The pattern is a **fixed string**, not a regex. The gate looks
for an exact match. If the pattern is `pre_qa_gate_lib`, a call like
`(my-pre-qa-gate-lib ...)` will NOT match. The call site must contain the
exact string.

### Option 2: Remove the No-Longer-Required Entry

If the wiring requirement no longer applies, remove the `required_wiring:` entry
from the ticket:

```yaml
# In backlog/active/BL-531-....yaml

# Remove this line:
# required_wiring:
#   - "swarmforge/scripts/swarm_handoff.bb::pre_qa_gate_lib::..."

# Or if multiple entries, delete only the one that no longer applies
required_wiring:
  - "swarmforge/roles/QA.prompt::pre_qa_gate_lib::still required"
```

Then commit and re-send:

```bash
git add backlog/active/BL-531-....yaml
git commit -m "BL-531: remove obsolete wiring requirement"
swarm_handoff.sh ./tmp/handoff.txt
```

## Manifest Refusals

**What it means:** The ticket's `required_wiring:` field itself is malformed.

**Example output:**
```
PRE_QA_GATE_FAIL manifest BL-531 malformed required_wiring entry: "path-no-separator"
  remedy: fix the entry in the ticket and re-send
```

**How to fix:**

Edit the `required_wiring:` field in the ticket to use the correct format.
Each entry must be:
```
path::pattern
```
or
```
path::pattern::why
```

Examples of **incorrect** formats:
- `path-no-separator` (missing `::`)
- `path::pattern::why::toomany` (more than two `::`)
- `123` (numeric, not a string)

Examples of **correct** formats:
- `swarmforge/scripts/lib.bb::function_name`
- `extension/src/file.ts::ClassName::instantiated in the WebView`
- Flow-style: `required_wiring: ["path::pattern", "path2::pattern2"]`
- Block-style:
  ```yaml
  required_wiring:
    - "path::pattern"
    - "path2::pattern2::why"
  ```

Fix the ticket and re-send:

```bash
vim backlog/active/BL-531-....yaml
# ... fix the required_wiring entry ...

git add backlog/active/BL-531-....yaml
git commit -m "BL-531: fix malformed required_wiring entry"
swarm_handoff.sh ./tmp/handoff.txt
```

## Acceptance-Contract Refusals

**What it means:** Your ticket's declared `acceptance:` feature file cannot
actually run — either it can't be read at the commit you're sending, or the
step registry at that commit has no handler for one or more of its steps
(BL-761: shipped tickets have landed with feature files never actually
executed, only read and mapped by eye).

**Example output — unresolved step:**
```
PRE_QA_GATE_FAIL acceptance-contract BL-761 scenario "Bridge is unreachable": no step handler matched "Given the Bubble companion is paired to a bridge base URL"
  remedy: Merge the named commit / land the named wiring and re-forward, or record a deliberately dropped commit under abandoned_commits:.
```

**Example output — unreadable declaration:**
```
PRE_QA_GATE_FAIL acceptance-contract BL-761 acceptance: declaration is unreadable at the cited commit (absent, inline Gherkin, or naming a feature file that does not exist there)
  remedy: Merge the named commit / land the named wiring and re-forward, or record a deliberately dropped commit under abandoned_commits:.
```

**How to fix:**

### Option 1: Register the Missing Step Handler

The finding names the exact scenario (and, for a Scenario Outline, the
example row) and the step text that matched nothing. Add a handler for it in
`specs/pipeline/steps/`, scoped to this feature with `defineScoped` if the
step text is generic enough to collide with another ticket's handlers:

```bash
# Add/extend a step file under specs/pipeline/steps/ for the missing step
vim specs/pipeline/steps/<yourTicket>Steps.js

git add specs/pipeline/steps/<yourTicket>Steps.js
git commit -m "BL-761: register missing step handler"

# Confirm the contract now runs end to end
bash specs/pipeline/scripts/run_acceptance.sh specs/features/<your-feature>.feature

swarm_handoff.sh ./tmp/handoff.txt
```

### Option 2: Fix the `acceptance:` Declaration

If the field is absent, blank, inline Gherkin, or points at a path that
doesn't exist at the commit you're citing, point it at the real feature file
and commit both the ticket edit and the correct commit together:

```yaml
# In backlog/active/BL-761-....yaml
acceptance: specs/features/BL-761-acceptance-contract-must-be-runnable.feature
```

```bash
git add backlog/active/BL-761-....yaml
git commit -m "BL-761: fix acceptance: declaration path"
swarm_handoff.sh ./tmp/handoff.txt
```

**Never** treat this class the way an ancestry or wiring finding can
sometimes be dismissed via `abandoned_commits:` — a contract that cannot run
is not deliberately-dropped work, it is unverified behavior. There is no
"remove the requirement" option: every ticket must declare a runnable
contract.

**Note on infrastructure warnings for this check:** if the step registry
itself cannot be loaded at the cited commit (most commonly `extension/out/`
was never compiled, so `pilotAcceptanceGate` and friends fail to `require()`),
the gate fails **open** — a `PRE_QA_GATE WARNING`, not a finding, and the send
goes through. Run `npm run compile` and re-check locally if you want to be
sure your contract actually resolves before sending.

## Infrastructure Warnings

If `swarm_handoff.sh` prints a warning like:
```
PRE_QA_GATE_WARN ancestry check skipped: roles.tsv unreadable
```

The gate encountered a problem (missing file, unreadable git state) and
**allowed the send** anyway. The handoff went through, but the gate could not
run one of its checks. Investigate the issue (missing `.swarmforge/roles.tsv`,
git state corruption, etc.) and fix it before the next handoff.

## Gate Misfires

The gate is designed conservatively. A false positive (refusing a legitimate
send) is possible but rare. If you believe the gate is wrong:

1. **Understand the finding first.** Read the `PRE_QA_GATE_FAIL` line and
   verify the gate's claim. Does the stranded commit exist? Is the pattern
   really missing?

2. **Consult the engineering prompt** (engineering.prompt § Epic Runtime Wiring
   and related sections) for the gate's design rationale.

3. **If the gate is genuinely wrong** (a design flaw in the gate itself), file
   a defect ticket and override via the escape hatch:

   Delete the offending `required_wiring:` entry from the ticket YAML or add
   the stranded commit to `abandoned_commits:`, then note in a comment why the
   gate misfired. This documents the override in the ticket's git history, not
   in an invisible env var.

   **Never** use environment variables like `*_FORCE_RESULT` to bypass the
   gate — engineering.prompt forbids that pattern.

4. **File the defect.** Example:
   ```
   Title: BL-531 gate false positive: ___
   Description: The ancestry gate flagged commit XYZ as stranded, but ...
   ```

## Testing the Gate Locally

Before committing, you can test the gate independently:

```bash
./swarmforge/scripts/pre_qa_gate.sh BL-531 a1b2c3d9e8
# Prints: OK
# or
# Prints: PRE_QA_GATE_FAIL ...
```

Exit code 0 = OK. Exit code nonzero = failure. Run this before attempting a
QA-bound handoff to catch issues early.
