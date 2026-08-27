#!/usr/bin/env bb
;; BL-840: unit coverage for provider_outage_evidence_lib.bb - both the
;; producer (record-provider-outage!, throttling) and the reader
;; (evidence-for-provider, provider attribution, fail-closed behavior).
;; Every test uses its own temp state-dir - never the real project's
;; .swarmforge/telemetry/.
(ns provider-outage-evidence-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "provider_outage_evidence_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
;; BL-872: shutdown hook mirrors handoff_lib_test_runner.bb (BL-459) - fires
;; on both a clean run and an uncaught exception, never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn tmp-state-dir []
  (let [d (str (fs/create-temp-dir))]
    (swap! created-temp-dirs conj d)
    d))

;; ── invariant 1: absent/empty/unreadable/corrupt evidence subtracts nothing,
;;    never throws ──────────────────────────────────────────────────────────
(let [state-dir (str (fs/path (tmp-state-dir) "does-not-exist"))]
  (assert= "missing telemetry dir -> no evidence, no throw"
           []
           (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic")))

(let [state-dir (tmp-state-dir)
      telem-dir (fs/path state-dir "telemetry")]
  (fs/create-dirs telem-dir)
  (assert= "empty telemetry dir -> no evidence"
           []
           (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic")))

(let [state-dir (tmp-state-dir)
      telem-dir (fs/path state-dir "telemetry")]
  (fs/create-dirs telem-dir)
  (spit (str (fs/path telem-dir "provider-outage-2026-08.jsonl")) "not json at all {{{\n")
  (assert= "corrupt line -> skipped, not thrown"
           []
           (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic")))

(let [state-dir (tmp-state-dir)
      telem-dir (fs/path state-dir "telemetry")]
  (fs/create-dirs telem-dir)
  (spit (str (fs/path telem-dir "provider-outage-2026-08.jsonl"))
        (str "{\"ts\":\"2026-08-07T09:10:00Z\",\"role\":\"coder\",\"provider\":\"anthropic\",\"text\":\"529\"}\n"
             "garbage line, not json\n"
             "{\"ts\":\"not-a-timestamp\",\"role\":\"coder\",\"provider\":\"anthropic\",\"text\":\"529\"}\n"
             "{\"role\":\"coder\",\"provider\":\"anthropic\",\"text\":\"missing ts field\"}\n"))
  (assert= "one good line survives among three corrupt/malformed neighbors"
           1
           (count (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic"))))

;; ── invariant 2: throttled to at most one line per role per interval ───────
(let [state-dir (tmp-state-dir)]
  (assert= "first observation always writes"
           true
           (boolean (provider-outage-evidence-lib/record-provider-outage!
                     state-dir "coder" "anthropic" "529 overloaded" 1000000 60000)))
  (assert= "a second observation within the interval does not write"
           false
           (boolean (provider-outage-evidence-lib/record-provider-outage!
                     state-dir "coder" "anthropic" "529 overloaded" 1030000 60000)))
  (assert= "still exactly one line after the throttled attempt"
           1
           (count (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic")))
  (assert= "an observation past the interval writes again"
           true
           (boolean (provider-outage-evidence-lib/record-provider-outage!
                     state-dir "coder" "anthropic" "529 overloaded" 1061000 60000)))
  (assert= "two lines after the interval elapses"
           2
           (count (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic"))))

(let [state-dir (tmp-state-dir)]
  (provider-outage-evidence-lib/record-provider-outage! state-dir "coder" "anthropic" "x" 1000000 60000)
  (assert= "a DIFFERENT role gets its own throttle budget, independent of coder's"
           true
           (boolean (provider-outage-evidence-lib/record-provider-outage!
                     state-dir "cleaner" "anthropic" "x" 1000500 60000))))

;; ── invariant 3: attribution by provider, never by the observing role/pane ─
(let [state-dir (tmp-state-dir)]
  (provider-outage-evidence-lib/record-provider-outage! state-dir "coder" "anthropic" "x" 1000000 60000)
  (provider-outage-evidence-lib/record-provider-outage! state-dir "cleaner" "openrouter" "y" 1000000 60000)
  (assert= "evidence for provider anthropic includes coder's line"
           1
           (count (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic")))
  (assert= "evidence for provider openrouter includes cleaner's line, not coder's"
           1
           (count (provider-outage-evidence-lib/evidence-for-provider state-dir "openrouter")))
  (assert= "evidence for a provider no role observed is empty"
           []
           (provider-outage-evidence-lib/evidence-for-provider state-dir "some-other-provider")))

;; A second role on the SAME provider as an already-recorded role's outage -
;; its evidence must still surface under that shared provider (proves
;; attribution is provider-keyed on read, not role-keyed).
(let [state-dir (tmp-state-dir)]
  (provider-outage-evidence-lib/record-provider-outage! state-dir "coder" "anthropic" "x" 1000000 60000)
  (let [evidence (provider-outage-evidence-lib/evidence-for-provider state-dir "anthropic")]
    (assert= "evidence line shape carries :ts-ms :provider :text"
             #{:ts-ms :provider :text}
             (set (keys (first evidence))))
    (assert= "ts-ms is a real parsed epoch-millis number, not the raw ISO string"
             1000000
             (:ts-ms (first evidence)))))

;; ── config parsing ──────────────────────────────────────────────────────
(assert= "explicit positive config value parses"
         120000
         (provider-outage-evidence-lib/parse-observe-min-interval-ms
          "config provider_outage_observe_min_interval_ms 120000\n"))

(assert= "absent config falls back to the default"
         provider-outage-evidence-lib/default-observe-min-interval-ms
         (provider-outage-evidence-lib/parse-observe-min-interval-ms ""))

(assert= "zero config falls back to the default"
         provider-outage-evidence-lib/default-observe-min-interval-ms
         (provider-outage-evidence-lib/parse-observe-min-interval-ms
          "config provider_outage_observe_min_interval_ms 0\n"))

(assert= "negative config falls back to the default"
         provider-outage-evidence-lib/default-observe-min-interval-ms
         (provider-outage-evidence-lib/parse-observe-min-interval-ms
          "config provider_outage_observe_min_interval_ms -5\n"))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "provider_outage_evidence_lib_test_runner: ALL CHECKS PASSED"))
