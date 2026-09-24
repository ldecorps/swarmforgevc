# Disposition (specifier, 2026-09-24)

The Anthropic arm ran on the live specifier seat - claude-opus-5-5 (the human moved
the seat from Fable that morning, db5d1313e4), not Fable - and is recorded in
backlog/evidence/specifier-ab-20260923-arm-claude-opus-5-5-20260924.md with the
intake's open questions answered. Arm A (local) never produced output. It is kept as a
remaining slice on epic BL-1125 (sandboxed run over the pinned corpus, after
the GPU and the human's go-ahead). The human's sentence is quoted verbatim in the
evidence file.

---

# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-23T09:18:40.662003974Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Human ask (Telegram LOCAL_AGENT, 2026-09-23T09:06:45Z, verbatim): "Could we test the specifier role for the local qwen by having it minting the 2 intakes sitting on the queue, store this somewhere, so that tomorrow, when we have anthropic tokens, have fable do the exact same exercise, and then we can compare the results."

This is an A/B evaluation of the SPECIFIER role across providers, using the two live intakes as a fixed corpus. Grounding the Operator gathered so it need not be re-derived:

CORPUS (already pinned, do not re-derive it at run time). The two intakes are backlog/INTAKE-operator-question-1790153120168.md (committed efe605fd9002fb0fca68449f88e80a9cfb066dbf, sha256 253d81766c4dbe0d315f4440faebfec69d0e2bb6c41a94f113d8979e3f4afb23) and backlog/INTAKE-operator-question-1790153142349.md (committed 329793a3b8f18268904e3ec503dd776ddc1774dd, sha256 7a7ca23ca24765e0ed1ef1ef43733a2049e18b9c144140bfd09cfa1659174b40). The Operator also snapshotted both byte-identical under .swarmforge/operator/benchmark-corpus-specifier-ab-20260923/ with SHA256SUMS. REASON THIS MATTERS: draining an intake consumes it, so arm A destroys the input for arm B. Arm B must be re-seeded from the pinned copies and the evidence must record the sha256 each arm actually read - otherwise the comparison is not like-for-like.

ARM A (local, today). Live pack is ollama-ista-iq3s-mono-router: depth-1 rotation router, only TWO windows exist (swarmforge-coordinator, swarmforge-coder), so there is NO standing specifier seat - the specifier is reached by ROTATION, and how the arm rotates a seat to specifier and back is part of what needs designing. Model is hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_S (~12GB, ~2.3-2.7 tok/s measured; think:false via the repo-root .aider.model.settings.yml). Both seats are alive but currently retrying litellm APITimeoutError against 127.0.0.1:11434, so budget for a long, timeout-prone run and record retries/timeouts as a result, not as a rerun-until-green.

ARM B (Fable/Anthropic, tomorrow). Requires the claude pack. Known hazard the Operator has hit twice: the scheduled start reads .swarmforge/swarm.env's DEFAULT pack, which wins over the day_shift_pack marker - so swapping arms is a swarm.env edit, not a marker flip, or arm B silently runs on the wrong provider. Record the resolved pack + model id from the LIVE process environment, not from the conf file.

STORAGE. Precedent already in-tree: BL-1127's coder battery writes backlog/evidence/BL-1127-coder-battery-<provider>-<model>-<UTC>.md, one file per model. A specifier battery should follow the same shape - per arm: pack, resolved model id, UTC start/end + wall time, whether it minted at all, the minted ticket YAML / topic records verbatim, every refusal or gate rejection, and retries/timeouts.

OPEN QUESTIONS FOR THE SPECIFIER TO SETTLE (the Operator does not decide these):
1. Do the minted tickets from an experimental arm enter the live backlog as real work, or land in a quarantined evidence path? Auto-entry pollutes the queue AND means arm B cannot mint the same intake twice.
2. Comparison axes: mint-or-not, ticket-shape validity (register row, acceptance criteria, depends_on naming only landed siblings), would-the-gates-pass, hallucinated file/ticket references, and a human-judged usefulness call.
3. Who runs the rotation and records the evidence - this is dispatch, so the coordinator owns it, not the Operator.

Note on wording: "local qwen" here is the ISTA IQ3_S Qwen3.8-27B build above, not qwen3:14b (which this endpoint does not hold); the evidence should name the exact tag so the comparison record is honest.
