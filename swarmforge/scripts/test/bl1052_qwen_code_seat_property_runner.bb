#!/usr/bin/env bb
;; BL-1052 property test (coder-authored, TWO declared invariants).
;;
;;   Invariant 1: a capability entry describes the AGENT, never the model.
;;   qwen-code and the aider-based qwen pack share a model catalog, an
;;   endpoint and a key, and must never share a capability shape - the two
;;   differ in whether the agent can execute a shell command at all.
;;
;;   Invariant 2: the API key reaches the pane only through the launching
;;   environment and tmux `-e`. It is never written into a pack file, a
;;   generated launch script, a prompt, or anything that reaches a commit.
;;
;; WHY THE PAIRS ARE CONSTRUCTED, NOT DRAWN INDEPENDENTLY (BL-654's known
;; failure shape (b)). The transformation this code can conflate is MODEL ->
;; AGENT: two agents serve the same Qwen model over the same endpoint with the
;; same key, and the map is indexed by agent. Drawing an agent and a model
;; independently would spend most runs on pairs that share nothing, so a
;; conflation would almost never be exercised. P1b therefore draws ONE model
;; from the shared Token Plan catalog and derives BOTH agents that serve it -
;; every generated pair is a collision candidate by construction.
;;
;; WHY P2 ASSERTS THE KEY ARRIVES, NOT ONLY THAT IT IS ABSENT. "The value is
;; in no file" is satisfied perfectly by a launcher that dropped the
;; credential on the floor and left the seat unable to authenticate at all.
;; Every P2 run therefore also proves the SAME value reached the pane through
;; respawn-pane -e, so the property cannot be passed by deleting the feature.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause):
;;   (a) SHELL-HOSTILE VALUES. A key drawn from [A-Za-z0-9] alone would never
;;       contain the quote or `$` that a naive interpolation into the launch
;;       script would mangle or expand, so a leak could hide behind a value
;;       that happens to survive. Hostile fragments carry their own floor.
;;   (b) THE FALLBACK-ONLY PATH. QWEN_API_KEY set is the easy case; the
;;       BAILIAN fallbacks are a separate branch of the guard and are floored
;;       separately, drawn with QWEN_API_KEY deliberately unset.
;;   (c) ORDINARY VALUES. If every value were hostile, a launcher that
;;       mangled a plain key would still pass.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break applied and
;; reverted - see the header of test_qwen_code_seat.sh for the same evidence
;; on the example-based side:
;;   - the "qwen-code" entry removed from provider-capabilities ..... P1a, P1b
;;   - qwen-code's :bootstrap-style set to aider's ................... P1b
;;   - `export QWEN_API_KEY='<value>'` written into the launch script  P2a
;;   - the qwen-code arm removed from launch_role's use_qwen gate .... P2c
;;   - ${qwen_guard} dropped from the generated script ............... P2d
;;
;; P2d's break is deliberately that one and not "the forced guard branch
;; reverted to the opt-in branch": BOTH branches carry the Token Plan host as
;; a literal, so the repair path's host match survives that edit. P2d
;; discriminates whether the endpoint reaches the script AT ALL, which is the
;; coupling that actually decides whether a respawned seat keeps its
;; credentials; the forced-vs-defaulted distinction is P2c's and the example
;; suite's job (they read `export OPENAI_BASE_URL=` unquoted).

(ns bl1052-qwen-code-seat-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (str (fs/parent test-dir)))
(def swarmforge-sh (str (fs/path scripts-dir "swarmforge.sh")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))
(load-file (str (fs/path scripts-dir "provider_compat_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
;; P2 forks zsh and reads back a generated file per run, so it runs a smaller
;; number of heavier cases rather than the same count as the pure-map P1.
(def launch-runs (or (some-> (System/getenv "PROPERTY_LAUNCH_RUNS") parse-long) 40))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

;; ONE generator advanced across every run - a fresh LCG seeded per run index
;; returns a near-constant first draw for a small modulus (BL-991's measured
;; degenerate draw; BL-1057 recorded the same shape per position).
(def rng
  (let [state (atom 1052)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

;; ── invariant 1 ───────────────────────────────────────────────────────────

;; The agent allow-list read FROM THE TREE, never a list kept here: a hand
;; copy is exactly what goes stale the day a ninth agent is added, and the
;; gap it would hide - an agent the launcher accepts but the capability map
;; has never heard of - is silent, because normalize-agent answers with
;; claude's own shape rather than an error.
(def allow-listed-agents
  (let [body (slurp swarmforge-sh)
        arm (second (re-find #"(?m)^\s*(claude\|[a-z0-9|_-]+)\)\s*;;\s*$" body))]
    (when arm (set (str/split arm #"\|")))))

(check! "could not read validate_agent's allow-list out of swarmforge.sh - the check below would assert about nothing"
        (seq allow-listed-agents))

;; P1a: every agent a pack may legally declare has an entry of its OWN.
(doseq [agent (sort allow-listed-agents)]
  (bump! :allow-listed)
  (check! (str "agent '" agent "' is accepted by validate_agent but has no provider-capabilities entry - "
               "a pack declaring it would silently launch with claude's shape")
          (contains? prompt-engine-lib/provider-capabilities agent))
  (check! (str "agent '" agent "' does not normalize to itself - it resolves to '"
               (prompt-engine-lib/normalize-agent agent) "'")
          (= agent (prompt-engine-lib/normalize-agent agent))))

;; The Token Plan SEA catalog both Qwen packs draw from - the shared half of
;; the invariant. Every one of these is servable by EITHER agent.
(def shared-qwen-models
  ["qwen3.7-plus" "qwen3.7-max" "qwen3.6-flash" "qwen3.8-max-preview"
   "deepseek-v4-pro" "glm-5.2"])

;; The two agents that serve those models: one really executes, one is a file
;; editor that cannot. Derived from a model, never drawn beside one.
(defn agents-serving [_model] ["qwen-code" "aider"])

;; The fields that decide whether a seat can DO the job. Sharing either one
;; is what the invariant forbids - a shape that matched on wake style alone
;; would still nudge the executing agent with aider's `! ./script` literal.
(def execution-relevant-keys [:wake-style :bootstrap-style])

;; P1b: same model, same endpoint, same key - and never the same shape.
(doseq [run-index (range runs)]
  (let [model (shared-qwen-models (rng (count shared-qwen-models)))
        [a b] (agents-serving model)
        where (str "run " run-index " model " model)]
    (bump! :model-pairs)
    (when (str/starts-with? model "qwen") (bump! :qwen-catalog-model))
    (when-not (str/starts-with? model "qwen") (bump! :third-party-model))
    (let [caps-a (get prompt-engine-lib/provider-capabilities a)
          caps-b (get prompt-engine-lib/provider-capabilities b)]
      (check! (str where ": agent '" a "' has no capability entry of its own")
              (some? caps-a))
      (check! (str where ": agent '" b "' has no capability entry of its own")
              (some? caps-b))
      (when (and caps-a caps-b)
        (doseq [k execution-relevant-keys]
          (check! (str where ": agents '" a "' and '" b "' share " k " = " (get caps-a k)
                       " - they serve the same model but only one of them can execute a shell command")
                  (not= (get caps-a k) (get caps-b k))))
        ;; And the model genuinely has no say: the shape is a function of the
        ;; agent alone, so asking with the model attached changes nothing.
        (check! (str where ": capabilities are not a function of the agent alone")
                (= caps-a (get prompt-engine-lib/provider-capabilities a)))))))

;; ── invariant 2 ───────────────────────────────────────────────────────────

;; Fragments, not characters: a value drawn from [A-Za-z0-9] would never
;; contain the quote or `$` that an interpolated `export KEY='<value>'` would
;; mangle, so a real leak could hide behind a value that happens to survive.
(def hostile-fragments
  ["'" "\"" "$HOME" "`id`" "\\" ";" "|" "&" "*" "(" ")" " " "#" "\n" "$(id)"])
(def plain-fragments ["sk" "sp" "abc123" "TOKEN" "9f4d" "plan" "aliyun" "0000"])

(defn draw-key-value []
  (let [hostile? (not= 0 (rng 4))
        parts (repeatedly (+ 3 (rng 3))
                          #(let [alphabet (if (and hostile? (zero? (rng 2)))
                                            hostile-fragments
                                            plain-fragments)]
                             (alphabet (rng (count alphabet)))))]
    (str "sk-" (str/join "-" parts))))

;; Both source names the qwen guard reads, in its own precedence order. The
;; fallback is a SEPARATE branch of the guard and is floored separately below.
;;
;; DELIBERATELY NOT BAILIAN_TOKEN_PLAN_API_KEY. Widening this vector to it was
;; the first thing written here, and it failed - swarmforge.sh falls back to
;; BAILIAN_CODING_PLAN_API_KEY and nothing else, while the PRE-EXISTING
;; packs/qwen-mono-router.conf documents BAILIAN_TOKEN_PLAN_API_KEY as the
;; "preferred" name in its own PREREQ block. That mismatch is real and it is
;; older than this ticket, whose contract names exactly these two (and whose
;; acceptance Examples table lists exactly these two); the pack carrying the
;; wrong name is the one scenario 07 requires be left alone. Reported to the
;; specifier with the parcel rather than fixed here.
(def credential-vars ["QWEN_API_KEY" "BAILIAN_CODING_PLAN_API_KEY"])

(def provider-vars
  ["QWEN_API_KEY" "BAILIAN_CODING_PLAN_API_KEY" "BAILIAN_TOKEN_PLAN_API_KEY"
   "OPENAI_API_KEY" "OPENAI_API_BASE" "OPENAI_BASE_URL" "MISTRAL_API_KEY"
   "CEREBRAS_API_KEY" "PERPLEXITY_API_KEY" "GEMINI_API_KEY"
   "SWARMFORGE_GEMINI_API_KEY"])

(def index-of-role-snippet
  "index_of_role() {\n  local target=\"$1\" i\n  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do\n    [[ \"${ROLES[$i]}\" == \"$target\" ]] && { echo \"$i\"; return; }\n  done\n}\n")

(defn make-fixture-root []
  (let [root (str (fs/create-temp-dir {:prefix "bl1052-qwen-prop-"}))]
    (fs/create-dirs (fs/path root "swarmforge" "roles"))
    (fs/create-dirs (fs/path root ".swarmforge" "launch"))
    (fs/create-dirs (fs/path root ".swarmforge" "prompts"))
    (fs/create-dirs (fs/path root "fakebin"))
    (spit (str (fs/path root "swarmforge" "constitution.prompt")) "")
    (doseq [role ["coder" "specifier" "documenter"]]
      (spit (str (fs/path root "swarmforge" "roles" (str role ".prompt"))) "role prompt\n"))
    (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
          "config active_backlog_max_depth -1\nwindow coder qwen-code coder --model qwen3.7-plus\n")
    (let [tmux (str (fs/path root "fakebin" "tmux"))]
      (spit tmux "#!/usr/bin/env bash\necho \"$@\" >> \"$TMUX_LOG\"\nexit 0\n")
      (fs/set-posix-file-permissions tmux "rwxr-xr-x"))
    root))

(defn launch-with
  "Runs the launcher's OWN launch_role against a throwaway root with exactly
   one credential variable set, and returns the generated launch script, the
   generated prompt artifact, and every argv the fake tmux was handed.
   Sourced, never executed (BL-089): no tmux server, no agent, no network."
  [var-name value]
  (let [root (make-fixture-root)]
    (try
      (let [tmux-log (str (fs/path root "fakebin" "tmux-calls.log"))
            env (-> (into {} (System/getenv))
                    (as-> m (apply dissoc m provider-vars))
                    (assoc var-name value
                           "TMUX_LOG" tmux-log
                           "PATH" (str (fs/path root "fakebin") ":" (System/getenv "PATH"))))
            script (str "source '" swarmforge-sh "' '" root "'\n"
                        "parse_config\n" index-of-role-snippet
                        "choose_cleanup_owner\n"
                        "launch_role \"$(index_of_role coder)\"\n")]
        (process/sh {:out :string :err :string :continue true :env env}
                    "zsh" "-f" "-c" script)
        (let [launch-file (fs/path root ".swarmforge" "launch" "coder.sh")
              prompt-file (fs/path root ".swarmforge" "prompts" "coder.md")]
          {:root root
           :launch (when (fs/exists? launch-file) (slurp (str launch-file)))
           :prompt (when (fs/exists? prompt-file) (slurp (str prompt-file)))
           :tmux (when (fs/exists? tmux-log) (slurp tmux-log))
           ;; Every regular file the launch left under the target working
           ;; directory - the invariant names "anything that reaches a
           ;; commit", so the sweep is the tree, not two known paths.
           :files (->> (file-seq (clojure.java.io/file root))
                       (filter #(.isFile %))
                       (remove #(str/includes? (str %) "/fakebin/"))
                       (map str))}))
      (finally
        ;; BL-971: removed in a finally, never only after the last assertion -
        ;; a throw between here and the check would leak the root forever.
        (fs/delete-tree root)))))

(doseq [run-index (range launch-runs)]
  (let [var-name (credential-vars (rng (count credential-vars)))
        value (draw-key-value)
        where (str "run " run-index " " var-name " " (pr-str value))
        {:keys [launch prompt tmux files]} (launch-with var-name value)]
    (bump! :launches)
    (when (= "QWEN_API_KEY" var-name) (bump! :primary-var))
    (when (str/starts-with? var-name "BAILIAN") (bump! :fallback-var))
    (when (re-find #"['\"$`\;|&*() \n]" value) (bump! :hostile-value))
    (when-not (re-find #"['\"$`\;|&*() \n]" value) (bump! :plain-value))

    ;; P2a: the launch script the launcher generated carries no key value.
    (check! (str where ": the launch script was not generated at all")
            (some? launch))
    (when launch
      (check! (str where ": the credential VALUE reached .swarmforge/launch/coder.sh")
              (not (str/includes? launch value))))

    ;; P2b: neither does the prompt artifact, nor ANY other file the launch
    ;; wrote under the target working directory.
    (when prompt
      (check! (str where ": the credential VALUE reached the generated prompt artifact")
              (not (str/includes? prompt value))))
    (doseq [f files]
      (let [content (try (slurp f) (catch Exception _ ""))]
        (when (str/includes? content value)
          (fail! (str where ": the credential VALUE reached " f
                      " - a file under the target working directory (BL-130)")))))

    ;; P2c: and it DID reach the pane, through respawn-pane -e. Without this
    ;; the whole property is satisfied by a launcher that dropped the key.
    (check! (str where ": nothing was handed to tmux at all")
            (some? tmux))
    (when tmux
      (check! (str where ": the key never reached the pane via respawn-pane -e; tmux saw: " tmux)
              (str/includes? tmux (str "-e OPENAI_API_KEY=" value)))
      (check! (str where ": the pane was not pointed at the Token Plan endpoint; tmux saw: " tmux)
              (str/includes? tmux "-e OPENAI_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1")))

    ;; P2d: and it keeps reaching the pane on a RESPAWN. The daemon's repair
    ;; path (handoffd / swarm_ensure, via provider_compat_lib) does not know
    ;; the agent name - it re-derives the provider by matching the Token Plan
    ;; host in the role's own generated launch script. That works today only
    ;; because the forced guard puts the endpoint there; a launch body that
    ;; stopped carrying it would still launch fine and then lose the seat's
    ;; credentials the first time anything respawned it.
    (when launch
      (bump! :respawn-derivable)
      (check! (str where ": a repair respawn could not derive Qwen from the generated launch script - "
                   "the seat would come back without its credentials")
              (provider-compat-lib/launch-cli-implies-qwen? launch)))))

;; P2d: the invariant also names pack files, which are COMMITTED - so this
;; half is checked against the real tree rather than a fixture.
(doseq [pack (sort (map str (fs/glob (str (fs/path (fs/parent scripts-dir) "packs")) "*.{conf,prompt}")))]
  (bump! :packs-scanned)
  (let [content (slurp pack)]
    (doseq [line (str/split-lines content)]
      ;; A credential-shaped assignment: NAME=<something that is not another
      ;; variable reference>. `export QWEN_API_KEY="$BAILIAN_..."` is a
      ;; mapping, not a secret; `QWEN_API_KEY=sk-...` is a secret.
      (when-let [[_ nm val] (re-find #"(?i)\b([A-Z_]*(?:API_KEY|TOKEN|SECRET))\s*=\s*([^\s#]+)" line)]
        ;; A placeholder is not a secret. A pack's PREREQ block legitimately
        ;; SHOWS the operator what to export, and every such line elides the
        ;; value - an ellipsis, an angle-bracket, or another variable to map
        ;; from. What must never appear is a complete literal.
        (when-not (or (str/starts-with? val "$")
                      (str/starts-with? val "\"$")
                      (str/starts-with? val "'$")
                      (str/includes? val "…")
                      (str/includes? val "...")
                      (str/includes? val "<"))
          (fail! (str (fs/file-name pack) " assigns a literal value to " nm
                      " - a credential must never be written into a committed pack file: "
                      (str/trim line))))))))

;; ── reach, asserted rather than hoped for ────────────────────────────────

(defn floor! [k min-count]
  (let [seen (get @reached k 0)]
    (when (< seen min-count)
      (fail! (str "generator reach: " k " was produced " seen " times, needed >= " min-count
                  ". A property that never reaches a state proves nothing about it.")))))

(floor! :allow-listed 8)
(floor! :model-pairs (max 1 (quot runs 2)))
(floor! :qwen-catalog-model (max 1 (quot runs 4)))
(floor! :third-party-model 5)
(floor! :launches (max 1 (quot launch-runs 2)))
(floor! :primary-var 5)
(floor! :fallback-var 5)
(floor! :hostile-value 10)
(floor! :plain-value 3)
(floor! :respawn-derivable (max 1 (quot launch-runs 2)))
(floor! :packs-scanned 10)

(if (empty? @failures)
  (println (str "bl1052 qwen-code seat: ALL PROPERTIES HELD ("
                runs " map runs, " launch-runs " launch runs)"))
  (do (println (str "bl1052 qwen-code seat: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
