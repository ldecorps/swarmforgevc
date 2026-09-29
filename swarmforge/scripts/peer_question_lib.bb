#!/usr/bin/env bb
;; peer_question_lib.bb — BL-1754: the PURE decisions behind peer_question.bb,
;; the one-shot, read-only "ask another role a question" helper. The human,
;; 2026-09-25: mono-router's one-resident rule allows a question a short-lived
;; helper, never a second resident. This lib is the pure half; peer_question.bb
;; is the IO (compose the prompt, spawn the bounded child, write the record).
;;
;; Machinery-independence, expedite_lib.bb's own rule (BL-567) applied here
;; too: this file never load-files handoff_lib.bb / mono_router_lib.bb /
;; swarm_ensure.bb. roles-tsv-row below is a second, minimal reader of the
;; one column (provider) this ticket needs, deliberately not a reuse of
;; handoff_lib.bb's load-role-info — that function is reached only through a
;; require chain that pulls in the full mailbox/tmux/mono-router closet this
;; ticket's own invariant 1 forbids depending on.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "peer_question_lib.bb")))
;; and referred to as peer-question-lib/foo.

(ns peer-question-lib
  (:require [clojure.string :as str]))

(def usage-text
  "Usage: peer_question.bb <project-root> --from <role> --to <role> --question \"<text>\" [--timeout-s <n>]")

;; ── argument parsing ───────────────────────────────────────────────────────
;; Same shape as expedite_lib.bb's own parse-args/flag-value/positionals:
;; value-flags is the single source of truth for which flags consume the
;; next argv element, driving both the positional strip and the reads.

(def value-flags #{"--from" "--to" "--question" "--timeout-s"})

(defn flag-value
  "The element after `flag`, or nil. Returns nil rather than the next flag
   when a value is missing, so `--from --to` cannot read as from \"--to\"."
  [args flag]
  (let [v (second (drop-while #(not= flag %) args))]
    (when (and v (not (str/starts-with? (str v) "--"))) v)))

(defn positionals
  "argv minus every flag and minus every value-flag's value, in order."
  [args]
  (loop [in (seq args) out []]
    (if (empty? in)
      out
      (let [a (str (first in))
            rest' (rest in)]
        (cond
          (contains? value-flags a) (recur (drop 1 rest') out)
          (str/starts-with? a "--") (recur rest' out)
          :else (recur rest' (conj out a)))))))

(defn parse-args
  [argv]
  (let [args (vec (map str argv))
        pos (positionals args)]
    {:project-root (first pos)
     :from (flag-value args "--from")
     :to (flag-value args "--to")
     :question (flag-value args "--question")
     :timeout-s (some-> (flag-value args "--timeout-s") parse-long)}))

(defn missing-required
  "Which required fields `parsed` (parse-args's result) is missing — a blank
   string counts as missing, same as absent. Empty when every required
   field is present, in which case there is nothing to print a usage line
   for."
  [{:keys [project-root from to question]}]
  (vec (keep (fn [[k v]] (when (str/blank? (str v)) k))
             [[:project-root project-root] [:from from] [:to to] [:question question]])))

;; ── timeout ────────────────────────────────────────────────────────────────
;; 5 minutes, the same default a read-only agent scoped to Read/Glob/Grep
;; already uses (contractPhaseRealAdapters.ts's CLAUDE_SURVEY_TIMEOUT_MS) —
;; not expedite's 90-minute stage budget, which assumes real write/build work.

(def default-timeout-s 300)

(defn timeout-ms
  [{:keys [timeout-s]}]
  (* 1000 (or timeout-s default-timeout-s)))

;; ── the question itself ──────────────────────────────────────────────────

(defn user-message
  "The claude -p user turn: the question, prefixed with who is asking."
  [from question]
  (str from " asks: " question))

;; ── roles.tsv, the one column this ticket needs ─────────────────────────

(defn roles-tsv-row
  "Pure: the roles.tsv row map for `role`, or nil when absent or `tsv-text`
   is blank. Same seven-column shape handoff_lib.bb's own load-role-info
   reads (role, worktree-name, worktree-path, session, display, agent,
   receive-mode) — see this file's header for why that function itself is
   never reused here."
  [tsv-text role]
  (some (fn [line]
          (let [[r worktree-name worktree-path session display agent receive-mode]
                (str/split line #"\t")]
            (when (= r role)
              {:role r :worktree-name worktree-name :worktree-path worktree-path
               :session session :display display :agent agent
               :receive-mode receive-mode})))
        (remove str/blank? (str/split-lines (str tsv-text)))))

(defn provider-supported?
  "Only claude has the one-shot, read-only print mode this helper needs."
  [agent]
  (= "claude" agent))

(defn refusal-reason
  "nil when `to`'s seat may be asked; otherwise a message that NAMES the
   role and, when known, its provider — refusal-04's own requirement."
  [{:keys [to role-row]}]
  (cond
    (nil? role-row)
    (str "no such role in roles.tsv: " to)

    (not (provider-supported? (:agent role-row)))
    (str "role " to "'s provider " (pr-str (:agent role-row))
         " has no one-shot read-only mode (peer_question.bb requires provider \"claude\")")

    :else nil))

;; ── the claude invocation, as pure data ──────────────────────────────────
;; --restricted strips command/code-running tools and WebFetch, confines file
;; tools to the working directory, and refuses bypassPermissions outright;
;; --tools Read,Glob,Grep on top of that makes the available set EXACTLY
;; those three (a hard restriction, not a permission allowlist a caller
;; could still be prompted to override) — the structural guarantee behind
;; both scenario 02 and this ticket's own invariant text ("file-reading
;; tools only (no write, edit or shell tool)").

(def read-only-tools "Read,Glob,Grep")

(defn claude-cmd
  [{:keys [user-message prompt-file model]}]
  (vec (concat ["claude" "-p" user-message
                "--append-system-prompt-file" prompt-file
                "--restricted"
                "--tools" read-only-tools]
               (when-not (str/blank? (str model)) ["--model" model]))))

;; ── the durable record (the helper's only durable output) ───────────────

(defn record-filename
  [started-at-ms from to]
  (str started-at-ms "-" from "-to-" to ".json"))

(defn record-path
  [root started-at-ms from to]
  (str root "/.swarmforge/peer-questions/" (record-filename started-at-ms from to)))

(defn answered-record
  [{:keys [from to question answer started-at-ms ended-at-ms]}]
  {:from from :to to :question question :status "answered" :answer answer
   :started_at_ms started-at-ms :ended_at_ms ended-at-ms})

(defn refused-record
  [{:keys [from to question reason started-at-ms ended-at-ms]}]
  {:from from :to to :question question :status "refused" :reason reason
   :started_at_ms started-at-ms :ended_at_ms ended-at-ms})

(defn timed-out-record
  [{:keys [from to question timeout-ms started-at-ms ended-at-ms]}]
  {:from from :to to :question question :status "timed-out"
   :reason (str "no answer within " timeout-ms "ms")
   :started_at_ms started-at-ms :ended_at_ms ended-at-ms})

(defn failed-record
  [{:keys [from to question exit err started-at-ms ended-at-ms]}]
  {:from from :to to :question question :status "failed"
   :reason (str "claude exited " exit (when-not (str/blank? (str err)) (str ": " (str/trim (str err)))))
   :started_at_ms started-at-ms :ended_at_ms ended-at-ms})

;; ── stderr lines (also what refusal-04 and timeout-05 grep for) ──────────

(defn refusal-message [reason]
  (str "REFUSED peer_question: " reason))

(defn timeout-message [to timeout-s]
  (str "PEER_QUESTION_TIMEOUT: " to " did not answer within " timeout-s "s"))

(defn failed-message [to exit]
  (str "PEER_QUESTION_FAILED: " to "'s session exited " exit))
