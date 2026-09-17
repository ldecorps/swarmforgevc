# BL-1605 hardener follow-up: socketFixtureShortRootGuard violation

Found while running the standing whole-tree guards for an unrelated parcel
(BL-1610), per the "A parcel that touches specs/pipeline/steps/ or
extension/test/ runs the standing whole-tree guards" rule. This is OUTSIDE
BL-1610's scope (no file it touches) and is a miss in my own earlier
BL-1605 hardener pass (`backlog/evidence/BL-1605-hardender-20260916.md`,
recorded "confirmed, no test gap found") — the guard was not run, or was
run and its finding missed, in that pass.

## Finding

`cd extension && npx vitest run test/socketFixtureShortRootGuard.test.js`
fails:

```
specs/pipeline/steps/bl1605NoReverseCopyToForwardRecipientSteps.js:
builds or references a control socket but roots its fixture at
os.tmpdir() (long on macOS; the socket path overruns
swarm_socket_lib.bb's 100-char guard) - use lib/socketFixtureRoot.js's
mkSocketFixtureRoot instead
```

`makeFixtureRoot()` (line 43-44) does:
```js
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1605-'));
```
and later writes a real `.swarmforge/tmux-socket` file (line 73) — the
exact long-base-plus-socket shape BL-948/BL-1290/BL-1002 already fixed
elsewhere in this tree (`hardener-found-defect-socket-fixture-root-
bl982-983-20260820.md`).

## Status checked

- `git rev-list --left-right --count main...origin/main` = 0/0 (both refs
  agree); the file does not exist on either — BL-1605 has not landed to
  `main` yet (`backlog/active/BL-1605-...yaml` status: todo).
- `grep -rl socketFixtureShortRootGuard backlog/` and a standing-reds.tsv
  grep for BL-1605/this guard: no existing ticket or row names this
  violation. Presumed unticketed per the standing "a red outside your
  parcel is already ticketed until proven otherwise" discipline.

## Not fixed here

Ticket-scope discipline (workflow.prompt, "An Approval Authorizes Only Its
Ticket's Work"): BL-1610's own commit touches none of BL-1605's files, so
the fix (swap `path.join(os.tmpdir(), 'bl1605-')` for
`lib/socketFixtureRoot.js`'s `mkSocketFixtureRoot`) is not folded in here.
Reported via priority-00 note to the specifier alongside this evidence.
