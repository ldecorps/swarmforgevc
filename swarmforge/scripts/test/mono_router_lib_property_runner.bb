#!/usr/bin/env bb
;; BL-651 coder pass (BL-654 Invariants): PROPERTY tests over
;; mono_router_lib.bb, encoding the ticket's three declared invariants:
;;
;;   1. "The age input can only change WHICH role is preferred at an idle
;;      decision point - it can never cause a rotation that the existing
;;      busy/recent-churn/cooldown/one-rotation-per-sweep gates would have
;;      refused, so work in flight is never preempted." P3 below composes
;;      preferred-rotate-target's OWN return value (whatever role the starve
;;      override selects, across arbitrary rows/threshold combinations) with
;;      should-rotate-resident? (the real gate function chase-rotate-to!
;;      calls next, unmodified by this ticket) and asserts the gate's
;;      busy/already-active/cooldown/rotate verdict never disagrees with
;;      should-rotate-resident?'s own unconditional precedence order,
;;      regardless of which role the starve logic handed it. This is the
;;      example-based mono_router_lib_test_runner.bb's "busy resident blocks
;;      rotate"/"cooldown blocks rotate" cases generalized to every possible
;;      preferred-role/gate-state combination, including cases no hand-written
;;      example reaches (e.g. a starved role that also happens to equal
;;      active-role, or a starved role inside the cooldown window).
;;      (one-rotation-per-sweep is chase-poke-plan's budget bookkeeping in
;;      handoffd.bb, not a mono_router_lib.bb pure function - out of this
;;      file's reach; unaffected by this ticket since chase-rotate-to! still
;;      only consumes the budget on a successful should-rotate-resident? ->
;;      :rotate, exactly as before.)
;;   2. "Every parcel age used by a rotation decision is derived from that
;;      parcel's own headers (enqueued_at, else created_at) - never file or
;;      directory mtime, at any site." P2 quantifies oldest-actionable-
;;      waited-ms over generated age-source colls that ALSO carry a bogus
;;      :mtime field (deliberately drawn "fresher" than the real
;;      enqueued_at/created_at, mimicking a worktree hot-sync touch) and
;;      asserts the computed wait is byte-identical whether or not :mtime is
;;      present - proving the pure decision never reads it, not merely
;;      failing to exercise it. The impure production site (role-mail-row in
;;      handoffd.bb, which is what could theoretically consult a file's real
;;      mtime) is covered by the concrete fixture example in
;;      test_handoffd_starve_rotate_wiring.sh scenario C (touches a real
;;      file's mtime, confirms the header age still wins) - an impure
;;      fs-touching site is not something this pure-function property runner
;;      can reach, per Design And Testability's testable/unsuitable boundary.
;;   3. "With rotation_starve_after_ms off, the preferred rotate target is
;;      identical to BL-636's for every input: the rule is a pure additive
;;      override, never a rewrite of the existing ordering." P1 quantifies
;;      preferred-rotate-target over arbitrary row sets and asserts the
;;      :off-arity-2 call and the pre-BL-651 arity-1 call always agree -
;;      literally "BL-636's own selection", since the arity-1 code path is
;;      untouched by this ticket.
;;
;; Deterministic by construction: a seeded LCG, never rand (mirrors
;; promotion_gates_lib_property_runner.bb's own generator shape).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored before
;; this commit; a diff against the restored file showed no residual change):
;;   - P1 was run against a deliberately broken preferred-rotate-target where
;;     the :off/arity-1 guard was widened to `(some? starve-after-ms)` (so
;;     :off no longer skipped the starve branch) - crashed with a
;;     ClassCastException comparing the :off keyword, i.e. failed loudly.
;;   - P2 was run against a deliberately broken oldest-actionable-waited-ms
;;     that additionally consulted an :mtime key when present - failed on
;;     the first batch of generated inputs (mtime present vs. stripped
;;     diverged), exactly the divergence the property exists to catch.
;;   - P3 was run against a deliberately broken should-rotate-resident? with
;;     the `resident-busy? :busy` cond clause dropped - 198/500 runs failed
;;     with "resident busy but gate=:rotate/:cooldown", proving the property
;;     actually exercises the busy branch (not merely present in the
;;     generator's coverage counters) and would catch a regression there
;;     even though should-rotate-resident? itself is untouched by this
;;     ticket's diff.

(ns mono-router-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(def now-ms (.toEpochMilli (java.time.Instant/parse "2026-08-01T12:00:00Z")))

(defn iso-of [ms] (str (java.time.Instant/ofEpochMilli ms)))

;; ── seeded generator (mirrors promotion_gates_lib_property_runner.bb) ────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

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

;; ── generators ────────────────────────────────────────────────────────────

(def role-alphabet ["coder" "documenter" "cleaner" "architect"])

(defn gen-roles
  "1-4 DISTINCT roles from role-alphabet, sampled without replacement -
   mirrors one mailbox row per role, the real handoffd shape."
  [s]
  (let [[extra s0] (gen-int s (count role-alphabet))
        n (inc extra)]
    (loop [pool role-alphabet picked [] sx s0 k n]
      (if (or (zero? k) (empty? pool))
        [picked sx]
        (let [[i sx'] (gen-int sx (count pool))
              chosen (nth pool i)
              pool' (vec (remove #(= % chosen) pool))]
          (recur pool' (conj picked chosen) sx' (dec k)))))))

(defn gen-row [s role]
  (let [[best-priority s1] (gen-int s 100)
        [created-offset s2] (gen-int s1 3600001)
        [has-waited? s3] (gen-bool s2)
        [waited-ms s4] (if has-waited? (gen-int s3 3600001) [nil s3])
        [actionable? s5] (gen-bool s4)]
    [{:role role
      :best-priority best-priority
      :newest-created-at (iso-of (- now-ms created-offset))
      :oldest-actionable-waited-ms waited-ms
      :actionable? actionable?}
     s5]))

(defn gen-rows [s]
  (let [[roles s1] (gen-roles s)]
    (reduce (fn [[acc sx] role]
              (let [[row sy] (gen-row sx role)]
                [(conj acc row) sy]))
            [[] s1] roles)))

;; Positive-only, deliberately biased toward small thresholds so a
;; meaningful fraction of generated waits land on both sides of it.
(defn gen-starve-ms [s]
  (let [[ms s1] (gen-int s 1200001)]
    [(inc ms) s1]))

(defn gen-age-source [s]
  (let [[enq-kind s1] (gen-int s 3)      ;; 0 nil, 1 valid, 2 garbage
        [enq-offset s2] (gen-int s1 3600001)
        [created-kind s3] (gen-int s2 3)
        [created-offset s4] (gen-int s3 3600001)
        [mtime-offset s5] (gen-int s4 60000) ;; a "just touched" mtime - fresher than any real header
        enqueued-at (case enq-kind 0 nil 1 (iso-of (- now-ms enq-offset)) 2 "not-a-timestamp")
        created-at (case created-kind 0 nil 1 (iso-of (- now-ms created-offset)) 2 "also-not-a-timestamp")]
    [{:enqueued-at enqueued-at :created-at created-at :mtime (iso-of (- now-ms mtime-offset))} s5]))

(defn gen-age-sources [s]
  (let [[extra s0] (gen-int s 3)
        n (inc extra)]
    (reduce (fn [[acc sx] _]
              (let [[src sy] (gen-age-source sx)]
                [(conj acc src) sy]))
            [[] s0] (range n))))

;; ── P1 (invariant 3): rotation_starve_after_ms off == the arity-1 call ───

(check-all "P1 preferred-rotate-target: :off reproduces the arity-1 (pre-BL-651) result for every input"
  gen-rows
  (fn [rows]
    (let [with-off (mono-router-lib/preferred-rotate-target rows :off)
          arity1 (mono-router-lib/preferred-rotate-target rows)]
      (if (= with-off arity1)
        true
        (str "rows " (pr-str rows) " off=" (pr-str with-off) " arity1=" (pr-str arity1))))))

;; ── P2 (invariant 2): mtime never changes the computed wait ──────────────

(check-all "P2 oldest-actionable-waited-ms ignores an :mtime field entirely - age comes only from enqueued_at/created_at"
  gen-age-sources
  (fn [sources]
    (let [with-mtime (mono-router-lib/oldest-actionable-waited-ms sources now-ms)
          without-mtime (mono-router-lib/oldest-actionable-waited-ms
                         (map #(dissoc % :mtime) sources) now-ms)]
      (if (= with-mtime without-mtime)
        true
        (str "mtime present=" with-mtime " mtime stripped=" without-mtime)))))

;; ── P3 (invariant 1): the starve override never bypasses the resident's
;;      unconditional busy/already-active/cooldown gate order ─────────────

(def active-role-alphabet (into role-alphabet ["coordinator" "specifier"]))

(defn gen-p3-input [s]
  (let [[rows s1] (gen-rows s)
        [starve s2] (gen-starve-ms s1)
        [active-role s3] (gen-pick s2 active-role-alphabet)
        [busy? s4] (gen-bool s3)
        [within-cooldown? s5] (gen-bool s4)]
    [{:rows rows :starve starve :active-role active-role
      :busy? busy? :within-cooldown? within-cooldown?}
     s5]))

(check-all "P3 should-rotate-resident?'s busy/already-active/cooldown/rotate verdict on the STARVE-CHOSEN target always matches its own unconditional precedence order - the starve override never causes a rotation those gates would refuse"
  gen-p3-input
  (fn [{:keys [rows starve active-role busy? within-cooldown?]}]
    (let [preferred (mono-router-lib/preferred-rotate-target rows starve)]
      (if (nil? preferred)
        true ;; nothing actionable - nothing to gate
        (let [last-rotate-at-ms (if within-cooldown?
                                   (- now-ms 1000)
                                   (- now-ms mono-router-lib/default-rotate-cooldown-ms 1000))
              gate (mono-router-lib/should-rotate-resident?
                    {:active-role active-role
                     :target-role preferred
                     ;; BL-921 added a second, independent live-identity axis
                     ;; to :already-active. P3 exercises the PRE-EXISTING
                     ;; starve/busy/cooldown precedence order only, so pin
                     ;; live-role to agree with active-role here - the new
                     ;; axis has its own P4/P5/P6 below.
                     :live-role active-role
                     :resident-busy? busy?
                     :last-rotate-at-ms last-rotate-at-ms
                     :now-ms now-ms
                     :cooldown-ms mono-router-lib/default-rotate-cooldown-ms})]
          (cond
            (and busy? (not= gate :busy))
            (str "resident busy but gate=" gate " for preferred=" preferred)

            (and (not busy?) (= (str active-role) (str preferred)) (not= gate :already-active))
            (str "active-role already equals preferred=" preferred " but gate=" gate)

            (and (not busy?) (not= (str active-role) (str preferred)) within-cooldown? (not= gate :cooldown))
            (str "within cooldown but gate=" gate " for preferred=" preferred)

            (and (not busy?) (not= (str active-role) (str preferred)) (not within-cooldown?) (not= gate :rotate))
            (str "no gate should refuse but gate=" gate " for preferred=" preferred)

            :else true))))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [buckets (loop [i 0 s 7 acc {:busy 0 :already-active 0 :cooldown 0 :rotate 0 :nil-preferred 0}]
                (if (= i runs)
                  acc
                  (let [[{:keys [rows starve active-role busy? within-cooldown?]} s'] (gen-p3-input s)
                        preferred (mono-router-lib/preferred-rotate-target rows starve)]
                    (if (nil? preferred)
                      (recur (inc i) s' (update acc :nil-preferred inc))
                      (let [last-rotate-at-ms (if within-cooldown? (- now-ms 1000) (- now-ms mono-router-lib/default-rotate-cooldown-ms 1000))
                            gate (mono-router-lib/should-rotate-resident?
                                  {:active-role active-role :target-role preferred :live-role active-role
                                   :resident-busy? busy? :last-rotate-at-ms last-rotate-at-ms
                                   :now-ms now-ms :cooldown-ms mono-router-lib/default-rotate-cooldown-ms})]
                        (recur (inc i) s' (update acc (keyword (name gate)) (fnil inc 0))))))))
      floor (quot runs 20)]
  (println (str "  generator coverage (P3 gate buckets): " (pr-str buckets)))
  (doseq [b [:busy :cooldown :rotate]]
    (when (< (get buckets b 0) floor)
      (report! (str "COVERAGE P3 " b " branch") 7 buckets (str b " branch barely exercised")))))

(let [mtime-mattered (loop [i 0 s 7 n 0]
                        (if (= i runs)
                          n
                          (let [[sources s'] (gen-age-sources s)]
                            (recur (inc i) s'
                                   (if (not= (mono-router-lib/oldest-actionable-waited-ms sources now-ms)
                                             (mono-router-lib/oldest-actionable-waited-ms (map #(dissoc % :mtime) sources) now-ms))
                                     (inc n) n)))))]
  (println (str "  generator coverage (P2): mtime-would-have-mattered=" mtime-mattered " (informational; property asserts 0 actual divergence above)")))

;; ── BL-921 (coder pass): PROPERTY tests encoding the ticket's three
;;    declared invariants over dormant-mailbox-chase-action and
;;    should-rotate-resident?, both now gated by a live-role independent of
;;    the active-role marker.
;;
;;    1. "Wake text reaches the resident pane only when the pane's own live
;;       identity equals the target role... an identity that cannot be read
;;       is treated as divergence, never as agreement." -> P4/P4b: a
;;       :wake-resident / :already-active verdict never occurs unless
;;       live-role-agrees? held.
;;    2. "The identity check only ever tightens the gate: for every input,
;;       no case that resolves to skip or rotate today may resolve to wake
;;       once the check is in place." -> P5/P5b: compared against a
;;       reference marker-only baseline (the pre-BL-921 function bodies,
;;       reproduced here so the comparison survives future edits to the
;;       real functions), every branch OTHER than :wake-resident /
;;       :already-active is byte-identical; that one branch may only ever
;;       narrow towards :rotate/:cooldown, never the reverse.
;;    3. "A role holding its own standing session is decided exactly as it
;;       is today, independent of both the marker and the resident pane's
;;       identity." -> P6: target-session-exists? true always yields
;;       :wake-own-session regardless of active-role/live-role.
;;
;;    Non-vacuity proven by hand at authoring time (mutant restored before
;;    this commit): P4 was run against dormant-mailbox-chase-action with the
;;    live-role-agrees? conjunct dropped (i.e. the pre-BL-921 body) - failed
;;    immediately, reporting a :wake-resident verdict with a non-agreeing
;;    live-role on the very first generated input. P4b was run the same way
;;    against should-rotate-resident? and failed identically on
;;    :already-active. P5/P5b were run against the CURRENT (correct)
;;    functions with baseline-dormant-action/baseline-should-rotate below
;;    temporarily made identical to the patched call (i.e. asserting
;;    equality on every branch, including :wake-resident) - failed as soon
;;    as a generated live-role diverged from an agreeing marker, confirming
;;    the comparison is actually sensitive to the tightening, not trivially
;;    true.

(defn gen-role-biased-to
  "50% of the time returns `target` exactly, else a uniform pick from
   role-alphabet (which may coincidentally still equal target) - biases
   toward the agreement boundary the property needs to exercise, mirroring
   gen-starve-ms's bias toward small thresholds. Without this bias,
   independent uniform picks make :wake-resident / :already-active so rare
   (~1/48 of inputs) that 500 runs barely exercise them."
  [s target]
  (let [[hit? s1] (gen-bool s)]
    (if hit? [target s1] (gen-pick s1 role-alphabet))))

(defn gen-live-role-biased-to
  "50% unreadable (nil or blank, split evenly), 50% gen-role-biased-to
   target - so both live-role-agrees? and its negation are well covered."
  [s target]
  (let [[unreadable? s1] (gen-bool s)]
    (if unreadable?
      (let [[blank? s2] (gen-bool s1)] [(if blank? "   " nil) s2])
      (gen-role-biased-to s1 target))))

(defn gen-p4-input [s]
  (let [[target-role s1] (gen-pick s role-alphabet)
        [active-role s2] (gen-role-biased-to s1 target-role)
        [live-role s3] (gen-live-role-biased-to s2 target-role)
        [resident-exists? s4] (gen-bool s3)]
    [{:active-role active-role :target-role target-role :live-role live-role
      :resident-session-exists? resident-exists?}
     s4]))

;; ── P4 (invariant 1): dormant-mailbox-chase-action ───────────────────────

(check-all "P4 dormant-mailbox-chase-action never returns :wake-resident unless the live identity independently agrees with target-role"
  gen-p4-input
  (fn [{:keys [active-role target-role live-role resident-session-exists?]}]
    (let [action (mono-router-lib/dormant-mailbox-chase-action
                  {:target-session-exists? false
                   :resident-session-exists? resident-session-exists?
                   :active-role active-role
                   :target-role target-role
                   :live-role live-role})]
      (if (and (= action :wake-resident)
               (not (mono-router-lib/live-role-agrees? live-role target-role)))
        (str "wake-resident with non-agreeing live-role=" (pr-str live-role) " target-role=" target-role)
        true))))

;; ── P4b (invariant 1): should-rotate-resident? ───────────────────────────

(defn gen-p4b-input [s]
  (let [[target-role s1] (gen-pick s role-alphabet)
        [active-role s2] (gen-role-biased-to s1 target-role)
        [live-role s3] (gen-live-role-biased-to s2 target-role)
        [busy? s4] (gen-bool s3)
        [cooldown-offset s5] (gen-int s4 120000)]
    [{:active-role active-role :target-role target-role :live-role live-role
      :busy? busy? :last-rotate-at-ms (- now-ms cooldown-offset) :now-ms now-ms
      :cooldown-ms mono-router-lib/default-rotate-cooldown-ms}
     s5]))

(check-all "P4b should-rotate-resident? never returns :already-active unless the live identity independently agrees with target-role"
  gen-p4b-input
  (fn [{:keys [active-role target-role live-role busy? last-rotate-at-ms now-ms cooldown-ms]}]
    (let [gate (mono-router-lib/should-rotate-resident?
                {:active-role active-role :target-role target-role :live-role live-role
                 :resident-busy? busy? :last-rotate-at-ms last-rotate-at-ms
                 :now-ms now-ms :cooldown-ms cooldown-ms})]
      (if (and (= gate :already-active)
               (not (mono-router-lib/live-role-agrees? live-role target-role)))
        (str "already-active with non-agreeing live-role=" (pr-str live-role) " target-role=" target-role)
        true))))

;; ── P5/P5b (invariant 2): tightening only, never loosening ──────────────

(defn- baseline-dormant-action
  "Reference PRE-BL-921 body (marker-only) - deliberately NOT the function
   under test, so this comparison stays meaningful if that function is
   later edited again."
  [{:keys [target-session-exists? resident-session-exists? active-role target-role]}]
  (cond
    target-session-exists? :wake-own-session
    (not resident-session-exists?) :wake-own-session
    (= (str active-role) (str target-role)) :wake-resident
    :else :rotate))

(check-all "P5 dormant-mailbox-chase-action: live-role only ever narrows a baseline :wake-resident to :rotate - every other branch is untouched"
  gen-p4-input
  (fn [{:keys [active-role target-role live-role resident-session-exists?]}]
    (let [args {:target-session-exists? false
                :resident-session-exists? resident-session-exists?
                :active-role active-role :target-role target-role}
          baseline (baseline-dormant-action args)
          patched (mono-router-lib/dormant-mailbox-chase-action (assoc args :live-role live-role))]
      (cond
        (not= baseline :wake-resident)
        (if (= patched baseline) true
          (str "baseline=" baseline " (never :wake-resident) but patched=" patched " - unaffected branch changed"))

        :else ;; baseline :wake-resident - patched may stay or narrow to :rotate, nothing else
        (if (contains? #{:wake-resident :rotate} patched) true
          (str "baseline=:wake-resident narrowed to unexpected patched=" patched))))))

(defn- baseline-should-rotate
  "Reference PRE-BL-921 body (marker-only)."
  [{:keys [active-role target-role resident-busy? last-rotate-at-ms now-ms cooldown-ms]}]
  (let [cooldown (or cooldown-ms mono-router-lib/default-rotate-cooldown-ms)]
    (cond
      resident-busy? :busy
      (and active-role target-role (= (str active-role) (str target-role))) :already-active
      (and last-rotate-at-ms (pos? last-rotate-at-ms)
           (< (- now-ms last-rotate-at-ms) cooldown)) :cooldown
      :else :rotate)))

(check-all "P5b should-rotate-resident?: live-role only ever narrows a baseline :already-active to :cooldown/:rotate - every other branch is untouched"
  gen-p4b-input
  (fn [{:keys [active-role target-role live-role busy? last-rotate-at-ms now-ms cooldown-ms]}]
    (let [args {:active-role active-role :target-role target-role
                :resident-busy? busy? :last-rotate-at-ms last-rotate-at-ms
                :now-ms now-ms :cooldown-ms cooldown-ms}
          baseline (baseline-should-rotate args)
          patched (mono-router-lib/should-rotate-resident? (assoc args :live-role live-role))]
      (cond
        (not= baseline :already-active)
        (if (= patched baseline) true
          (str "baseline=" baseline " (never :already-active) but patched=" patched " - unaffected branch changed"))

        :else ;; baseline :already-active - patched may stay, or fall through to cooldown/rotate
        (if (contains? #{:already-active :cooldown :rotate} patched) true
          (str "baseline=:already-active narrowed to unexpected patched=" patched))))))

;; ── P6 (invariant 3): a role's own standing session is decided
;;      independent of the marker/live-role ───────────────────────────────

(check-all "P6 dormant-mailbox-chase-action: target-session-exists? true always yields :wake-own-session regardless of active-role/live-role"
  gen-p4-input
  (fn [{:keys [active-role target-role live-role resident-session-exists?]}]
    (let [action (mono-router-lib/dormant-mailbox-chase-action
                  {:target-session-exists? true
                   :resident-session-exists? resident-session-exists?
                   :active-role active-role
                   :target-role target-role
                   :live-role live-role})]
      (if (= action :wake-own-session) true
        (str "expected :wake-own-session, got " action)))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [wake-resident-count (loop [i 0 s 7 n 0]
                             (if (= i runs) n
                               (let [[{:keys [active-role target-role live-role resident-session-exists?]} s'] (gen-p4-input s)]
                                 (recur (inc i) s'
                                        (if (= :wake-resident
                                               (mono-router-lib/dormant-mailbox-chase-action
                                                {:target-session-exists? false
                                                 :resident-session-exists? resident-session-exists?
                                                 :active-role active-role :target-role target-role :live-role live-role}))
                                          (inc n) n)))))
      already-active-count (loop [i 0 s 7 n 0]
                              (if (= i runs) n
                                (let [[input s'] (gen-p4b-input s)]
                                  (recur (inc i) s'
                                         (if (= :already-active (mono-router-lib/should-rotate-resident? input)) (inc n) n)))))
      floor (quot runs 40)]
  (println (str "  generator coverage (P4 :wake-resident)=" wake-resident-count " (P4b :already-active)=" already-active-count))
  (when (< wake-resident-count floor)
    (report! "COVERAGE P4 :wake-resident branch" 7 wake-resident-count "barely exercised"))
  (when (< already-active-count floor)
    (report! "COVERAGE P4b :already-active branch" 7 already-active-count "barely exercised")))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "mono_router_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
