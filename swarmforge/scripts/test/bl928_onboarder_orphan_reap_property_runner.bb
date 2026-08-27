#!/usr/bin/env bb
;; BL-928 (BL-654 Invariants): PROPERTY tests over front_desk_supervisor_lib.bb's
;; decide-onboarder-orphan-reap, encoding the ticket's three declared
;; invariants:
;;
;;   1. "A process whose parent is alive is never reaped. The running
;;      supervisor's own child, and any other live supervisor's child,
;;      survive every sweep - the sweep's only licence is over processes
;;      whose parent is gone." P1 asserts every pid in :reapable has
;;      parent-orphaned? true - a live-parented pid can never appear there,
;;      regardless of how well its cmdline matches.
;;
;;   2. "Only a process whose command line names THIS swarm repo root is
;;      ever a candidate. A poll-loop for any other root, including a tmp
;;      fixture root, is never reaped no matter how orphaned it is." P2
;;      asserts every pid in :reapable has a cmdline naming project-root -
;;      an orphaned poll-loop for a DIFFERENT root, however orphaned, can
;;      never appear there.
;;
;;   P3 is the converse of P1+P2 (completeness, not just soundness): every
;;   process that DOES satisfy both the cmdline-holder check and
;;   parent-orphaned? is NOT silently dropped - it always appears in
;;   :reapable. Combined with P1/P2, :reapable is exactly the filtered set,
;;   neither over- nor under-inclusive.
;;
;;   3. "An unreadable process table reaps nothing and is never conflated
;;      with an empty candidate set. The two outcomes are distinguishable
;;      from the supervisor's own log." P4 asserts :unreadable? is true iff
;;      processes is nil, and :reapable is always [] whenever :unreadable?
;;      is true - the log-line half of this invariant (reap-unreadable vs
;;      silence) is a process/IO fact proven instead by
;;      test_onboarder_supervisor_tick.sh scenarios 07/07b (real log file,
;;      real supervisor process) - not something a pure function over
;;      arbitrary inputs can demonstrate on its own, same split as BL-870's
;;      own precedent comment for its wiring half.
;;
;; Non-vacuity proven by hand at authoring time: temporarily dropped the
;; parent-orphaned? filter from decide-onboarder-orphan-reap - P1 failed
;; immediately on the first generated case with a live-parented cmdline
;; match. Separately, temporarily dropped the onboarder-reconcile-poll-
;; loop-holder? filter - P2 failed immediately on the first case with an
;; orphaned, unrelated-root cmdline. Separately, temporarily removed the
;; parent-orphaned? filter's negation (kept holder? only) - P3 could no
;; longer distinguish itself from P1 failing, so instead confirmed P3 non-
;; vacuity by requiring BOTH filters truthy in its own predicate and
;; checking it fails when either is loosened. Restored the file after each,
;; reran clean - all properties held again.

(ns bl928-onboarder-orphan-reap-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "front_desk_supervisor_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(zero? n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 17]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── generator: an arbitrary process table + project-root ──────────────────

(def our-root "/repo/tmp-fixture-abc")
(def other-roots ["/repo/other-fixture-1" "/other-repo"])

(defn- gen-cmdline-kind [s]
  ;; 0 our-root poll-loop (a real candidate)
  ;; 1 other-root poll-loop (root mismatch)
  ;; 2 our-root, NOT poll-loop (subcommand mismatch)
  ;; 3 unrelated process entirely
  (gen-int s 4))

(defn- gen-cmdline [s]
  (let [[kind s1] (gen-cmdline-kind s)
        [other-n s2] (gen-int s1 (count other-roots))]
    (case kind
      0 [(str "node " our-root "/extension/out/tools/onboarder-reconcile.js " our-root " poll-loop") s2]
      1 [(str "node " (nth other-roots other-n) "/extension/out/tools/onboarder-reconcile.js "
              (nth other-roots other-n) " poll-loop") s2]
      2 [(str "node " our-root "/extension/out/tools/onboarder-reconcile.js " our-root " once") s2]
      3 [(str "python3 -m http.server 8765") s2])))

(defn- gen-process [s]
  (let [[pid s1] (gen-int s 100000)
        [cmdline s2] (gen-cmdline s1)]
    [{:pid pid :cmdline cmdline} s2]))

(defn- gen-processes [s]
  (let [[n s1] (gen-int s 6)]
    (loop [i 0 s' s1 acc []]
      (if (= i n)
        [acc s']
        (let [[p s''] (gen-process s')]
          (recur (inc i) s'' (conj acc p)))))))

;; parent-liveness is assigned PER PID (a map), independent of cmdline -
;; every distinct pid generated gets its own coin flip so the same pid never
;; silently disagrees with itself within one input.
(defn- gen-input [s]
  ;; unreadable is a degenerate case for P1-P3 (processes=nil trivially
  ;; satisfies both) - weighted rare (1/8) so most runs exercise the
  ;; interesting filter logic, while still generating it often enough
  ;; (~60+ of 500 runs) for P4's own assertion to be meaningfully checked.
  (let [[n s1] (gen-int s 8)
        unreadable? (zero? n)]
    (if unreadable?
      [{:processes nil :alive-pids #{}} s1]
      (let [[processes s2] (gen-processes s1)
            [alive-flags s3] (reduce (fn [[flags s'] p]
                                        (let [[alive? s''] (gen-bool s')]
                                          [(conj flags [(:pid p) alive?]) s'']))
                                      [[] s2] processes)
            alive-pids (set (map first (filter second alive-flags)))]
        [{:processes processes :alive-pids alive-pids} s3]))))

(defn- parent-orphaned-fn [alive-pids]
  (fn [pid] (not (contains? alive-pids pid))))

;; ── P1: every reaped pid has a genuinely orphaned parent ────────────────────

(check-all "P1 :reapable never includes a pid whose parent is alive"
  gen-input
  (fn [{:keys [processes alive-pids]}]
    (let [{:keys [reapable]} (front-desk-supervisor-lib/decide-onboarder-orphan-reap
                               processes our-root (parent-orphaned-fn alive-pids))]
      (or (empty? (filter alive-pids reapable))
          (str "reapable=" (pr-str reapable) " alive-pids=" (pr-str alive-pids))))))

;; ── P2: every reaped pid's cmdline names OUR project-root ───────────────────

(check-all "P2 :reapable never includes a pid whose cmdline does not name project-root"
  gen-input
  (fn [{:keys [processes alive-pids]}]
    (let [{:keys [reapable]} (front-desk-supervisor-lib/decide-onboarder-orphan-reap
                               processes our-root (parent-orphaned-fn alive-pids))
          by-pid (into {} (map (juxt :pid :cmdline) processes))]
      (or (every? #(front-desk-supervisor-lib/onboarder-reconcile-poll-loop-holder?
                    (get by-pid %) our-root)
                  reapable)
          (str "reapable=" (pr-str reapable) " processes=" (pr-str processes))))))

;; ── P3: completeness - every process satisfying BOTH filters is present ────

(check-all "P3 every holder+orphaned process is present in :reapable (never silently dropped)"
  gen-input
  (fn [{:keys [processes alive-pids]}]
    (let [{:keys [reapable]} (front-desk-supervisor-lib/decide-onboarder-orphan-reap
                               processes our-root (parent-orphaned-fn alive-pids))
          expected (->> processes
                        (filter #(front-desk-supervisor-lib/onboarder-reconcile-poll-loop-holder?
                                  (:cmdline %) our-root))
                        (filter #(not (contains? alive-pids (:pid %))))
                        (map :pid)
                        set)]
      (or (= expected (set reapable))
          (str "expected=" (pr-str expected) " reapable=" (pr-str reapable))))))

;; ── P4: unreadable? tracks (nil? processes) exactly, and always empties
;;    :reapable - never conflated with a genuinely empty candidate set ──────

(check-all "P4 :unreadable? is true iff processes is nil, and then :reapable is always empty"
  gen-input
  (fn [{:keys [processes alive-pids]}]
    (let [{:keys [reapable unreadable?]} (front-desk-supervisor-lib/decide-onboarder-orphan-reap
                                           processes our-root (parent-orphaned-fn alive-pids))]
      (or (and (= unreadable? (nil? processes))
               (or (not unreadable?) (empty? reapable)))
          (str "processes=" (pr-str processes) " unreadable?=" unreadable? " reapable=" (pr-str reapable))))))

;; ── generator coverage, asserted rather than assumed ──────────────────────

(let [buckets (loop [i 0 s 17 acc {:unreadable 0 :nonempty-reapable 0 :multi-process 0}]
                (if (= i runs)
                  acc
                  (let [[{:keys [processes alive-pids]} s'] (gen-input s)
                        {:keys [reapable]} (front-desk-supervisor-lib/decide-onboarder-orphan-reap
                                             processes our-root (parent-orphaned-fn alive-pids))]
                    (recur (inc i) s'
                           (cond-> acc
                             (nil? processes) (update :unreadable inc)
                             (seq reapable) (update :nonempty-reapable inc)
                             (and processes (>= (count processes) 2)) (update :multi-process inc))))))
      floor (quot runs 20)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [b [:unreadable :nonempty-reapable :multi-process]]
    (when (< (get buckets b 0) floor)
      (report! (str "COVERAGE " b) 17 buckets (str b " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "front_desk_supervisor_lib decide-onboarder-orphan-reap properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
