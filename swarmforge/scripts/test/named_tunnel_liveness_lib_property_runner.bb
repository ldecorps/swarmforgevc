#!/usr/bin/env bb
;; BL-1199: PROPERTY test over named_tunnel_liveness_lib.bb's
;; liveness-verdict, covering the ticket YAML's two declared invariants
;; (coder-authored first, per BL-654):
;;
;;   1. "No tunnel status row is ever derived from a different tunnel's
;;      pidfile — every row observes the process it names."
;;   2. "Liveness of an ancillary service is never inferred from its
;;      launcher's exit code; it is re-read from the process after
;;      launch."
;;
;; liveness-verdict's own signature is the structural half of invariant 1:
;; it takes ONLY {configured? pid-alive?} - there is no third input for
;; "what the OTHER tunnel's pidfile says", so a caller literally cannot
;; wire this function to the wrong pidfile's facts and have it silently
;; work; both real call sites (named_tunnel_liveness_check.bb,
;; swarm_status.bb's gather-bubble-cloudflared) gather pid-alive? from
;; resident-spy-cloudflared.pid specifically, never tunnel.pid, which is
;; wiring correctness the acceptance suite's real-git scenario 02 proves
;; concretely (vscode-tunnel and bubble-cloudflared diverge independently).
;; Invariant 2's own pure-decision half: this function's signature has NO
;; "launcher exit code" input at all - pid-alive? is the ONLY liveness
;; signal it ever consults, so a verdict of :up is only ever reachable
;; when the process was actually re-read as alive, never inferred from
;; anything else.
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent (see
;; bl640_reference_freshness_property_runner.bb).

(ns named-tunnel-liveness-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "named_tunnel_liveness_lib.bb")))

(def failures (atom []))

(defn- assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 1199))
(defn- rbool [] (.nextBoolean rng))

(def branches-hit (atom #{}))

(dotimes [_ 200]
  (let [configured? (rbool)
        pid-alive? (rbool)
        verdict (named-tunnel-liveness-lib/liveness-verdict
                 {:configured? configured? :pid-alive? pid-alive?})]
    (swap! branches-hit conj [configured? pid-alive?])
    (cond
      (not configured?)
      (assert-true (str "invariant (constraint): unconfigured is ALWAYS :not-configured, "
                        "regardless of pid-alive?=" pid-alive?)
                   (= :not-configured verdict))

      pid-alive?
      (assert-true "invariant 2: configured AND actually alive is :up"
                   (= :up verdict))

      :else
      (assert-true "invariant 2: configured AND NOT actually alive is :down - never inferred as up"
                   (= :down verdict)))))

(assert-true "the generator reached all 4 (configured?, pid-alive?) combinations"
             (= 4 (count @branches-hit)))

;; ── non-vacuousness: a broken "trust configuration alone" implementation ──
;; must fail. The exact class of bug invariant 2 exists to prevent: a
;; verdict that reports :up once a tunnel is merely CONFIGURED, without
;; ever re-checking whether the process is actually alive - precisely the
;; 2026-08-27 incident shape (launcher exited 0, pid later died, nothing
;; re-checked).
(defn- broken-trusts-configuration-alone [{:keys [configured?]}]
  (if configured? :up :not-configured))

(let [facts {:configured? true :pid-alive? false}]
  (assert-true "non-vacuousness: a broken always-up-when-configured verdict WOULD wrongly report :up"
               (= :up (broken-trusts-configuration-alone facts)))
  (assert-true "non-vacuousness: the REAL liveness-verdict correctly reports :down for the same facts"
               (= :down (named-tunnel-liveness-lib/liveness-verdict facts))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " property failure(s)"))
  (System/exit 1))
(println "ALL PROPERTIES HOLD: named_tunnel_liveness_lib.bb (200 runs)")
