# Local coder A/B: qwen2.5-coder-14b (BL-1916) vs iq3 (BL-1917) - plan and qwen2.5 baseline

2026-10-03, specifier.

## The human's ruling (verbatim, specifier pane, ~12:20Z)

> Agreed to
>
> How I'd run it:
> Let qwen2.5 handle QA's BL-1916 bounce first. That's the test already queued: can it act on a bounce?
> Then swap the coder seat to iq3 for the next stamp-off (BL-1917, same shape and size), and compare the two runs on the same things: tool calls per parcel, stalls, whether a forward lands, and what QA's bounce inventory says.

## Sequence

1. **qwen2.5 takes QA's BL-1916 bounce.** QA held BL-1916 (50_20261003T121143Z_002383)
   at 12:12Z and was finding placeholder evidence, a file literally named
   `BL-1916-coder-$(date +%Y%m%d).md`, a misleading subject and a missing
   byline. The test is whether the seat acts on the bounce inventory and
   forwards a corrected parcel.
2. **Coordinator routes BL-1917 next, and notes the specifier first.** The
   coder's queue is served oldest-first within a priority. After the bounce
   it would otherwise serve stale Work notes (BL-1908, BL-1456, BL-1861,
   BL-1912, BL-1851) and about a dozen "branch behind - merge up" notes
   before BL-1917's Work note (10_20261003T103936Z_015813). The specifier
   needs a note before BL-1917 is served, so the seat can be swapped first.
3. **Specifier swaps the `coder` seat to `ista-iq3s-coder:latest`.**
   - full-forge.conf's `coder` line: model `qwen2.5-coder-14b-q5km:latest` ->
     `ista-iq3s-coder:latest`, in the working copy only, like the human's
     own uncommitted edit of that line.
   - Regenerate `.swarmforge/launch/coder.sh` with the one-seat recipe
     (SWARMFORGE_PACK + SWARMFORGE_CONFIG set) and diff it against a backup.
     Only the model name lines may change. Then rewrite the seat's
     `.qwen/settings.json` the same way and respawn the pane.
   - Preconditions: the Modelfile pins `num_ctx 49152` and
     `num_predict 4096` (checked 12:20Z). The serving `ollama serve` has
     `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` (check
     `/proc/<pid>/environ` first; without them iq3 spilled to CPU on 09-30).
     And the seat's `think: false` / `reasoning_effort: none` must actually
     reach this thinking-capable model; probe one request through the shim
     before the respawn.
4. **iq3 takes BL-1917** on the same harness (shim, served text, card,
   kickoff). Measure the same things as the baseline below.

## qwen2.5 baseline on BL-1916 (10:44-12:13Z)

From the seat's qwen chat recordings, shim.log and handoffd.log
(`abmetrics.py`: sessions whose first record falls in the window).

| measure | whole run | final post-fix session (8aa47fd1, 12:08-12:13Z) |
|---|---|---|
| sessions | 13 | 1 |
| handoffd chase-respawns | 9 (plus specifier respawns for hotfixes) | 0 |
| tool calls | 169 | 14 |
| text-only stops (reply with no call) | 23 | 1 |
| shim nudges (ok / no-call) | 42 / 1 | - |
| forward landed | yes, 12:11:43Z (about 93 min after the 10:38Z route) | yes, about 4 min after its kickoff |
| QA bounce inventory | 3 items, all `behavior`, all blamed on coder (backlog/evidence/BL-1916-QA-20261003.md at 28965db6b7; bounce f09cf2dfce, 12:25:50Z) | same parcel |

The whole-run numbers are confounded. Ten harness hotfixes landed during
the run (59a376845a ... e2e2287822; BL-1916's own stamp is e022e33baf). The
final session ran on the finished harness, so it is the fair comparison
for iq3's BL-1917 run.

### QA's BL-1916 inventory (first forward, da06baf72d)

- D1: a committed file literally named `BL-1916-coder-$(date +%Y%m%d).md`
  holding `NONE`: written by session ad49be78's ten-call blind batch at
  11:47Z, before 5a89725e03 added the literal-path rule, and committed by
  session 79269ebf's `git add .` (62b66b7b2e). That session never read its
  card.
- D2: the evidence file is the ticket's own instruction sentence ("NONE, or
  one item per defect found.") - no check run, no commit range.
- D3: da06baf72d's subject claims a Modelfile edit it does not contain and
  names no ticket; 62b66b7b2e has no byline.

QA's verdict on the hotfix itself: e022e33baf stands (every check passed).
D1 and D3's byline are harness-addressed now (card-first resume e2e2287822,
the printed forward step aec0daba54). D2 and D3's subject are judgment, the
thing this comparison measures. QA dogfood note 003778 (12:26Z) points at
the same commit. Next measurement: what the qwen2.5 seat does with this bounce.

## Compare on

Tool calls per parcel, stalls (text-only stops, nudges, respawns), whether
the forward lands (and time to it), and QA's bounce inventory (item count
and classes), for BL-1916 after its bounce and for BL-1917 on iq3.

## qwen2.5 on QA's BL-1916 bounce (12:54-13:38Z) - leg closed

The human's ruling (SUP-17 12:44Z "Requeue it, run A/B as planned") put
qwen2.5 on BL-1916's bounce. The specifier requeued BL-1858's bounce behind
it, moved the coder onto f09cf2dfce with origin/main merged in (611844ce66,
today's tooling) and respawned the seat at 12:54Z.

| measure | qwen2.5, BL-1916 bounce |
|---|---|
| kickoff to forward | 12:54:16Z -> 13:38:25Z, 44 min |
| sessions | 4 (ede72412, d6446e43, 12465c0a, 95764159) |
| handoffd chase-respawns | 3 |
| tool calls | 61 |
| text-only stops | 10 |
| shim nudges ok / text calls rewritten | 28 / 47 |
| hand nudges | 1 (13:32:17Z, "Run: swarm_handoff.sh tmp/handoff.txt then done_with_current.sh") |
| wrong forwards | 1: at 13:00:39Z it re-sent the stale BL-1858 draft left in tmp/handoff.txt (task BL-1858, 127768f186); the audit had been answered in an earlier session, so it queued and reached the hardender (002384), which reverted it and recorded a bounce |
| junk committed | 10aaa15e97: 1,019 venv/ files plus tests/test_qwen_tile.py, 375k lines, after git's "use git add to track" hint on an empty commit |
| runaway reply | one text-only reply of 7127 tokens (about 9 min), cut by qwen |
| QA inventory on the forward | 5 items, all behavior, all blamed on coder (backlog/evidence/BL-1916-QA-20261003-2.md, 263005aebd/a3f4588527; bounce 003779 at 4ae9005cdf): D1-D3 of the first bounce all unfixed, D4 the venv (it also pushed bl1699's git ls-files past Node's 1 MB exec buffer), D5 an unrelated pytest file |

After the forward it took the requeued BL-1858 bounce and completed it in 17
seconds unworked (13:38:41Z), then worked stale Work notes: BL-1908 (already
done) and BL-1456 (left one uncommitted line using an undefined `nowMs`,
saved to the coder worktree's tmp/BL-1456-qwen25-wip-20261003T1355Z.patch).

**Result: qwen2.5 cannot act on a bounce.** It fixed none of three defects
and added two. The human closed its leg (ruling relayed ~13:57Z: "iq3 takes
the BL-1916 bounce, stop qwen2.5 now").

## iq3 leg (from 14:00:08Z)

Per the same ruling iq3 takes the SAME bounce, so both models are measured
on one parcel; BL-1917 follows. BL-1916's line was reset behind 10aaa15e97:
611844ce66 with main merged (4720c4f64b), the qwen2.5 tip 4ae9005cdf kept
under refs/swarmforge/parcel-backup/coder/<stamp>-bl1916-qwen25-junk-line.
The in-process parcel is QA's first bounce text at 4720c4f64b (QA's 003779
moved to abandoned/); BL-1917's Work note is next at priority 00. The seat's
stale tmp/handoff.txt (BL-1916, 10aaa15e97) was renamed aside so it is not
re-sent. Seat: ista-iq3s-coder:latest, num_ctx 49152, num_predict 4096,
FA=1 and KV q8_0 on ollama serve, think:false checked through the shim
(2-token "OK", no reasoning). Model-agnostic hotfixes landed first or
alongside: venv/ ignored (358be6be62), qwen2.5 num_predict 2048
(479155f733), and swarm_handoff refusing a git_handoff for a ticket other
than the in-process parcel.
