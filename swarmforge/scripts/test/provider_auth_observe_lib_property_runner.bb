#!/usr/bin/env bb
;; BL-536 coder pass (BL-654 Invariants): PROPERTY tests over
;; provider_auth_observe_lib.bb's decide-auth-observation, encoding the
;; ticket's two declared invariants:
;;
;;   1. "For a persisting auth-class failure, respawn attempts per role are
;;      bounded by the configured attempt cap across ALL observe ticks -
;;      repeated 401s never produce an unbounded respawn/token-burn loop."
;;      P1 generates an arbitrary configured cap crossed with arbitrary
;;      episode lengths (0..cap+5, so under-cap, exactly-at-cap, and
;;      well-past-cap runs are all common — never a rare tail) and asserts
;;      the number of :respawn actions in ANY single unbroken run of
;;      auth-class observations never exceeds that cap.
;;   2. "Once a role's failure episode reaches the attempt cap, further
;;      observe ticks are quiet for that episode: no additional respawns and
;;      no duplicate operator alerts." P2 asserts exactly one :alert action
;;      per episode whose length exceeds the cap (never zero, never more
;;      than one), and that no :respawn action ever follows an :alert
;;      within the same episode.
;;
;; NOTE on toolchain (per swarmforge/constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)" - BL-472 tracks pinning real
;; mutation/property tooling for .bb scripts, deliberately deferred, not
;; wired today): the BL-654 role contract's "*.property.test.js /
;; vitest.properties.config.mjs" home is a TypeScript convention with no
;; Babashka equivalent. This follows the property-test precedent this repo
;; already established for .bb code instead (mono_router_lib_property_runner.bb,
;; swarm_ensure_daemon_repair_property_runner.bb) - a deterministic
;; seeded-generator sweep in the same swarmforge/scripts/test/ suite that is
;; the actual enforced gate for .bb scripts, per that engineering-article
;; note.
;;
;; Deterministic by construction: a seeded LCG, never rand (mirrors
;; mono_router_lib_property_runner.bb's own generator shape).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored before
;; this commit; a diff against the restored file showed no residual change):
;;   - P1 was run against a deliberately broken decide-episode-action where
;;     the `(< (:attempts state) max-attempts)` guard was widened to
;;     `(<= (:attempts state) max-attempts)` (one extra respawn allowed per
;;     episode) - failed on the first generated case whose episode length
;;     exceeded the cap, every such episode showing one respawn too many.
;;   - P2 was run against a deliberately broken decide-episode-action that
;;     dropped the `(not (:alerted state))` guard (re-alerting on every tick
;;     once at the cap) - failed immediately, alert counts > 1 on every
;;     episode whose length exceeded the cap by 2 or more.

(ns provider-auth-observe-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "provider_auth_observe_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def auth-text "AuthenticationError: Invalid API key provided\n")
(def healthy-text "some normal Claude Code turn output\n$ ")

;; ── generator: an arbitrary cap + a handful of episode run-lengths ────────

(defn gen-episodes [s]
  (let [[cap-n s1] (gen-int s 6)
        max-attempts (inc cap-n)                              ;; 1..6
        [extra-n s2] (gen-int s1 4)
        episodes-n (inc extra-n)                               ;; 1..4 episodes
        [lengths s3] (reduce (fn [[acc sx] _]
                                ;; 0..(cap+5): both sides of the cap are common
                                (let [[len sy] (gen-int sx (+ max-attempts 6))]
                                  [(conj acc len) sy]))
                              [[] s2] (range episodes-n))]
    [{:max-attempts max-attempts :lengths lengths} s3]))

;; ── run a sequence of episodes through decide-auth-observation, threading
;;    state across ticks; each episode is separated by one healthy tick
;;    (forcing a reset boundary) that is NOT itself part of the episode's
;;    own recorded action trace ────────────────────────────────────────────

(defn run-episodes [max-attempts lengths]
  (loop [state nil eps lengths acc []]
    (if (empty? eps)
      acc
      (let [len (first eps)
            [actions state'] (loop [k 0 st state as []]
                                (if (= k len)
                                  [as st]
                                  (let [decision (provider-auth-observe-lib/decide-auth-observation
                                                   st auth-text {:max-attempts max-attempts})]
                                    (recur (inc k) (:state decision) (conj as (:action decision))))))
            reset-decision (provider-auth-observe-lib/decide-auth-observation
                             state' healthy-text {:max-attempts max-attempts})]
        (recur (:state reset-decision) (rest eps) (conj acc {:length len :actions actions}))))))

;; ── P1 (invariant 1): respawns per episode never exceed the configured cap ─

(check-all "P1 respawn attempts per episode bounded by the configured cap, across all episodes in the sequence"
  gen-episodes
  (fn [{:keys [max-attempts lengths]}]
    (let [episodes (run-episodes max-attempts lengths)]
      (or (every? (fn [{:keys [length actions]}]
                    (= (count (filter #(= :respawn %) actions))
                       (min length max-attempts)))
                  episodes)
          (str "max-attempts=" max-attempts " episodes=" (pr-str episodes))))))

;; ── P2 (invariant 2): exactly one alert once the cap is exceeded, never a
;;    respawn after that alert within the same episode ─────────────────────

(check-all "P2 exactly one alert per episode past the cap; no respawn after the alert; no alert when under the cap"
  gen-episodes
  (fn [{:keys [max-attempts lengths]}]
    (let [episodes (run-episodes max-attempts lengths)]
      (or (every? (fn [{:keys [length actions]}]
                    (let [expected-alerts (if (> length max-attempts) 1 0)
                          alert-count (count (filter #(= :alert %) actions))
                          alert-idx (first (keep-indexed (fn [i a] (when (= :alert a) i)) actions))
                          respawn-after-alert? (and alert-idx
                                                     (boolean (some #(= :respawn %) (drop (inc alert-idx) actions))))]
                      (and (= alert-count expected-alerts) (not respawn-after-alert?))))
                  episodes)
          (str "max-attempts=" max-attempts " episodes=" (pr-str episodes))))))

;; ── generator coverage, asserted rather than assumed - both under-cap AND
;;    at-or-past-cap episode lengths must actually be generated, not merely
;;    theoretically possible (the "asserted reachability floor" requirement) ─

(let [buckets (loop [i 0 s 7 acc {:under-cap 0 :at-or-past-cap 0}]
                (if (= i runs)
                  acc
                  (let [[{:keys [max-attempts lengths]} s'] (gen-episodes s)]
                    (recur (inc i) s'
                           (reduce (fn [a len]
                                     (update a (if (> len max-attempts) :at-or-past-cap :under-cap) inc))
                                   acc lengths)))))
      floor (quot runs 10)]
  (println (str "  generator coverage (episode lengths vs. cap): " (pr-str buckets)))
  (doseq [b [:under-cap :at-or-past-cap]]
    (when (< (get buckets b 0) floor)
      (report! (str "COVERAGE " b) 7 buckets (str b " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "provider_auth_observe_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
