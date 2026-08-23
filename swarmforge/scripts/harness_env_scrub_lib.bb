;; BL-657: pure list of harness / IDE env markers that must not stick to a
;; long-lived tmux server started from a Claude Code or Cursor shell.
;; BL-1049: plus the provider-secret half - the same tmux server also seeds
;; its global environment from the whole calling shell, so every role pane
;; inherits every API key that shell happened to export.
;; Keep in sync with harness_env_scrub.sh.

(ns harness-env-scrub-lib
  (:require [clojure.set :as set]
            [clojure.string :as str]))

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

(defn harness-marker-var?
  "Is `name` a harness/session marker that must be scrubbed from the tmux
   server's global environment before any role pane is spawned? keep-vars
   win: swarmforge.sh's launch_role reads them from the LAUNCHER's own env
   and re-passes them via respawn-pane -e, so scrubbing one would be a
   misleading exclusion to leave implicit. nil/blank is never a marker."
  [name]
  (boolean (and name
                (not (str/blank? name))
                (not (contains? keep-vars name))
                (contains? scrub-vars name))))

;; ── reading `tmux show-environment -g` output ─────────────────────────────

(defn env-var-name
  "The variable name from one line of `tmux show-environment -g` output,
   which is either `NAME=value` (set) or `-NAME` (tmux's own marked-unset
   syntax). A marked-unset line holds no value, so it can leak nothing and
   yields nil - the caller filters it out rather than trying to remove a
   name that is already gone."
  [line]
  (when-not (str/blank? line)
    (let [trimmed (str/trim line)]
      (when-not (str/starts-with? trimmed "-")
        (first (str/split trimmed #"=" 2))))))

(defn- present-names
  "Distinct variable names carried by `text`, in the order tmux printed them,
   keeping only those in `wanted`. Always a vector - callers loop over it."
  [text wanted]
  (into []
        (comp (keep env-var-name)
              (filter #(contains? wanted %))
              (distinct))
        (str/split-lines (or text ""))))

(defn harness-marker-names
  "BL-657: given the raw output of `tmux show-environment -g`, the distinct
   harness-marker names present that must be scrubbed from the server's
   global environment before any role pane is spawned."
  [text]
  (present-names text (set/difference scrub-vars keep-vars)))

;; ── BL-1049: provider secrets ─────────────────────────────────────────────

(def provider-secret-vars
  "Credential-shaped names observed in the live swarm's tmux server global
   environment (2026-08-22, values redacted). Every one of them reached all
   seven role panes; none is read by any pipeline role pane. Ancillaries that
   DO read them (front desk, operator) run on their own sockets and already
   receive them as explicit `-e` passthroughs, and handoffd forks from the
   launcher process, whose own environment this list never touches."
  #{"BAILIAN_API_KEY"
    "BAILIAN_CODING_PLAN_API_KEY"
    "BAILIAN_TOKEN_PLAN_API_KEY"
    "CEREBRAS_API_KEY"
    "CURSOR_API_KEY"
    "DASHSCOPE_API_KEY"
    "DEEPSEEK_API_KEY"
    "GEMINI_API_KEY"
    "MISTRAL_API_KEY"
    "OPENAI_API_KEY"
    "OPENROUTER_API_KEY"
    "PERPLEXITY_API_KEY"
    "QWEN_API_KEY"
    "RESEND_API_KEY"
    "TELEGRAM_BOT_TOKEN"})

(def backend-provider-vars
  "What each window BACKEND reads, so the keep-list follows the running
   configuration rather than a hand-maintained allowlist. Mirrors what
   swarmforge.sh's launch_role forwards per backend; `openrouter` is not a
   conf backend but the SWARMFORGE_OPENROUTER_ROLES env gate, carried here
   as a pseudo-backend so one uniform map covers both. `claude` and
   `copilot` authenticate by subscription/device flow and need none of
   these - CLAUDE_CODE_OAUTH_TOKEN is BL-657's keep-var, not a provider
   secret."
  {"claude"     #{}
   "copilot"    #{}
   "grok"       #{}
   "codex"      #{"OPENAI_API_KEY"}
   "gemini"     #{"GEMINI_API_KEY"}
   "vibe"       #{"MISTRAL_API_KEY"}
   "openrouter" #{"OPENROUTER_API_KEY"}
   "aider"      #{"OPENAI_API_KEY" "MISTRAL_API_KEY" "CEREBRAS_API_KEY"
                  "PERPLEXITY_API_KEY" "QWEN_API_KEY" "DASHSCOPE_API_KEY"
                  "DEEPSEEK_API_KEY" "BAILIAN_API_KEY"
                  "BAILIAN_CODING_PLAN_API_KEY" "BAILIAN_TOKEN_PLAN_API_KEY"}})

(defn provider-keep-names
  "Every provider secret the given window backends can read, plus BL-657's
   deliberate passthroughs. A backend this map does not know contributes
   EVERY secret: an unrecognised backend must cost the swarm its leak, never
   its credentials (invariant 2)."
  [backends]
  (reduce (fn [acc b]
            (set/union acc (get backend-provider-vars b provider-secret-vars)))
          keep-vars
          (or backends #{})))

(defn provider-scrub-vars
  "The provider secrets the tmux server's global environment must not carry
   for this configuration. An EMPTY backend set means the running
   configuration could not be read at all, which is not evidence that
   nothing needs a key - it scrubs nothing, leaving the leak in place rather
   than silently cutting a configured provider's credentials."
  [backends]
  (if (empty? backends)
    #{}
    (set/difference provider-secret-vars (provider-keep-names backends))))

(defn provider-secret-names
  "Given the raw output of `tmux show-environment -g` and the running
   configuration's window backends, the distinct names to remove."
  [text backends]
  (present-names text (provider-scrub-vars backends)))

(defn config-backends
  "The window backends a swarmforge.conf declares - column 3 of each
   `window <role> <backend> ...` line. Comments and every other directive
   are ignored. An empty set means no window line was readable, which
   provider-scrub-vars treats as 'configuration unknown'."
  [conf-text]
  (into #{}
        (keep (fn [line]
                (let [fields (str/split (str/trim line) #"\s+")]
                  (when (and (= "window" (first fields)) (>= (count fields) 3))
                    (nth fields 2)))))
        (str/split-lines (or conf-text ""))))
