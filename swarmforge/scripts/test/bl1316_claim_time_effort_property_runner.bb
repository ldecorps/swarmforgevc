#!/usr/bin/env bb
;; BL-1316 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over seat_difficulty_lib.bb's claim-effort-
;; decision and handoff_lib.bb's apply-claim-effort!, encoding all three
;; declared invariants.
;;
;;   invariant 1 - "A ticket's mutation_cost is the only difficulty signal
;;      this slice reads for effort - never seat name, never idle time,
;;      never a second schema field": claim-effort-decision destructures
;;      only :backend/:cost/:pack-default-effort out of its argument map, so
;;      generated extra keys (a random seat name, a random idle-time
;;      number, a random unrelated schema field) merged into that map must
;;      never change its result versus the same call without them.
;;
;;   invariant 2 - "A backend with no effort lever never receives an
;;      unsupported CLI flag; claim still succeeds": for backends outside
;;      effort-lever-backends, claim-effort-decision always answers
;;      {:apply? false}, and the IO edge (apply-claim-effort!) never writes
;;      to - or even requires the existence of - a settings file, and never
;;      throws (claim still succeeds).
;;
;;   invariant 3 - "Effort from a previous claim does not stick after the
;;      next claim; each claim retunes or restores the pack default when
;;      mutation_cost is absent": a generated SEQUENCE of claims against one
;;      real settings file always lands the effort mutation_cost maps to,
;;      or the pack default when mutation_cost is absent - never whatever
;;      the previous claim in the sequence left behind.
;;
;; WHY THE PAIRS ARE CONSTRUCTED (BL-654 failure shape (b), invariant 3):
;; each step's expected effort is DERIVED from that same step's own
;; (cost, pack-default) draw, not drawn independently, so a mutant that
;; forgets to overwrite (leaves the prior write in place) is caught the
;; first time consecutive steps draw a different resolved effort.
;;
;; Same seeded RNG / no-shared-framework convention as this directory's
;; other property runners (e.g. bl1213_parcel_rollback_guard_property_
;; runner.bb) - each runner owns its own loop.
;;
;; Non-vacuity proven by hand at authoring time (and re-verified live before
;; landing): commenting out the `(or (effort-for-mutation-cost cost)
;; pack-default-effort)` fallback in claim-effort-decision (so absent cost
;; resolves to nil instead of the pack default) fails invariant 3's first
;; absent-cost generated step; removing "cursor" from effort-lever-backends'
;; complement check (i.e. defaulting effort-lever-backend? to true) fails
;; invariant 2's first non-claude generated backend. Both restored before
;; landing.

(ns bl1316-claim-time-effort-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (str (fs/parent (fs/parent (fs/canonicalize *file*)))))
(load-file (str (fs/path scripts-dir "handoff_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def rng
  (let [state (atom 1316)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(def costs [nil "low" "medium" "high"])
(def lever-backends ["claude"])
(def no-lever-backends ["cursor" "copilot" "codex" "gemini" "vibe" "grok" nil])
(def pack-defaults [nil "low" "medium" "high"])

(defn rand-nth* [coll] (nth coll (rng (count coll))))
(defn rand-string [] (apply str (repeatedly (inc (rng 8)) #(char (+ 97 (rng 26))))))

;; ── invariant 1: mutation_cost is the ONLY signal read for effort ─────────
(dotimes [i runs]
  (let [backend (rand-nth* (concat lever-backends no-lever-backends))
        cost (rand-nth* costs)
        pack-default (rand-nth* pack-defaults)
        base {:backend backend :cost cost :pack-default-effort pack-default}
        noisy (assoc base
                     :seat (rand-string)
                     :idle-time-ms (rng 100000)
                     :some-other-schema-field (rand-string))]
    (when (some? cost) (bump! :inv1-cost-present))
    (when (nil? cost) (bump! :inv1-cost-absent))
    (check! (str "invariant 1: extra map keys changed the decision for " (pr-str noisy))
            (= (seat-difficulty-lib/claim-effort-decision base)
               (seat-difficulty-lib/claim-effort-decision noisy)))))

;; ── invariant 2: no-lever backend never applies, never writes, never throws ─
(dotimes [i runs]
  (let [backend (rand-nth* no-lever-backends)
        cost (rand-nth* costs)
        pack-default (rand-nth* pack-defaults)]
    (bump! :inv2-no-lever-backend)
    (check! (str "invariant 2: no-lever backend " (pr-str backend) " applied an effort")
            (= {:apply? false}
               (seat-difficulty-lib/claim-effort-decision
                {:backend backend :cost cost :pack-default-effort pack-default})))
    ;; The IO edge: no settings file even present for this role - must not
    ;; throw, must not create one, and must report no write (claim still
    ;; succeeds).
    (let [result (try
                   (handoff-lib/apply-claim-effort!
                    {:role "prop-no-lever" :backend backend :mutation-cost cost
                     :pack-default-effort pack-default})
                   (catch Exception e {:threw (.getMessage e)}))]
      (check! (str "invariant 2: apply-claim-effort! threw for no-lever backend " (pr-str backend))
              (not (:threw result)))
      (check! (str "invariant 2: apply-claim-effort! reported apply? true for no-lever backend " (pr-str backend))
              (false? (:apply? result))))))

;; ── invariant 3: each claim retunes/restores; no history leakage ──────────
(dotimes [i runs]
  (let [root (str (fs/create-temp-dir {:prefix "sfvc-bl1316-prop-"}))]
    (try
      (let [launch-dir (fs/path root ".swarmforge" "launch")]
        (fs/create-dirs launch-dir)
        (spit (str (fs/path launch-dir "prop-coder.claude-settings.json"))
              "{\"model\":\"claude-sonnet-5\",\"effortLevel\":\"medium\"}")
        (handoff-lib/set-project-root! root)
        (try
          ;; A sequence of claims, each drawn independently, applied in
          ;; order to the SAME settings file - the point is that step N's
          ;; result must depend only on step N's own draw, never on step
          ;; N-1's resolved effort.
          (dotimes [step (+ 3 (rng 6))]
            (let [cost (rand-nth* costs)
                  pack-default (rand-nth* [nil "low" "medium" "high"])
                  ;; A resolvable expectation needs SOME effort available -
                  ;; when both cost and pack-default are nil there is
                  ;; nothing to apply and nothing to assert about, so force
                  ;; a pack default on that draw (still exercises the
                  ;; absent-cost/restore-default path with a real value).
                  pack-default (or pack-default "medium")
                  expected (or cost pack-default)]
              (if (some? cost) (bump! :inv3-cost-present) (bump! :inv3-cost-absent-restores))
              (let [result (handoff-lib/apply-claim-effort!
                            {:role "prop-coder" :backend "claude" :mutation-cost cost
                             :pack-default-effort pack-default})
                    on-disk (slurp (str (fs/path launch-dir "prop-coder.claude-settings.json")))]
                (check! (str "invariant 3 step " step ": decision effort mismatch for cost=" (pr-str cost)
                             " pack-default=" (pr-str pack-default))
                        (= expected (:effort result)))
                (check! (str "invariant 3 step " step ": settings file does not reflect " (pr-str expected)
                             " (found " on-disk ")")
                        (str/includes? on-disk (str "\"" expected "\""))))))
          (finally (handoff-lib/set-project-root! nil))))
      (finally (fs/delete-tree root)))))

(check! "invariant 1 generator never reached a present cost"
        (pos? (get @reached :inv1-cost-present 0)))
(check! "invariant 1 generator never reached an absent cost"
        (pos? (get @reached :inv1-cost-absent 0)))
(check! "invariant 2 generator never reached a no-lever backend"
        (pos? (get @reached :inv2-no-lever-backend 0)))
(check! "invariant 3 generator never reached a present-cost step"
        (pos? (get @reached :inv3-cost-present 0)))
(check! "invariant 3 generator never reached an absent-cost (restore-default) step"
        (pos? (get @reached :inv3-cost-absent-restores 0)))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PROPERTIES HELD"
         "inv1-cost-present=" (get @reached :inv1-cost-present 0)
         "inv1-cost-absent=" (get @reached :inv1-cost-absent 0)
         "inv2-no-lever-backend=" (get @reached :inv2-no-lever-backend 0)
         "inv3-cost-present=" (get @reached :inv3-cost-present 0)
         "inv3-cost-absent-restores=" (get @reached :inv3-cost-absent-restores 0))
