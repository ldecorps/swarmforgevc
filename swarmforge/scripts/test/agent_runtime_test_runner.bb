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

;; ── report ────────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (do
    (println "ALL PASS: agent_runtime_lib.bb")))
