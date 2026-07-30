;; BL-657: pure list of harness / IDE env markers that must not stick to a
;; long-lived tmux server started from a Claude Code or Cursor shell.
;; Keep in sync with harness_env_scrub.sh.

(ns harness-env-scrub-lib)

(def scrub-vars
  #{"CLAUDE_CODE_CHILD_SESSION"
    "CLAUDECODE"
    "CLAUDE_CODE_SESSION_ID"
    "CLAUDE_CODE_SSE_PORT"
    "CLAUDE_CODE_EXECPATH"
    "CLAUDE_CODE_ENTRYPOINT"
    "CURSOR_AGENT"
    "CURSOR_CONVERSATION_ID"
    "CURSOR_LAYOUT"
    "__CURSOR_SANDBOX_ENV_RESTORE"})

(def keep-vars
  #{"CLAUDE_CODE_MAX_OUTPUT_TOKENS"
    "CLAUDE_CODE_OAUTH_TOKEN"})

(defn scrub-map
  "Drop scrub-vars from an env map. keep-vars are never scrubbed even if
   someone adds a CLAUDE_CODE_* pattern later."
  [env-map]
  (into {}
        (for [[k v] env-map
              :when (or (contains? keep-vars k)
                        (not (contains? scrub-vars k)))]
          [k v])))
