# Intake: add OpenRouter as an alternate provider for claude-harness roles

Filed by the human (2026-07-18, via coordinator) - a raw ask with an attached
draft patch. This is a RAW ask, not a spec: the specifier drains this like any
other backlog-root item, writes proper acceptance criteria, and decides what
(if anything) becomes a real ticket. Do not treat the patch below as pre-approved;
review it for correctness, secrets handling, and scope before turning it into a spec.

## The ask

"let's introduce openrouter" - route one or more `claude`-harness roles through
OpenRouter's Anthropic-compatible endpoint instead of first-party subscription
auth, model-slug selectable per role.

## Attached draft patch (for reference/inspiration only - NOT pre-approved)

```diff
diff --git a/swarmforge/scripts/swarmforge.sh b/swarmforge/scripts/swarmforge.sh
index 2643760..324c877 100755
--- a/swarmforge/scripts/swarmforge.sh
+++ b/swarmforge/scripts/swarmforge.sh
@@ -300,6 +300,21 @@ validate_agent() {
   esac
 }
 
+# OpenRouter: a claude-harness role is OpenRouter-backed when its name appears
+# in the space-separated SWARMFORGE_OPENROUTER_ROLES env list. Env-gated on
+# purpose (NOT a conf schema change): default-empty means every claude role
+# keeps first-party subscription auth exactly as before, and the routing is
+# fully reversible per launch (unset the var / drop the role from it). The
+# role's OpenRouter model slug is carried by its existing --model flag in the
+# conf window line; only the auth target changes here, not the harness.
+role_uses_openrouter() {
+  local role="$1" r
+  for r in ${(s: :)SWARMFORGE_OPENROUTER_ROLES:-}; do
+    [[ "$r" == "$role" ]] && return 0
+  done
+  return 1
+}
+
 # Registers one role into the parallel ROLES/AGENTS/SESSIONS/etc. arrays -
 # shared by parse_config's per-conf-line loop and provision_coordinator
 # (BL-243) so the role model (which array a role occupies a slot in) is a
@@ -1157,7 +1172,17 @@ RESUMECHECK
   local billing_guard=""
   local copilot_guard=""
   if [[ "$agent" == "claude" ]]; then
-    billing_guard=$'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN\n'
+    if role_uses_openrouter "$role"; then
+      # OpenRouter-backed claude role: do NOT unset the auth token (that unset
+      # is what forces subscription auth for every other claude role). Point the
+      # harness at OpenRouter's Anthropic-compatible endpoint ("Anthropic Skin")
+      # and authenticate with OPENROUTER_API_KEY, which arrives in the pane env
+      # via respawn-pane -e (see launch_role) and is never written into this
+      # file - same BL-130 secrets rule as the MISTRAL/OPENAI provider keys.
+      billing_guard=$'export ANTHROPIC_BASE_URL=\'https://openrouter.ai/api\'\nexport ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"\n'
+    else
+      billing_guard=$'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN\n'
+    fi
   elif [[ "$agent" == "copilot" ]]; then
     copilot_guard=$'export COPILOT_ALLOW_ALL=1\n'
   fi
@@ -1279,6 +1304,13 @@ launch_role() {
         provider_env_flags+=(-e "${provider_key}=${(P)provider_key}")
       fi
     done
+  elif role_uses_openrouter "$role"; then
+    # OpenRouter-backed claude role: same ephemeral -e injection - the key
+    # reaches the launch script's `export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"`
+    # via the pane env, never persisted to disk (BL-130).
+    if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
+      provider_env_flags+=(-e "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}")
+    fi
   fi
 
   wait_for_session_pane "$session"
diff --git a/swarmforge/swarmforge.conf b/swarmforge/swarmforge.conf
index 597396c..0c0f969 100644
--- a/swarmforge/swarmforge.conf
+++ b/swarmforge/swarmforge.conf
@@ -76,5 +76,5 @@ window coder claude coder --model claude-sonnet-5 --dangerously-skip-permissions
 window cleaner claude cleaner batch --model claude-sonnet-5 --dangerously-skip-permissions --effort high --remote-control SwarmForge-Cleaner
 window architect claude architect --model claude-sonnet-5 --dangerously-skip-permissions --effort high --remote-control SwarmForge-Architect
 window hardender claude hardender batch --model claude-sonnet-5 --dangerously-skip-permissions --effort high --remote-control SwarmForge-Hardender
-window documenter claude documenter --model claude-sonnet-5 --dangerously-skip-permissions --effort medium --remote-control SwarmForge-Documenter
+window documenter claude documenter --model deepseek/deepseek-chat --dangerously-skip-permissions --effort medium --remote-control SwarmForge-Documenter
 window QA claude QA --model claude-sonnet-5 --dangerously-skip-permissions --effort high --remote-control SwarmForge-QA
```

## Things the specifier should weigh when writing the real spec

- Secrets handling: `OPENROUTER_API_KEY` must follow the existing BL-130 rule
  (ephemeral `-e` pane injection only, never written to `swarmforge.conf` or
  any tracked file) - the draft patch claims to follow this; verify.
- The draft also flips `swarmforge.conf`'s documenter line to a live model
  change (`deepseek/deepseek-chat` via OpenRouter) as a worked example - that
  is a real per-role model/capacity change, which per the coordinator's own
  rules is a human decision, not something to land silently inside a
  mechanism ticket. Consider splitting "add the OpenRouter routing mechanism"
  from "switch documenter's model" into separate acceptance criteria (or two
  tickets) so the human can approve the model swap distinctly from the
  plumbing.
- Test/acceptance coverage for `role_uses_openrouter` and the billing-guard
  branch per the engineering article's testability rules (this is `.sh`
  logic - confirm whether it needs a `.bb`-side port/test per the
  Babashka/Clojure tooling note, or whether `swarmforge/scripts/test/`
  shell-test coverage is the right home).
- Reversibility/default-off behavior (empty `SWARMFORGE_OPENROUTER_ROLES` ->
  unchanged first-party auth for every existing role) should be an explicit
  acceptance scenario, not just a comment claim.
