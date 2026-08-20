#!/usr/bin/env bb
;; Property tests for daemon_cycle_guard_lib.bb (BL-967, declared invariants;
;; coder-authored per BL-654).
;;
;;   Invariant 1: "No single subprocess or file-I/O wait inside the daemon's
;;   poll cycle can silently exceed the freshness threshold: every such wait
;;   carries a bound well under the threshold, and hitting the bound is
;;   logged and survived - a wedged tmux/git/child process may cost one
;;   bounded wait, never the heartbeat." P1's executable core: over draws of
;;   child behavior constructed BY THE GENERATOR to straddle the bound
;;   (fast-and-clean, fast-and-failing, hung), sh! (a) returns within
;;   bound + slack even for a hung child, (b) reports exit 124 + fires
;;   on-timeout! naming the drawn context exactly when the child hung,
;;   (c) passes fast children through untouched (their own exit/out), and
;;   (d) never throws. The remainder of the invariant - that the DAEMON
;;   routes every in-cycle subprocess through this chokepoint - is wiring
;;   over ~60 call sites, not a pure module: held structurally (handoffd.bb
;;   and its in-cycle libs define no other subprocess path; the
;;   clojure.java.shell require is gone from handoff_lib.bb) and asserted
;;   end-to-end by acceptance scenario 01. Recorded here as the stated
;;   reason per the coder role's carve-out. File-I/O waits: the cycle's file
;;   reads are ordinary local files (no FIFOs/sockets); the subprocess pipe
;;   was the only blocking class observed (BL-057/BL-061 family) - also
;;   recorded as stated reason.
;;
;;   Invariant 2: "After a heavy cycle, the log alone localizes any stall to
;;   one sweep: each sweep in the heavy bundle emits a boundary line (sweep
;;   name + duration) even when it took no action... at bounded volume." P2:
;;   over generated bundles (idle, acting, and throwing sweeps mixed), (a)
;;   exactly ONE boundary line per sweep, in run order, each carrying its
;;   fake-clock duration; (b) THE LOCALIZATION PROPERTY ITSELF: for EVERY
;;   possible prefix cut of the emitted log (a stall can freeze the log at
;;   any point), the first bundle sweep whose boundary is missing from the
;;   prefix is exactly the sweep that ground truth says was running (or next
;;   to run) at that point; (c) volume is exactly (count sweeps) boundary
;;   lines - no more. The never-on-idle-ticks half is main-loop wiring
;;   (run-sweep! is only called in the heavy bundle) - acceptance scenario
;;   03 asserts it; stated reason here.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - sh!'s deref bound multiplied by 1000 (wait effectively unbounded) ->
;;     P1's hung-draw predicate fired "hung child was not bounded: elapsed
;;     30035ms against bound 150" (demonstrated on a single draw: under the
;;     break every hung draw waits out the child's full 30s, so the full
;;     runner would need ~300s to print what one draw shows);
;;   - run-sweep!'s boundary emission made conditional on the thunk's truthy
;;     return ("log only when something happened") -> P2 failed 64/90 runs:
;;     every bundle containing an idle sweep lost that boundary line.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_cycle_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop n gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i n)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── P1: the bounded wait, real subprocesses ───────────────────────────────
;; Spawns real children, so this lane runs a REDUCED count (runs/10, floor
;; 20): the property is about the bound, and 20+ mixed draws exercise every
;; branch. The generator weights hung draws heavily BY CONSTRUCTION - the
;; deep/terminal state must be common, never astronomically rare.

(def p1-runs (max 20 (quot runs 10)))
(def p1-bound-ms 150)
(def p1-slack-ms 1500) ; process spawn + destroy overhead budget

(def child-kinds [:hung :hung :fast-clean :fast-fail]) ; hung weighted 2x

(defn- gen-child [s]
  (let [[kind s1] (gen-pick s child-kinds)
        [ctx-n s2] (gen-int s1 1000)]
    [{:kind kind :context (str "sweep-" ctx-n)} s2]))

(check-all "P1 bounded wait: a hung child costs one bounded wait (124 + attributed report), a fast child passes through untouched, and sh! never throws"
  p1-runs
  gen-child
  (fn [{:keys [kind context]}]
    (let [fired (atom nil)]
      (reset! daemon-cycle-guard-lib/on-timeout! (fn [info] (reset! fired info)))
      (reset! daemon-cycle-guard-lib/current-context context)
      (let [t0 (System/currentTimeMillis)
            r (try (with-redefs [daemon-cycle-guard-lib/subprocess-wait-bound-ms (fn [] p1-bound-ms)]
                     (case kind
                       :hung (daemon-cycle-guard-lib/sh! "sleep" "30")
                       :fast-clean (daemon-cycle-guard-lib/sh! "echo" "ok")
                       :fast-fail (daemon-cycle-guard-lib/sh! "false")))
                   (catch Exception e {::threw (.getMessage e)}))
            elapsed (- (System/currentTimeMillis) t0)]
        (reset! daemon-cycle-guard-lib/on-timeout! (fn [_] nil))
        (reset! daemon-cycle-guard-lib/current-context "outside-sweep")
        (cond
          (::threw r) (str "sh! threw: " (::threw r))

          (= kind :hung)
          (cond
            (> elapsed (+ p1-bound-ms p1-slack-ms))
            (str "hung child was not bounded: elapsed " elapsed "ms against bound " p1-bound-ms)
            (not= 124 (:exit r)) (str "hung child exit " (:exit r) ", not 124")
            (nil? @fired) "on-timeout! never fired for a hung child"
            (not= context (:context @fired))
            (str "timeout attributed to " (pr-str (:context @fired)) ", drew " context)
            :else true)

          (= kind :fast-clean)
          (cond
            (not= 0 (:exit r)) (str "fast clean child exit " (:exit r))
            (some? @fired) "on-timeout! fired for a fast child"
            :else true)

          :else ; :fast-fail
          (cond
            (not= 1 (:exit r)) (str "fast failing child exit " (:exit r) ", not its own 1")
            (some? @fired) "on-timeout! fired for a fast failing child"
            :else true))))))

;; ── P2: boundary lines localize any stall, pure fake clock ────────────────

(def sweep-kinds [:idle :acting :throwing])

(defn- gen-bundle [s]
  (let [[n s1] (gen-int s 7)] ; 1..7 sweeps
    (reduce (fn [[acc sx] i]
              (let [[kind sy] (gen-pick sx sweep-kinds)
                    [dur sz] (gen-int sy 50)]
                [(conj acc {:name (str "sweep-" i) :kind kind :dur (inc dur)}) sz]))
            [[] s1] (range (inc n)))))

(check-all "P2 localization: one boundary per sweep in order with its duration, and EVERY log prefix cut names the guilty sweep as the first one missing its boundary"
  (- runs (quot runs 10))
  gen-bundle
  (fn [bundle]
    (let [logged (atom [])   ; [[event detail sweep-running-at-emit]]
          clock (atom 0)
          running (atom nil) ; ground truth: which sweep is in flight
          log-fn (fn [event detail] (swap! logged conj [event detail @running]))]
      (doseq [{:keys [name kind dur]} bundle]
        (reset! running name)
        (daemon-cycle-guard-lib/run-sweep!
         log-fn (fn [] @clock) name
         (fn []
           (swap! clock + dur)
           (case kind
             :idle nil
             :acting (log-fn "some-action" (str name "-did-a-thing"))
             :throwing (throw (Exception. (str name "-boom"))))))
        (reset! running nil))
      (let [lines @logged
            boundaries (filterv (fn [[e _ _]] (= e "sweep-boundary")) lines)
            expected (mapv (fn [{:keys [name dur]}] (str "sweep=" name " ms=" dur)) bundle)]
        (cond
          (not= expected (mapv second boundaries))
          (str "boundaries wrong: " (pr-str (mapv second boundaries)) " expected " (pr-str expected))

          ;; volume: exactly one per sweep, no boundary noise beyond the bundle
          (not= (count bundle) (count boundaries))
          (str (count boundaries) " boundary lines for " (count bundle) " sweeps")

          :else
          ;; localization: cut the log after every line; the first sweep
          ;; whose boundary is absent from the prefix must be the sweep
          ;; ground truth says was running when the next line would land.
          (or (some (fn [cut]
                      (let [prefix (subvec lines 0 cut)
                            seen (set (keep (fn [[e d _]] (when (= e "sweep-boundary") d)) prefix))
                            blamed (first (remove #(contains? seen (str "sweep=" (:name %) " ms=" (:dur %))) bundle))
                            truth (if (< cut (count lines)) (nth (nth lines cut) 2) nil)]
                        ;; truth nil = the bundle finished; blamed nil matches.
                        ;; A between-sweeps truth (nil mid-log) cannot occur:
                        ;; every emitted line lands while some sweep runs.
                        (when (and truth blamed (not= (:name blamed) truth))
                          (str "cut at " cut ": log blames " (:name blamed) " but " truth " was running"))))
                    (range (inc (count lines))))
              true))))))

;; ── generator coverage floors (reach asserted, never hoped) ───────────────

(let [tally-p1 (loop [i 0 s 7 acc {}]
                 (if (= i p1-runs)
                   acc
                   (let [[{:keys [kind]} s'] (gen-child s)]
                     (recur (inc i) s' (update acc kind (fnil inc 0))))))
      tally-p2 (loop [i 0 s 7 acc {}]
                 (if (= i (- runs (quot runs 10)))
                   acc
                   (let [[bundle s'] (gen-bundle s)]
                     (recur (inc i) s' (merge-with + acc (frequencies (map :kind bundle)))))))]
  (println (str "  generator coverage: P1 (" p1-runs " runs) " (pr-str tally-p1)))
  (println (str "  generator coverage: P2 " (pr-str tally-p2)))
  (doseq [k [:hung :fast-clean :fast-fail]]
    (when (< (get tally-p1 k 0) (max 3 (quot p1-runs 10)))
      (report! (str "COVERAGE P1 " k) 7 {:count (get tally-p1 k 0)} "this child kind is barely exercised")))
  (doseq [k sweep-kinds]
    (when (< (get tally-p2 k 0) (quot runs 20))
      (report! (str "COVERAGE P2 " k) 7 {:count (get tally-p2 k 0)} "this sweep kind is barely exercised"))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "daemon_cycle_guard_lib properties: P1=" p1-runs " runs (real children), P2=" (- runs (quot runs 10)) " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
