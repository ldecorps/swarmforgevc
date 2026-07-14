#!/usr/bin/env bb
;; TDD runner for push_sweep_lib.bb (BL-356) - no real git process, no real
;; clock (every now-ms is explicit), no real network (every send is a fake).
;; Mirrors stuck_escalation_email_lib_test_runner.bb's own assert-battery
;; shape.

(ns push-sweep-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def retry-cfg {:max-push-attempts 3 :max-alarm-attempts 3
                :backoff-base-ms 1000 :backoff-max-ms 8000})

;; ── push-decision ─────────────────────────────────────────────────────────

(assert= "push-decision: nothing ahead, nothing behind -> nothing-to-push"
         :nothing-to-push (push-sweep-lib/push-decision {:ahead 0 :behind 0}))
(assert= "push-decision: nothing ahead (even if behind) -> nothing-to-push (this sweep never pulls)"
         :nothing-to-push (push-sweep-lib/push-decision {:ahead 0 :behind 4}))
(assert= "push-decision: ahead, not behind -> should-push"
         :should-push (push-sweep-lib/push-decision {:ahead 3 :behind 0}))
(assert= "push-decision: ahead AND behind -> diverged (a plain push would be non-fast-forward)"
         :diverged (push-sweep-lib/push-decision {:ahead 2 :behind 1}))

;; ── due? ──────────────────────────────────────────────────────────────────

(assert-true "due?: never attempted is always due"
             (push-sweep-lib/due? {:attempts 0 :last-attempt-at-ms nil :now-ms 100000 :retry-config retry-cfg}))
(assert-false "due?: a retry before its backoff has elapsed waits"
              (push-sweep-lib/due? {:attempts 1 :last-attempt-at-ms 100000 :now-ms 100500 :retry-config retry-cfg}))
(assert-true "due?: a retry once its backoff has elapsed is due"
             (push-sweep-lib/due? {:attempts 1 :last-attempt-at-ms 100000 :now-ms 101000 :retry-config retry-cfg}))

;; ── next-push-state ───────────────────────────────────────────────────────

(assert= "next-push-state: a successful push resets attempts and is never exhausted"
         {:attempts 0 :last-attempt-at-ms nil :exhausted? false}
         (push-sweep-lib/next-push-state :pushed {:attempts 2} retry-cfg 200000))
(assert= "next-push-state: a transient failure under the cap counts the attempt, not exhausted"
         {:attempts 1 :last-attempt-at-ms 200000 :exhausted? false}
         (push-sweep-lib/next-push-state :transient-failure {:attempts 0} retry-cfg 200000))
(assert= "next-push-state: a transient failure AT the cap is exhausted (bounded, not unlimited)"
         {:attempts 3 :last-attempt-at-ms 200000 :exhausted? true}
         (push-sweep-lib/next-push-state :transient-failure {:attempts 2} retry-cfg 200000))

;; ── classify-send-result / next-alarm-state ─────────────────────────────

(assert= "classify-send-result: a successful send is :delivered"
         :delivered (push-sweep-lib/classify-send-result {:success true}))
(assert= "classify-send-result: missing api key is :terminal-misconfig"
         :terminal-misconfig (push-sweep-lib/classify-send-result {:success false :reason :missing-api-key}))
(assert= "classify-send-result: a failed send with no reason is :transient-failure"
         :transient-failure (push-sweep-lib/classify-send-result {:success false :error "connection refused"}))

(assert= "next-alarm-state: :delivered arms and resets attempts"
         {:armed? true :attempts 0 :last-attempt-at-ms nil :gave-up? false}
         (push-sweep-lib/next-alarm-state :delivered {:attempts 1} retry-cfg 200000))
(assert= "next-alarm-state: :transient-failure under the cap stays unarmed"
         {:armed? false :attempts 1 :last-attempt-at-ms 200000 :gave-up? false}
         (push-sweep-lib/next-alarm-state :transient-failure {:attempts 0} retry-cfg 200000))
(assert= "next-alarm-state: :transient-failure AT the cap arms anyway and gives up loudly"
         {:armed? true :attempts 0 :last-attempt-at-ms nil :gave-up? true}
         (push-sweep-lib/next-alarm-state :transient-failure {:attempts 2} retry-cfg 200000))

;; ── sweep! (adapter-injected orchestration, real state-file fixture) -
;;    BL-356's own 5 acceptance scenarios ──────────────────────────────────

(defn mk-fixture-dir []
  (str (fs/create-temp-dir {:prefix "sfvc-push-sweep-"})))

(defn fake-adapters [{:keys [counts push-results alarm-results divergence-results]}]
  (let [counts-atom (atom counts)
        push-calls (atom 0)
        alarm-calls (atom 0)
        divergence-calls (atom 0)
        logs (atom [])]
    {:calls {:push push-calls :alarm alarm-calls :divergence divergence-calls :logs logs}
     ;; Lets a test simulate the real world changing between sweep! ticks
     ;; (e.g. a human merging directly to origin mid-episode) without
     ;; losing the running call counters a fresh fake-adapters would reset.
     :set-counts! (fn [new-counts] (reset! counts-atom new-counts))
     :adapters
     {:rev-counts! (fn [] @counts-atom)
      :push! (fn []
               (swap! push-calls inc)
               (let [r (nth push-results (dec @push-calls) (last push-results))]
                 r))
      :send-push-alarm! (fn [_attempts]
                           (swap! alarm-calls inc)
                           (let [r (nth alarm-results (dec @alarm-calls) (last alarm-results))]
                             r))
      :send-divergence-alarm! (fn [_ahead _behind]
                                 (swap! divergence-calls inc)
                                 (let [r (nth divergence-results (dec @divergence-calls) (last divergence-results))]
                                   r))
      :log! (fn [& parts] (swap! logs conj (clojure.string/join " " parts)))}}))

;; BL-356 swarm-pushes-main-to-origin-01: committed work reaches origin
;; without a human.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]} (fake-adapters {:counts {:ahead 2 :behind 0}
                                                :push-results [{:success true}]})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "01: origin ahead of local -> exactly one push is attempted" 1 @(:push calls))
  (assert= "01: a successful push clears all state" {} (push-sweep-lib/read-state dir)))

;; BL-356 swarm-pushes-main-to-origin-02: a transient push failure is
;; retried, not abandoned, and bounded rather than unlimited.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]} (fake-adapters {:counts {:ahead 2 :behind 0}
                                                :push-results [{:success false :error "connection refused"}]})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "02: a transient push failure is recorded, not treated as delivered"
           {:attempts 1 :last-attempt-at-ms 100000 :exhausted? false}
           (:push (push-sweep-lib/read-state dir)))
  ;; Before backoff elapses, no further attempt.
  (push-sweep-lib/sweep! 100200 dir retry-cfg adapters)
  (assert= "02: no retry attempted before backoff elapses" 1 @(:push calls))
  ;; Once backoff (1000ms for attempt 1) elapses, a retry is attempted.
  (push-sweep-lib/sweep! 101000 dir retry-cfg adapters)
  (assert= "02: a retry is attempted once backoff elapses" 2 @(:push calls)))

;; BL-356 swarm-pushes-main-to-origin-03: pushes that keep failing raise a
;; loud alarm rather than silently accumulating, and the alarm is only
;; marked delivered once actually delivered.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]} (fake-adapters {:counts {:ahead 2 :behind 0}
                                                :push-results [{:success false :error "e"}
                                                               {:success false :error "e"}
                                                               {:success false :error "e"}]
                                                :alarm-results [{:success false :error "smtp down"}
                                                                {:success true}]})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)   ; attempt 1 -> transient
  (push-sweep-lib/sweep! 101000 dir retry-cfg adapters)   ; attempt 2 -> transient
  (push-sweep-lib/sweep! 103000 dir retry-cfg adapters)   ; attempt 3 -> exhausted, alarm due, alarm fails transiently
  (assert= "03: three bounded push attempts, no more" 3 @(:push calls))
  (assert= "03: the retries were bounded (attempts cap reached, not still climbing unbounded)"
           3 (get-in (push-sweep-lib/read-state dir) [:push :attempts]))
  (assert= "03: exactly one alarm attempt so far" 1 @(:alarm calls))
  (assert-false "03: a failed alarm delivery is NOT marked armed/delivered"
                (get-in (push-sweep-lib/read-state dir) [:alarm :armed?]))
  ;; The alarm itself is retried (bounded, with backoff) until it actually
  ;; delivers - it must not be silently abandoned either.
  (push-sweep-lib/sweep! 103500 dir retry-cfg adapters)   ; alarm backoff not yet elapsed -> no new alarm call
  (assert= "03: no alarm retry before ITS OWN backoff elapses" 1 @(:alarm calls))
  (push-sweep-lib/sweep! 104500 dir retry-cfg adapters)   ; alarm backoff elapsed -> retried, delivers
  (assert= "03: the alarm is retried and this time delivers" 2 @(:alarm calls))
  (assert-true "03: the alarm is marked armed ONLY once actually delivered"
               (get-in (push-sweep-lib/read-state dir) [:alarm :armed?])))

;; BL-356 swarm-pushes-main-to-origin-04: work that diverged from origin is
;; surfaced, never force-pushed over.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]} (fake-adapters {:counts {:ahead 2 :behind 1}
                                                :divergence-results [{:success true}]})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "04: a diverged main is never pushed" 0 @(:push calls))
  (assert= "04: the human is told about the divergence" 1 @(:divergence calls))
  (assert-true "04: the divergence alarm is armed once delivered"
               (get-in (push-sweep-lib/read-state dir) [:divergence :armed?]))
  ;; A later sweep, still diverged, does not spam a second divergence alert.
  (push-sweep-lib/sweep! 200000 dir retry-cfg adapters)
  (assert= "04: no repeat divergence alert once already delivered" 1 @(:divergence calls)))

;; BL-356 architect bounce (20260714): a stale ARMED alarm flag from one
;; episode must not survive into, and silently suppress, a LATER episode of
;; the OTHER kind - entering :diverged must clear a stale push-failure
;; :alarm, and returning to :should-push must clear a stale :divergence.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters set-counts!]}
      (fake-adapters {:counts {:ahead 2 :behind 0}
                      ;; A FINITE repeat, not an infinite lazy seq: fake-adapters'
                      ;; own `(nth push-results (dec @push-calls) (last push-results))`
                      ;; eagerly evaluates `last` as an ordinary argument on every
                      ;; call, which never terminates against an infinite sequence.
                      :push-results (vec (repeat 10 {:success false :error "persistent failure"}))
                      :alarm-results [{:success true}]
                      :divergence-results [{:success true}]})]
  ;; Episode 1: should-push exhausts its bounded push retries and arms the
  ;; push-failure alarm.
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (push-sweep-lib/sweep! 101000 dir retry-cfg adapters)
  (push-sweep-lib/sweep! 103000 dir retry-cfg adapters)
  (assert= "cross-episode: episode 1 exhausts 3 bounded push attempts" 3 @(:push calls))
  (assert-true "cross-episode: episode 1's push alarm is armed"
               (get-in (push-sweep-lib/read-state dir) [:alarm :armed?]))
  (assert= "cross-episode: exactly one push alarm so far" 1 @(:alarm calls))

  ;; Episode 2: origin gains a commit mid-episode (a human merges directly)
  ;; -> diverged. The divergence alarm fires and delivers.
  (set-counts! {:ahead 2 :behind 1})
  (push-sweep-lib/sweep! 110000 dir retry-cfg adapters)
  (assert-true "cross-episode: the divergence alarm is armed"
               (get-in (push-sweep-lib/read-state dir) [:divergence :armed?]))
  (assert= "cross-episode: exactly one divergence alarm" 1 @(:divergence calls))
  (assert= "cross-episode: entering :diverged clears episode 1's stale push-alarm flag"
           {} (:alarm (push-sweep-lib/read-state dir)))

  ;; Episode 3: a human reconciles the divergence by hand (no push yet) ->
  ;; should-push again. The ORIGINAL push-failure cause was never actually
  ;; fixed, so this episode exhausts and must alarm AGAIN - not be silently
  ;; swallowed by episode 1's stale armed flag (the exact bug reported).
  (set-counts! {:ahead 2 :behind 0})
  (push-sweep-lib/sweep! 120000 dir retry-cfg adapters)
  (push-sweep-lib/sweep! 121000 dir retry-cfg adapters)
  (push-sweep-lib/sweep! 123000 dir retry-cfg adapters)
  (assert= "cross-episode: episode 3 exhausts its own 3 bounded push attempts"
           6 @(:push calls))
  (assert= "cross-episode: episode 3's push alarm fires AGAIN, not suppressed by episode 1's stale flag"
           2 @(:alarm calls))
  (assert-true "cross-episode: episode 3's push alarm is armed"
               (get-in (push-sweep-lib/read-state dir) [:alarm :armed?]))
  (assert= "cross-episode: returning to :should-push clears the resolved :divergence flag"
           {} (:divergence (push-sweep-lib/read-state dir))))

;; BL-356 swarm-pushes-main-to-origin-05: an already-published main is left
;; alone - nothing pushed, no alarm.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]} (fake-adapters {:counts {:ahead 0 :behind 0}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "05: nothing is pushed" 0 @(:push calls))
  (assert= "05: no alarm of any kind is raised" 0 (+ @(:alarm calls) @(:divergence calls)))
  (assert= "05: no state is left behind" {} (push-sweep-lib/read-state dir)))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "push_sweep_lib: ALL TESTS PASSED")
  (do (println (str "push_sweep_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
