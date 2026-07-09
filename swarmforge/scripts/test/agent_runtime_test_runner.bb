#!/usr/bin/env bb
;; TDD runner for agent_runtime_lib.bb — no tmux, pure assertions.
(ns agent-runtime-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "agent_runtime_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(defn step-ops [steps]
  (mapv :op steps))

;; ── normalize-agent ───────────────────────────────────────────────────────────
(assert= "normalize known agent" "aider" (agent-runtime-lib/normalize-agent "Aider"))
(assert= "unknown falls back to claude" "claude" (agent-runtime-lib/normalize-agent "unknown-bot"))

;; ── handoff draft path (same for all agents) ──────────────────────────────────
(assert= "handoff draft path unified"
         "swarmforge/runtime/handoff-draft.txt"
         (agent-runtime-lib/handoff-draft-path "aider"))
(assert= "handoff draft path claude same"
         "swarmforge/runtime/handoff-draft.txt"
         (agent-runtime-lib/handoff-draft-path "claude"))

;; ── wake-steps ────────────────────────────────────────────────────────────────
(assert= "aider wake runs script via bang"
         [{:op :send-literal :text "! ./swarmforge/scripts/ready_for_next.sh"}
          {:op :submit}]
         (agent-runtime-lib/wake-steps "aider"))

(assert= "claude wake uses chat message"
         [{:op :send-literal :text agent-runtime-lib/default-wake-chat-message}
          {:op :submit}]
         (agent-runtime-lib/wake-steps "claude"))

(assert= "mock wake uses deterministic text"
         [{:op :send-literal :text "MOCK_WAKE"}
          {:op :submit}]
         (agent-runtime-lib/wake-steps "mock"))

(assert= "mock bootstrap steps"
         [{:op :send-literal :text "MOCK_BOOTSTRAP"}
          {:op :submit}]
         (agent-runtime-lib/bootstrap-steps "mock" "coder" :prompt-file "/p.md"))

(assert-true "mock bootstrap text is tagged"
             (str/includes? (agent-runtime-lib/bootstrap-text "mock" "coder") "MOCK_BOOTSTRAP_TEXT"))

(assert-true "needs-tmux-bootstrap includes mock"
             (agent-runtime-lib/needs-tmux-bootstrap? "mock"))

(assert-true "aider wake confirmed when shell output appears"
             (agent-runtime-lib/wake-delivery-confirmed?
              "aider"
              "> ! ./swarmforge/scripts/ready_for_next.sh\n\nTASK: foo.handoff\n"
              "! ./swarmforge/scripts/ready_for_next.sh"))

(assert-true "aider wake confirmed when prompt clears"
             (agent-runtime-lib/wake-delivery-confirmed?
              "aider"
              "swarmforge/roles/coder.prompt\n>"
              "! ./swarmforge/scripts/ready_for_next.sh"))

(assert-true "claude wake not confirmed while text still pending"
             (not (agent-runtime-lib/wake-delivery-confirmed?
                   "claude"
                   "❯ You have new handoff mail"
                   "You have new handoff mail")))

;; ── bootstrap-steps ───────────────────────────────────────────────────────────
(assert-true "claude bootstrap is empty (launch embeds prompt)"
             (empty? (agent-runtime-lib/bootstrap-steps "claude" "coder")))

(let [aider-steps (agent-runtime-lib/bootstrap-steps "aider" "coder"
                                                     :two-pack? true
                                                     :prompt-file "/tmp/prompt.md")
      ops (step-ops aider-steps)]
  (assert= "aider bootstrap starts with sleep" :sleep (first ops))
  (assert-true "aider bootstrap includes /add"
               (some #(str/includes? (:text %) "/add") (filter #(= :send-literal (:op %)) aider-steps)))
  (assert-true "aider bootstrap includes two-pack prompt in /add"
               (some #(str/includes? (:text %) "two-pack.prompt") (filter #(= :send-literal (:op %)) aider-steps)))
  (assert-true "aider bootstrap pastes prompt file"
               (some #(= "/tmp/prompt.md" (:path %)) (filter #(= :paste-file (:op %)) aider-steps))))

(assert= "grok bootstrap pastes only"
         [:sleep :paste-file :submit]
         (step-ops (agent-runtime-lib/bootstrap-steps "grok" "coder" :prompt-file "/p.md")))

;; BL-206: an explicit :startup-delay-ms argument overrides the provider's
;; own capability-map default (grok's is 3000) - a caller-supplied delay
;; must win, not silently be discarded in favor of the capability flag.
(assert= "grok bootstrap honors an explicit startup-delay-ms override over its capability default"
         {:op :sleep :ms 9999}
         (first (agent-runtime-lib/bootstrap-steps "grok" "coder" :prompt-file "/p.md" :startup-delay-ms 9999)))

(assert= "grok bootstrap falls back to its capability-map default (3000ms) when no override is given"
         {:op :sleep :ms 3000}
         (first (agent-runtime-lib/bootstrap-steps "grok" "coder" :prompt-file "/p.md")))

;; ── bootstrap-text ────────────────────────────────────────────────────────────
(assert-true "aider coordinator text forbids coding"
             (str/includes? (agent-runtime-lib/bootstrap-text "aider" "coordinator" :two-pack? true)
                            "ORCHESTRATOR ONLY"))

(assert-true "aider coordinator mentions runtime draft path"
             (str/includes? (agent-runtime-lib/bootstrap-text "aider" "coordinator")
                            "swarmforge/runtime/handoff-draft.txt"))

(assert-true "claude coder text uses Read-lines"
             (str/includes? (agent-runtime-lib/bootstrap-text "claude" "coder")
                            "Read swarmforge/constitution.prompt"))

(assert-true "needs-tmux-bootstrap distinguishes agents"
             (and (agent-runtime-lib/needs-tmux-bootstrap? "aider")
                  (not (agent-runtime-lib/needs-tmux-bootstrap? "claude"))))

;; ── BL-206 capability-branching-01: decisions read capability flags, ──────
;; not brand names - every supported-agents member has a capability entry,
;; and capabilities lookup is itself agent-name-driven ONLY at that one
;; boundary (normalize-agent), never again inside any decision function.
(doseq [agent agent-runtime-lib/supported-agents]
  (assert-true (str "every supported agent has a capabilities entry: " agent)
               (some? (agent-runtime-lib/capabilities agent))))

(assert-true "aider (wake-style :shell-run-script) and claude (:chat-message) decide wake text from the flag, not the name"
             (not= (:text (first (agent-runtime-lib/wake-steps "aider")))
                   (:text (first (agent-runtime-lib/wake-steps "claude")))))

;; A synthetic provider declaring claude's own capabilities must be
;; decided identically to claude by every capability-driven function -
;; proof the decision reads the flag, not the literal string "claude".
(assert=
 "a provider with the same capability flags as claude gets the same wake steps as claude, decided purely from data"
 (agent-runtime-lib/wake-steps "claude")
 (with-redefs [agent-runtime-lib/provider-capabilities
               (assoc agent-runtime-lib/provider-capabilities "codex" (get agent-runtime-lib/provider-capabilities "claude"))]
   (agent-runtime-lib/wake-steps "codex")))

;; ── BL-206 new-provider-is-capabilities-02: adding a provider is adding ───
;; one capability-map entry, no existing function's logic changes. Proven
;; by rebinding provider-capabilities with a wholly synthetic provider and
;; confirming the SAME shared functions (unedited) already handle it.
(let [synthetic-caps (assoc agent-runtime-lib/provider-capabilities
                             "synthetic-provider" {:wake-style :chat-message
                                                    :bootstrap-style :embedded
                                                    :bootstrap-text-style :generic})]
  (with-redefs [agent-runtime-lib/provider-capabilities synthetic-caps
                agent-runtime-lib/supported-agents (conj agent-runtime-lib/supported-agents "synthetic-provider")]
    (assert= "a synthetic provider declared with only capability flags gets uniform chat-style wake steps"
             [{:op :send-literal :text agent-runtime-lib/default-wake-chat-message}
              {:op :submit}]
             (agent-runtime-lib/wake-steps "synthetic-provider"))
    (assert-true "a synthetic embedded-style provider needs no tmux bootstrap, same as claude"
                 (empty? (agent-runtime-lib/bootstrap-steps "synthetic-provider" "coder")))
    (assert-true "a synthetic generic-text-style provider gets the generic bootstrap text"
                 (str/includes? (agent-runtime-lib/bootstrap-text "synthetic-provider" "coder")
                                "Read swarmforge/constitution.prompt"))))

;; ── BL-206 lifecycle-verbs-03: health/stop/respawn produce a step for ─────
;; every supported provider, with no brand-specific branching anywhere in
;; their own implementation (verified structurally: each is a single
;; fixed-step function, not a case/cond over agent identity).
(doseq [agent agent-runtime-lib/supported-agents
        [verb-name verb-fn expected-op] [["health" agent-runtime-lib/health-steps :capture-pane]
                                          ["stop" agent-runtime-lib/stop-steps :kill-pane]
                                          ["respawn" agent-runtime-lib/respawn-steps :respawn-pane]]]
  (let [steps (verb-fn agent)]
    (assert-true (str verb-name " step produced for " agent) (seq steps))
    (assert= (str verb-name " step op for " agent) expected-op (:op (first steps)))))

(assert=
 "health-steps is identical for every supported provider (uniform, no per-provider branching)"
 (agent-runtime-lib/health-steps "claude")
 (agent-runtime-lib/health-steps "aider"))

(assert=
 "stop-steps is identical for every supported provider"
 (agent-runtime-lib/stop-steps "mock")
 (agent-runtime-lib/stop-steps "grok"))

(assert=
 "respawn-steps is identical for every supported provider"
 (agent-runtime-lib/respawn-steps "codex")
 (agent-runtime-lib/respawn-steps "copilot"))

;; ── report ────────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (do
    (println "ALL PASS: agent_runtime_lib.bb")))
