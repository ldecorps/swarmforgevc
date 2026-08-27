#!/usr/bin/env bb
;; BL-567 architect pass: PROPERTY tests over expedite_lib.bb.
;;
;; The example-based runner (expedite_lib_test_runner.bb) checks the cases I
;; thought of. This checks the cases I did not. That distinction earned its keep
;; on BL-590, where four rounds of code review missed one unstated invariant and
;; a property test found it unassisted on the first run.
;;
;; Deterministic by construction: a seeded LCG, never rand. A property test that
;; flakes is worse than none, and a counterexample nobody can reproduce is not a
;; counterexample. Every failure prints the seed and the offending input.
;;
;; GENERATOR WEIGHTING, per the recorded lesson that a uniform draw can pass
;; hundreds of runs against a live defect because it never reaches the
;; interesting state: defect classes are drawn from a DELIBERATELY SMALL
;; alphabet, so repeats are common and P7's probable-spec-defect branch is
;; actually exercised. With a wide alphabet a repeat is rare and P7 would be
;; vacuous while looking green.
;;
;; Non-vacuity is proven separately by breaking each invariant and recording the
;; result — see backlog/evidence/BL-567-property-non-vacuity-20260725.md.

(ns expedite-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator ──────────────────────────────────────────────────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── generators ────────────────────────────────────────────────────────────

(def supervisor-flag-keys [:handoffd :handoffd-supervisor :babysitterd :operator])

(defn gen-probe
  "WEIGHTED, and the weighting is load-bearing. A naive independent draw over 4
   booleans and 2 counts makes a fully-stopped probe ~0.5% likely: measured 2
   stopped out of 500 runs, which left P1's whole `stopped? = true` branch
   effectively unexercised while the suite reported green. That is the recorded
   'uniform draw passed 400 runs against a live defect' trap, reproduced here on
   this very suite.

   So: draw the SHAPE first. Roughly a third of probes are fully stopped, a third
   have exactly one thing alive (the case that catches a key forgotten in the
   liveness cond), and a third are arbitrary. socket-files is always noise, since
   it must never influence the verdict."
  [s]
  (let [[shape s0] (gen-int s 3)
        [socks s1] (gen-int s0 4)
        base {:tmux-servers-answering 0 :role-agents 0 :socket-files socks
              :handoffd false :handoffd-supervisor false :babysitterd false :operator false}]
    (case shape
      ;; fully stopped
      0 [base s1]
      ;; exactly one thing alive
      1 (let [[which s2] (gen-int s1 6)]
          [(case which
             0 (assoc base :tmux-servers-answering 1)
             1 (assoc base :role-agents 1)
             2 (assoc base :handoffd true)
             3 (assoc base :handoffd-supervisor true)
             4 (assoc base :babysitterd true)
             5 (assoc base :operator true))
           s2])
      ;; arbitrary
      2 (let [[servers s2] (gen-int s1 3)
              [agents s3] (gen-int s2 4)
              [flags s4] (reduce (fn [[m sx] k]
                                   (let [[b sy] (gen-bool sx)] [(assoc m k b) sy]))
                                 [{} s3] supervisor-flag-keys)]
          [(merge base flags {:tmux-servers-answering servers :role-agents agents}) s4]))))

;; Small alphabet so repeats happen - see the weighting note in the header.
(def defect-classes ["identity" "guard" "unit"])

(defn gen-bounces [s]
  (let [[n s1] (gen-int s 6)]
    (reduce (fn [[acc sx] _]
              (let [[k sy] (gen-pick sx defect-classes)]
                [(conj acc {:class k :reason (str "r-" k)}) sy]))
            [[] s1] (range n))))

(defn gen-bound [s] (let [[v s'] (gen-int s 6)] [(inc v) s']))

(defn gen-ticket-verdict [s] (gen-pick s [:done :failed]))
(defn gen-restart-outcome [s] (gen-pick s [:ok :failed :degraded :not-attempted nil]))

(defn gen-argv [s]
  (let [[nb s1] (gen-int s 4)
        [bound s2] (gen-int s1 20)
        [timeout s3] (gen-int s2 999)
        [flag-order s4] (gen-int s3 6)
        flags (cond-> []
                (>= nb 1) (conj "--override")
                (>= nb 2) (conj "--dry-run")
                (>= nb 3) (conj "--no-restart"))
        valued ["--bounce-bound" (str (inc bound)) "--stage-timeout-ms" (str (inc timeout))]
        chunks [["/repo" "BL-777"] flags valued]
        order (case (mod flag-order 3)
                0 [0 1 2] 1 [2 0 1] 2 [1 2 0])]
    [(vec (mapcat #(nth chunks %) order)) s4]))

;; ── P1: no probe can report "stopped" while anything is alive ─────────────
;; The interlock's safety property. Getting this wrong lets an offline run start
;; next to live agents - the contention the whole gate exists to prevent.

(check-all "P1 liveness soundness: stopped? implies nothing alive" gen-probe
  (fn [probe]
    (let [{:keys [stopped? alive]} (expedite-lib/liveness-verdict probe)]
      (if-not stopped?
        true
        (let [anything-alive? (or (pos? (:tmux-servers-answering probe))
                                  (pos? (:role-agents probe))
                                  (some #(get probe %) supervisor-flag-keys))]
          (cond
            anything-alive? (str "reported stopped while alive: " (pr-str probe))
            (seq alive) (str "reported stopped with a non-empty alive list: " (pr-str alive))
            :else true))))))

;; ── P2: anything alive is both detected AND named ─────────────────────────
;; Completeness. A key forgotten in the cond would pass P1 and fail here.

(check-all "P2 liveness completeness: every live thing is detected and named" gen-probe
  (fn [probe]
    (let [{:keys [stopped? alive]} (expedite-lib/liveness-verdict probe)
          expected (cond-> #{}
                     (pos? (:tmux-servers-answering probe)) (conj "tmux-server")
                     (pos? (:role-agents probe)) (conj "role-agents")
                     (:handoffd probe) (conj "handoffd")
                     (:handoffd-supervisor probe) (conj "handoffd-supervisor")
                     (:babysitterd probe) (conj "babysitterd")
                     (:operator probe) (conj "operator"))]
      (cond
        (not= (empty? expected) stopped?)
        (str "stopped? " stopped? " but expected-alive " (pr-str expected))
        (not= expected (set alive))
        (str "alive " (pr-str (set alive)) " != expected " (pr-str expected))
        :else true))))

;; ── P3: a socket FILE never influences liveness ───────────────────────────
;; The measured 2026-07-25 false positive, as a property rather than one example.

(check-all "P3 socket-files is inert: liveness ignores it entirely" gen-probe
  (fn [probe]
    (let [without (expedite-lib/liveness-verdict (dissoc probe :socket-files))
          with-many (expedite-lib/liveness-verdict (assoc probe :socket-files 99))]
      (if (= without with-many)
        true
        (str "socket-files changed the verdict: " (pr-str without) " vs " (pr-str with-many))))))

;; ── P4: the bound is never exceeded, for any bound ────────────────────────
;; Drives the decision from zero upward and counts. The operator set this bound
;; at 3 precisely so it cannot drift; a driver that retried bound+1 times would
;; silently restore the rejected behaviour.

(check-all "P4 bounce bound: exactly `bound` retries, then exhausted"
  (fn [s] (let [[b s'] (gen-bound s)] [b s']))
  (fn [bound]
    (loop [n 0 retries 0]
      (let [d (expedite-lib/bounce-decision {:stage "architect"
                                             :bounces (vec (repeat n {:class "identity"}))
                                             :bound bound})]
        (cond
          (> n (+ bound 2)) (str "never exhausted within bound+2 for bound " bound)
          (= :retry (:action d)) (recur (inc n) (inc retries))
          (not= retries bound) (str "exhausted after " retries " retries, expected " bound)
          (not= bound (:bound d)) (str "reported bound " (:bound d) " != " bound)
          :else true)))))

;; ── P5: no restart outcome can retract the ticket verdict ─────────────────
;; THE asymmetry the operator asked for, stated as a property over the whole
;; cross-product rather than the one example the scenarios pin.

(check-all "P5 restart never retracts the ticket"
  (fn [s] (let [[t s1] (gen-ticket-verdict s)
                [r s2] (gen-restart-outcome s1)]
            [[t r] s2]))
  (fn [[t r]]
    (let [res (expedite-lib/run-result {:ticket t :restart r})]
      (cond
        (not= t (:ticket res)) (str "ticket " t " became " (:ticket res))
        (not= (= :done t) (:ticket-ok? res)) (str "ticket-ok? disagrees with the verdict for " t)
        ;; A done ticket with a bad restart must still exit non-zero AND name the
        ;; restart as the failing half - loud, but not a retraction.
        (and (= :done t) (#{:failed :degraded} r)
             (not= :restart (:failed-half res)))
        (str "failed-half was " (:failed-half res) " for restart " r)
        (and (= :done t) (#{:failed :degraded} r) (zero? (:exit-code res)))
        (str "a bad restart (" r ") exited 0 - not loud")
        :else true))))

;; ── P6: parse-args recovers the positionals for any flag arrangement ──────
;; The property that would have caught the value-flags defect the cleaner pass
;; found: a value-taking flag's value must never be read as the project root.

(check-all "P6 parse-args: positionals survive any flag arrangement" gen-argv
  (fn [argv]
    (let [{:keys [project-root ticket bounce-bound]} (expedite-lib/parse-args argv)]
      (cond
        (not= "/repo" project-root) (str "project-root was " (pr-str project-root))
        (not= "BL-777" ticket) (str "ticket was " (pr-str ticket))
        (nil? bounce-bound) "bounce-bound was not read"
        :else true))))

;; ── P7: exhaustion never blames a stage, and only claims a spec defect on
;;        real evidence ────────────────────────────────────────────────────

(check-all "P7 exhaustion: no stage is ever blamed; spec-defect only on a real repeat"
  gen-bounces
  (fn [bounces]
    (let [r (expedite-lib/exhaustion-report {:stage "architect" :bounces bounces})
          repeated (expedite-lib/repeated-class bounces)]
      (cond
        (some? (:blame-stage r)) (str "blamed a stage: " (:blame-stage r))
        (and (some? repeated) (not= :probable-spec-defect (:verdict r)))
        (str "class " repeated " repeats but verdict was " (:verdict r))
        (and (nil? repeated) (= :probable-spec-defect (:verdict r)))
        "claimed a spec defect with no repeated class"
        (and (= :probable-spec-defect (:verdict r)) (not= "specifier" (:route-to r)))
        (str "spec defect routed to " (pr-str (:route-to r)))
        (and (not= :probable-spec-defect (:verdict r)) (some? (:route-to r)))
        (str "routed " (pr-str (:route-to r)) " on weaker evidence")
        (not= (count bounces) (:rounds r)) "rounds miscounted"
        :else true))))

;; ── P8: park never touches the run's own ticket, and always targets hold ──

(check-all "P8 park: destination is always hold and never includes the run ticket"
  (fn [s] (let [[n s1] (gen-int s 5)
                tickets (mapv #(str "BL-" (+ 500 %)) (range n))
                [idx s2] (gen-int s1 (max 1 (inc n)))]
            [[tickets (str "BL-" (+ 500 idx))] s2]))
  (fn [[tickets run-ticket]]
    (let [plan (expedite-lib/park-plan {:active-tickets tickets :run-ticket run-ticket})]
      (cond
        (not= "hold" (:destination plan)) (str "destination " (:destination plan))
        (some #{run-ticket} (:park plan)) "parked the run's own ticket"
        (not= (set (remove #{run-ticket} tickets)) (set (:park plan)))
        (str "park list " (pr-str (:park plan)) " != " (pr-str (remove #{run-ticket} tickets)))
        :else true))))

;; ── generator coverage, asserted rather than assumed ─────────────────────
;; A property that never reaches its interesting input is vacuous while looking
;; green. These make the generator's reach a checked fact, so a future tweak that
;; skews the distribution fails here instead of silently hollowing out P1/P7.

(let [[stopped live] (loop [i 0 s 42 st 0 lv 0]
                       (if (= i runs)
                         [st lv]
                         (let [[p s'] (gen-probe s)]
                           (if (:stopped? (expedite-lib/liveness-verdict p))
                             (recur (inc i) s' (inc st) lv)
                             (recur (inc i) s' st (inc lv))))))
      floor (quot runs 10)]
  (println (str "  generator coverage: stopped=" stopped " live=" live))
  (when (< stopped floor)
    (report! "COVERAGE stopped probes" 42 {:stopped stopped :floor floor}
             "P1's stopped? branch is barely exercised - the generator is skewed"))
  (when (< live floor)
    (report! "COVERAGE live probes" 42 {:live live :floor floor}
             "P2's live branch is barely exercised - the generator is skewed")))

(let [[rep norep] (loop [i 0 s 42 r 0 n 0]
                    (if (= i runs)
                      [r n]
                      (let [[b s'] (gen-bounces s)]
                        (if (expedite-lib/repeated-class b)
                          (recur (inc i) s' (inc r) n)
                          (recur (inc i) s' r (inc n))))))
      floor (quot runs 10)]
  (println (str "  generator coverage: bounce-repeat=" rep " no-repeat=" norep))
  (when (< rep floor)
    (report! "COVERAGE repeated classes" 42 {:repeat rep :floor floor}
             "P7's probable-spec-defect branch is barely exercised"))
  (when (< norep floor)
    (report! "COVERAGE distinct classes" 42 {:no-repeat norep :floor floor}
             "P7's diffuse-failure branch is barely exercised")))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "expedite_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
