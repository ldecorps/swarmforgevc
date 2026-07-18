#!/usr/bin/env bb
;; TDD runner for cache_warm_lib.bb (BL-519 launch cache-warm decision).
(ns cache-warm-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "cache_warm_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── warm-decision (pure) ────────────────────────────────────────────────────
(assert= "identical hashes reuse the cache" :reuse-cache
         (cache-warm-lib/warm-decision "abc123" "abc123"))

(assert= "differing hashes trigger a re-warm" :rewarm
         (cache-warm-lib/warm-decision "abc123" "def456"))

(assert= "no prior hash (first launch) triggers a re-warm" :rewarm
         (cache-warm-lib/warm-decision nil "abc123"))

;; ── stable-prefix-content-hash (pure, deterministic) ────────────────────────
(assert=
 "hashing the same inputs twice is deterministic"
 (cache-warm-lib/stable-prefix-content-hash :model-routing-text "model=x")
 (cache-warm-lib/stable-prefix-content-hash :model-routing-text "model=x"))

(assert-true
 "a changed model-routing-text changes the hash (BL-519 model-routing-changed-05)"
 (not= (cache-warm-lib/stable-prefix-content-hash :model-routing-text "model=x")
       (cache-warm-lib/stable-prefix-content-hash :model-routing-text "model=y")))

(assert-true
 "omitting model-routing-text never throws (defaults to empty)"
 (string? (cache-warm-lib/stable-prefix-content-hash)))

;; ── decide-and-record-warm! (impure orchestration, redirectable state-dir) ──
(let [state-dir (str (fs/create-temp-dir))
      r1 (cache-warm-lib/decide-and-record-warm! state-dir "test-pack" :model-routing-text "model=x")
      r2 (cache-warm-lib/decide-and-record-warm! state-dir "test-pack" :model-routing-text "model=x")
      r3 (cache-warm-lib/decide-and-record-warm! state-dir "test-pack" :model-routing-text "model=z")]
  (assert= "BL-519 warm-hash-tracks-stable-prefix-05: first launch of a pack always re-warms (no prior hash)"
           :rewarm (:decision r1))
  (assert= "BL-519 warm-hash-tracks-stable-prefix-05: unchanged relaunch reuses the still-warm cache"
           :reuse-cache (:decision r2))
  (assert= "BL-519 warm-hash-tracks-stable-prefix-05: a model-routing change re-warms the new prefix"
           :rewarm (:decision r3))
  (assert-true "the recorded hash persists across calls (durable state, not in-memory only)"
               (= (:hash r1) (:hash r2)))
  (assert-true "a changed hash is actually a different value, not a decision-only signal"
               (not= (:hash r2) (:hash r3)))
  (fs/delete-tree state-dir))

;; ── stable-text override (BL-519 constitution-changed-05, no real disk edit) ─
(let [state-dir (str (fs/create-temp-dir))
      r1 (cache-warm-lib/decide-and-record-warm! state-dir "test-pack" :model-routing-text "model=x" :stable-text "STABLE_V1")
      r2 (cache-warm-lib/decide-and-record-warm! state-dir "test-pack" :model-routing-text "model=x" :stable-text "STABLE_V1")
      r3 (cache-warm-lib/decide-and-record-warm! state-dir "test-pack" :model-routing-text "model=x" :stable-text "STABLE_V2")]
  (assert= "unchanged stable-text (same override) reuses the cache" :reuse-cache (:decision r2))
  (assert= "BL-519 constitution-changed-05: a changed stable-text (simulating a constitution edit) re-warms the new prefix"
           :rewarm (:decision r3))
  (fs/delete-tree state-dir))

(let [state-dir (str (fs/create-temp-dir))]
  (cache-warm-lib/decide-and-record-warm! state-dir "pack-a" :model-routing-text "model=x")
  (let [pack-b-first (cache-warm-lib/decide-and-record-warm! state-dir "pack-b" :model-routing-text "model=x")]
    (assert= "packs are tracked independently - a different pack name has its own prior-hash state"
             :rewarm (:decision pack-b-first)))
  (fs/delete-tree state-dir))

;; ── report ────────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (do
    (println "ALL PASS: cache_warm_lib.bb")))
