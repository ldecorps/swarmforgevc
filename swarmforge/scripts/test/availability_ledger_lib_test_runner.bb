#!/usr/bin/env bb
;; TDD runner for availability_ledger_lib.bb (BL-823) - the Babashka reader
;; side of the swarm availability interval ledger.

(ns availability-ledger-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "availability_ledger_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-nil [msg actual] (assert= msg nil actual))

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg "\n  expected truthy, got: " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "avail-ledger-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-ledger! [root month lines]
  (let [dir (availability-ledger-lib/telemetry-dir root)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir (str "availability-" month ".jsonl")))
          (str (str/join "\n" lines) "\n"))))

(defn rec [event cls source ts]
  (str "{\"ts\":\"" ts "\",\"event\":\"" event "\",\"class\":\"" cls "\",\"source\":\"" source "\"}"))

;; ── acceptance scenario 02: graceful stop + start folds to one proven interval ─
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z")
                  (rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T02:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "02: exactly one interval" 1 (count intervals))
    (let [i (first intervals)]
      (assert= "02: class" "swarm-stop" (:class i))
      (assert= "02: duration 60 minutes" (* 60 60000) (- (:end-ms i) (:start-ms i)))
      (assert= "02: provenance proven" "proven" (:provenance i)))))

;; ── acceptance scenario 03: an ungraceful-stop synthetic close is "inferred" ──
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T00:00:00Z")
                  (rec "stop" "swarm-stop" "heartbeat-inferred" "2026-08-06T01:00:00Z")
                  (rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T02:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "03: exactly one closed interval" 1 (count intervals))
    (let [i (first intervals)]
      (assert= "03: duration 60 minutes" (* 60 60000) (- (:end-ms i) (:start-ms i)))
      (assert= "03: provenance inferred" "inferred" (:provenance i)))))

;; ── acceptance scenario 04: two starts with no intervening stop emit nothing ──
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T00:00:00Z")
                  (rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T02:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "04: no swarm-stop interval emitted for the gap" 0 (count intervals))))

;; ── acceptance scenario 06: a corrupt line is skipped without discarding neighbours ─
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z")
                  "not even json {{{"
                  (rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T02:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "06: exactly one interval survives the corrupt line" 1 (count intervals))
    (assert= "06: duration 60 minutes" (* 60 60000) (- (:end-ms (first intervals)) (:start-ms (first intervals))))
    (assert= "06: provenance proven" "proven" (:provenance (first intervals)))))

;; ── acceptance scenario 07: an unmatched pause-start is an open interval ─────
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "pause-start" "control-pause" "telegram-front-desk-bot:pause" "2026-08-06T01:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "07: exactly one open interval" 1 (count intervals))
    (let [i (first intervals)]
      (assert= "07: class control-pause" "control-pause" (:class i))
      (assert-nil "07: no end timestamp" (:end-ms i))
      (assert= "07: provenance open" "open" (:provenance i))
      (assert= "07: starts at the pause-start's own ts" (.toEpochMilli (java.time.Instant/parse "2026-08-06T01:00:00Z")) (:start-ms i)))))

;; ── acceptance scenario 08: an interval spans a month boundary across two files ─
(let [root (mk-root)]
  (write-ledger! root "2026-08" [(rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-31T23:00:00Z")])
  (write-ledger! root "2026-09" [(rec "start" "swarm-stop" "start-swarm.sh" "2026-09-01T01:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "08: exactly one interval spanning both files" 1 (count intervals))
    (assert= "08: duration 120 minutes" (* 120 60000) (- (:end-ms (first intervals)) (:start-ms (first intervals))))
    (assert= "08: provenance proven" "proven" (:provenance (first intervals)))))

;; ── control-pause and swarm-stop classes are folded independently ──────────
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "pause-start" "control-pause" "telegram-front-desk-bot:pause" "2026-08-06T00:00:00Z")
                  (rec "pause-end" "control-pause" "telegram-front-desk-bot:resume" "2026-08-06T00:10:00Z")
                  (rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z")
                  (rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T01:30:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "independence: two intervals, one per class" 2 (count intervals))
    (assert-true "independence: one control-pause interval present" (some #(= "control-pause" (:class %)) intervals))
    (assert-true "independence: one swarm-stop interval present" (some #(= "swarm-stop" (:class %)) intervals))))

;; ── duplicate lines are tolerated (BL-823 invariant 2) ──────────────────────
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z")
                  (rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z")
                  (rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T02:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "duplicate lines: still exactly one interval" 1 (count intervals))))

;; ── out-of-order lines are tolerated - sorted before folding ────────────────
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "start" "swarm-stop" "start-swarm.sh" "2026-08-06T02:00:00Z")
                  (rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "out-of-order: still exactly one interval" 1 (count intervals))
    (assert= "out-of-order: duration 60 minutes" (* 60 60000) (- (:end-ms (first intervals)) (:start-ms (first intervals))))))

;; ── invariant 3: no interval is ever closed with a guessed timestamp ───────
;; A trailing stop with no following start is emitted open, never closed at
;; e.g. "now" or any other invented value.
(let [root (mk-root)]
  (write-ledger! root "2026-08" [(rec "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z")])
  (let [intervals (availability-ledger-lib/fold root)]
    (assert= "invariant 3: exactly one open interval" 1 (count intervals))
    (assert-nil "invariant 3: no guessed end timestamp" (:end-ms (first intervals)))
    (assert= "invariant 3: provenance open, not proven or inferred" "open" (:provenance (first intervals)))))

;; ── empty ledger: no telemetry dir at all is a safe no-op ──────────────────
(let [root (mk-root)]
  (assert= "empty: no telemetry dir yields no intervals" [] (availability-ledger-lib/fold root)))

;; ── a pause-end with no open pause-start has nothing to close ──────────────
(let [root (mk-root)]
  (write-ledger! root "2026-08"
                 [(rec "pause-end" "control-pause" "telegram-front-desk-bot:resume" "2026-08-06T00:10:00Z")])
  (assert= "orphan pause-end: no interval" [] (availability-ledger-lib/fold root)))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: availability_ledger_lib.bb"))
