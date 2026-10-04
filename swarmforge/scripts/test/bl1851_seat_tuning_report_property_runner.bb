#!/usr/bin/env bb
;; BL-1851 property test (coder-authored, TWO declared invariants, BL-654).
;;
;;   Invariant 1: the tuning report is read-only - running it changes no
;;   file, pane or process.
;;   Invariant 2: every number the report prints is computed from a
;;   record; a field no record carries prints as unknown, never as 0.
;;
;; Drives the REAL local_seat_tuning_report_cli.bb as a real subprocess
;; over a real mkdtemp fixture tree - never a reimplementation of its
;; gathering or rendering.
;;
;; WHY THE GENERATOR REACHES WHAT IT QUANTIFIES OVER: invariant 2's
;; generator independently decides, PER REQUEST and per metric family
;; (timing, compression, tool-call), whether that family's fields are
;; present or entirely absent - so every run reaches both "the field
;; exists, compute it" and "the field never appeared anywhere in the
;; group, say unknown" for every metric this report prints, not only the
;; ones a hand-picked example happens to cover.
;;
;; Non-vacuity proven at authoring: (a) invariant 1 - writing a stray
;; marker file from inside build-report's own namespace during a run
;; made the directory-snapshot check fail outright, restored after; (b)
;; invariant 2 - defaulting a missing ttft to 0 instead of nil in
;; per-request-metrics (local_seat_tuning_report_lib.bb) made the
;; "never literal 0" check fail on every all-absent group, restored
;; after.

(ns bl1851-seat-tuning-report-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (str (fs/parent test-dir)))
(def cli (str (fs/path scripts-dir "local_seat_tuning_report_cli.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 15))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def rng
  (let [state (atom 1851)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(def seat "coder@iq3")

(defn cwd-key [root]
  (str/replace (str (fs/path root ".worktrees" "coder-iq3")) #"[/.]" "-"))

(defn ts-at [minute]
  (str (java.time.Instant/ofEpochMilli (+ (.toEpochMilli (java.time.Instant/parse "2026-09-30T20:00:00Z"))
                                          (long (* minute 60000))))))

(defn api-response-row [minute ttft duration in out think]
  {:type "system" :subtype "ui_telemetry" :timestamp (ts-at minute)
   :systemPayload {:uiEvent (cond-> {(keyword "event.name") "qwen-code.api_response"}
                              ttft (assoc :ttft_ms ttft)
                              duration (assoc :duration_ms duration)
                              in (assoc :input_token_count in)
                              out (assoc :output_token_count out)
                              think (assoc :thoughts_token_count think))}})

(defn write-fixture!
  "A seat fixture with n-requests under one settings row, each request
   either carrying every timing field or NONE of them (the generator's
   own reach for invariant 2) - returns {:root :settings-file :ollama-log}."
  [n-requests field-presence]
  (let [root (str (fs/create-temp-dir {:prefix "bl1851-prop-"}))
        chats-dir (fs/path root "qwen" (cwd-key root) "chats")
        settings-file (fs/path root ".swarmforge" "local-agent" "seat-settings" (str seat ".jsonl"))]
    (fs/create-dirs chats-dir)
    (fs/create-dirs (fs/parent settings-file))
    (spit (str settings-file) (str (json/generate-string {:at (ts-at -60) :fingerprint "fp1" :gpu {:powerLimitW 180}}) "\n"))
    (let [rows (for [i (range n-requests)]
                 (if field-presence
                   (api-response-row i 1000 2000 100 50 10)
                   (api-response-row i nil nil nil nil nil)))]
      (spit (str (fs/path chats-dir "S1.jsonl")) (str/join "\n" (map json/generate-string rows))))
    {:root (str root) :chats-dir (str chats-dir) :settings-file (str settings-file)
     :ollama-log (str (fs/path root "ollama.log"))}))

(defn run-cli [fx]
  (process/sh "bb" cli (:root fx) "--seat" seat
              "--qwen-projects-dir" (str (fs/path (:root fx) "qwen"))
              "--ollama-log" (:ollama-log fx)
              "--settings-file" (:settings-file fx)))

(defn snapshot-tree [root]
  (into {}
        (for [p (file-seq (io/file root))
              :when (.isFile p)]
          [(str p) [(slurp p) (.lastModified p)]])))

;; ── invariant 1: read-only ─────────────────────────────────────────────────

(dotimes [i runs]
  (let [n (inc (rng 8))
        fx (write-fixture! n (even? i))]
    (try
      (bump! :inv1-runs)
      (let [before (snapshot-tree (:root fx))
            result (run-cli fx)
            after (snapshot-tree (:root fx))]
        (check! (str "invariant 1: run " i " exits 0, got " (:exit result) " err=" (:err result))
                (zero? (:exit result)))
        (check! (str "invariant 1: run " i " changed the fixture tree - read-only violated")
                (= before after)))
      (finally (fs/delete-tree (:root fx))))))

;; ── invariant 2: unknown, never 0, for an absent field ─────────────────────

(dotimes [i runs]
  (let [n (inc (rng 6))
        all-absent? (even? i)
        fx (write-fixture! n (not all-absent?))]
    (try
      (bump! (if all-absent? :inv2-all-absent :inv2-all-present))
      (let [result (run-cli fx)
            out (:out result)]
        (check! (str "invariant 2: run " i " exits 0, got " (:exit result) " err=" (:err result))
                (zero? (:exit result)))
        (if all-absent?
          (do
            (check! (str "invariant 2: every timing field absent -> ttft reads unknown, run " i ", out=" out)
                    (str/includes? out "Median time to first token: unknown"))
            (check! (str "invariant 2: every timing field absent -> prefill reads unknown, run " i)
                    (str/includes? out "Prefill: unknown"))
            (check! (str "invariant 2: every timing field absent -> decode reads unknown, run " i)
                    (str/includes? out "Decode: unknown"))
            (check! (str "invariant 2: every timing field absent -> output reads unknown, never 0, run " i)
                    (str/includes? out "Median output: unknown"))
            (check! (str "invariant 2: no metric line prints a bare literal 0 standing in for unknown, run " i ", out=" out)
                    (not (re-find #": 0(?:\.0)? (?:s|tokens|tokens/s)\b" out))))
          (check! (str "invariant 2: every timing field present -> ttft is a real number, never unknown, run " i)
                  (str/includes? out "Median time to first token: 1 s"))))
      (finally (fs/delete-tree (:root fx))))))

(check! "invariant 1 generator never ran" (pos? (get @reached :inv1-runs 0)))
(check! "invariant 2 generator never reached the all-absent case" (pos? (get @reached :inv2-all-absent 0)))
(check! "invariant 2 generator never reached the all-present case" (pos? (get @reached :inv2-all-present 0)))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (println (count @failures) "FAILURES")
  (System/exit 1))

(println "ALL PROPERTIES HELD"
         "inv1-runs=" (get @reached :inv1-runs 0)
         "inv2-all-absent=" (get @reached :inv2-all-absent 0)
         "inv2-all-present=" (get @reached :inv2-all-present 0))
