#!/usr/bin/env bb
;; BL-1842: a local-model seat's health, one command away. Thin: this file
;; only gathers the facts (default paths, file contents, whether the
;; seat's own process is alive) and hands them to
;; local_seat_report_lib.bb's pure summarise - never a reimplementation of
;; the parsing or state logic, which live only there.
;;
;; Usage:
;;   local_seat_report_cli.bb <project-root> --seat <seat>
;;     [--sessions N] [--now-ms <epoch-ms>]
;;     [--qwen-home <dir>] [--qwen-usage-dir <dir>] [--qwen-projects-dir <dir>]
;;     [--ollama-log <path>]
;;
;; Read-only (ticket invariant): touches no file, pane or process - only
;; reads files and lists processes (pgrep).
(ns local-seat-report-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "local_seat_report_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn opt-value [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (>= idx 0) (get args (inc idx)))))

(defn- parse-long* [s]
  (when-not (str/blank? (str s))
    (try (Long/parseLong (str/trim (str s))) (catch Exception _ nil))))

(defn- read-file-if-exists [path]
  (when (and path (fs/exists? path)) (slurp (str path))))

(defn- usage-file-contents
  "Every *.jsonl file under qwen-usage-dir, most recent N months first when
   --sessions narrows it - but a session can only be found by reading the
   month it actually falls in, so this reads every file present rather
   than guessing one from --sessions (BL-1842: correctness over cleverness
   here; a seat accumulates at most a few months of these)."
  [qwen-usage-dir]
  (if (fs/exists? qwen-usage-dir)
    (->> (fs/list-dir qwen-usage-dir)
         (filter #(str/ends-with? (str %) ".jsonl"))
         (map #(slurp (str %))))
    []))

(defn- pid-cwd
  "worktree-path a running pid's CURRENT WORKING DIRECTORY resolves to, or
   nil (pid gone, permission denied, or - off Linux - no /proc at all)."
  [pid]
  (try (str (fs/canonicalize (fs/read-link (str "/proc/" pid "/cwd"))))
       (catch Exception _ nil)))

(defn- all-pids []
  (try
    (->> (fs/list-dir "/proc")
         (map fs/file-name)
         (filter #(re-matches #"\d+" %)))
    (catch Exception _ [])))

(defn process-alive?
  "BL-1842 D2: identifies the seat's process by its CURRENT WORKING
   DIRECTORY, never by matching worktree-path against argv (`pgrep -f`) -
   a live qwen seat's own argv rarely names its worktree at all (false
   'down'), while any unrelated command line that happens to NAME the path
   (a human's shell, this very CLI's own invocation) matched and read as
   alive even with no seat process running.

   Linux: every pid under /proc, each pid's own cwd symlink resolved and
   compared to worktree-path. macOS has no /proc; `lsof -a -d cwd -Fn`
   lists every open 'cwd' file descriptor's name on its own `n`-prefixed
   line - the same identity check, read a different way. Both targets are
   this project's only two (local-engineering 'Tech Stack')."
  [worktree-path]
  (let [target (try (str (fs/canonicalize worktree-path)) (catch Exception _ (str worktree-path)))]
    (if (fs/exists? "/proc")
      (boolean (some #(= target %) (keep pid-cwd (all-pids))))
      (let [{:keys [out exit]} (process/sh {:continue true} "lsof" "-a" "-d" "cwd" "-Fn")]
        (and (zero? exit)
             (boolean
              (some #(and (str/starts-with? % "n") (= target (subs % 1)))
                    (str/split-lines (or out "")))))))))

(defn build-reports
  "Gathers the facts and returns a seq of local-seat-report-lib/summarise's
   report maps, one per of the `sessions` most recent sessions (newest
   first) - a pure-ish function of its explicit inputs (its only IO is
   reading the resolved files and listing processes; it never touches
   *out*/System/exit) so the CLI's own main below stays a thin wrapper."
  [{:keys [project-root seat sessions now-ms qwen-home qwen-usage-dir qwen-projects-dir ollama-log]}]
  (let [qwen-home (or qwen-home (str (fs/path (System/getProperty "user.home") ".qwen")))
        qwen-usage-dir (or qwen-usage-dir (str (fs/path qwen-home "usage")))
        qwen-projects-dir (or qwen-projects-dir (str (fs/path qwen-home "projects")))
        ollama-log (or ollama-log (local-seat-report-lib/default-ollama-log project-root))
        usage-entries (local-seat-report-lib/parse-usage-entries (usage-file-contents qwen-usage-dir))
        session-ids (local-seat-report-lib/recent-session-ids usage-entries (or sessions 1))
        worktree-path (local-seat-report-lib/seat-worktree-path project-root seat)
        now-ms (or now-ms (System/currentTimeMillis))
        alive? (process-alive? worktree-path)
        ollama-log-text (read-file-if-exists ollama-log)]
    (if (seq session-ids)
      (for [session-id session-ids]
        (let [chat-path (fs/path qwen-projects-dir (local-seat-report-lib/qwen-cwd-key worktree-path)
                                  "chats" (str session-id ".jsonl"))
              chat-jsonl (read-file-if-exists chat-path)]
          (local-seat-report-lib/summarise
           {:usage-entries usage-entries
            :session-id session-id
            :chat-jsonl chat-jsonl
            :ollama-log-text ollama-log-text
            :now-ms now-ms
            :process-alive? alive?})))
      ;; No usage record at all for this seat: still report served/state,
      ;; the parts that never depend on a session existing.
      [(local-seat-report-lib/summarise
        {:usage-entries [] :chat-jsonl nil :ollama-log-text ollama-log-text
         :now-ms now-ms :process-alive? alive?})])))

(defn render
  "The report as lines of text - the CLI's only formatting responsibility."
  [{:keys [session-id requests turns output-tokens reasoning-tokens longest-request-tokens
           compressions api-errors served state]}]
  (let [{:keys [layers-on-gpu layers-total context kv-cache-type tokens-per-second]} served]
    (str/join
     "\n"
     (remove
      nil?
      [(str "State: " (name state))
       (when session-id (str "Session: " session-id))
       (str "Requests: " requests)
       (str "Turns: " turns)
       (str "Output tokens: " output-tokens)
       (str "Reasoning tokens: " reasoning-tokens)
       (str "Longest request: " longest-request-tokens " tokens")
       (str "Compressions: " (count compressions)
            (when (seq compressions)
              (str " (" (str/join ", " (map (fn [{:keys [tokens-before tokens-after]}]
                                               (str tokens-before "->" tokens-after))
                                             compressions))
                   " tokens)")))
       (str "API errors: " api-errors)
       (when (and layers-on-gpu layers-total)
         (str "Served: " layers-on-gpu "/" layers-total " layers on GPU"
              (when context (str ", context " context))
              (when kv-cache-type (str ", KV cache " kv-cache-type))
              (when tokens-per-second (str ", " tokens-per-second " tokens per second"))))]))))

(defn -main [args]
  (let [project-root (first args)
        rest-args (rest args)
        seat (opt-value rest-args "--seat")]
    (when (or (str/blank? project-root) (str/blank? seat))
      (binding [*out* *err*]
        (println "Usage: local_seat_report_cli.bb <project-root> --seat <seat> [--sessions N] [--now-ms <ms>] [--qwen-home <dir>] [--qwen-usage-dir <dir>] [--qwen-projects-dir <dir>] [--ollama-log <path>]"))
      (System/exit 2))
    (let [reports (build-reports
                   {:project-root project-root
                    :seat seat
                    :sessions (parse-long* (opt-value rest-args "--sessions"))
                    :now-ms (parse-long* (opt-value rest-args "--now-ms"))
                    :qwen-home (opt-value rest-args "--qwen-home")
                    :qwen-usage-dir (opt-value rest-args "--qwen-usage-dir")
                    :qwen-projects-dir (opt-value rest-args "--qwen-projects-dir")
                    :ollama-log (opt-value rest-args "--ollama-log")})]
      (println (str/join "\n\n" (map render reports))))))

(-main (cli-args))
