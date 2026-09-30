# iq3 context window vs VRAM: census, 2026-09-30 (specifier)

The human asked: "Can we reduce the context size of iq3 so that it does not spill over to the cpu and still an swallow the coder's card?"

Answer: the window is not what caused the spill. Keep 49152 until BL-1841 and BL-1840 land, then re-run this census.

## Where the layers went (every iq3 load in the logs)

Sources: `.swarmforge/ollama-serve-operator.log` (09-30) and `.swarmforge/local-agent/ollama-serve.log` (09-29). The model is `ista-iq3s-coder:latest`, 65 layers, on an RTX 5060 Ti with 16 GB.

| Load | num_ctx | KV cache | Layers on GPU |
|---|---|---|---|
| 09-29, 12 loads | 32768 | f16 | 62-64 of 65 |
| 09-30 13:13 | 32768 | f16 | 64 of 65 |
| 09-30 13:27 | 49152 | f16 | 57 of 65 |
| 09-30 13:51 | 49152 | q8_0 + flash attention | 65 of 65 |
| 09-30 18:28 | 49152 | q8_0 + flash attention | 65 of 65 |

At 18:28 the buffers were:
- model: 10827 MiB
- KV cache: 1632 MiB, about 34 KiB per token
- compute: about 320 MiB

`nvidia-smi` then showed 1621 MiB free. At the same rate the KV cache would be 1360 MiB at 40960, 1088 MiB at 32768 and 816 MiB at 24576.

A CPU spill therefore means the serving `ollama serve` lacks `OLLAMA_FLASH_ATTENTION=1` or `OLLAMA_KV_CACHE_TYPE=q8_0`. Check `/proc/<pid>/environ`. The swarm's own start path has set both by default since 7f38e5d7fe.

## How much context the seat uses

Source: `~/.qwen/usage/token-usage-2026-09.jsonl`, model `ista-iq3s-coder:latest`, 2026-09-30, `source: main`. That is 27 sessions and 228 requests.

- **First turn:** 12154-13099 input tokens, with one session at 9883. `.swarmforge/prompts/coder@iq3.md` is 3735 characters, about 1k tokens. The rest is qwen's own system prompt and tools.
- **Peak per request (input + output):** p50 15015, p90 26200, p95 29350, p99 38925, max 40602.
- **Requests over a smaller window:** 5 of 228 exceed 32768; 31 of 228 exceed 24576.
- **The largest peaks come from output:** single replies reached 8309-14141 output tokens, with thinking tokens counted and thinking still on. The maximum was a request with 25856 input and 14141 output tokens, 4879 of them thoughts.

## What would change the answer

- **BL-1841 (thinking off)** removes the thought tokens from every reply.
- **BL-1840 (compression near the served window)** stops qwen compressing on every turn.

After both land, re-run the census with the script below. If p99 and the max stay under about 30k tokens, 32768 frees about 0.5 GB of VRAM with no failed requests.

```
python3 - ~/.qwen/usage/token-usage-2026-09.jsonl <<'EOF'
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if 'ista-iq3s' in l]
rows=[r for r in rows if r.get('localDate')=='2026-09-30' and r.get('source')=='main']
pk=sorted(r['inputTokens']+r['outputTokens'] for r in rows)
print(len(rows), [pk[int(q*len(pk))] for q in (.5,.9,.95,.99)], pk[-1], sum(x>32768 for x in pk))
EOF
```

Change `localDate` to the day being measured.
