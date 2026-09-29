#!/usr/bin/env bb
;; TDD runner for peer_question_lib.bb (BL-1754) - the pure decisions behind
;; the one-shot, read-only "ask another role a question" helper.

(ns peer-question-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "peer_question_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── parse-args / positionals / flag-value ───────────────────────────────

(assert= "parse-args: reads project-root as the sole positional"
         "/tmp/proj"
         (:project-root (peer-question-lib/parse-args
                          ["/tmp/proj" "--from" "QA" "--to" "specifier" "--question" "does scenario 03 still apply?"])))

(assert= "parse-args: --from"
         "QA"
         (:from (peer-question-lib/parse-args
                 ["/tmp/proj" "--from" "QA" "--to" "specifier" "--question" "q?"])))

(assert= "parse-args: --to"
         "specifier"
         (:to (peer-question-lib/parse-args
               ["/tmp/proj" "--from" "QA" "--to" "specifier" "--question" "q?"])))

(assert= "parse-args: --question, multi-word"
         "does scenario 03 still apply?"
         (:question (peer-question-lib/parse-args
                     ["/tmp/proj" "--from" "QA" "--to" "specifier" "--question" "does scenario 03 still apply?"])))

(assert= "parse-args: --timeout-s parses as a long"
         2
         (:timeout-s (peer-question-lib/parse-args
                      ["/tmp/proj" "--from" "QA" "--to" "specifier" "--question" "q?" "--timeout-s" "2"])))

(assert= "parse-args: --timeout-s absent is nil, never a default baked in here"
         nil
         (:timeout-s (peer-question-lib/parse-args
                      ["/tmp/proj" "--from" "QA" "--to" "specifier" "--question" "q?"])))

(assert= "parse-args: flag order does not matter"
         {:project-root "/tmp/proj" :from "QA" :to "specifier" :question "q?" :timeout-s nil}
         (peer-question-lib/parse-args
          ["--to" "specifier" "--from" "QA" "/tmp/proj" "--question" "q?"]))

(assert= "parse-args: a value-taking flag with a missing value (immediately followed by another flag) reads nil, never the next flag's own name"
         nil
         (:question (peer-question-lib/parse-args
                     ["/tmp/proj" "--from" "QA" "--to" "specifier" "--question" "--timeout-s"])))

(assert= "parse-args: no arguments at all - every field nil/blank"
         {:project-root nil :from nil :to nil :question nil :timeout-s nil}
         (peer-question-lib/parse-args []))

;; ── missing-required ─────────────────────────────────────────────────────

(assert= "missing-required: every field present - nothing missing"
         []
         (peer-question-lib/missing-required
          {:project-root "/tmp/proj" :from "QA" :to "specifier" :question "q?"}))

(assert= "missing-required: no arguments at all names every required field"
         [:project-root :from :to :question]
         (peer-question-lib/missing-required
          {:project-root nil :from nil :to nil :question nil}))

(assert= "missing-required: a blank string counts as missing, same as absent"
         [:question]
         (peer-question-lib/missing-required
          {:project-root "/tmp/proj" :from "QA" :to "specifier" :question "  "}))

;; ── timeout-ms ────────────────────────────────────────────────────────────

(assert= "timeout-ms: default is 300s in ms (the read-only-agent precedent, never expedite's 90-minute stage budget)"
         300000
         (peer-question-lib/timeout-ms {:timeout-s nil}))

(assert= "timeout-ms: an explicit --timeout-s overrides the default"
         2000
         (peer-question-lib/timeout-ms {:timeout-s 2}))

;; ── user-message ──────────────────────────────────────────────────────────

(assert= "user-message: the question, prefixed with who is asking"
         "QA asks: does scenario 03 still apply?"
         (peer-question-lib/user-message "QA" "does scenario 03 still apply?"))

;; ── roles-tsv-row ─────────────────────────────────────────────────────────

(def sample-tsv
  (str "specifier\tmaster\t/root\tswarmforge-specifier\tSpecifier\tclaude\ttask\n"
       "coder\tcoder\t/root/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\n"
       "\n"))

(assert= "roles-tsv-row: finds the named role's row"
         {:role "specifier" :worktree-name "master" :worktree-path "/root"
          :session "swarmforge-specifier" :display "Specifier" :agent "claude"
          :receive-mode "task"}
         (peer-question-lib/roles-tsv-row sample-tsv "specifier"))

(assert= "roles-tsv-row: an aider seat's own agent column reads back verbatim"
         "aider"
         (:agent (peer-question-lib/roles-tsv-row
                  (str "specifier\tmaster\t/root\tswarmforge-specifier\tSpecifier\taider\ttask\n")
                  "specifier")))

(assert= "roles-tsv-row: no matching role - nil, never a wrong row"
         nil
         (peer-question-lib/roles-tsv-row sample-tsv "architect"))

(assert= "roles-tsv-row: blank tsv text - nil, never throws"
         nil
         (peer-question-lib/roles-tsv-row nil "specifier"))

(assert= "roles-tsv-row: blank lines are skipped, not read as a row"
         nil
         (peer-question-lib/roles-tsv-row "\n\n" "specifier"))

;; ── provider-supported? / refusal-reason ──────────────────────────────────

(assert-true "provider-supported?: claude"
             (peer-question-lib/provider-supported? "claude"))
(assert-false "provider-supported?: aider"
              (peer-question-lib/provider-supported? "aider"))
(assert-false "provider-supported?: local-model"
              (peer-question-lib/provider-supported? "local-model"))
(assert-false "provider-supported?: nil agent (blank/malformed row)"
              (peer-question-lib/provider-supported? nil))

(assert= "refusal-reason: a claude seat is never refused"
         nil
         (peer-question-lib/refusal-reason {:to "specifier" :role-row {:agent "claude"}}))

(assert-includes "refusal-reason: no such role names the role"
                  (peer-question-lib/refusal-reason {:to "ghost-role" :role-row nil})
                  "ghost-role")

(assert-includes "refusal-reason: a nil role-row is reported as no-such-role, never as an unsupported-provider fallback (both messages happen to include the role name, so this must check the DISTINGUISHING wording, not just the name)"
                  (peer-question-lib/refusal-reason {:to "ghost-role" :role-row nil})
                  "no such role")

(let [reason (peer-question-lib/refusal-reason {:to "specifier" :role-row {:agent "aider"}})]
  (assert-includes "refusal-reason: unsupported provider names the role" reason "specifier")
  (assert-includes "refusal-reason: unsupported provider names the provider" reason "aider"))

(let [reason (peer-question-lib/refusal-reason {:to "specifier" :role-row {:agent "local-model"}})]
  (assert-includes "refusal-reason: local-model is also refused by name" reason "local-model"))

;; ── claude-cmd ────────────────────────────────────────────────────────────

(assert= "claude-cmd: one print-mode call, the composed prompt file, and Read/Glob/Grep only - no model given"
         ["claude" "-p" "QA asks: q?" "--append-system-prompt-file" "/tmp/prompt.md"
          "--restricted" "--tools" "Read,Glob,Grep"]
         (peer-question-lib/claude-cmd
          {:user-message "QA asks: q?" :prompt-file "/tmp/prompt.md" :model nil}))

(assert= "claude-cmd: a known model is appended, never substituted for --tools"
         ["claude" "-p" "QA asks: q?" "--append-system-prompt-file" "/tmp/prompt.md"
          "--restricted" "--tools" "Read,Glob,Grep" "--model" "claude-opus-5"]
         (peer-question-lib/claude-cmd
          {:user-message "QA asks: q?" :prompt-file "/tmp/prompt.md" :model "claude-opus-5"}))

(assert-false "claude-cmd: never carries --dangerously-skip-permissions (the tool restriction is structural, not a skipped prompt)"
              (boolean (some #{"--dangerously-skip-permissions"}
                             (peer-question-lib/claude-cmd
                              {:user-message "q" :prompt-file "/tmp/p.md" :model nil}))))

(assert-false "claude-cmd: never carries --allowedTools (a permission allowlist, not the hard --tools restriction)"
              (boolean (some #{"--allowedTools"}
                             (peer-question-lib/claude-cmd
                              {:user-message "q" :prompt-file "/tmp/p.md" :model nil}))))

;; ── record path / filename ─────────────────────────────────────────────

(assert= "record-filename: started-at-ms, from, to"
         "1700000000000-QA-to-specifier.json"
         (peer-question-lib/record-filename 1700000000000 "QA" "specifier"))

(assert= "record-path: under .swarmforge/peer-questions/, never the mailbox or the backlog"
         "/root/.swarmforge/peer-questions/1700000000000-QA-to-specifier.json"
         (peer-question-lib/record-path "/root" 1700000000000 "QA" "specifier"))

;; ── record builders ───────────────────────────────────────────────────────

(assert= "answered-record: names from, to, question and answer"
         {:from "QA" :to "specifier" :question "q?" :status "answered" :answer "yes"
          :started_at_ms 1 :ended_at_ms 2}
         (peer-question-lib/answered-record
          {:from "QA" :to "specifier" :question "q?" :answer "yes" :started-at-ms 1 :ended-at-ms 2}))

(assert= "refused-record: status refused, reason carried through"
         {:from "QA" :to "aider-role" :question "q?" :status "refused" :reason "no such"
          :started_at_ms 1 :ended_at_ms 2}
         (peer-question-lib/refused-record
          {:from "QA" :to "aider-role" :question "q?" :reason "no such" :started-at-ms 1 :ended-at-ms 2}))

(assert= "timed-out-record: status timed-out, reason names the bound"
         {:from "QA" :to "specifier" :question "q?" :status "timed-out"
          :reason "no answer within 2000ms" :started_at_ms 1 :ended_at_ms 2}
         (peer-question-lib/timed-out-record
          {:from "QA" :to "specifier" :question "q?" :timeout-ms 2000 :started-at-ms 1 :ended-at-ms 2}))

(assert= "failed-record: status failed, reason names the exit code and stderr"
         {:from "QA" :to "specifier" :question "q?" :status "failed"
          :reason "claude exited 1: boom" :started_at_ms 1 :ended_at_ms 2}
         (peer-question-lib/failed-record
          {:from "QA" :to "specifier" :question "q?" :exit 1 :err "boom\n" :started-at-ms 1 :ended-at-ms 2}))

;; ── message text (what the CLI prints, and what refusal-04/timeout-05 grep for) ──

(assert-includes "refusal-message: carries the reason verbatim"
                  (peer-question-lib/refusal-message "role specifier's provider \"aider\" has no one-shot read-only mode")
                  "aider")

(assert-includes "timeout-message: names the role"
                  (peer-question-lib/timeout-message "specifier" 2)
                  "specifier")
(assert-includes "timeout-message: says timed out"
                  (peer-question-lib/timeout-message "specifier" 2)
                  "did not answer")

(assert-includes "failed-message: names the role and the exit code"
                  (peer-question-lib/failed-message "specifier" 1)
                  "specifier")

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: peer_question_lib.bb"))
