#!/usr/bin/env bb
;; TDD runner for operator_runtime_watch_lib.bb (BL-993) - pure assertions
;; over the shared predicates, plus fixture-based tests for the impure
;; read-pid/healthy?/parked? (real fs I/O against a temp dir, no live swarm).
;; Modeled on ambulance_lib_test_runner.bb's own split.
(ns operator-runtime-watch-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_runtime_watch_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "operator-runtime-watch-lib-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── operator-runtime-cmdline?: pure ──────────────────────────────────────
(assert= "operator-runtime-cmdline?: matches our own invocation shape" true
         (operator-runtime-watch-lib/operator-runtime-cmdline? "bb /repo/swarmforge/scripts/operator_runtime.bb /repo"))
(assert= "operator-runtime-cmdline?: an unrelated process does not match" false
         (operator-runtime-watch-lib/operator-runtime-cmdline? "sleep 100"))
(assert= "operator-runtime-cmdline?: nil cmdline does not match" false
         (operator-runtime-watch-lib/operator-runtime-cmdline? nil))
(assert= "operator-runtime-cmdline?: blank cmdline does not match" false
         (operator-runtime-watch-lib/operator-runtime-cmdline? ""))

;; ── runtime-alive?: pid reuse is the case a naive kill-0 check gets wrong ──
(assert= "runtime-alive?: alive + matching cmdline -> alive" true
         (operator-runtime-watch-lib/runtime-alive? true "bb .../operator_runtime.bb /repo"))
(assert= "runtime-alive?: alive but UNRELATED cmdline (pid reuse) -> not alive" false
         (operator-runtime-watch-lib/runtime-alive? true "sleep 100"))
(assert= "runtime-alive?: not alive at the OS level -> not alive regardless of cmdline" false
         (operator-runtime-watch-lib/runtime-alive? false "bb .../operator_runtime.bb /repo"))
(assert= "runtime-alive?: not alive, no cmdline -> not alive" false
         (operator-runtime-watch-lib/runtime-alive? false nil))

;; ── deliberately-stopped? / stop-reason: pure ────────────────────────────
(assert= "deliberately-stopped?: neither signal -> false" false
         (operator-runtime-watch-lib/deliberately-stopped? false false))
(assert= "deliberately-stopped?: skip env only -> true" true
         (operator-runtime-watch-lib/deliberately-stopped? true false))
(assert= "deliberately-stopped?: park flag only -> true" true
         (operator-runtime-watch-lib/deliberately-stopped? false true))
(assert= "deliberately-stopped?: both signals -> true" true
         (operator-runtime-watch-lib/deliberately-stopped? true true))

(assert= "stop-reason: skip env only" "SWARMFORGE_SKIP_OPERATOR=1"
         (operator-runtime-watch-lib/stop-reason true false))
(assert= "stop-reason: park flag only" "park flag present"
         (operator-runtime-watch-lib/stop-reason false true))
(assert= "stop-reason: both names both, never guesses one" "SWARMFORGE_SKIP_OPERATOR=1, park flag present"
         (operator-runtime-watch-lib/stop-reason true true))

;; ── initial-entry: an already-healthy runtime is never seeded to spawn ───
(def default-entry-calls (atom 0))
(defn fake-default-entry [] (swap! default-entry-calls inc) {:status "not-started"})

(let [entry (operator-runtime-watch-lib/initial-entry true 4242 1000 fake-default-entry)]
  (assert= "initial-entry: healthy seeds status running" "running" (:status entry))
  (assert= "initial-entry: healthy seeds the discovered pid" 4242 (:pid entry))
  (assert= "initial-entry: healthy seeds zero attempts" 0 (:attempts entry))
  (assert= "initial-entry: healthy never calls default-entry-fn" 0 @default-entry-calls))

(reset! default-entry-calls 0)
(let [entry (operator-runtime-watch-lib/initial-entry false nil 1000 fake-default-entry)]
  (assert= "initial-entry: down defers to default-entry-fn" "not-started" (:status entry))
  (assert= "initial-entry: down calls default-entry-fn exactly once" 1 @default-entry-calls))

;; ── announced-event? / announcement-for-event: invariant 2's own decision
;;    (2026-08-21 architect bounce: the supervisor's announce dispatch was a
;;    hand-copy of the announced set that no test tied back to this
;;    predicate; announcement-for-event is now the ONE composition the real
;;    dispatch calls, so these rows pin the real production decision, not a
;;    mirror of it) ─────────────────────────────────────────────────────────
(doseq [[event expected] {:started true :re-armed true :gave-up true
                          :crashed false :healthy-reset false nil false}]
  (assert= (str "announced-event?: " (pr-str event)) expected
           (operator-runtime-watch-lib/announced-event? event)))

(assert= "announcement-for-event: started with a claimed pid names it"
         "operator runtime restarted (pid 4242, attempt 3)"
         (operator-runtime-watch-lib/announcement-for-event :started {:pid 4242 :attempts 3}))
(assert= "announcement-for-event: started with NO claimed pid says so"
         "operator runtime restart attempt 3 failed to claim a pid"
         (operator-runtime-watch-lib/announcement-for-event :started {:pid nil :attempts 3}))
(assert= "announcement-for-event: re-armed names the cooldown restart"
         "operator runtime restarted after cooldown (pid 4242)"
         (operator-runtime-watch-lib/announcement-for-event :re-armed {:pid 4242 :attempts 0}))
(assert= "announcement-for-event: gave-up is the escalation"
         "operator runtime restart attempts exhausted after 5 tries; will retry after cooldown"
         (operator-runtime-watch-lib/announcement-for-event :gave-up {:pid nil :attempts 5}))
(assert= "announcement-for-event: crashed is NOT announced" nil
         (operator-runtime-watch-lib/announcement-for-event :crashed {:pid 4242 :attempts 1}))
(assert= "announcement-for-event: healthy-reset is NOT announced" nil
         (operator-runtime-watch-lib/announcement-for-event :healthy-reset {:pid 4242 :attempts 2}))
(assert= "announcement-for-event: nil event is NOT announced" nil
         (operator-runtime-watch-lib/announcement-for-event nil {:pid 4242 :attempts 0}))

;; announcement-for-event's default `case` arm is unreachable through any
;; event announced-event? recognizes TODAY (every member has its own arm
;; above) - it exists purely as the fail-safe direction invariant 2 demands
;; for an event added to announced-event? tomorrow with no bespoke text yet.
;; Nothing above can exercise it without forcing announced-event? to admit a
;; novel keyword, so with-redefs does exactly that - proving the fail-safe
;; actually announces rather than trusting the comment that says it does.
(with-redefs [operator-runtime-watch-lib/announced-event? (fn [event] (= event :a-future-event))]
  (assert= "announcement-for-event: an unrecognized-but-announced event still announces (fail-safe default arm)"
           "operator runtime watch event a-future-event"
           (operator-runtime-watch-lib/announcement-for-event :a-future-event {:pid nil :attempts 0})))

;; ── I/O: read-pid / pid-alive-os? / parked? / healthy? against a real
;;    fixture project root ────────────────────────────────────────────────
(let [root (mk-tmp)]
  (assert= "read-pid: no pidfile at all -> nil" nil (operator-runtime-watch-lib/read-pid root))
  (assert= "healthy?: no pidfile at all -> not healthy" false (operator-runtime-watch-lib/healthy? root))
  (assert= "parked?: no park file -> false" false (operator-runtime-watch-lib/parked? root)))

(let [root (mk-tmp)
      op-dir (fs/path root ".swarmforge" "operator")]
  (fs/create-dirs op-dir)
  ;; a pidfile naming a dead pid
  (spit (str (fs/path op-dir "runtime.pid")) "999999999\n")
  (assert= "read-pid: parses a pidfile naming a dead pid" 999999999 (operator-runtime-watch-lib/read-pid root))
  (assert= "healthy?: a pidfile naming a dead process -> not healthy" false (operator-runtime-watch-lib/healthy? root))
  ;; a pidfile naming this OWN test process (alive, but not operator_runtime.bb)
  (spit (str (fs/path op-dir "runtime.pid")) (str (.pid (java.lang.ProcessHandle/current)) "\n"))
  (assert= "healthy?: a pidfile naming a live but UNRELATED process (pid reuse) -> not healthy" false
           (operator-runtime-watch-lib/healthy? root))
  ;; the park flag
  (assert= "parked?: absent -> false" false (operator-runtime-watch-lib/parked? root))
  (spit (str (operator-runtime-watch-lib/park-file root)) "parked by a human\n")
  (assert= "parked?: present -> true" true (operator-runtime-watch-lib/parked? root)))

;; ── report ─────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: operator_runtime_watch_lib.bb"))
