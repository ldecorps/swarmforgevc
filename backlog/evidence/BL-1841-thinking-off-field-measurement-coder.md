# BL-1841 - which thinking-off field this Ollama honours (coder, 2026-10-03)

Ollama version: `0.32.15` (`GET /api/version`). Endpoint: live
`http://localhost:11434/v1/chat/completions`, non-streaming, prompt
"What is 2+2?".

Model: `qwen3-0.6b:latest` (a thinking-capable qwen3). The ticket's
`ista-iq3s-coder:latest` is no longer installed on this host (iq3 retired,
GPU reassigned 2026-10-01/03), so the measurement uses the same Ollama
server and the same OpenAI-compatible path with a qwen3 that reasons by
default.

| Candidate | Request field | `message.reasoning` chars | `<think>` in content | completion tokens |
|---|---|---|---|---|
| baseline | (none) | 637 | no | 184 |
| top-level think | `"think": false` | 697 | no | 209 |
| reasoning_effort | `"reasoning_effort": "none"` | **0** | no | **9** |
| literal extra_body | `"extra_body": {"think": false}` | 2039 | no | 579 |
| prompt suffix | `"... /no_think"` | 0 | no | 13 |

Winner: `reasoning_effort: "none"` (a request field, not prompt text).
qwen merges `generationConfig.extra_body` into the top-level body, so the
old `extra_body.think false` arrived as top-level `think: false` - the
row that left reasoning on. Fix: `extra_body` now also carries
`reasoning_effort: "none"` (`local_model_qwen_provider_lib.bb`);
`think: false` is kept (harmless; BL-1838's handler asserts it).

Proof qwen sends it: `specs/pipeline/steps/bl1841LocalSeatThinkingOffSteps.js`
runs the pinned qwen against a loopback fake endpoint and reads
`reasoning_effort: "none"` at the top level of every chat body; 1/1 green,
0/1 with the field removed from the lib.

Declared invariant ("the field sent is the one measured"): no property
test. The field is a single constant pinned to a live measurement; there
is no input space a generator could range over. Encoded instead as the
literal assertion in the bb unit runner and the acceptance handler, tied to
this table.
