#!/usr/bin/env bb
;; TDD runner for llm_cost_ledger_lib.bb (BL-551) - real fs against a temp
;; fixture dir (this lib's whole job is writing the ledger file; no adapter
;; seam to fake around), no network, no real timers.
(ns llm-cost-ledger-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "llm_cost_ledger_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "llm-cost-ledger-lib-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn read-jsonl [path]
  (map #(json/parse-string % true) (str/split-lines (slurp path))))

;; ── telemetry-dir / month-key / ledger-file-for-month (pure path helpers) ──
(assert= "telemetry-dir sits under .swarmforge/telemetry"
         (str (fs/path "/root/.swarmforge" "telemetry"))
         (str (llm-cost-ledger-lib/telemetry-dir "/root/.swarmforge")))

(assert= "month-key takes the YYYY-MM prefix off an ISO instant"
         "2026-07"
         (llm-cost-ledger-lib/month-key "2026-07-22T12:00:00Z"))

(assert= "ledger-file-for-month names the file llm-cost-<month>.jsonl under telemetry-dir"
         (str (fs/path "/root/.swarmforge" "telemetry" "llm-cost-2026-07.jsonl"))
         (str (llm-cost-ledger-lib/ledger-file-for-month "/root/.swarmforge" "2026-07")))

;; ── append-llm-invocation-record! ──────────────────────────────────────────
(let [root (mk-tmp)
      record {:type "llm_invocation" :at "2026-07-22T12:00:00Z" :model "claude-sonnet-5"
              :tokens nil :costUsd 0.05 :origin {:subsystem "pipeline"}}]
  (llm-cost-ledger-lib/append-llm-invocation-record! root record)
  (let [file (str (llm-cost-ledger-lib/ledger-file-for-month root "2026-07"))]
    (assert= "append-llm-invocation-record! creates the telemetry dir and monthly file on first write"
             true (fs/exists? file))
    (assert= "append-llm-invocation-record! writes the record as one JSON line, round-trippable"
             [record] (read-jsonl file))))

(let [root (mk-tmp)
      r1 {:type "llm_invocation" :at "2026-07-22T12:00:00Z" :model "a" :tokens nil :costUsd nil :origin {}}
      r2 {:type "llm_invocation" :at "2026-07-22T13:00:00Z" :model "b" :tokens nil :costUsd nil :origin {}}]
  (llm-cost-ledger-lib/append-llm-invocation-record! root r1)
  (llm-cost-ledger-lib/append-llm-invocation-record! root r2)
  (let [file (str (llm-cost-ledger-lib/ledger-file-for-month root "2026-07"))]
    (assert= "append-llm-invocation-record! appends, never truncates, across calls"
             [r1 r2] (read-jsonl file))))

(let [root (mk-tmp)
      july {:type "llm_invocation" :at "2026-07-31T23:59:00Z" :model "a" :tokens nil :costUsd nil :origin {}}
      august {:type "llm_invocation" :at "2026-08-01T00:00:00Z" :model "b" :tokens nil :costUsd nil :origin {}}]
  (llm-cost-ledger-lib/append-llm-invocation-record! root july)
  (llm-cost-ledger-lib/append-llm-invocation-record! root august)
  (assert= "records land in the ledger file matching their OWN month, not the same file"
           [july] (read-jsonl (str (llm-cost-ledger-lib/ledger-file-for-month root "2026-07"))))
  (assert= "a record for the next month starts its own separate ledger file"
           [august] (read-jsonl (str (llm-cost-ledger-lib/ledger-file-for-month root "2026-08")))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: llm_cost_ledger_lib.bb"))
