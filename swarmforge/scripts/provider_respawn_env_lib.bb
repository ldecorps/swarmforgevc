;; provider_respawn_env_lib.bb — BL-536 extraction of swarm_ensure.bb's
;; provider-respawn-env-args so a second caller (handoffd.bb's auth-observe
;; respawn path) can reuse the SAME machinery without load-file'ing
;; swarm_ensure.bb itself, which unconditionally runs (-main) at the bottom
;; of the file (a full ensure sweep + System/exit) as a side effect of being
;; loaded - fine for a script invoked directly, fatal for a library import
;; inside a long-running daemon process.
;;
;; Load:
;;   (load-file ... "provider_respawn_env_lib.bb")
;;   provider-respawn-env-lib/provider-respawn-env-args state-dir role

(ns provider-respawn-env-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_compat_lib.bb")))

(defn provider-respawn-env-args
  "BL-130 pane -e passthrough for ensure/respawn repairs — same keys rotate/chase
   need so a repair never strips OpenRouter/OpenAI/Mistral/Cerebras/Perplexity/Gemini/Qwen
   auth from a live alternate-runtime pane.

   SRE 2026-07-19: when role's launch script CLI targets api.perplexity.ai,
   Perplexity wins for OPENAI_* even if SWARMFORGE_USE_PERPLEXITY was unset
   in the calling process (provider_compat_lib/must-remap-to-perplexity?).
   Gemini: GEMINI_API_KEY, or SWARMFORGE_GEMINI_API_KEY mapped to GEMINI_API_KEY.
   Qwen: QWEN_API_KEY, or BAILIAN_CODING_PLAN_API_KEY mapped to QWEN_API_KEY.

   state-dir is passed explicitly (never a bound global) so both callers -
   swarm_ensure.bb's own process-arg state-dir and handoffd.bb's daemon-wide
   state-dir - resolve the SAME role launch script without this lib picking
   a side in what 'state-dir' means."
  ([state-dir] (provider-respawn-env-args state-dir nil))
  ([state-dir role]
   (let [launch-cli (when role
                      (let [p (fs/path state-dir "launch" (str role ".sh"))]
                        (when (fs/exists? p) (slurp (str p)))))
         use-cerebras (= "1" (System/getenv "SWARMFORGE_USE_CEREBRAS"))
         use-perplexity (= "1" (System/getenv "SWARMFORGE_USE_PERPLEXITY"))
         use-qwen (= "1" (System/getenv "SWARMFORGE_USE_QWEN"))
         cerebras (System/getenv "CEREBRAS_API_KEY")
         perplexity (System/getenv "PERPLEXITY_API_KEY")
         qwen (let [q (System/getenv "QWEN_API_KEY")]
                (if (str/blank? q)
                  (System/getenv "BAILIAN_CODING_PLAN_API_KEY")
                  q))
         gemini (let [g (System/getenv "GEMINI_API_KEY")]
                  (if (str/blank? g)
                    (System/getenv "SWARMFORGE_GEMINI_API_KEY")
                    g))
         resolved (provider-compat-lib/resolve-openai-compat
                   {:use-cerebras use-cerebras
                    :use-perplexity use-perplexity
                    :use-qwen use-qwen
                    :cerebras-api-key cerebras
                    :perplexity-api-key perplexity
                    :qwen-api-key qwen
                    :openai-api-key (System/getenv "OPENAI_API_KEY")
                    :launch-cli launch-cli})
         openai (:openai-api-key resolved)
         openai-base (:openai-api-base resolved)
         openai-base-url (:openai-base-url resolved)
         force-perplexity (= :perplexity (:provider resolved))
         force-cerebras (= :cerebras (:provider resolved))
         force-qwen (= :qwen (:provider resolved))]
     (cond-> []
       (not (str/blank? (System/getenv "OPENROUTER_API_KEY")))
       (concat ["-e" (str "OPENROUTER_API_KEY=" (System/getenv "OPENROUTER_API_KEY"))])
       (not (str/blank? (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS")))
       (concat ["-e" (str "CLAUDE_CODE_MAX_OUTPUT_TOKENS=" (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS"))])
       (not (str/blank? (System/getenv "MISTRAL_API_KEY")))
       (concat ["-e" (str "MISTRAL_API_KEY=" (System/getenv "MISTRAL_API_KEY"))])
       (not (str/blank? cerebras))
       (concat ["-e" (str "CEREBRAS_API_KEY=" cerebras)])
       (not (str/blank? perplexity))
       (concat ["-e" (str "PERPLEXITY_API_KEY=" perplexity)])
       (not (str/blank? qwen))
       (concat ["-e" (str "QWEN_API_KEY=" qwen)])
       (not (str/blank? gemini))
       (concat ["-e" (str "GEMINI_API_KEY=" gemini)])
       (or use-cerebras force-cerebras)
       (concat ["-e" "SWARMFORGE_USE_CEREBRAS=1"])
       (or use-perplexity force-perplexity)
       (concat ["-e" "SWARMFORGE_USE_PERPLEXITY=1"])
       (or use-qwen force-qwen)
       (concat ["-e" "SWARMFORGE_USE_QWEN=1"])
       (not (str/blank? openai))
       (concat ["-e" (str "OPENAI_API_KEY=" openai)])
       (not (str/blank? openai-base))
       (concat ["-e" (str "OPENAI_API_BASE=" openai-base)])
       (not (str/blank? openai-base-url))
       (concat ["-e" (str "OPENAI_BASE_URL=" openai-base-url)])))))
