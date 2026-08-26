#!/usr/bin/env bb
;; BL-647 / BL-654: coder-authored PROPERTY tests for the ticket's two
;; declared invariants over operator-lib/dead-agent-events:
;;
;;   INV1 - Whether a role is expected or dormant is a function of the
;;   conf-resolved rotation mode, roles.tsv, and the active-role marker
;;   alone - the observed live-session set may decide only which expected
;;   roles are absent, never which roles count as expected.
;;
;;   INV2 - With the rotation options omitted, or under any non-router
;;   rotation mode, dead-agent-events output equals the pre-BL-647 oracle -
;;   every role whose own roles.tsv session is not live fires - for every
;;   input.
;;
;; The example-based runner (operator_lib_test_runner.bb's BL-647-01..06)
;; checks the six cases the ticket named. This checks the general claims
;; those six examples are instances of.
;;
;; Deterministic by construction: a seeded LCG, never rand - a property test
;; that flakes is worse than none (same discipline as
;; expedite_lib_property_runner.bb, BL-567).
;;
;; NON-VACUITY, made permanent rather than a one-off manual check: this file
;; also carries two DEFECTIVE variants of dead-agent-events - one that
;; ignores rotation-mode entirely (the literal pre-BL-647 shape), one that
;; applies router-only dormancy suppression regardless of mode. Both
;; properties run against the REAL implementation (must hold) and against
;; the defective variant it targets (must fail) on every invocation, so a
;; future change that quietly hollows out either property is caught the
;; same run it happens, not left to a discarded manual check.
;;
;; GENERATOR REACH: the roster generator always includes "coordinator" plus
;; a random 1-7 of the six OTHER pipeline roles (never fewer than one
;; non-coordinator role), rotation-mode is weighted so "router" comes up
;; roughly half the time, and live-sessions is drawn from three deliberate
;; shapes (none live, everyone live, arbitrary subset) so both the
;; "dormant role's own session happens to be live" and "resident session
;; distinct from the active role's own roles.tsv session" states are
;; actually reached, not merely possible in principle - asserted below via
;; the same generator-coverage-floor pattern as expedite_lib_property_runner.bb.

(ns operator-lib-bl647-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "operator_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator ──────────────────────────────────────────────────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; Deterministic pick-without-replacement, consuming the seed for every
;; draw - NEVER `shuffle` or `rand-nth`, which pull from the JVM's default
;; Random and would silently break run-to-run determinism despite every
;; other generator here being seed-derived (caught by this file's own
;; run-twice check during authoring: two `bb` invocations of the same
;; PROPERTY_RUNS produced different generator-coverage counts before this
;; fix).
(defn- gen-take-n [s coll n]
  (loop [remaining (vec coll) picked [] i 0 sx s]
    (if (or (= i n) (empty? remaining))
      [picked sx]
      (let [[idx sy] (gen-int sx (count remaining))
            item (nth remaining idx)]
        (recur (into (subvec remaining 0 idx) (subvec remaining (inc idx)))
               (conj picked item) (inc i) sy)))))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── generators ────────────────────────────────────────────────────────────

(def pipeline-roles ["specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coder"])

(defn gen-roster
  "coordinator plus a random 1..7 of the other six pipeline roles (always
   including \"coder\", since it is the mono-router home role every real
   roster carries) - never a degenerate zero-non-coordinator roster, which
   would make rotation-mode meaningless to test."
  [s]
  (let [others (remove #{"coder"} pipeline-roles)
        [extra-n s1] (gen-int s (inc (count others)))
        [chosen-extras s2] (gen-take-n s1 others extra-n)
        candidates (conj (into ["coder"] chosen-extras) "coordinator")
        [roles s3] (gen-take-n s2 candidates (count candidates))]
    [(mapv (fn [r] {:role r :session (str "swarmforge-" r)}) roles) s3]))

;; Weighted toward "router" (~half) so INV1's router-specific dormancy path
;; is well exercised, not merely reachable - the recorded "uniform draw
;; passes hundreds of runs against a live defect" trap.
(defn gen-rotation-mode [s]
  (gen-pick s ["router" "router" "router" nil "full-forge" "banked"]))

;; Three deliberate shapes: nobody live, everybody live (including dormant
;; roles' OWN roles.tsv sessions - the exact state that would fool a
;; "dormant role just happens to look live" coincidence), or an arbitrary
;; subset. A uniform independent draw per session rarely reaches the
;; "everyone live" corner, so it is its own explicit branch.
(defn gen-live-sessions [s roster]
  (let [[shape s1] (gen-int s 3)
        all-sessions (mapv :session roster)]
    (case shape
      0 [#{} s1]
      1 [(set all-sessions) s1]
      2 (let [[keep-mask s2] (reduce (fn [[m sx] sess]
                                        (let [[b sy] (gen-bool sx)]
                                          [(if b (conj m sess) m) sy]))
                                      [#{} s1] all-sessions)]
          [keep-mask s2]))))

;; resident-session deliberately NOT always one of the roster's own session
;; names - this is what P1/P6 (BL-647-02) catches: checking the active
;; role's OWN session instead of the passed-in resident-session.
(defn gen-resident-session [s roster]
  (gen-pick s (conj (mapv :session roster) "swarmforge-resident-off-roster")))

(defn gen-case
  "One full input: roster, rotation-mode, active-role (always a
   non-coordinator roster member), resident-session, live-sessions."
  [s]
  (let [[roster s1] (gen-roster s)
        [mode s2] (gen-rotation-mode s1)
        non-coord (vec (remove #(= "coordinator" (:role %)) roster))
        [active s3] (gen-pick s2 (mapv :role non-coord))
        [resident s4] (gen-resident-session s3 roster)
        [live s5] (gen-live-sessions s4 roster)]
    [{:roster roster :mode mode :active active :resident resident :live live} s5]))

;; ── independent oracles (re-derived from the ticket's own prose, not a
;;    copy of the implementation under test) ────────────────────────────────

(defn- expected-roles-oracle
  "INV1's own statement, restated directly: under router mode the expected
   set is {coordinator, active-role}; otherwise every roster role is
   expected. Computed WITHOUT looking at live-sessions at all."
  [{:keys [roster mode active]}]
  (if (= mode "router")
    (into #{} (filter #(or (= % "coordinator") (= % active)) (map :role roster)))
    (into #{} (map :role roster))))

(defn- pre-fix-oracle
  "The literal pre-BL-647 shape: one AGENT_EXITED per role whose OWN
   roles.tsv session is not in live-sessions, roster order, rotation
   options entirely ignored."
  [{:keys [roster live]}]
  (vec (keep (fn [{:keys [role session]}]
               (when-not (contains? live session)
                 {:type "AGENT_EXITED" :subject role :detail (str "tmux session " session " not live")}))
             roster)))

;; ── defective variants (for permanent non-vacuity, not the real fix) ──────

(defn- defective-ignores-rotation-mode
  "Pre-BL-647 exactly: ignores the options map entirely, always the plain
   own-session-liveness check. Must fail INV1 (a dormant role whose own
   session is absent - the overwhelmingly common generated case - wrongly
   fires) while trivially satisfying INV2 (it INSTANIATES INV2's oracle)."
  [expected-roles live-sessions & [_opts]]
  (pre-fix-oracle {:roster expected-roles :live (set live-sessions)}))

(defn- defective-always-router
  "Applies router-style active-role suppression regardless of rotation-mode
   - the bug INV2 exists to rule out (router?  gate not actually checked).
   Must fail INV2 for any non-router mode with more than one non-coordinator
   role; is not exercised against INV1 (a different failure axis)."
  [expected-roles live-sessions & [{:keys [active resident]}]]
  (let [live (set live-sessions)]
    (vec (keep (fn [{:keys [role]}]
                 (let [dormant? (and (not= role "coordinator") (not= role active))
                       sess (if (= role "coordinator")
                              (:session (first (filter #(= "coordinator" (:role %)) expected-roles)))
                              resident)]
                   (when (and (not dormant?) (not (contains? live sess)))
                     {:type "AGENT_EXITED" :subject role :detail (str "tmux session " sess " not live")})))
               expected-roles))))

;; ── INV1: dormant roles never appear, for any live-sessions ──────────────

(defn- inv1-pred [impl-fn]
  (fn [{:keys [roster mode active resident live] :as input}]
    (let [expected (expected-roles-oracle input)
          events (impl-fn roster live {:rotation-mode mode :active-role active :resident-session resident})
          bad (remove expected (map :subject events))]
      (if (seq bad)
        (str "role(s) " (pr-str bad) " fired but are not in the expected set " (pr-str expected))
        true))))

(check-all "INV1 (real impl): dormant roles never fire, for any live-sessions"
           gen-case (inv1-pred operator-lib/dead-agent-events))

(defn- has-absent-dormant?
  "True only when this input actually exercises the bug
   defective-ignores-rotation-mode has: router mode, and at least one
   dormant role (not coordinator, not active) whose own session is not
   live. Without this gate the check is vacuous on two counts: a
   non-router mode makes the oracle's expected-set everyone (no violation
   is even possible), and a dormant role whose own session HAPPENS to be
   live would coincidentally not fire either way."
  [{:keys [roster mode active live]}]
  (and (= mode "router")
       (some (fn [{:keys [role session]}]
               (and (not= role "coordinator") (not= role active) (not (contains? live session))))
             roster)))

(check-all "INV1 NON-VACUITY: defective-ignores-rotation-mode must violate INV1"
           gen-case
           (fn [input]
             (if-not (has-absent-dormant? input)
               true
               (let [r ((inv1-pred defective-ignores-rotation-mode) input)]
                 (if (true? r) (str "expected a violation, defective impl passed for " (pr-str input)) true)))))

;; ── INV2: non-router (or omitted) options reproduce the pre-fix oracle ────

(defn- inv2-pred [impl-fn]
  (fn [{:keys [roster mode active resident live] :as input}]
    (if (= mode "router")
      true ;; INV2 only constrains non-router / omitted-options inputs
      (let [oracle (pre-fix-oracle {:roster roster :live live})
            via-opts (impl-fn roster live {:rotation-mode mode :active-role active :resident-session resident})
            via-omitted (impl-fn roster live)]
        (cond
          (not= oracle via-opts) (str "with explicit non-router opts, got " (pr-str via-opts) " != oracle " (pr-str oracle))
          (not= oracle via-omitted) (str "with opts OMITTED, got " (pr-str via-omitted) " != oracle " (pr-str oracle))
          :else true)))))

(check-all "INV2 (real impl): non-router/omitted options equal the pre-fix oracle"
           gen-case (inv2-pred operator-lib/dead-agent-events))

(defn- has-suppressible-dormant?
  "True only when this input actually exercises defective-always-router's
   bug: a non-router mode (INV2's domain) with at least one non-coordinator,
   non-active role whose own session is not live - the role the oracle
   WOULD fire for, and the defective variant wrongly suppresses as if it
   were a router-dormant role. Without this gate the check is vacuous
   whenever every roster session happens to be live (both the oracle and
   the defective variant then agree on zero events, coincidentally)."
  [{:keys [roster mode active live]}]
  (and (not= mode "router")
       (some (fn [{:keys [role session]}]
               (and (not= role "coordinator") (not= role active) (not (contains? live session))))
             roster)))

(check-all "INV2 NON-VACUITY: defective-always-router must violate INV2"
           gen-case
           (fn [input]
             (if-not (has-suppressible-dormant? input)
               true
               (let [r ((inv2-pred defective-always-router) input)]
                 (if (true? r) (str "expected a violation, defective impl passed for " (pr-str input)) true)))))

;; ── P3 (architect property pass, BL-647): router mode fires EXACTLY the
;;    expected-and-absent set ───────────────────────────────────────────────
;;
;; INV1's own encoding above (inv1-pred) is one-directional: it asserts no
;; DORMANT role fires, so an implementation that returned [] for every
;; router-mode input would satisfy it. INV2 does not close that gap either -
;; it constrains non-router inputs only. The six example cases pin the
;; positive direction at named inputs, but nothing quantified did.
;;
;; That missing direction is the ticket's stated red line - "the one thing it
;; must never do is make a genuine storm quiet". A regression that
;; over-suppresses under router mode (the failure mode a fix like this one
;; naturally drifts toward) would re-disarm the alarm BL-647 exists to
;; rearm, and would pass both declared-invariant properties on the way out.
;; So this pins the equality, including the session each event names: the
;; coordinator against its OWN session, the active role against
;; resident-session.
(defn- router-oracle
  "Full expected output under router mode, re-derived from the ticket's
   prose: coordinator checked against its own session, the active role
   against resident-session, every other role dormant. Roster order, which
   is the order the producer's remove/map pipeline preserves."
  [{:keys [roster active resident live]}]
  (vec (keep (fn [{:keys [role session]}]
               (let [checked (if (= role "coordinator") session resident)]
                 (when (and (or (= role "coordinator") (= role active))
                            (not (contains? live checked)))
                   {:type "AGENT_EXITED" :subject role
                    :detail (str "tmux session " checked " not live")})))
             roster)))

(defn- p3-pred [impl-fn]
  (fn [{:keys [roster mode active resident live] :as input}]
    (if-not (= mode "router")
      true
      (let [oracle (router-oracle input)
            actual (impl-fn roster live {:rotation-mode mode :active-role active :resident-session resident})]
        (if (= oracle actual)
          true
          (str "router-mode output " (pr-str actual) " != oracle " (pr-str oracle)))))))

(check-all "P3 (real impl): router mode fires exactly the expected-and-absent set"
           gen-case (p3-pred operator-lib/dead-agent-events))

;; Permanent non-vacuity, same discipline as the two above: a variant that
;; goes silent under router mode must fail P3. Gated on the input actually
;; having something to lose - when the oracle is already empty (coordinator
;; and resident both live) silence is the correct answer and the check
;; would prove nothing.
(defn- defective-router-silent
  "Suppresses everything under router mode - the over-suppression drift P3
   exists to rule out. Satisfies INV1 (nothing fires, so nothing dormant
   fires) and INV2 (untouched for non-router), which is precisely why P3 is
   needed."
  [expected-roles live-sessions & [{:keys [rotation-mode] :as opts}]]
  (if (= rotation-mode "router")
    []
    (operator-lib/dead-agent-events expected-roles live-sessions opts)))

(check-all "P3 NON-VACUITY: defective-router-silent must violate P3"
           gen-case
           (fn [input]
             (if (or (not= (:mode input) "router") (empty? (router-oracle input)))
               true
               (let [r ((p3-pred defective-router-silent) input)]
                 (if (true? r) (str "expected a violation, silent impl passed for " (pr-str input)) true)))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [[router-n live-empty-n live-all-n reach-off-roster-n absent-dormant-n inv2-nonvacuity-eligible-n
       p3-nonvacuity-eligible-n]
      (loop [i 0 s 42 rn 0 le 0 la 0 ro 0 ad 0 ie 0 pe 0]
        (if (= i runs)
          [rn le la ro ad ie pe]
          (let [[{:keys [mode live roster resident] :as input} s'] (gen-case s)]
            (recur (inc i) s'
                   (if (= mode "router") (inc rn) rn)
                   (if (empty? live) (inc le) le)
                   (if (= live (set (map :session roster))) (inc la) la)
                   (if (= resident "swarmforge-resident-off-roster") (inc ro) ro)
                   (if (has-absent-dormant? input) (inc ad) ad)
                   (if (has-suppressible-dormant? input) (inc ie) ie)
                   (if (and (= mode "router") (seq (router-oracle input))) (inc pe) pe)))))
      floor (quot runs 20)]
  (println (str "  generator coverage: router-mode=" router-n " live-empty=" live-empty-n
                " live-all=" live-all-n " resident-off-roster=" reach-off-roster-n
                " absent-dormant(INV1 non-vacuity)=" absent-dormant-n
                " inv2-nonvacuity-eligible=" inv2-nonvacuity-eligible-n
                " p3-nonvacuity-eligible=" p3-nonvacuity-eligible-n " (runs=" runs ")"))
  (doseq [[label n] [["router-mode" router-n] ["live-empty" live-empty-n]
                     ["live-all" live-all-n] ["resident-off-roster" reach-off-roster-n]
                     ["absent-dormant(INV1 non-vacuity)" absent-dormant-n]
                     ["inv2-nonvacuity-eligible" inv2-nonvacuity-eligible-n]
                     ["p3-nonvacuity-eligible" p3-nonvacuity-eligible-n]]]
    (when (< n floor)
      (report! (str "COVERAGE " label) 42 {:count n :floor floor}
               (str label " is barely exercised (" n "/" runs ") - the generator is skewed")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "operator_lib BL-647 invariant properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD (real impl passes; all three defective variants correctly fail)")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 20 @failures)] (println f))
      (System/exit 1)))
