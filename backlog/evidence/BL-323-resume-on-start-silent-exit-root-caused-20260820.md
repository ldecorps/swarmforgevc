# BL-323 `test_resume_on_start.sh` exits 1 SILENTLY — root-caused; same class as BL-948

Raised by: architect (priority-00 note 20260820T053543Z_000283, "BL-323 acceptance red
3/5: test_resume_on_start.sh exits 1 silently"). **Verified and root-caused.**

## Confirmed, including the silence
    bash swarmforge/scripts/test/test_resume_on_start.sh
    exit=1
    output_bytes=0

Zero bytes. Under `set -euo pipefail` the script dies inside
`generate_coder_launch_script`, whose `env -u SWARMFORGE_CONFIG zsh -c '...'` block
swallows the diagnostic, and the EXIT trap then runs tmp cleanup — so the trace ends in
cleanup and looks like a clean teardown.

## The swallowed error (reproduced by rebuilding the fixture by hand and re-running the
## exact zsh block)
    Error: resolve_swarm_socket.bb: Socket path exceeds the operating system's
    unix-socket path limit (100 chars) and XDG_RUNTIME_DIR is not set for a fallback.
    primary=/private/var/folders/ks/.../T/tmp.970E5tq9/.swarmforge/tmux/3536148976.sock
    (102 chars)

macOS `$TMPDIR` is `/private/var/folders/<2>/<24>/T/`. Add `tmp.XXXXXXXX/` plus
`.swarmforge/tmux/<10-digit>.sock` and the result lands at **102 chars against a 100-char
limit** — over by two.

## This explains the "3/5", which is the important part
The overrun is **marginal and length-dependent**: `mktemp -d` names vary, so some fixture
roots come in under 100 and pass while others tip over. That is precisely an
intermittent 3-of-5 failure rate, not a deterministic red. Anyone re-running it a few
times may see it pass and conclude it was transient.

## Scope question for the specifier (not decided here)
**BL-948 is the same defect class** and is already active at coder — its title is
"Acceptance fixtures that build a control socket root at os.tmpdir(), whose long macOS
base overruns the 100-char unix-socket guard, so scenarios fail on a socket-path refusal
instead of the behaviour they assert." Identical mechanism, identical guard, identical
limit.

But BL-948 is scoped to **acceptance fixtures**, and this is a **shell test** under
`swarmforge/scripts/test/`. Either BL-948's scope extends to the shell suite, or a
sibling is needed. Coordinator has no view on which; both close it. Worth resolving
before BL-948 lands, so the fix is not applied to half the affected fixtures.

Second, independent defect worth noting: the `zsh -c` block discards its own stderr, so a
real configuration failure presents as a bare `exit 1`. Whatever the socket fix, this
test should fail loudly.
