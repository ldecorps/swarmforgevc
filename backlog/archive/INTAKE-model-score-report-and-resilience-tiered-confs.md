# INTAKE: model-scoring attachment + resilience-tiered swarm confs

Requested by the operator 2026-09-09. Route to whichever role fits each
piece (documenter for the report/attachment, architect/specifier for the
confs) - this is one intake covering three related deliverables, not one
ticket.

## 1. A properly formatted attachment of current scoring, all seats x all models

Full `model_steward_cli.bb role-matrix <role> --include-uncertified` pull
across all 7 scored roles, taken 2026-09-09 (`coordinator` is NOT part of
this - the model steward does not track it as a role-matrix role at all;
see the coordinator note at the bottom). Certified models are marked *;
uncertified (candidate) are plain.

| Role | Model | Score | Provider/plan | Evidence |
|---|---|---|---|---|
| specifier | anthropic/claude-fable-5-1 * | 1.0 | Anthropic (first-party) | live-battery:coordinator-run-20260908 |
| specifier | tencentcloud2/glm-5.3-flash * | 1.0 | b.ai | compliance-battery:glm-bai-specifier-lite-20260909 |
| specifier | anthropic/claude-sonnet-5 * | 0.96 | Anthropic | recruiter-scorecard:seed-specifier-01 |
| specifier | cursor/auto * | 0.88 | Cursor | compliance-battery:cursor-auto-all-roles-20260824 |
| specifier | qwen/qwen3.7-plus * | 0.8 | Alibaba Cloud Token Plan | compliance-battery:qwen-token-plan-lite-20260829 |
| specifier | qwen/qwen3.8-max (candidate) | 0.74 | Alibaba Cloud Token Plan | operator-onboard:token-plan-lite-anthropic-20260829 |
| specifier | deepseek/deepseek-v4-flash (candidate) | 0.72 | DeepSeek direct | compliance-battery:deepseek-direct-20260831 |
| specifier | qwen/qwen3.7-plus * | 0.72 | Alibaba Cloud Token Plan | operator-onboard:token-plan-lite-anthropic-20260829 |
| coder | tencentcloud2/glm-5.3-flash * | 1.0 | b.ai | live-battery:coordinator-run-20260908 |
| coder | anthropic/claude-sonnet-5 * | 0.95 | Anthropic | recruiter-scorecard:seed-coder-01 |
| coder | openai/gpt-5.3-codex * | 0.92 | OpenAI | recruiter-scorecard:seed-coder-02 |
| coder | cursor/auto * | 0.9 | Cursor | compliance-battery:cursor-auto-all-roles-20260824 |
| coder | qwen/qwen3.7-plus * | 0.8 | Alibaba Cloud Token Plan | compliance-battery:qwen-token-plan-lite-20260829 |
| coder | deepseek/deepseek-v4-flash (candidate) | 0.72 | DeepSeek direct | compliance-battery:deepseek-direct-20260831 |
| coder | opencode/nemotron-3-ultra-free * | 0.72 | Opencode Zen | compliance-battery:opencode-zen-20260831 |
| coder | qwen/qwen3.8-max (candidate) | 0.74 | Alibaba Cloud Token Plan | operator-onboard:token-plan-lite-anthropic-20260829 |
| coder | qwen/qwen3.6-flash (candidate) | 0.6 | Alibaba Cloud Token Plan | compliance-battery:qwen-token-plan-lite-20260829 |
| cleaner | tencentcloud2/glm-5.3-flash * | 1.0 | b.ai | live-battery:coordinator-run-20260908 |
| cleaner | anthropic/claude-sonnet-5 * | 0.9 | Anthropic | recruiter-scorecard:seed-cleaner-01 |
| cleaner | cursor/auto * | 0.86 | Cursor | compliance-battery:cursor-auto-all-roles-20260824 |
| cleaner | qwen/qwen3.6-flash (candidate) | 0.6-0.78 | Alibaba Cloud Token Plan | compliance-battery / operator-onboard |
| architect | tencentcloud2/glm-5.3-flash * | 1.0 | b.ai | live-battery:coordinator-run-20260908 |
| architect | anthropic/claude-sonnet-5 * | 0.95 | Anthropic | recruiter-scorecard:seed-architect-01 |
| architect | openai/gpt-5.3-codex * | 0.9 | OpenAI | recruiter-scorecard:seed-architect-02 |
| architect | cursor/auto * | 0.87 | Cursor | compliance-battery:cursor-auto-all-roles-20260824 |
| architect | qwen/qwen3.7-plus * | 0.72-0.8 | Alibaba Cloud Token Plan | compliance-battery / operator-onboard |
| hardender | tencentcloud2/glm-5.3-flash * | 1.0 | b.ai | live-battery:coordinator-run-20260908 |
| hardender | anthropic/claude-sonnet-5 * | 0.91 | Anthropic | recruiter-scorecard:seed-hardender-01 |
| hardender | cursor/auto * | 0.86 | Cursor | compliance-battery:cursor-auto-all-roles-20260824 |
| hardender | qwen/qwen3.7-plus * | 0.72-0.8 | Alibaba Cloud Token Plan | compliance-battery / operator-onboard |
| documenter | tencentcloud2/glm-5.3-flash * | 1.0 | b.ai | live-battery:coordinator-run-20260908 |
| documenter | cursor/auto * | 0.88 | Cursor | compliance-battery:cursor-auto-all-roles-20260824 |
| documenter | anthropic/claude-sonnet-5 * | 0.85 | Anthropic | recruiter-scorecard:seed-documenter-01 |
| documenter | qwen/qwen3.7-plus * | 0.72-0.8 | Alibaba Cloud Token Plan | compliance-battery / operator-onboard |
| QA | tencentcloud2/glm-5.3-flash * | 1.0 | b.ai | live-battery:coordinator-run-20260908 |
| QA | anthropic/claude-sonnet-5 * | 0.93 | Anthropic | recruiter-scorecard:seed-qa-01 |
| QA | cursor/auto * | 0.87 | Cursor | compliance-battery:cursor-auto-all-roles-20260824 |
| QA | qwen/qwen3.7-plus * | 0.72-0.8 | Alibaba Cloud Token Plan | compliance-battery / operator-onboard |

Full registry also carries uncertified candidates never role-matrix-scored
at all: `alibabacloud/qwen3.8-flash`, `cerebras/llama-3.3-70b`,
`mixai/mimo-v2.5`, `nvidia/nemotron-3-ultra-550b-a55b`,
`tencentcloud2/hy3`, `moonshotai/kimi-k3` (certified but also unscored on
any role) - worth a `role-matrix ... --include-uncertified` re-pull at
delivery time in case new trials landed between now and then.

**Deliverable**: render the table above (re-pulled fresh, not copy-pasted
stale) as a properly formatted FILE ATTACHMENT delivered to the operator's
Concierge Telegram topic - not inline chat text. There is currently no
`sendDocument`-equivalent in `extension/src/notify/telegramClient.ts`; the
closest existing precedent is `sendVoiceNote` (same file), which already
does a multipart file upload to the Telegram Bot API - extend that same
pattern for a generic document upload rather than inventing a new one.
This is pipeline code (`extension/src/`) - a real ticket through the
normal specifier -> coder -> ... -> QA path, not a hotfix.

## 2. Candidate "best-of-breed" swarm conf

By raw score alone, `tencentcloud2/glm-5.3-flash` (b.ai) is the top or
tied-top scorer on every single seat, coder through QA, and ties
`anthropic/claude-fable-5-1` on specifier. A pure best-of-breed conf is
therefore close to what's already running
(`bob-multi-provider-mono-router.conf`, minus specifier being disabled
there). Recommend: reinstate specifier with `claude-fable-5-1` (deeper
evidence: real live-battery production observation vs. GLM's fresh
single-gate synthetic trial - see the caveat on that trial in
`.swarmforge/model-steward/trials/glm-bai-specifier-lite-20260909/`) unless
whoever finalizes this prefers uniform-provider simplicity (all-GLM,
including specifier, accepting the thinner evidence).

## 3. Fallback tiers - several candidates per seat, from different plans

Per-seat ranked alternates, chosen for PROVIDER diversity (never repeat a
plan two seats in a row where a same-or-better-scoring alternate from a
different plan exists), so one exhausted plan degrades one tier, not the
whole swarm:

| Seat | Primary (plan) | Fallback 1 (plan) | Fallback 2 (plan) |
|---|---|---|---|
| specifier | claude-fable-5-1 / glm-5.3-flash (Anthropic / b.ai) | claude-sonnet-5 (Anthropic) | cursor/auto (Cursor) |
| coder | glm-5.3-flash (b.ai) | claude-sonnet-5 (Anthropic) | gpt-5.3-codex (OpenAI) |
| cleaner | glm-5.3-flash (b.ai) | claude-sonnet-5 (Anthropic) | cursor/auto (Cursor) |
| architect | glm-5.3-flash (b.ai) | claude-sonnet-5 (Anthropic) | gpt-5.3-codex (OpenAI) |
| hardender | glm-5.3-flash (b.ai) | claude-sonnet-5 (Anthropic) | cursor/auto (Cursor) |
| documenter | glm-5.3-flash (b.ai) | cursor/auto (Cursor) | claude-sonnet-5 (Anthropic) |
| QA | glm-5.3-flash (b.ai) | claude-sonnet-5 (Anthropic) | cursor/auto (Cursor) |
| coordinator | claude-sonnet-5 (Anthropic) - not role-matrix-scored, but proven live this session | glm-5.3-flash (b.ai) - also proven live this session | - |

Every seat's "Fallback 1" is `claude-sonnet-5`/`claude-fable-5-1`
(Anthropic) - meaning **`swarmforge/packs/anthropic-mono-router.conf`,
which already exists, already IS the tier-1 fallback conf**: if b.ai's
plan is exhausted, switching to that pack (no new file needed) restores
every seat to its #2 choice at once. What's still missing is a genuine
tier-2/3 diversified conf (Fallback 2 column, mixing Cursor/OpenAI/Qwen
per seat) for the case where BOTH b.ai and Anthropic are unavailable at
once - build that as
`swarmforge/packs/candidate-diversified-fallback-mono-router.conf`,
following the header-comment-rationale convention already established in
`bob-multi-provider-mono-router.conf` (state why each seat's pick was
chosen, plan-diversity intent, and how to launch it).

Coordinator's fallback is thin (only Anthropic and b.ai proven live this
session, no role-matrix data at all) - if a third tier is wanted, run a
real trial for `claude-fable-5-1` or `cursor/auto` on coordinator before
promising it as a fallback; don't list an untested pick as a real option
(same discipline as `[[glm-bai-specifier-lite-20260909]]` - only score
what was actually run).

---

## Disposition (specifier, 2026-09-10 07:45 UTC) - split 1:N

| Intake section | Ticket | What went there |
|---|---|---|
| 1 (attachment) - mechanism | BL-1509 | `sendDocument` in telegramClient.ts on the sendVoiceNote pattern + a headless CLI posting any file to the Concierge topic |
| 1 (attachment) - report | BL-1510 | the role-matrix table re-pulled at run time, certified marked, coordinator footer, delivered through BL-1509 (depends_on); file format is a `ruling_options` ask |
| 2 (best-of-breed conf) | BL-1511 | bob pack regains its specifier line; the model is a `ruling_options` ask (claude-fable-5-1 recommended vs all-GLM) |
| 3 (fallback tiers) | BL-1512 | `candidate-diversified-fallback-mono-router.conf` with the Fallback 2 column (documenter deviates to qwen3.7-plus, flagged); coordinator seat is a `ruling_options` ask per the intake's own caveat |

Every operator directive above is carried verbatim into the ticket's
`source:` block (Article 5.3). The 2026-09-09 snapshot table stays here as
the reference the renderer must reproduce fresh. Epic: best-of-breed-swarm
(BL-1180, `decomposes_into` updated).
