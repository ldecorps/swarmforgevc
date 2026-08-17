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

;; ── BL-630: bookkeeping-only-path? / commit-bookkeeping-only? ──────────────

(assert-true "bookkeeping-only-path?: backlog/ is bookkeeping"
             (push-sweep-lib/bookkeeping-only-path? "backlog/active/BL-1.yaml"))
(assert-true "bookkeeping-only-path?: docs/ is bookkeeping"
             (push-sweep-lib/bookkeeping-only-path? "docs/how-to/x.md"))
(assert-true "bookkeeping-only-path?: swarmforge/ is bookkeeping"
             (push-sweep-lib/bookkeeping-only-path? "swarmforge/scripts/x.bb"))
(assert-false "bookkeeping-only-path?: extension/src/ is NOT bookkeeping"
              (push-sweep-lib/bookkeeping-only-path? "extension/src/foo.ts"))
(assert-false "bookkeeping-only-path?: nil path is NOT bookkeeping"
              (push-sweep-lib/bookkeeping-only-path? nil))

(assert-true "commit-bookkeeping-only?: every changed path is bookkeeping"
             (push-sweep-lib/commit-bookkeeping-only? ["backlog/active/BL-1.yaml" "docs/x.md"]))
(assert-false "commit-bookkeeping-only?: one non-bookkeeping path disqualifies the whole commit"
              (push-sweep-lib/commit-bookkeeping-only? ["backlog/active/BL-1.yaml" "extension/src/foo.ts"]))
(assert-false "commit-bookkeeping-only?: an empty/unknown change set never earns the allowlist"
              (push-sweep-lib/commit-bookkeeping-only? []))

;; ── BL-630: qa-gate-decision ────────────────────────────────────────────

(assert= "qa-gate-decision: facts-complete? false fails closed regardless of other facts"
         {:refuse? true :reason :gather-failed :offending-shas []}
         (push-sweep-lib/qa-gate-decision {:facts-complete? false :qa-ref-exists? true :tip-is-qa-ancestor? true}))

(assert= "qa-gate-decision: no swarmforge-QA ref at all refuses"
         {:refuse? true :reason :missing-ref :offending-shas []}
         (push-sweep-lib/qa-gate-decision {:qa-ref-exists? false}))

(assert= "qa-gate-decision: tip IS a QA ancestor -> publishes, no ahead-commits needed"
         {:refuse? false :reason nil :offending-shas []}
         (push-sweep-lib/qa-gate-decision {:qa-ref-exists? true :tip-is-qa-ancestor? true}))

(assert= "qa-gate-decision: tip not a QA ancestor, offending commit touches non-bookkeeping path -> refused"
         {:refuse? true :reason :non-qa-ancestor :offending-shas ["abc1234567"]}
         (push-sweep-lib/qa-gate-decision
          {:qa-ref-exists? true :tip-is-qa-ancestor? false
           :ahead-commits [{:sha "abc1234567" :qa-ancestor? false :changed-paths ["extension/src/foo.ts"]}]}))

(assert= "qa-gate-decision: tip not a QA ancestor, but every offending commit touches only bookkeeping paths -> publishes"
         {:refuse? false :reason nil :offending-shas []}
         (push-sweep-lib/qa-gate-decision
          {:qa-ref-exists? true :tip-is-qa-ancestor? false
           :ahead-commits [{:sha "abc1234567" :qa-ancestor? false :changed-paths ["backlog/active/BL-1.yaml"]}
                           {:sha "def1234567" :qa-ancestor? true :changed-paths ["extension/src/foo.ts"]}]}))

(assert= "qa-gate-decision: a mix of bookkeeping-only and non-bookkeeping offending commits names only the non-bookkeeping ones"
         {:refuse? true :reason :non-qa-ancestor :offending-shas ["def1234567"]}
         (push-sweep-lib/qa-gate-decision
          {:qa-ref-exists? true :tip-is-qa-ancestor? false
           :ahead-commits [{:sha "abc1234567" :qa-ancestor? false :changed-paths ["backlog/active/BL-1.yaml"]}
                           {:sha "def1234567" :qa-ancestor? false :changed-paths ["extension/src/foo.ts"]}]}))

;; ── BL-630 bounce #1 (architect, 2026-07-30): a TRIVIAL merge (empty
;;    combined diff - no independent content of its own) is never itself
;;    offending, regardless of its own :qa-ancestor? - its real content is
;;    already covered by its own non-merge ancestors appearing as separate
;;    entries in the same ahead-commits seq ─────────────────────────────────

(assert= "qa-gate-decision: a trivial merge (:merge? true, empty changed-paths) never masks a genuinely offending non-merge commit alongside it"
         {:refuse? true :reason :non-qa-ancestor :offending-shas ["bad12345a"]}
         (push-sweep-lib/qa-gate-decision
          {:qa-ref-exists? true :tip-is-qa-ancestor? false
           :ahead-commits [{:sha "merge1234" :merge? true :qa-ancestor? false :changed-paths []}
                           {:sha "bad12345a" :qa-ancestor? false :changed-paths ["extension/src/foo.ts"]}]}))

(assert= "qa-gate-decision: a trivial merge alongside its already-QA-approved feature commit still publishes"
         {:refuse? false :reason nil :offending-shas []}
         (push-sweep-lib/qa-gate-decision
          {:qa-ref-exists? true :tip-is-qa-ancestor? false
           :ahead-commits [{:sha "merge1234" :merge? true :qa-ancestor? false :changed-paths []}
                           {:sha "feat1234a" :qa-ancestor? true :changed-paths ["extension/src/foo.ts"]}]}))

;; ── BL-630 bounce #2 (architect, 2026-07-30): a CONTENT-BEARING merge (its
;;    own combined diff is non-empty - typically a hand-resolved conflict
;;    that exists in neither parent's tree, so no other entry in the seq
;;    covers it) is scrutinized exactly like a non-merge commit's own
;;    :changed-paths - :merge? true does NOT exempt it ───────────────────────

(assert= "qa-gate-decision: a content-bearing merge (non-empty combined diff) with a non-bookkeeping path is offending and refuses, even with a qa-ancestor feature commit alongside it"
         {:refuse? true :reason :non-qa-ancestor :offending-shas ["merge1234"]}
         (push-sweep-lib/qa-gate-decision
          {:qa-ref-exists? true :tip-is-qa-ancestor? false
           :ahead-commits [{:sha "merge1234" :merge? true :qa-ancestor? false
                            :changed-paths ["extension/src/foo.ts"]}
                           {:sha "feat1234a" :qa-ancestor? true :changed-paths ["extension/src/foo.ts"]}]}))

(assert= "qa-gate-decision: a content-bearing merge whose own combined-diff paths are all bookkeeping-only still publishes"
         {:refuse? false :reason nil :offending-shas []}
         (push-sweep-lib/qa-gate-decision
          {:qa-ref-exists? true :tip-is-qa-ancestor? false
           :ahead-commits [{:sha "merge1234" :merge? true :qa-ancestor? false
                            :changed-paths ["backlog/active/BL-1.yaml"]}]}))

;; ── BL-855: noop-landing-merge? / noop-merge-decision ──────────────────────
;; Gherkin BL-855 noop-landing-merge-drops-approved-work-01 (Scenario Outline)

(assert-true "noop-landing-merge?: 108 offered, tree identical to parent1 -> refused shape"
             (push-sweep-lib/noop-landing-merge?
              {:merge? true :tree-equals-parent1? true :offered-paths (repeat 108 "x")}))
(assert-false "noop-landing-merge?: 0 offered, tree identical to parent1 -> harmless (nothing to take)"
              (push-sweep-lib/noop-landing-merge?
               {:merge? true :tree-equals-parent1? true :offered-paths []}))
(assert-false "noop-landing-merge?: 108 offered, tree differs from parent1 -> the merge took something"
              (push-sweep-lib/noop-landing-merge?
               {:merge? true :tree-equals-parent1? false :offered-paths (repeat 108 "x")}))
(assert-false "noop-landing-merge?: a non-merge commit is never flagged, regardless of other facts"
              (push-sweep-lib/noop-landing-merge?
               {:merge? false :tree-equals-parent1? true :offered-paths (repeat 108 "x")}))

;; Gherkin BL-855 -02: the refusal states its reason, not a bare status.

(assert= "noop-merge-decision: names the offending sha, its second parent, and the dropped count"
         {:refuse? true :reason :noop-landing-merge
          :offending [{:sha "f28a84ad01" :second-parent-sha "11ae7ac301" :dropped-count 108}]}
         (push-sweep-lib/noop-merge-decision
          {:facts-complete? true
           :ahead-commits [{:sha "f28a84ad01" :merge? true :second-parent-sha "11ae7ac301"
                             :tree-equals-parent1? true :offered-paths (vec (repeat 108 "x"))}]}))

;; Gherkin BL-855 -03: being genuinely QA-approved does not excuse a merge
;; that took nothing - noop-merge-decision never consults :qa-ancestor? at
;; all, so this holds regardless of whether the ahead-commit fact even
;; carries that key.

(assert-true "noop-merge-decision: refuses a no-op merge even when its second parent is genuinely QA-approved"
             (:refuse?
              (push-sweep-lib/noop-merge-decision
               {:facts-complete? true
                :ahead-commits [{:sha "f28a84ad01" :merge? true :second-parent-sha "11ae7ac301"
                                  :qa-ancestor? true
                                  :tree-equals-parent1? true :offered-paths (vec (repeat 108 "x"))}]})))

;; Gherkin BL-855 -05: a non-merge commit is not subject to the check.

(assert= "noop-merge-decision: a lone non-merge ahead-commit is never refused"
         {:refuse? false :reason nil :offending []}
         (push-sweep-lib/noop-merge-decision
          {:facts-complete? true
           :ahead-commits [{:sha "abc1234567" :merge? false}]}))

;; facts-complete? false fails closed, mirroring qa-gate-decision's own posture.

(assert= "noop-merge-decision: facts-complete? false fails closed regardless of ahead-commits"
         {:refuse? true :reason :gather-failed :offending []}
         (push-sweep-lib/noop-merge-decision {:facts-complete? false :ahead-commits []}))

;; A merge whose second parent is ALREADY an ancestor of the first parent
;; (nothing new offered) is never flagged - the harmless tree-equal shape
;; measured twice in the real 400-merge sample (e126f28d, 229ae7c2).

(assert= "noop-merge-decision: a merge with nothing to take (0 offered paths) never refuses, even alongside a genuine no-op merge"
         {:refuse? true :reason :noop-landing-merge
          :offending [{:sha "bad0000001" :second-parent-sha "p2bad00001" :dropped-count 28}]}
         (push-sweep-lib/noop-merge-decision
          {:facts-complete? true
           :ahead-commits [{:sha "harmless001" :merge? true :second-parent-sha "p2harmless1"
                             :tree-equals-parent1? true :offered-paths []}
                            {:sha "bad0000001" :merge? true :second-parent-sha "p2bad00001"
                             :tree-equals-parent1? true :offered-paths (vec (repeat 28 "y"))}]}))

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
         {:attempts 1 :last-attempt-at-ms 200000 :exhausted? false :last-error nil}
         (push-sweep-lib/next-push-state :transient-failure {:attempts 0} retry-cfg 200000))
(assert= "next-push-state: a transient failure AT the cap is exhausted (bounded, not unlimited)"
         {:attempts 3 :last-attempt-at-ms 200000 :exhausted? true :last-error nil}
         (push-sweep-lib/next-push-state :transient-failure {:attempts 2} retry-cfg 200000))

;; BL-903: the underlying git error now travels into push-state as
;; :last-error, sanitized to one line.
(assert= "next-push-state: a transient failure carries the sanitized error alongside the attempt count"
         {:attempts 1 :last-attempt-at-ms 200000 :exhausted? false :last-error "connection refused"}
         (push-sweep-lib/next-push-state :transient-failure {:attempts 0} retry-cfg 200000 "connection refused"))
(assert= "next-push-state: a blank error yields no :last-error text, not a blank string"
         {:attempts 1 :last-attempt-at-ms 200000 :exhausted? false :last-error nil}
         (push-sweep-lib/next-push-state :transient-failure {:attempts 0} retry-cfg 200000 "  "))

;; ── sanitize-error-line ───────────────────────────────────────────────────

(assert= "sanitize-error-line: nil error -> nil"
         nil (push-sweep-lib/sanitize-error-line nil))
(assert= "sanitize-error-line: blank error -> nil"
         nil (push-sweep-lib/sanitize-error-line "   "))
(assert= "sanitize-error-line: a single-line error is trimmed and returned as-is"
         "fatal: could not read Username"
         (push-sweep-lib/sanitize-error-line "  fatal: could not read Username  "))
(assert= "sanitize-error-line: a multi-line error collapses to one line, nothing dropped"
         "remote: Support for password authentication was removed. | fatal: Authentication failed for 'https://example.invalid/repo.git/'"
         (push-sweep-lib/sanitize-error-line
          "remote: Support for password authentication was removed.\nfatal: Authentication failed for 'https://example.invalid/repo.git/'"))
(assert-false "sanitize-error-line: the collapsed result never contains a raw newline"
              (clojure.string/includes?
               (or (push-sweep-lib/sanitize-error-line "line one\nline two\nline three") "")
               "\n"))

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

(def created-temp-dirs (atom []))
;; BL-459: every temp dir this runner creates is tracked here and removed by
;; a JVM shutdown hook, registered ONCE below - fires on both a clean run
;; and an uncaught assertion/exception propagating out of this script
;; (verified empirically: Runtime/addShutdownHook runs on System/exit and on
;; an uncaught throwable unwinding to the top level), never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that - out of scope
;; here).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-fixture-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-push-sweep-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; BL-630: every pre-existing sweep! test below predates the QA gate and
;; expects an unconditional publish once :should-push is reached - default
;; qa-gate-facts here mirrors "already QA-approved", the fast tip-ancestor
;; path, so none of them have to know the gate exists. Tests of the gate
;; ITSELF pass their own :qa-gate-facts.
(def approved-qa-gate-facts {:qa-ref-exists? true :tip-is-qa-ancestor? true})

;; BL-855: every pre-existing sweep! test below predates the no-op-merge
;; gate too and expects an unconditional publish once :should-push is
;; reached - default noop-merge-gate-facts here is "no ahead commits offer
;; anything", the harmless case, so none of them have to know the gate
;; exists. Tests of the gate ITSELF pass their own :noop-merge-gate-facts.
(def harmless-noop-merge-gate-facts {:facts-complete? true :ahead-commits []})

(defn fake-adapters [{:keys [counts push-results alarm-results divergence-results qa-gate-facts noop-merge-gate-facts]}]
  (let [counts-atom (atom counts)
        push-calls (atom 0)
        alarm-calls (atom 0)
        divergence-calls (atom 0)
        alarm-args (atom [])
        logs (atom [])]
    {:calls {:push push-calls :alarm alarm-calls :divergence divergence-calls :logs logs
             ;; BL-903: [attempts reason] as actually received by
             ;; :send-push-alarm! on each call, so a test can confirm the
             ;; reason travels through, not only the count.
             :alarm-args alarm-args}
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
      :send-push-alarm! (fn [attempts reason]
                           (swap! alarm-calls inc)
                           (swap! alarm-args conj [attempts reason])
                           (let [r (nth alarm-results (dec @alarm-calls) (last alarm-results))]
                             r))
      :send-divergence-alarm! (fn [_ahead _behind]
                                 (swap! divergence-calls inc)
                                 (let [r (nth divergence-results (dec @divergence-calls) (last divergence-results))]
                                   r))
      :qa-gate-facts! (fn [] (or qa-gate-facts approved-qa-gate-facts))
      :noop-merge-gate-facts! (fn [] (or noop-merge-gate-facts harmless-noop-merge-gate-facts))
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
           {:attempts 1 :last-attempt-at-ms 100000 :exhausted? false :last-error "connection refused"}
           (:push (push-sweep-lib/read-state dir)))
  (assert-true "02: the push-failed log record carries the error, on one line"
               (some #(and (clojure.string/includes? % "push-failed")
                            (clojure.string/includes? % "connection refused"))
                     @(:logs calls)))
  ;; Before backoff elapses, no further attempt.
  (push-sweep-lib/sweep! 100200 dir retry-cfg adapters)
  (assert= "02: no retry attempted before backoff elapses" 1 @(:push calls))
  ;; Once backoff (1000ms for attempt 1) elapses, a retry is attempted.
  (push-sweep-lib/sweep! 101000 dir retry-cfg adapters)
  (assert= "02: a retry is attempted once backoff elapses" 2 @(:push calls)))

;; BL-903 push-sweep-discards-failure-reason-02: two different failure
;; causes on two different tick series produce two distinguishable records
;; (a non-fast-forward reads differently from an unreachable remote).
(let [ffwd-dir (mk-fixture-dir)
      {:keys [adapters]}
      (fake-adapters {:counts {:ahead 2 :behind 0}
                      :push-results [{:success false :error "! [rejected] main -> main (non-fast-forward)"}]})
      unreachable-dir (mk-fixture-dir)
      {adapters2 :adapters}
      (fake-adapters {:counts {:ahead 2 :behind 0}
                      :push-results [{:success false :error "fatal: unable to access remote"}]})]
  (push-sweep-lib/sweep! 100000 ffwd-dir retry-cfg adapters)
  (push-sweep-lib/sweep! 100000 unreachable-dir retry-cfg adapters2)
  (let [ffwd-error (get-in (push-sweep-lib/read-state ffwd-dir) [:push :last-error])
        unreachable-error (get-in (push-sweep-lib/read-state unreachable-dir) [:push :last-error])]
    (assert-true "BL-903-02: both records carry non-blank reasons"
                 (and (some? ffwd-error) (some? unreachable-error)))
    (assert-false "BL-903-02: the two causes produce distinguishable recorded reasons"
                  (= ffwd-error unreachable-error))))

;; BL-903 push-sweep-discards-failure-reason-03: a multi-line git error
;; still occupies exactly one new log record.
(let [dir (mk-fixture-dir)
      multiline-error "remote: Support for password authentication was removed.\nfatal: Authentication failed"
      {:keys [calls adapters]} (fake-adapters {:counts {:ahead 2 :behind 0}
                                                :push-results [{:success false :error multiline-error}]})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "BL-903-03: exactly one push-failed record is written"
           1 (count (filter #(clojure.string/includes? % "push-failed") @(:logs calls))))
  (assert-false "BL-903-03: the log record itself carries no raw newline"
                (some #(clojure.string/includes? % "\n") @(:logs calls))))

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
  ;; BL-903: the alarm names the reason, not only the attempt count.
  (assert= "03: the alarm receives the recorded failure reason alongside the attempt count"
           [3 "e"] (first @(:alarm-args calls)))
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

;; BL-630 non-qa-ancestor-tip-blocks-push-01: a main tip that is not a QA
;; ancestor, whose offending commit touches a non-bookkeeping path, is
;; never pushed - the refusal names the offending sha.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]}
      (fake-adapters {:counts {:ahead 1 :behind 0}
                      :qa-gate-facts {:qa-ref-exists? true :tip-is-qa-ancestor? false
                                      :ahead-commits [{:sha "cafe000001" :qa-ancestor? false
                                                        :changed-paths ["extension/src/foo.ts"]}]}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "BL-630 01: origin/main is not updated" 0 @(:push calls))
  (assert-true "BL-630 01: the refusal is logged naming the offending commit sha"
               (some #(clojure.string/includes? % "cafe000001") @(:logs calls))))

;; BL-630 refusal-distinct-from-other-outcomes-02: a QA-refusal is logged as
;; its own outcome, never folded into push-failed/divergence, and none of
;; the existing retry/alarm machinery engages.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]}
      (fake-adapters {:counts {:ahead 1 :behind 0}
                      :qa-gate-facts {:qa-ref-exists? true :tip-is-qa-ancestor? false
                                      :ahead-commits [{:sha "cafe000002" :qa-ancestor? false
                                                        :changed-paths ["extension/src/foo.ts"]}]}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert-true "BL-630 02: the refusal entry is distinguishable (tagged qa-refused)"
               (some #(clojure.string/includes? % "qa-refused") @(:logs calls)))
  (assert= "BL-630 02: no push-failure/push-backoff state is recorded"
           nil (:push (push-sweep-lib/read-state dir)))
  (assert= "BL-630 02: the existing push-failure retry/backoff never engaged" 0 @(:push calls))
  (assert= "BL-630 02: the existing divergence alarm never fires" 0 @(:divergence calls))
  (assert= "BL-630 02: no push-failure alarm (the 'check network/auth' email) is sent" 0 @(:alarm calls)))

;; BL-630 bookkeeping-only-tip-still-publishes-03: a non-QA tip whose every
;; offending commit touches only backlog/docs/swarmforge/ still publishes.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]}
      (fake-adapters {:counts {:ahead 1 :behind 0}
                      :push-results [{:success true}]
                      :qa-gate-facts {:qa-ref-exists? true :tip-is-qa-ancestor? false
                                      :ahead-commits [{:sha "cafe000003" :qa-ancestor? false
                                                        :changed-paths ["backlog/active/BL-1.yaml"]}]}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "BL-630 03: origin/main IS updated (bookkeeping-only allowlist)" 1 @(:push calls)))

;; BL-630 qa-approved-tip-publishes-unchanged-04: a QA-approved tip
;; publishes exactly as it did before this ticket.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]}
      (fake-adapters {:counts {:ahead 1 :behind 0}
                      :push-results [{:success true}]
                      :qa-gate-facts {:qa-ref-exists? true :tip-is-qa-ancestor? true}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "BL-630 04: origin/main is updated exactly as before" 1 @(:push calls))
  (assert= "BL-630 04: a successful push clears all state" {} (push-sweep-lib/read-state dir)))

;; BL-630 behind-with-nothing-to-push-still-surfaces-05: a local main
;; behind origin with nothing to push is distinguished from a genuinely
;; up-to-date tip, never silently folded into "up-to-date".
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]} (fake-adapters {:counts {:ahead 0 :behind 3}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "BL-630 05: nothing is pushed" 0 @(:push calls))
  (assert-true "BL-630 05: the log distinguishes behind-only from up-to-date"
               (some #(clojure.string/includes? % "behind-only") @(:logs calls)))
  (assert-false "BL-630 05: the behind-only tick is never logged as plain up-to-date"
                (some #(= % "push-sweep up-to-date") @(:logs calls))))

;; ── BL-855: sweep! -level wiring - the noop-merge gate runs BEFORE
;;    qa-gate-decision and refuses regardless of QA-approval facts ─────────

;; Gherkin BL-855 -03 replayed at the sweep! level: a genuinely QA-approved
;; tip (the qa-gate fast path) is still refused when it is itself a no-op
;; landing merge.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]}
      (fake-adapters {:counts {:ahead 1 :behind 0}
                      :qa-gate-facts {:qa-ref-exists? true :tip-is-qa-ancestor? true}
                      :noop-merge-gate-facts
                      {:facts-complete? true
                       :ahead-commits [{:sha "f28a84ad01" :merge? true :second-parent-sha "11ae7ac301"
                                         :tree-equals-parent1? true :offered-paths (vec (repeat 108 "x"))}]}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "BL-855 sweep!: a no-op landing merge is never pushed, even when its second parent is a QA-ancestor tip"
           0 @(:push calls))
  (assert-true "BL-855 sweep!: the refusal is logged naming the offending sha, its second parent, and the dropped count"
               (some #(and (clojure.string/includes? % "f28a84ad01")
                            (clojure.string/includes? % "11ae7ac301")
                            (clojure.string/includes? % "108"))
                     @(:logs calls))))

;; Gherkin BL-855 -02 replayed at the sweep! level: the refusal is its own
;; distinct outcome, tagged noop-merge-refused, and none of the QA-gate or
;; push-retry/alarm machinery engages.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]}
      (fake-adapters {:counts {:ahead 1 :behind 0}
                      :noop-merge-gate-facts
                      {:facts-complete? true
                       :ahead-commits [{:sha "f28a84ad02" :merge? true :second-parent-sha "11ae7ac302"
                                         :tree-equals-parent1? true :offered-paths (vec (repeat 108 "x"))}]}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert-true "BL-855 sweep!: the refusal entry is distinguishable (tagged noop-merge-refused)"
               (some #(clojure.string/includes? % "noop-merge-refused") @(:logs calls)))
  (assert= "BL-855 sweep!: no push-failure/push-backoff state is recorded"
           nil (:push (push-sweep-lib/read-state dir)))
  (assert= "BL-855 sweep!: the existing push-failure retry/backoff never engaged" 0 @(:push calls))
  (assert= "BL-855 sweep!: the existing divergence alarm never fires" 0 @(:divergence calls))
  (assert= "BL-855 sweep!: no push-failure alarm is sent" 0 @(:alarm calls)))

;; A merge that genuinely had nothing to take still publishes (the harmless
;; tree-equal shape) - this must not regress once the gate exists.
(let [dir (mk-fixture-dir)
      {:keys [calls adapters]}
      (fake-adapters {:counts {:ahead 1 :behind 0}
                      :push-results [{:success true}]
                      :noop-merge-gate-facts
                      {:facts-complete? true
                       :ahead-commits [{:sha "harmless002" :merge? true :second-parent-sha "p2harmless2"
                                         :tree-equals-parent1? true :offered-paths []}]}})]
  (push-sweep-lib/sweep! 100000 dir retry-cfg adapters)
  (assert= "BL-855 sweep!: a merge with nothing to take still publishes" 1 @(:push calls)))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "push_sweep_lib: ALL TESTS PASSED")
  (do (println (str "push_sweep_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
