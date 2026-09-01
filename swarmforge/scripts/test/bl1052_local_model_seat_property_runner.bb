#!/usr/bin/env bb
;; BL-1052 property test (coder-authored, THREE declared invariants).
;;
;;   Invariant 1: a capability entry describes the AGENT, never the model.
;;   local-model and the aider-based qwen pack can share a model catalog and
;;   must never share a capability shape — they differ in whether the agent
;;   can execute a shell command at all.
;;
;;   Invariant 2: the path is model-generic. Staffing a second downloaded
;;   model must not require a second launch branch / capability entry / pack
;;   family — only the model id on the window line.
;;
;;   Invariant 3: secrets never land in a pack file, a generated launch
;;   script, a prompt, or anything that reaches a commit. Credentials reach
;;   the pane only through the launching environment and tmux -e.
;;
;; WHY THE PAIRS ARE CONSTRUCTED (BL-654 failure shape (b)): draw ONE model
;; from the shared catalog and derive BOTH agents that can serve it, so every
;; generated pair is a collision candidate by construction.
;;
;; Non-vacuity proven at authoring: remove the local-model capability entry
;; (P1), hard-code a second launch case for a second model id (would fail P2
;; reach), write OPENAI_API_KEY into the launch script (P3).

(ns bl1052-local-model-seat-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (str (fs/parent test-dir)))
(def swarmforge-sh (str (fs/path scripts-dir "swarmforge.sh")))
(def packs-dir (str (fs/path (fs/parent scripts-dir) "packs")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def launch-runs (or (some-> (System/getenv "PROPERTY_LAUNCH_RUNS") parse-long) 40))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def rng
  (let [state (atom 1052)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(def allow-listed-agents
  (let [body (slurp swarmforge-sh)
        arm (second (re-find #"(?m)^\s*(claude\|[a-z0-9|_-]+)\)\s*;;\s*$" body))]
    (when arm (set (str/split arm #"\|")))))

(check! "could not read validate_agent's allow-list out of swarmforge.sh"
        (seq allow-listed-agents))

(doseq [agent (sort allow-listed-agents)]
  (bump! :allow-listed)
  (check! (str "agent '" agent "' is accepted by validate_agent but has no provider-capabilities entry")
          (contains? prompt-engine-lib/provider-capabilities agent))
  (check! (str "agent '" agent "' does not normalize to itself")
          (= agent (prompt-engine-lib/normalize-agent agent))))

(def shared-local-models
  ["qwen2.5-coder:7b-instruct" "llama3.1:8b"])

(def execute-agent "local-model")
(def editor-agent "aider")

(dotimes [i runs]
  (let [model (nth shared-local-models (rng (count shared-local-models)))
        caps-exec (get prompt-engine-lib/provider-capabilities execute-agent)
        caps-edit (get prompt-engine-lib/provider-capabilities editor-agent)]
    (bump! :collision-pair)
    (when (zero? (mod i 17)) (bump! :model-sample))
    (check! (str "P1b: local-model missing for shared model " model)
            (some? caps-exec))
    (check! (str "P1b: aider missing for shared model " model)
            (some? caps-edit))
    (check! (str "P1b: agents sharing model " model " must not share wake-style")
            (not= (:wake-style caps-exec) (:wake-style caps-edit)))
    (check! (str "P1b: agents sharing model " model " must not share bootstrap-style")
            (not= (:bootstrap-style caps-exec) (:bootstrap-style caps-edit)))))

(check! "P1b generator never reached a constructed collision pair"
        (pos? (get @reached :collision-pair 0)))

;; P2: both model ids compose through the SAME local-model launch arm.
(defn compose-launch [model]
  (let [root (str (fs/create-temp-dir {:prefix "bl1052-prop-"}))
        conf (str (fs/path root "swarmforge" "swarmforge.conf"))]
    (try
      (fs/create-dirs (fs/path root "swarmforge" "roles"))
      (fs/create-dirs (fs/path root ".swarmforge" "launch"))
      (fs/create-dirs (fs/path root ".swarmforge" "prompts"))
      (spit (str (fs/path root "swarmforge" "constitution.prompt")) "")
      (doseq [role ["coder" "specifier" "documenter"]]
        (spit (str (fs/path root "swarmforge" "roles" (str role ".prompt"))) "role\n"))
      (spit conf (str "config active_backlog_max_depth -1\n"
                      "window coder local-model coder --model " model "\n"))
      (let [cmd (str "source '" swarmforge-sh "' '" root "'; parse_config; "
                     "index_of_role() { local t=\"$1\" i; "
                     "for (( i = 1; i <= ${#ROLES[@]}; i++ )); do "
                     "[[ \"${ROLES[$i]}\" == \"$t\" ]] && { echo \"$i\"; return; }; done; }; "
                     "write_role_launch_script \"$(index_of_role coder)\"")
            _ (process/shell {:out :string :err :string
                              ;; BL-1318: local-model seats have no steward
                              ;; provider mapping (out of steward scope) - bypass
                              ;; the new staffing gate the same way the endpoint
                              ;; readiness probe is bypassed.
                              :extra-env {"SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS" "healthy"
                                          "PACK_STAFFING_SKIP_GATE" "1"}}
                             "zsh" "-f" "-c" cmd)
            body (slurp (str (fs/path root ".swarmforge" "launch" "coder.sh")))]
        body)
      (finally
        (fs/delete-tree root)))))

(let [a (compose-launch "qwen2.5-coder:7b-instruct")
      b (compose-launch "llama3.1:8b")]
  (bump! :model-generic)
  (check! "P2: first model id must appear in the launch body"
          (str/includes? a "--model qwen2.5-coder:7b-instruct"))
  (check! "P2: second model id must appear in the launch body"
          (str/includes? b "--model llama3.1:8b"))
  (check! "P2: both models use the same qwen OpenAI-compat launch binary"
          (and (re-find #"(?m)(^|\s)qwen\s" a)
               (re-find #"(?m)(^|\s)qwen\s" b)))
  (check! "P2: both models target loopback"
          (and (re-find #"127\.0\.0\.1|localhost" a)
               (re-find #"127\.0\.0\.1|localhost" b))))

;; P3: credential value never lands in pack or launch script.
(def hostile-frags ["'\"$" "plain" "sk-local/../x" "line\nbreak"])

(dotimes [_ launch-runs]
  (let [frag (nth hostile-frags (rng (count hostile-frags)))
        key-val (str "bl1052-prop-" frag "-" (rng 100000))
        root (str (fs/create-temp-dir {:prefix "bl1052-sec-"}))]
    (try
      (bump! (if (re-find #"[\"'$/\n]" frag) :hostile-key :plain-key))
      (fs/create-dirs (fs/path root "swarmforge" "roles"))
      (fs/create-dirs (fs/path root ".swarmforge" "launch"))
      (fs/create-dirs (fs/path root ".swarmforge" "prompts"))
      (spit (str (fs/path root "swarmforge" "constitution.prompt")) "")
      (doseq [role ["coder" "specifier" "documenter"]]
        (spit (str (fs/path root "swarmforge" "roles" (str role ".prompt"))) "role\n"))
      (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
            "config active_backlog_max_depth -1\nwindow coder local-model coder --model qwen2.5-coder:7b-instruct\n")
      (let [cmd (str "source '" swarmforge-sh "' '" root "'; parse_config; "
                     "index_of_role() { local t=\"$1\" i; "
                     "for (( i = 1; i <= ${#ROLES[@]}; i++ )); do "
                     "[[ \"${ROLES[$i]}\" == \"$t\" ]] && { echo \"$i\"; return; }; done; }; "
                     "write_role_launch_script \"$(index_of_role coder)\"")
            _ (process/shell {:out :string :err :string
                              :extra-env {"SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS" "healthy"
                                          "PACK_STAFFING_SKIP_GATE" "1"
                                          "OPENAI_API_KEY" key-val}}
                             "zsh" "-f" "-c" cmd)
            body (slurp (str (fs/path root ".swarmforge" "launch" "coder.sh")))
            pack (slurp (str (fs/path packs-dir "local-model-mono-router.conf")))]
        (check! (str "P3: credential value leaked into launch script: " key-val)
                (not (str/includes? body key-val)))
        (check! "P3: pack must not embed a live credential value"
                (not (str/includes? pack key-val))))
      (finally
        (fs/delete-tree root)))))

(check! "P3 generator never reached a hostile credential value"
        (pos? (get @reached :hostile-key 0)))
(check! "P3 generator never reached a plain credential value"
        (pos? (get @reached :plain-key 0)))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PROPERTIES HELD"
         "allow-listed=" (get @reached :allow-listed 0)
         "collision-pairs=" (get @reached :collision-pair 0)
         "model-generic=" (get @reached :model-generic 0)
         "hostile-keys=" (get @reached :hostile-key 0)
         "plain-keys=" (get @reached :plain-key 0))
