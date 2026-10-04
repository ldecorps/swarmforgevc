#!/usr/bin/env bb
;; BL-1851: a local-model seat's tuning report, one command away. Thin:
;; reads BL-1850's settings record, every one of the seat's qwen session
;; files, and the Ollama log, then hands already-parsed data to
;; local_seat_tuning_report_lib.bb's pure grouping/summary - never a
;; reimplementation of the record parsing, which lives only in
;; local_seat_report_lib.bb (BL-1811, BL-1842).
;;
;; Usage:
;;   local_seat_tuning_report_cli.bb <project-root> --seat <seat>
;;     [--since <iso-date>] [--qwen-home <dir>] [--qwen-projects-dir <dir>]
;;     [--ollama-log <path>] [--settings-file <path>]
;;
;; Read-only (ticket invariant 1): touches no file, pane or process.
(ns local-seat-tuning-report-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "local_seat_report_lib.bb")))
(load-file (str (fs/path scripts-dir "local_seat_tuning_report_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(defn opt-value [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (>= idx 0) (get args (inc idx)))))

(defn- read-file-if-exists [path]
  (when (and path (fs/exists? path)) (slurp (str path))))

(defn- parse-jsonl-rows [text]
  (->> (str/split-lines (or text ""))
       (remove str/blank?)
       (keep (fn [line] (try (json/parse-string line true) (catch Exception _ nil))))))

(defn- read-settings-rows [settings-file]
  (vec (parse-jsonl-rows (read-file-if-exists settings-file))))

(defn- session-files [chats-dir]
  (if (fs/exists? chats-dir)
    (->> (fs/list-dir chats-dir)
         (filter #(str/ends-with? (str %) ".jsonl"))
         sort)
    []))

(defn- session-id-of [path]
  (str/replace (fs/file-name path) #"\.jsonl$" ""))

(defn gather
  "Every input local-seat-tuning-report-lib/partition-into-groups needs,
   read from disk - the CLI's only IO. A pure-ish function of its explicit
   inputs, kept separate from -main so a fixture can call it directly
   without touching *out*/System/exit."
  [{:keys [project-root seat since qwen-home qwen-projects-dir ollama-log settings-file]}]
  (let [qwen-home (or qwen-home (str (fs/path (System/getProperty "user.home") ".qwen")))
        qwen-projects-dir (or qwen-projects-dir (str (fs/path qwen-home "projects")))
        ollama-log (or ollama-log (local-seat-report-lib/default-ollama-log project-root))
        settings-file (or settings-file (str (fs/path project-root ".swarmforge" "local-agent" "seat-settings" (str seat ".jsonl"))))
        worktree-path (local-seat-report-lib/seat-worktree-path project-root seat)
        chats-dir (fs/path qwen-projects-dir (local-seat-report-lib/qwen-cwd-key worktree-path) "chats")
        settings-rows (read-settings-rows settings-file)
        ollama-loads (local-seat-report-lib/parse-ollama-loads (read-file-if-exists ollama-log))
        per-session (for [f (session-files chats-dir)
                          :let [session-id (session-id-of f)
                                events (local-seat-report-lib/parse-session-events (read-file-if-exists f))]]
                      (assoc events :session-id session-id))
        tag-session (fn [session-id rows] (map #(assoc % :session-id session-id) rows))
        requests (mapcat (fn [e] (tag-session (:session-id e) (:api-responses e))) per-session)
        compressions (mapcat (fn [e] (tag-session (:session-id e) (:compressions e))) per-session)
        tool-calls (mapcat (fn [e] (tag-session (:session-id e) (:tool-calls e))) per-session)
        after-since (fn [rows] (if (str/blank? (str since)) rows (filter #(>= (compare (:timestamp %) since) 0) rows)))]
    {:requests (vec (after-since requests))
     :compressions (vec (after-since compressions))
     :tool-calls (vec (after-since tool-calls))
     :settings-rows settings-rows
     :ollama-loads ollama-loads}))

(defn- fmt-pct [v] (when v (str (local-seat-tuning-report-lib/fmt-number v) "%")))
(defn- fmt-s [v] (when v (str (local-seat-tuning-report-lib/fmt-number v) " s")))
(defn- fmt-tps [v] (when v (str (local-seat-tuning-report-lib/fmt-number v) " tokens/s")))
(defn- fmt-tokens [v] (when v (str (local-seat-tuning-report-lib/fmt-number v) " tokens")))
(defn- or-unknown [v] (if (nil? v) "unknown" (local-seat-tuning-report-lib/fmt-number v)))

(defn render-group [idx {:keys [settings-fingerprint served sessions requests
                                median-ttft-s median-prefill-tps median-decode-tps
                                median-output-tokens median-thinking-share
                                compressions compressions-per-10-requests median-tokens-saved
                                tool-calls tool-call-failures tool-call-failure-rate most-failing-tool]}]
  (str/join
   "\n"
   (remove
    nil?
    [(str "Group " idx ": " settings-fingerprint " / " served)
     (str "  Sessions: " sessions "  Requests: " requests)
     (str "  Median time to first token: " (or-unknown (fmt-s median-ttft-s))
          "  Prefill: " (or-unknown (fmt-tps median-prefill-tps))
          "  Decode: " (or-unknown (fmt-tps median-decode-tps)))
     (str "  Median output: " (or-unknown (fmt-tokens median-output-tokens))
          "  Thinking: " (or-unknown (fmt-pct (when median-thinking-share (Math/round (* 100.0 median-thinking-share))))) " of output")
     (str "  Compressions: " compressions
          (when compressions-per-10-requests
            (str " (" (local-seat-tuning-report-lib/fmt-number compressions-per-10-requests)
                 " per 10 requests, saving " (or-unknown median-tokens-saved) " tokens each)")))
     (str "  Tool calls: " tool-calls " (" tool-call-failures " failed"
          (when tool-call-failure-rate (str ", " (local-seat-tuning-report-lib/fmt-number tool-call-failure-rate) "% failure rate"))
          (when most-failing-tool (str ", " most-failing-tool " failing most"))
          ")")])))

(defn render [{:keys [groups diffs]}]
  (str/join
   "\n\n"
   (concat
    (map-indexed (fn [i g] (render-group (inc i) g)) groups)
    (when (seq diffs)
      [(str/join "\n" (map #(str "Difference: " %) diffs))]))))

(defn build-report
  "gather's data, grouped and summarised - the CLI's own pure assembly
   step, kept separate so a fixture can call it on data it built by hand
   without going through gather's own file IO."
  [{:keys [requests compressions tool-calls settings-rows ollama-loads] :as gathered}]
  (let [groups (local-seat-tuning-report-lib/partition-into-groups gathered)
        summaries (mapv local-seat-tuning-report-lib/summarise-group groups)
        diffs (vec (mapcat (fn [[prev nxt]]
                             (local-seat-tuning-report-lib/group-transition-diffs
                              prev nxt
                              (local-seat-tuning-report-lib/settings-at-or-before
                               settings-rows (:timestamp (last (:events prev))))
                              (local-seat-tuning-report-lib/settings-at-or-before
                               settings-rows (:timestamp (last (:events nxt))))))
                           (partition 2 1 groups)))]
    {:groups summaries :diffs diffs}))

(defn -main [args]
  (let [project-root (first args)
        rest-args (rest args)
        seat (opt-value rest-args "--seat")]
    (when (or (str/blank? project-root) (str/blank? seat))
      (binding [*out* *err*]
        (println "Usage: local_seat_tuning_report_cli.bb <project-root> --seat <seat> [--since <iso>] [--qwen-home <dir>] [--qwen-projects-dir <dir>] [--ollama-log <path>] [--settings-file <path>]"))
      (System/exit 2))
    (let [gathered (gather {:project-root project-root
                            :seat seat
                            :since (opt-value rest-args "--since")
                            :qwen-home (opt-value rest-args "--qwen-home")
                            :qwen-projects-dir (opt-value rest-args "--qwen-projects-dir")
                            :ollama-log (opt-value rest-args "--ollama-log")
                            :settings-file (opt-value rest-args "--settings-file")})]
      (if (empty? (:requests gathered))
        (println "No requests found for this seat.")
        (println (render (build-report gathered)))))))

(-main (cli-args))
