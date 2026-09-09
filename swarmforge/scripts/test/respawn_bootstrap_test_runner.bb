#!/usr/bin/env bb
;; Hotfix 2026-09-09: unit tests for respawn_bootstrap_lib.bb plus wiring
;; checks that BOTH respawn drivers (swarm ensure's single-role repair and
;; mono-router rotation) actually run the bootstrap after a respawn.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "respawn_bootstrap_lib.bb")))

(def failures (atom 0))
(defn assert= [label expected actual]
  (if (= expected actual)
    (println (str "PASS " label))
    (do (println (str "FAIL " label))
        (println (str "  expected: " (pr-str expected)))
        (println (str "  actual:   " (pr-str actual)))
        (swap! failures inc))))

;; ── paths ───────────────────────────────────────────────────────────────────
(assert= "prompt file is <state-dir>/prompts/<role>.md"
         "/r/.swarmforge/prompts/documenter.md"
         (respawn-bootstrap-lib/prompt-file-path "/r/.swarmforge" "documenter"))
(assert= "metadata sidecar sits beside it"
         "/r/.swarmforge/prompts/documenter.md.metadata.json"
         (respawn-bootstrap-lib/metadata-file-path "/r/.swarmforge" "documenter"))

;; ── compose sidecar ─────────────────────────────────────────────────────────
(assert= "sidecar: real launcher shape is read faithfully"
         {:two-pack? true :overlay-prompt "swarmforge/packs/mono-router.prompt"}
         (respawn-bootstrap-lib/parse-compose-metadata
          "{\"role\":\"documenter\",\"agent\":\"aider\",\"two-pack?\":true,\"overlay-prompt\":\"swarmforge/packs/mono-router.prompt\"}"))
(assert= "sidecar: live 2026-09-09 shape (no overlay, not two-pack)"
         {:two-pack? false :overlay-prompt ""}
         (respawn-bootstrap-lib/parse-compose-metadata
          "{\"role\":\"documenter\",\"agent\":\"aider\",\"model\":null,\"two-pack?\":false,\"overlay-prompt\":\"\",\"bootstrap-text-style\":\"aider\"}"))
(assert= "sidecar: missing file degrades to launcher defaults, never refuses"
         {:two-pack? false :overlay-prompt ""}
         (respawn-bootstrap-lib/parse-compose-metadata nil))
(assert= "sidecar: corrupt JSON degrades to defaults"
         {:two-pack? false :overlay-prompt ""}
         (respawn-bootstrap-lib/parse-compose-metadata "{not json"))
(assert= "sidecar: non-string overlay is ignored"
         {:two-pack? false :overlay-prompt ""}
         (respawn-bootstrap-lib/parse-compose-metadata "{\"overlay-prompt\":42}"))

;; ── argv ────────────────────────────────────────────────────────────────────
(def base {:scripts-dir "/r/swarmforge/scripts" :socket "/r/.swarmforge/t.sock"
           :session "swarmforge-coder" :agent "aider" :role "documenter"
           :prompt-file "/r/.swarmforge/prompts/documenter.md" :prompt-file-exists? true})

(assert= "argv matches the launcher's own run-bootstrap call, in order"
         ["bb" "/r/swarmforge/scripts/agent_runtime_cli.bb" "run-bootstrap"
          "/r/.swarmforge/t.sock" "swarmforge-coder" "aider" "documenter"
          "/r/.swarmforge/prompts/documenter.md" "0" ""]
         (respawn-bootstrap-lib/bootstrap-argv base))

(assert= "two-pack + overlay are passed through as the launcher passes them"
         ["bb" "/r/swarmforge/scripts/agent_runtime_cli.bb" "run-bootstrap"
          "/r/.swarmforge/t.sock" "swarmforge-coder" "aider" "documenter"
          "/r/.swarmforge/prompts/documenter.md" "1" "swarmforge/packs/mono-router.prompt"]
         (respawn-bootstrap-lib/bootstrap-argv
          (assoc base :two-pack? true :overlay-prompt "swarmforge/packs/mono-router.prompt")))

(doseq [[label k] [["no socket" :socket] ["no session" :session]
                   ["no agent" :agent] ["no role" :role] ["no scripts dir" :scripts-dir]]]
  (assert= (str "argv refuses with " label) nil
           (respawn-bootstrap-lib/bootstrap-argv (assoc base k ""))))

(assert= "argv refuses when the composed prompt is not on disk (never paste nothing)"
         nil (respawn-bootstrap-lib/bootstrap-argv (assoc base :prompt-file-exists? false)))

;; ── argv-for-role reads prompt + sidecar off the injected filesystem ───────
(assert= "argv-for-role resolves the prompt and its sidecar"
         ["bb" "/r/swarmforge/scripts/agent_runtime_cli.bb" "run-bootstrap"
          "sock" "sess" "aider" "documenter"
          "/r/.swarmforge/prompts/documenter.md" "1" "ov.prompt"]
         (respawn-bootstrap-lib/argv-for-role
          {:scripts-dir "/r/swarmforge/scripts" :state-dir "/r/.swarmforge"
           :socket "sock" :session "sess" :agent "aider" :role "documenter"}
          :exists-fn (constantly true)
          :slurp-fn (constantly "{\"two-pack?\":true,\"overlay-prompt\":\"ov.prompt\"}")))

(assert= "argv-for-role refuses when the role has no composed prompt yet"
         nil
         (respawn-bootstrap-lib/argv-for-role
          {:scripts-dir "/r/swarmforge/scripts" :state-dir "/r/.swarmforge"
           :socket "sock" :session "sess" :agent "claude" :role "coder"}
          :exists-fn (constantly false)
          :slurp-fn (constantly nil)))

;; An :embedded provider (claude) is NOT special-cased here on purpose: the
;; run-bootstrap verb yields no steps for it, so the call is a no-op by
;; construction and no provider name is branched on anywhere in this lib.
(assert= "no provider name appears in the lib" 0
         (->> (slurp (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "respawn_bootstrap_lib.bb")))
              str/split-lines
              (remove #(str/starts-with? (str/triml %) ";;"))
              (filter #(re-find #"\"(claude|aider|cursor|codex|copilot)\"" %))
              count))

;; ── wiring: both respawn drivers run it ────────────────────────────────────
(let [scripts (fs/parent (fs/parent (fs/canonicalize *file*)))
      ensure-src (slurp (str (fs/path scripts "swarm_ensure.bb")))
      handoff-src (slurp (str (fs/path scripts "handoff_lib.bb")))]
  (assert= "swarm_ensure loads the lib" true
           (str/includes? ensure-src "respawn_bootstrap_lib.bb"))
  (assert= "swarm_ensure's bootstrap helper builds its argv from the lib" true
           (let [i (str/index-of ensure-src "(defn- run-respawn-bootstrap!")
                 body (when i (subs ensure-src i (min (count ensure-src) (+ i 1500))))]
             (boolean (and body (str/includes? body "respawn-bootstrap-lib/argv-for-role")))))
  (assert= "swarm_ensure's single-role repair calls it after the repair commands" true
           (let [i (str/index-of ensure-src "(defn- run-single-role-repair!")
                 body (when i (subs ensure-src i (min (count ensure-src) (+ i 2500))))]
             (boolean (and body (str/includes? body "(run-respawn-bootstrap! socket role session)")))))
  (assert= "handoff_lib loads the lib" true
           (str/includes? handoff-src "respawn_bootstrap_lib.bb"))
  (assert= "handoff_lib's bootstrap helper builds its argv from the lib" true
           (let [i (str/index-of handoff-src "(defn run-respawn-bootstrap!")
                 body (when i (subs handoff-src i (min (count handoff-src) (+ i 1800))))]
             (boolean (and body (str/includes? body "respawn-bootstrap-lib/argv-for-role")))))
  (assert= "rotate-resident-to! calls it after a successful respawn" true
           (let [i (str/index-of handoff-src "(defn rotate-resident-to!")
                 body (when i (subs handoff-src i (min (count handoff-src) (+ i 4500))))]
             (boolean (and body (str/includes? body "(run-respawn-bootstrap! socket session target-role)"))))))

(when (pos? @failures)
  (println (str @failures " FAILED"))
  (System/exit 1))
(println "all respawn_bootstrap tests passed")
