#!/usr/bin/env bb
;; BL-1049: pure tests for the provider-secret half of harness_env_scrub_lib.bb.
;;
;; tmux seeds a NEW server's global environment from the entire calling shell,
;; so every pane the server opens afterwards inherits a copy. BL-657 built the
;; scrub hook for that reason but scoped it to Claude Code / Cursor harness
;; MARKERS; fifteen live provider credentials were never in that set and still
;; reach all seven role panes. These tests pin the classifier that decides
;; which provider names the tmux SERVER's global environment may keep, derived
;; from the running configuration's own window backends.
;;
;; No tmux, no processes, no files - just data, so every decision here is
;; deterministic and instant.

(ns bl1049-provider-env-scrub-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "harness_env_scrub_lib.bb")))

(alias 'lib 'harness-env-scrub-lib)

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── the scrub set is the observed leak, exactly ───────────────────────────

(assert= "the provider-secret set is the fifteen names observed on the live socket"
         #{"BAILIAN_API_KEY" "BAILIAN_CODING_PLAN_API_KEY" "BAILIAN_TOKEN_PLAN_API_KEY"
           "CEREBRAS_API_KEY" "CURSOR_API_KEY" "DASHSCOPE_API_KEY" "DEEPSEEK_API_KEY"
           "GEMINI_API_KEY" "MISTRAL_API_KEY" "OPENAI_API_KEY" "OPENROUTER_API_KEY"
           "PERPLEXITY_API_KEY" "QWEN_API_KEY" "RESEND_API_KEY" "TELEGRAM_BOT_TOKEN"}
         lib/provider-secret-vars)

;; ── keep-list derived from the running configuration ──────────────────────

;; The keep-list is always BL-657's deliberate passthroughs PLUS whatever the
;; configured backends read - the two halves of invariant 2 in one set.

(assert= "a claude-only configuration needs no provider secret at all"
         lib/keep-vars
         (lib/provider-keep-names #{"claude"}))

(assert= "one vibe window keeps MISTRAL_API_KEY and nothing else"
         (conj lib/keep-vars "MISTRAL_API_KEY")
         (lib/provider-keep-names #{"vibe"}))

(assert= "a mixed configuration keeps the union of its backends' needs"
         (into lib/keep-vars ["MISTRAL_API_KEY" "GEMINI_API_KEY"])
         (lib/provider-keep-names #{"claude" "vibe" "gemini"}))

(assert= "the openrouter pseudo-backend (SWARMFORGE_OPENROUTER_ROLES) keeps its token"
         (conj lib/keep-vars "OPENROUTER_API_KEY")
         (lib/provider-keep-names #{"claude" "openrouter"}))

;; ── the scrub list is the leak minus what the configuration needs ─────────

(assert= "a claude-only configuration scrubs all fifteen"
         lib/provider-secret-vars
         (lib/provider-scrub-vars #{"claude"}))

(assert= "one vibe window scrubs the other fourteen and keeps MISTRAL_API_KEY"
         (disj lib/provider-secret-vars "MISTRAL_API_KEY")
         (lib/provider-scrub-vars #{"vibe"}))

(assert-false "MISTRAL_API_KEY is never scrubbed when a vibe window is configured"
              (contains? (lib/provider-scrub-vars #{"claude" "vibe"}) "MISTRAL_API_KEY"))

(assert-true "MISTRAL_API_KEY IS scrubbed when no configured window can read it"
             (contains? (lib/provider-scrub-vars #{"claude"}) "MISTRAL_API_KEY"))

;; ── invariant 2's fail-open edge: an unknown configuration scrubs nothing ──

(assert= "an EMPTY backend set means the configuration could not be read - scrub nothing"
         #{}
         (lib/provider-scrub-vars #{}))

(assert= "nil backends (no conf resolvable at all) scrubs nothing"
         #{}
         (lib/provider-scrub-vars nil))

(assert= "an UNKNOWN backend name keeps every secret rather than guessing"
         #{}
         (lib/provider-scrub-vars #{"claude" "some-future-backend"}))

;; ── BL-657's deliberate passthroughs are never provider-scrubbed ──────────

(doseq [k ["CLAUDE_CODE_OAUTH_TOKEN" "CLAUDE_CODE_MAX_OUTPUT_TOKENS"]]
  (assert-false (str k " (BL-657 keep-var) is never in the provider scrub set")
                (contains? (lib/provider-scrub-vars #{"claude"}) k)))

;; ── the observable classifier over `tmux show-environment -g` output ──────

(assert= "only the names actually present on the server come back, in input order"
         ["OPENAI_API_KEY" "TELEGRAM_BOT_TOKEN"]
         (lib/provider-secret-names
           (str "PATH=/usr/bin\nOPENAI_API_KEY=sk-redacted\n"
                "CLAUDE_CODE_OAUTH_TOKEN=keepme\nTELEGRAM_BOT_TOKEN=123:abc\n-UNSET_MARKER")
           #{"claude"}))

(assert= "a vibe configuration leaves MISTRAL_API_KEY out of the names to remove"
         ["OPENAI_API_KEY"]
         (lib/provider-secret-names "OPENAI_API_KEY=sk-x\nMISTRAL_API_KEY=m-x" #{"vibe"}))

(assert= "no secrets present yields an empty vector, never nil (the caller loops over it)"
         []
         (lib/provider-secret-names "PATH=/usr/bin\nHOME=/root" #{"claude"}))

(assert= "empty input yields an empty vector"
         [] (lib/provider-secret-names "" #{"claude"}))

(assert= "nil input yields an empty vector, never raises"
         [] (lib/provider-secret-names nil #{"claude"}))

(assert= "a duplicated line is deduped"
         ["OPENAI_API_KEY"]
         (lib/provider-secret-names "OPENAI_API_KEY=a\nOPENAI_API_KEY=a" #{"claude"}))

(assert= "a tmux unset marker (-NAME) is not a leak and is never reported"
         []
         (lib/provider-secret-names "-OPENAI_API_KEY" #{"claude"}))

;; ── reading the configuration's window backends ───────────────────────────

(assert= "window lines yield their backend column, deduped"
         #{"claude"}
         (lib/config-backends
           (str "config active_backlog_max_depth 5\n"
                "window specifier claude master --model claude-opus-5\n"
                "window coder claude coder --model claude-sonnet-5\n")))

(assert= "a mixed conf yields every backend it declares"
         #{"claude" "vibe"}
         (lib/config-backends
           (str "window coder claude coder\nwindow documenter vibe documenter --max-price 2.00\n")))

(assert= "a conf with no window line yields the empty set (fail-open upstream)"
         #{}
         (lib/config-backends "config active_backlog_max_depth 5\n"))

(assert= "nil conf text yields the empty set, never raises"
         #{} (lib/config-backends nil))

;; ── invariant 1: the launcher-process scrub never touches a provider key ──

(assert= "no provider secret is on BL-657's launcher-process scrub list"
         #{}
         (clojure.set/intersection lib/scrub-vars lib/provider-secret-vars))

;; ── invariant 3: the Babashka lib and its shell twin name the same set ────

(let [sh-path (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "harness_env_scrub.sh"))
      body (slurp sh-path)
      block (second (re-find #"(?s)HARNESS_ENV_PROVIDER_SECRET_VARS=\(\n(.*?)\n\)" body))
      sh-names (when block (set (remove str/blank? (map str/trim (str/split-lines block)))))]
  (assert= "harness_env_scrub.sh declares the same fifteen provider names as the lib"
           lib/provider-secret-vars
           sh-names)
  (doseq [[backend names] lib/backend-provider-vars]
    (let [pattern (re-pattern (str "(?m)^\\s*" backend "\\)\\s+printf '%s\\\\n'\\s*(.*?)\\s*;;\\s*$"))
          m (re-find pattern body)
          sh-set (if m (set (remove str/blank? (str/split (str/trim (second m)) #"\s+"))) ::missing)]
      (assert= (str "harness_env_scrub.sh maps the '" backend "' backend to the same names as the lib")
               names sh-set))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "bl1049 provider env scrub: ALL TESTS PASSED")
  (do (println (str "bl1049 provider env scrub: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
