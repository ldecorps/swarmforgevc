# INTAKE — Ascertain whether qwen2.5-coder on coder@2 executes tools

**Source:** human via Cursor, 2026-10-03 ~10:04 BST, verbatim (Article 5.3):

> I want to ascertain whether or not coder 2.5 can run tools.
> Can we start the swarm with coder2 seat and have the swarm dedicated to make it work. Kind of like dogfood local llm swarm.
> Feel free to reprioritize the local llm tickets in front of qa landing rewrite for this exercise.

**Epic / track:** child of BL-1125 (`epic: local-llm-swarm`). That tracker is now priority 0, ahead of BL-1870 (`landing-is-a-merge`, now priority 1).

## What is wrong / why this is open

`coder@2` was retired earlier today because it emitted tool-call JSON as text instead of executing it, and the claim-check deferral then starved the Claude coder. The same shape showed up in the Local Agent topic on `qwen2.5-coder:latest` at 09:57: the seat was asked to count lines of code on master and replied with a `run_shell` JSON object instead of a count.

The seat is back on the full-forge pack as:

```
window coder@2 local-model coder2 --model qwen2.5-coder-14b-q5km:latest --seat-tier easy
```

Easy tier means this seat claims `mutation_cost: low` only. The Claude coder keeps medium and high.

## What is wanted

A dogfood pass whose success is a measured yes or no: does `qwen2.5-coder-14b-q5km` on `coder@2`, through the qwen CLI the seat already launches, execute its loop tools (shell, read, edit) and finish a low-cost local-llm parcel, or does it print the tool call as text and stall.

The swarm works the open `local-llm-swarm` slices for this exercise. Landing-is-a-merge waits behind that epic. Do not retire the local coder as the first move; BL-1861 (remove the local LLM) is the opposite of this exercise and should not be the next parcel.

## Follow-on, 2026-10-03 ~10:18 BST, verbatim

> In fact, it might be more efficient to remove the anthropic coder and leave it all to coder2.5.
> Have the swarm observe, raise high severity defect, have specifier implementing them, repeat, until the point where coder2.5 is capable of working.

The Anthropic coder is off the pack. The bare `coder` seat is `qwen2.5-coder-14b-q5km`, hard tier, so every coder parcel lands on it. `coder@2` is not staffed; two local seats would share one GPU.

The loop until that seat can finish a parcel. Follow the specifier's existing hotfix rule (human directive 2026-10-01, `swarmforge/roles/specifier.prompt`: "instead of minting a red, hotfix the defect and mint a stampoff"). Do not mint a spec for the coder to implement.

1. Observe the seat. A tool call printed as text, a stall, or a parcel it cannot move is an observation.
2. Raise it as a high-severity defect.
3. The specifier implements the hotfix on `main` in that same pass, then mints only the stamp-off (review-only, the coder reviews it and does not re-apply it). No spec ticket, no coder parcel for the fix.
4. Observe the seat again.

Repeat until `qwen2.5-coder-14b-q5km` executes its tools and lands a parcel. Stop the loop there.

## Specifier disposition, 2026-10-03 (first pass of the loop)

Drained 1:N. Each observation became a `type: defect`, `severity: high`
ticket (auto-approved, queue-jump, epic local-llm-swarm). The human's
verbatim line "have specifier implementing them" governs over this file's
own loop text ("The specifier does not write the code"): the seat cannot
build its own repair while it cannot run a tool. So the specifier landed
each fix as a hotfix, and each ticket is the stamp-off review the seat
attempts next (loop step 4).

| Obs | What the seat did | Hotfix | Ticket |
|---|---|---|---|
| 1 | Every request served at Ollama's 4096 default; the 8310-token first request cut to its last 2050 | e022e33baf (Modelfile, num_ctx 32768) | BL-1916 |
| 2 | Tool call written as a ```json fence; Ollama never parsed it (5 of 5) | 102d854f87 (tool-call shim) | BL-1917 |
| 3 | Kickoff "Read and obey every instruction in <card>" answered in prose (every replay) | f9c3e4e1da (kickoff names read_file) | BL-1918 |
| 4 | Announced "I'll run ready_for_next.sh" with no call: the template hid calls that had text beside them | 0d44613b74 (shim drops that text from history) | BL-1919 |

State at 11:30: the seat read its card, ran ready_for_next.sh, completed
QA's BL-1848 merge-up note with done_with_current.sh (correct in task mode),
then stalled once more on an announcement. It executes tools; it has not
yet forwarded a work parcel. The loop continues with the next observation;
the next lever measured is qwen's model.skipNextSpeakerCheck (BL-1919 notes).
