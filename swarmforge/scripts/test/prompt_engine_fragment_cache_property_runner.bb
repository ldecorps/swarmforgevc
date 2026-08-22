#!/usr/bin/env bb
;; BL-574 coder pass (BL-654 Invariants): PROPERTY test over
;; prompt_engine_lib.bb's Slice 2 content-hash fragment cache, encoding the
;; ticket's declared invariant:
;;
;;   "Composed prompt output is byte-identical with the fragment cache cold,
;;    warm, or invalidated — caching may change latency, never content."
;;
;; For a generated (role, overlay-prompt, two-pack?, agent) request, compose
;; is called three times against the SAME fragment-cache atom:
;;   1. cold  — fresh cache, every fragment read from disk
;;   2. warm  — same cache, unchanged request: role/pack-overlay fragments
;;              served from cache with zero content-fn reads
;;   3. invalidated — role AND pack-overlay fragments explicitly evicted,
;;              then recomposed: forces a fresh disk read of both
;; The property: all three composed :system-prompt values are byte-identical
;; — the cache changes how many times a fragment is read, never what the
;; composed text says.
;;
;; Deliberately in-process (no subprocess forking per run) - matches every
;; existing *_property_runner.bb in this directory (see
;; bl812_project_root_override_property_runner.bb's header for the
;; babashka-startup-cost rationale).
;;
;; Non-vacuity proven by hand at authoring time: temporarily made
;; read-fragment's cache-hit branch return a hardcoded "[[cache]]" sentinel
;; instead of the cached content — every generated run failed (warm output
;; differed from cold) — then restored before commit. See
;; backlog/evidence/BL-574-coder-pass.md for the transcript.
(ns prompt-engine-fragment-cache-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "prompt_engine_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= i 1) s']))
(defn- gen-nth [s coll] (let [[i s'] (gen-int s (count coll))] [(nth coll i) s']))

;; Real role prompt files and real pack-overlay prompt files this repo
;; ships - a generated request is realistic (no invented role/path names),
;; per this project's own guidance not to torture unrelated file-resolution
;; edge cases (bl812's precedent) when the invariant under test is about
;; caching, not path validity.
(def roles ["coder" "cleaner" "architect" "hardender" "documenter" "QA" "specifier" "coordinator"])
(def overlay-prompts ["" "swarmforge/packs/mono-router.prompt" "swarmforge/packs/two-pack.prompt"])
(def agents ["claude" "aider" "mock"])

(defn gen-request [s]
  (let [[role s1] (gen-nth s roles)
        [overlay-prompt s2] (gen-nth s1 overlay-prompts)
        [two-pack? s3] (gen-bool s2)
        [agent s4] (gen-nth s3 agents)]
    [{:role role :overlay-prompt overlay-prompt :two-pack? two-pack? :agent agent} s4]))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; ── P: composed output is byte-identical across cold/warm/invalidated ────
(loop [i 0 s 17]
  (when (< i runs)
    (let [[{:keys [role overlay-prompt two-pack? agent]} s'] (gen-request s)
          ctx {:agent agent :two-pack? two-pack? :overlay-prompt overlay-prompt}
          cache (atom (prompt-engine-lib/empty-fragment-cache))
          cold (:system-prompt (prompt-engine-lib/compose role (assoc ctx :fragment-cache cache)))
          warm (:system-prompt (prompt-engine-lib/compose role (assoc ctx :fragment-cache cache)))
          _ (swap! cache prompt-engine-lib/invalidate-fragment "role")
          _ (swap! cache prompt-engine-lib/invalidate-fragment "pack-overlay")
          invalidated (:system-prompt (prompt-engine-lib/compose role (assoc ctx :fragment-cache cache)))]
      (when (not= cold warm)
        (report! "P (invariant): cache-warm output equals cache-cold output" s
                  {:role role :overlay-prompt overlay-prompt :two-pack? two-pack? :agent agent}
                  "warm compose produced different text than the initial cold compose"))
      (when (not= warm invalidated)
        (report! "P (invariant): post-invalidation output equals prior output" s
                  {:role role :overlay-prompt overlay-prompt :two-pack? two-pack? :agent agent}
                  "recompose after invalidating role/pack-overlay produced different text"))
      (recur (inc i) s'))))

;; ── generator coverage, asserted rather than assumed ──────────────────────
(let [distinct-count (loop [i 0 s 17 seen #{}]
                        (if (= i runs)
                          (count seen)
                          (let [[req s'] (gen-request s)]
                            (recur (inc i) s' (conj seen req)))))]
  (println (str "  generator coverage: distinct requests=" distinct-count "/" runs))
  (when (< distinct-count (min runs (* 2 (count roles))))
    (report! "COVERAGE distinct generated requests" 17 distinct-count "generator barely varying its output")))

(println (str "prompt_engine_lib fragment-cache cold/warm/invalidated byte-identity property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
