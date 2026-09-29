#!/usr/bin/env bb
;; peer_question.bb — BL-1754: a role with a question for another role asks
;; it through a one-shot, read-only helper rather than spinning up a second
;; resident. The human, 2026-09-25: mono-router's one-resident rule allows an
;; ephemeral session for a question; installing a second resident is what it
;; forbids. This CLI runs the target role's own composed prompts as ONE
;; print-mode `claude` call, tools restricted to Read/Glob/Grep only, prints
;; the answer, records the question and answer under .swarmforge/, and exits.
;;
;; It never runs ready_for_next.sh or any mailbox helper, never starts a tmux
;; session, and never touches the target's inbox or the backlog. All pure
;; judgement lives in peer_question_lib.bb; this file is IO only.
;;
;; Usage:
;;   peer_question.bb <project-root> --from <role> --to <role>
;;                     --question "<text>" [--timeout-s <n>]
;;
;; Exit codes: 0 answered; 2 usage (missing/blank required argument, or a
;; malformed project-root); 3 refused (unknown role or unsupported provider —
;; claude was never invoked); 4 timed out; 5 the claude child exited nonzero
;; for some other reason.

(ns peer-question-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path scripts-dir "peer_question_lib.bb")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))
;; BL-1525: this file's own subprocess call is the bounded chokepoint,
;; reached via bounded_run_lib.bb - never a plain process/sh (BL-1031's
;; ratchet), and it is what gives invariant 2 ("no process it started is
;; alive" on answer, refusal or timeout) a real enforcement mechanism rather
;; than a hope: on a wall-clock overrun the whole process GROUP is killed.
(load-file (str (fs/path scripts-dir "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path scripts-dir "bounded_run_lib.bb")))
(load-file (str (fs/path scripts-dir "project_root_arg_lib.bb")))

(defn- now-ms [] (System/currentTimeMillis))

(defn- usage-and-exit! []
  (binding [*out* *err*] (println peer-question-lib/usage-text))
  (System/exit 2))

(defn- settings-model
  "The target role's own configured model, or nil (peer_question.bb never
   refuses for a missing/unreadable settings file — the claude call just
   omits --model and gets the account default)."
  [project-root role]
  (let [p (fs/path project-root ".swarmforge" "launch" (str role ".claude-settings.json"))]
    (when (fs/exists? p)
      (try (:model (json/parse-string (slurp (str p)) true))
           (catch Exception _ nil)))))

(defn- roles-tsv-text [project-root]
  (let [p (fs/path project-root ".swarmforge" "roles.tsv")]
    (when (fs/exists? p) (slurp (str p)))))

(defn- write-record! [project-root record started-at-ms from to]
  (let [path (peer-question-lib/record-path project-root started-at-ms from to)]
    (fs/create-dirs (fs/parent path))
    (spit path (str (json/generate-string record {:pretty true}) "\n"))
    path))

(defn -main [argv]
  (let [parsed (peer-question-lib/parse-args argv)]
    (when (seq (peer-question-lib/missing-required parsed))
      (usage-and-exit!))
    (let [root-check (project-root-arg-lib/check-root (:project-root parsed))]
      (when-not (:ok root-check)
        (project-root-arg-lib/refuse-and-exit! peer-question-lib/usage-text root-check))
      (let [root (:root root-check)
            {:keys [from to question]} parsed
            bound-ms (peer-question-lib/timeout-ms parsed)
            started-at-ms (now-ms)
            role-row (peer-question-lib/roles-tsv-row (roles-tsv-text root) to)
            reason (peer-question-lib/refusal-reason {:to to :role-row role-row})]
        (if reason
          (do
            (write-record! root
                           (peer-question-lib/refused-record
                            {:from from :to to :question question :reason reason
                             :started-at-ms started-at-ms :ended-at-ms (now-ms)})
                           started-at-ms from to)
            (binding [*out* *err*] (println (peer-question-lib/refusal-message reason)))
            (System/exit 3))
          (let [run-dir (fs/create-temp-dir {:prefix "bl1754-peer-question-"})
                ;; BL-1754 D1 (QA bounce 4f729861ee): System/exit tears the
                ;; JVM down immediately and never runs a `finally` on the
                ;; current thread, so a call to it from INSIDE this try body
                ;; skipped `(fs/delete-tree run-dir)` on the timed-out and
                ;; failed branches, leaking the run-dir on every such exit.
                ;; The try body now only COMPUTES the exit code; `finally`
                ;; always runs first, and System/exit (only when non-zero)
                ;; happens after the try/finally has already returned.
                exit-code
                (try
                  (let [prompt-file (str (fs/path run-dir "prompt.md"))
                        out-file (str (fs/path run-dir "answer.txt"))
                        err-file (str (fs/path run-dir "stderr.log"))
                        {:keys [system-prompt]} (prompt-engine-lib/compose to {:agent "claude" :deterministic? true})
                        _ (spit prompt-file system-prompt)
                        model (settings-model root to)
                        cmd (peer-question-lib/claude-cmd
                             {:user-message (peer-question-lib/user-message from question)
                              :prompt-file prompt-file :model model})
                        {:keys [exit timed-out?]}
                        (apply bounded-run-lib/run-bounded!
                               {:dir root :extra-env {"ANTHROPIC_API_KEY" "" "ANTHROPIC_AUTH_TOKEN" ""}}
                               bound-ms out-file err-file cmd)
                        ended-at-ms (now-ms)]
                    (cond
                      timed-out?
                      (do
                        (write-record! root
                                       (peer-question-lib/timed-out-record
                                        {:from from :to to :question question :timeout-ms bound-ms
                                         :started-at-ms started-at-ms :ended-at-ms ended-at-ms})
                                       started-at-ms from to)
                        (binding [*out* *err*]
                          (println (peer-question-lib/timeout-message to (quot bound-ms 1000))))
                        4)

                      (not (zero? exit))
                      (let [err-text (when (fs/exists? err-file) (slurp err-file))]
                        (write-record! root
                                       (peer-question-lib/failed-record
                                        {:from from :to to :question question :exit exit :err err-text
                                         :started-at-ms started-at-ms :ended-at-ms ended-at-ms})
                                       started-at-ms from to)
                        (binding [*out* *err*]
                          (println (peer-question-lib/failed-message to exit)))
                        5)

                      :else
                      (let [answer (str/trim (slurp out-file))]
                        (write-record! root
                                       (peer-question-lib/answered-record
                                        {:from from :to to :question question :answer answer
                                         :started-at-ms started-at-ms :ended-at-ms ended-at-ms})
                                       started-at-ms from to)
                        (println answer)
                        0)))
                  (finally (fs/delete-tree run-dir)))]
            (when (pos? exit-code) (System/exit exit-code))))))))

(-main *command-line-args*)
