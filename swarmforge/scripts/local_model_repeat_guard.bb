#!/usr/bin/env bb
;; local_model_repeat_guard.bb - the qwen PreToolUse hook a local-model
;; seat's .qwen/settings.json runs before every tool call
;; (write_local_model_qwen_settings in swarmforge.sh registers it).
;;
;; Why (2026-10-04): the iq3 coder, holding a BL-1951 bounce it had already
;; resolved, re-ran the same thirteen `git log ... && git show` commands in
;; a cycle, each up to seven times, for ten minutes with no edit - while
;; both of its compaction summaries said "Stop the ancestry trace ... write
;; tmp/handoff.txt". qwen's own loop detection is off on these seats
;; (skipLoopDetection): its dialog halts a one-shot seat's turn for good.
;;
;; This refuses a tool call that the seat has already made, with the same
;; arguments, twice since the last thing that can change what the call
;; returns: an edit or write_file, a compaction (the seat's context lost the
;; output), or a shell command that changes the repo or the mailbox (a
;; commit, merge, checkout, restore, reset, rebase, or one of the handoff
;; scripts). The refusal reaches the model as the tool's error and the turn
;; goes on. Edits and the state-changing commands themselves are never
;; refused, and an unreadable transcript or event refuses nothing.

(ns local-model-repeat-guard
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(def max-repeats
  "Identical calls allowed in one window; the next one is refused."
  2)

(def edit-tools #{"edit" "write_file"})

(def state-changing-commands
  ["git commit" "git merge" "git checkout" "git switch" "git restore"
   "git reset" "git rebase" "git cherry-pick" "git revert" "git stash"
   "swarm_handoff.sh" "done_with_current.sh" "ready_for_next.sh"])

(def noise-keys
  "Argument keys that do not change what a call returns."
  ["description" "is_background" "timeout"])

(defn call-key [name args]
  [name (apply dissoc (if (map? args) args {}) noise-keys)])

(defn resets-window? [{:keys [kind name args]}]
  (or (= kind :compaction)
      (contains? edit-tools name)
      (and (= name "run_shell_command")
           (let [command (str (get args "command"))]
             (some #(str/includes? command %) state-changing-commands)))))

(defn transcript-entries
  "Tool calls and compactions in transcript order, from qwen's session JSONL
   lines; each call carries :record, the index of the assistant record that
   made it. A line that does not parse is skipped."
  [lines]
  (apply concat
         (map-indexed
          (fn [i line]
            (let [record (try (json/parse-string line) (catch Exception _ nil))]
              (cond
                (not (map? record)) []
                (and (= "system" (get record "type"))
                     (= "chat_compression" (get record "subtype")))
                [{:kind :compaction}]
                (= "assistant" (get record "type"))
                (for [part (get-in record ["message" "parts"])
                      :let [call (get part "functionCall")]
                      :when (map? call)]
                  {:kind :call :record i :name (get call "name") :args (get call "args")})
                :else [])))
          lines)))

(defn- without-in-flight
  "qwen writes a model turn's calls to the transcript before it runs them,
   so the call being decided is already in the last assistant record. Drop
   that one occurrence; nothing is dropped when the record does not hold it."
  [entries k]
  (let [last-record (some :record (rseq entries))
        idx (some (fn [[i e]] (when (and (= last-record (:record e))
                                         (= k (call-key (:name e) (:args e))))
                                i))
                  (map-indexed vector entries))]
    (if idx
      (into (subvec entries 0 idx) (subvec entries (inc idx)))
      entries)))

(defn prior-repeats
  "How many times the call (name, args) was already made in the current
   window, not counting the in-flight call itself."
  [entries name args]
  (let [k (call-key name args)
        entries (without-in-flight (vec entries) k)
        window (reverse (take-while (complement resets-window?) (rseq entries)))]
    (count (filter #(and (= :call (:kind %)) (= k (call-key (:name %) (:args %)))) window))))

(defn refusal
  "The reason to refuse the call, or nil to let it run."
  [entries name args]
  (when-not (resets-window? {:kind :call :name name :args args})
    (let [n (prior-repeats entries name args)]
      (when (>= n max-repeats)
        (str "Refused: you already made this exact " name " call " n
             " times since your last edit, commit or compaction, and nothing it reads has changed,"
             " so it would print the same output again. That output is in your history above."
             " Do not repeat it. Take the next step your plan names instead:"
             " an edit, a commit, the handoff, or done_with_current.sh.")))))

(defn answer [event read-lines]
  (let [name (get event "tool_name")
        args (get event "tool_input")
        path (get event "transcript_path")]
    (when (and (string? name) (string? path))
      (when-let [lines (try (read-lines path) (catch Exception _ nil))]
        (when-let [reason (refusal (transcript-entries lines) name args)]
          (json/generate-string {"hookSpecificOutput" {"hookEventName" "PreToolUse"
                                                       "permissionDecision" "deny"
                                                       "permissionDecisionReason" reason}}))))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [event (try (json/parse-string (slurp *in*)) (catch Exception _ nil))]
    (when-let [out (and (map? event)
                        (answer event #(str/split-lines (slurp %))))]
      (println out))))
