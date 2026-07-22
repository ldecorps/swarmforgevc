;; BL-551: thin, shared write side of the unified LLM cost ledger
;; (`.swarmforge/telemetry/llm-cost-YYYY-MM.jsonl`). Loaded by BOTH
;; handoffd.bb (writer-handoff-02: stamps a correlation record at delivery
;; time) and operator_runtime.bb (writer-reap-03: folds the front-desk
;; reap's exact cost into the same ledger) so the path/filename convention
;; lives in exactly one place rather than being re-derived twice. The
;; record SHAPE itself (origin attribution, honest-null fields) is built by
;; the pure operator-lib/*-llm-invocation-record functions - this lib only
;; ever appends an already-built record, the same "pure builder, thin IO
;; caller" split as operator_lib.bb's front-desk-cost-record +
;; operator_runtime.bb's append-bridge-cost-record!.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "llm_cost_ledger_lib.bb")))
;; and referred to as llm-cost-ledger-lib/foo.

(ns llm-cost-ledger-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(defn telemetry-dir
  "Mirrors extension/src/metrics/llmCostLedgerStore.ts's
   llmCostTelemetryDir - the SAME `.swarmforge/telemetry` directory, read
   back by that module's readLlmInvocationRecords."
  [state-dir]
  (fs/path state-dir "telemetry"))

(defn month-key
  "The YYYY-MM the ledger files are named after, taken from an ISO-8601
   instant string (e.g. \"2026-07-22T12:00:00Z\" -> \"2026-07\")."
  [iso-instant-str]
  (subs iso-instant-str 0 7))

(defn ledger-file-for-month
  [state-dir month]
  (fs/path (telemetry-dir state-dir) (str "llm-cost-" month ".jsonl")))

(defn append-llm-invocation-record!
  "Appends one already-built llm_invocation record (see
   operator-lib/llm-invocation-record) to the monthly ledger file matching
   the record's own `:at` timestamp. Callers wrap this in try/catch - a
   telemetry write failure must never block the real work (handoff delivery,
   a reap) it is only observing."
  [state-dir record]
  (let [file (ledger-file-for-month state-dir (month-key (:at record)))]
    (fs/create-dirs (fs/parent file))
    (spit (str file) (str (json/generate-string record) "\n") :append true)))

;; Allow `bb llm_cost_ledger_lib.bb` to be a no-op load (it is a library).
(when (= *file* (System/getProperty "babashka.file")) nil)
