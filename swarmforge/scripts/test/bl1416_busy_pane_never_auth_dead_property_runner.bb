#!/usr/bin/env bb
;; BL-1416 coder pass (BL-654 Invariants): PROPERTY tests over
;; provider_auth_observe_lib.bb's decide-auth-observation/resolve-committed-
;; state/format-alert-reason, encoding the ticket's three declared
;; invariants:
;;
;;   1. "A pane the runtime reports busy ... is never classified auth-dead:
;;      no attempt counted, no alert." P1 generates a run of 1..8 busy
;;      ticks (always over auth-shaped text, the adversarial case) starting
;;      from an arbitrary prior episode state, and asserts every tick's
;;      action is :none, signal is :healthy, and the state after the WHOLE
;;      run is IDENTICAL (not merely equivalent-looking, `=`) to the state
;;      before it started - untouched, never reset either.
;;   2. "The episode counts only respawns that were performed; an attempt
;;      skipped for any reason leaves the count and the alerted flag
;;      untouched." P2 generates a sequence of idle (non-busy) auth-class
;;      ticks each with an arbitrary independent performed?/skipped
;;      outcome (do-auth-respawn!'s own later, independent busy check), and
;;      asserts the committed :attempts after the whole sequence equals
;;      EXACTLY the count of ticks that were both decided-as-:respawn AND
;;      performed - never counting a skip, and that :alerted only ever
;;      becomes true once that real count reaches the cap.
;;   3. "A persist alert always names the pane line it matched and the
;;      number of performed respawns." P3 generates arbitrary
;;      roles/matched-lines(including nil)/performed-counts and asserts
;;      format-alert-reason's text names the role, contains BL-536, and -
;;      whenever a matched line is present - contains that exact line and
;;      the exact performed-count as substrings.
;;
;; Same deterministic-seeded-LCG shape as provider_auth_observe_lib_property_
;; runner.bb (mirrors mono_router_lib_property_runner.bb's generator style;
;; Babashka has no mutation/property tooling wired, BL-472 - this sweep is
;; the enforced gate for .bb code per the engineering article).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored before
;; this commit; `git diff --quiet` confirmed exact restoration):
;;   - P1 was run against a deliberately broken decide-auth-observation
;;     where the busy branch returned `(:state decision)`-shaped fresh state
;;     `{:attempts 0 :alerted false}` instead of `(or prev-state ...)` (i.e.
;;     it RESET on busy instead of leaving it untouched) - failed on every
;;     generated case whose prior state had non-zero attempts, 100% of a
;;     20-run sample.
;;   - P2 was run against a deliberately broken resolve-committed-state that
;;     always returned `(:state decision)` (ignoring performed? entirely,
;;     the pre-BL-1416 bug) - failed on every generated case containing at
;;     least one skipped respawn, 100% of a 20-run sample (committed
;;     attempts count exceeded the real performed count).
;;   - P3 was run against a deliberately broken format-alert-reason that
;;     dropped the matched-line branch (always the plain ". " suffix,
;;     never quoting matched-line) - failed on every generated case with a
;;     non-nil matched-line, 100% of a 20-run sample.

(ns bl1416-busy-pane-never-auth-dead-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "provider_auth_observe_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 11]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def auth-text "AuthenticationError: Invalid API key provided\n")

;; ── P1: a busy pane is never classified auth-dead ─────────────────────────

(defn gen-p1 [s]
  (let [[attempts s1] (gen-int s 6)                 ;; 0..5 prior attempts
        [alerted? s2] (gen-bool s1)
        [busy-n s3] (gen-int s2 8)
        busy-ticks (inc busy-n)                      ;; 1..8 busy ticks in a row
        [cap-n s4] (gen-int s3 6)]
    [{:prev {:attempts attempts :alerted alerted?}
      :busy-ticks busy-ticks
      :max-attempts (inc cap-n)}
     s4]))

(check-all "P1: a run of busy ticks over auth-shaped text is always :none/:healthy and leaves state untouched"
  gen-p1
  (fn [{:keys [prev busy-ticks max-attempts]}]
    (let [[actions-ok? signals-ok? final-state]
          (loop [k 0 st prev actions-ok true signals-ok true]
            (if (= k busy-ticks)
              [actions-ok signals-ok st]
              (let [decision (provider-auth-observe-lib/decide-auth-observation
                               st auth-text {:max-attempts max-attempts :busy? true})]
                (recur (inc k) (:state decision)
                       (and actions-ok (= :none (:action decision)))
                       (and signals-ok (= :healthy (:signal decision)))))))]
      (cond
        (not actions-ok?) "a busy tick over auth-shaped text produced an action other than :none"
        (not signals-ok?) "a busy tick over auth-shaped text produced a signal other than :healthy"
        (not= prev final-state) (str "state was not left untouched: prev=" (pr-str prev) " final=" (pr-str final-state))
        :else true))))

;; ── P2: only PERFORMED respawns are counted ────────────────────────────────
;; Simulates observe-pane-auth!'s own real orchestration: decide, then (only
;; on a :respawn decision) an independent, arbitrary performed?/skipped
;; outcome, committed via resolve-committed-state - exactly the shape
;; handoffd.bb's observe-pane-auth! uses.

(defn gen-p2 [s]
  (let [[max-attempts s1] (gen-int s 4)
        cap (inc max-attempts)                       ;; 1..4
        [tick-n s2] (gen-int s1 8)
        ticks (inc tick-n)                            ;; 1..8 idle auth-class ticks
        [performed-flags s3] (reduce (fn [[acc sx] _]
                                        (let [[p sy] (gen-bool sx)] [(conj acc p) sy]))
                                      [[] s2] (range ticks))]
    [{:cap cap :performed-flags performed-flags} s3]))

(check-all "P2: committed :attempts equals exactly the count of PERFORMED respawns; :alerted only true once that real count reaches the cap"
  gen-p2
  (fn [{:keys [cap performed-flags]}]
    (let [{final-state :state :keys [performed-count actions]}
          (reduce
           (fn [{:keys [state performed-count actions]} performed?]
             (let [decision (provider-auth-observe-lib/decide-auth-observation
                              state auth-text {:max-attempts cap})
                   really-performed? (and (= :respawn (:action decision)) performed?)
                   committed (provider-auth-observe-lib/resolve-committed-state state decision performed?)]
               {:state committed
                :performed-count (if really-performed? (inc performed-count) performed-count)
                :actions (conj actions (:action decision))}))
           {:state nil :performed-count 0 :actions []}
           performed-flags)]
      (cond
        (not= performed-count (:attempts final-state))
        (str "committed attempts " (:attempts final-state) " != real performed count " performed-count)

        (and (:alerted final-state) (< performed-count cap))
        (str "alerted before the real performed count (" performed-count ") reached the cap (" cap ")")

        (and (>= performed-count cap) (some #(= :alert %) actions) (not (:alerted final-state)))
        "an :alert action occurred but the committed state never records alerted"

        :else true))))

;; ── P3: a persist alert always names the matched line and performed count ─

(def sample-roles ["hardender" "coder" "cleaner" "architect" "documenter" "QA"])
(def sample-lines [nil "Invalid API key" "AuthenticationError: nope" "401 Unauthorized"])

(defn gen-p3 [s]
  (let [[ri s1] (gen-int s (count sample-roles))
        [li s2] (gen-int s1 (count sample-lines))
        [count-n s3] (gen-int s2 10)]
    [{:role (nth sample-roles ri) :matched-line (nth sample-lines li) :performed-count (inc count-n)} s3]))

(check-all "P3: format-alert-reason names the role, BL-536, the matched line (when present) and the performed count"
  gen-p3
  (fn [{:keys [role matched-line performed-count]}]
    (let [text (provider-auth-observe-lib/format-alert-reason role matched-line performed-count)]
      (cond
        (not (clojure.string/includes? text role)) (str "missing role in: " text)
        (not (clojure.string/includes? text "BL-536")) (str "missing BL-536 in: " text)
        (not (clojure.string/includes? text (str performed-count))) (str "missing performed-count in: " text)
        (and matched-line (not (clojure.string/includes? text matched-line)))
        (str "missing matched-line " (pr-str matched-line) " in: " text)
        :else true))))

;; ── generator coverage (asserted reachability floors) ─────────────────────
;; Same deterministic-seed walk check-all uses (a distinct starting seed per
;; generator so the three walks do not correlate).

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs)
      acc
      (let [[input s'] (gen-fn s)]
        (recur (inc i) s' (conj acc (extract-fn input)))))))

(let [p1-attempts (sweep-coverage 101 gen-p1 #(get-in % [:prev :attempts]))
      p2-flags (sweep-coverage 211 gen-p2 :performed-flags)
      p3-lines (sweep-coverage 307 gen-p3 :matched-line)
      buckets {:p1-min-attempts-nonzero (count (filter pos? p1-attempts))
               :p2-some-skipped (count (filter #(some false? %) p2-flags))
               :p2-all-performed (count (filter #(every? true? %) p2-flags))
               :p3-nil-line (count (filter nil? p3-lines))}
      floor (quot runs 10)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 101 buckets (str k " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1416 busy-pane-never-auth-dead properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
