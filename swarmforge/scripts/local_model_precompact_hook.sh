#!/usr/bin/env bash
# local_model_precompact_hook.sh - the qwen PreCompact hook a local-model
# seat's .qwen/settings.json runs before every chat compaction
# (write_local_model_qwen_settings in swarmforge.sh registers it).
#
# Why (2026-10-04, coordinator note 016208): qwen's compaction prompt asks
# for a free <analysis> block first, then nine <state_snapshot> sections
# with <pending_tasks>, <current_work> and <next_step> LAST, and
# <files_and_code_sections> asking for "full code snippets" before them.
# The tool-call shim caps every reply at the model's Modelfile num_predict
# (e44f9cdfc7; 4096 for iq3), so every summary was cut off before those
# last three sections: 0 of 24 snapshots in one coder session closed
# </state_snapshot>. The seat lost its place at every compaction, re-read
# the same files (one 39 times) and never forwarded BL-1858 in 6 hours.
#
# qwen appends this hook's additionalContext to the compaction prompt as
# "Additional Instructions" (buildCompressionSystemPrompt). The text puts
# the resume sections first and bounds the length, so a summary that still
# hits the cap loses only the least important sections. It does not depend
# on the event input, which is drained and ignored.
cat >/dev/null
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext":"BOUNDED SUMMARY. Your reply stops at a hard output cap of a few thousand tokens and everything after the cap is lost. A summary cut off before <next_step> leaves the agent unable to resume. Therefore: (1) Do not write an <analysis> block; start your reply with <state_snapshot>. (2) Inside <state_snapshot>, write <next_step> first, then <current_work>, then <pending_tasks>, and only then the other sections. (3) Keep the whole snapshot under 900 words. In <files_and_code_sections> give each file as its path plus one line on why it matters, never code. In <all_user_messages> keep only the messages that set or change the task. (4) Copy commit hashes, ticket ids, file paths and commands exactly. (5) End with </state_snapshot>."}}
EOF
