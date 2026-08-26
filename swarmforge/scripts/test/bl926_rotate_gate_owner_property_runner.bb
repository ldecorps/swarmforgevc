#!/usr/bin/env bb
;; BL-926 (BL-654 Invariants): PROPERTY tests over mono_router_lib.bb's
;; rotate-gate-decision, encoding the ticket's first two declared
;; invariants:
;;
;;   1. "The gate refuses only when the rotation would abandon a parcel the
;;      DEPARTING pane itself owns. The mere presence of a parcel in some
;;      role's in_process box is never on its own sufficient to refuse."
;;      P1 generates arbitrary {:blocking-file :force? :active-role
;;      :target-role} inputs and asserts: whenever the decision is :refuse,
;;      a real blocking-file was present AND active-role/target-role were
;;      NOT both given and equal - i.e. refusal always tracks a genuine
;;      ownership mismatch, never mere presence of a parcel somewhere.
;;
;;   2. "The change may only turn refuse into proceed, and only where the
;;      rotation target names the same role as the departing role. No input
;;      that resolves to proceed or proceed-forced today may resolve to
;;      refuse once the change is in." P2 diffs the new four-input decision
;;      against old-rotate-gate-decision (the frozen BL-805 two-input
;;      formula, kept here only as a fixed reference point) over the SAME
;;      generated input, and asserts they agree everywhere except the one
;;      documented carve-out: old=:refuse, new=:proceed, and
;;      active-role/target-role both given and equal.
;;
;; The third declared invariant ("rotation never removes, moves, renames or
;; completes a parcel") is a process/IO fact about respawn-as!/
;; rotate-resident-to! actually touching (or not touching) real files via a
;; real tmux respawn - not a property of this pure decision function, so it
;; admits no executable encoding here (same split as bl870's own precedent:
;; the decision is a property, the daemon/IO layer around it is a wiring
;; smoke test). It is covered instead by
;; test_rotate_to_role_stuck_parcel_gate.sh scenario 09, which rotates a
;; real fixture parcel into its own owner and asserts the file survives
;; byte-identical.
;;
;; Non-vacuity proven by hand at authoring time: temporarily reverted
;; rotate-gate-decision to the BL-805 two-input formula (ignoring
;; active-role/target-role entirely) - P1 failed on the first generated
;; case where active-role/target-role were both given, equal, and a real
;; blocking-file was present (decision stayed :refuse instead of :proceed).
;; Separately, temporarily made the ownership check fire whenever EITHER
;; active-role OR target-role was given (instead of both, equal) - P2
;; failed on the first case where exactly one was given and the other nil
;; (old :refuse, new :proceed, same-owner? false - not the documented
;; carve-out). Restored the file after each, reran clean - both properties
;; held again.

(ns bl926-rotate-gate-owner-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(zero? n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 13]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── reference: the frozen BL-805 two-input formula, kept ONLY so P2 has a
;;    fixed point to diff the new behavior against - production code never
;;    calls this ──────────────────────────────────────────────────────────
(defn- old-rotate-gate-decision
  [{:keys [blocking-file force?]}]
  (cond
    (nil? blocking-file) :proceed
    force? :proceed-forced
    :else :refuse))

;; ── generator: an arbitrary rotate-gate-decision input ─────────────────────

(def roles ["coder" "specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(defn- gen-role-or-nil [s]
  (let [[n s'] (gen-int s (inc (count roles)))]
    (if (= n (count roles)) [nil s'] [(nth roles n) s'])))

(defn- gen-blocking-file-or-nil [s]
  (let [[has? s1] (gen-bool s)]
    (if has?
      (let [[n s2] (gen-int s1 100000)]
        [(str "/wt/.swarmforge/handoffs/inbox/in_process/00_" n ".handoff") s2])
      [nil s1])))

(defn gen-input [s]
  (let [[blocking-file s1] (gen-blocking-file-or-nil s)
        [force? s2] (gen-bool s1)
        [active-role s3] (gen-role-or-nil s2)
        [target-role s4] (gen-role-or-nil s3)]
    [{:blocking-file blocking-file :force? force? :active-role active-role :target-role target-role} s4]))

;; ── P1: refuse always tracks a genuine ownership mismatch, never mere
;;    presence ─────────────────────────────────────────────────────────────

(check-all "P1 :refuse implies a real blocking parcel AND an ownership mismatch"
  gen-input
  (fn [input]
    (let [decision (mono-router-lib/rotate-gate-decision input)]
      (if (not= decision :refuse)
        true
        (let [{:keys [blocking-file active-role target-role]} input
              same-owner? (and active-role target-role (= (str active-role) (str target-role)))]
          (or (and (some? blocking-file) (not same-owner?))
              (str "refused without a real ownership-mismatched block: decision=" decision)))))))

;; ── P2: non-regression - the only input class allowed to move off the old
;;    BL-805 answer is old=:refuse -> new=:proceed on an ownership match ────

(check-all "P2 only turns old :refuse into new :proceed, and only on ownership match"
  gen-input
  (fn [input]
    (let [old (old-rotate-gate-decision (select-keys input [:blocking-file :force?]))
          new (mono-router-lib/rotate-gate-decision input)
          {:keys [active-role target-role]} input
          same-owner? (and active-role target-role (= (str active-role) (str target-role)))]
      (cond
        (= old new) true
        (and (= old :refuse) (= new :proceed) same-owner?) true
        :else (str "old=" old " new=" new " same-owner?=" same-owner?)))))

;; ── generator coverage, asserted rather than assumed ──────────────────────

(let [buckets (loop [i 0 s 13 acc {:refuse 0 :proceed 0 :proceed-forced 0 :ownership-match 0}]
                (if (= i runs)
                  acc
                  (let [[input s'] (gen-input s)
                        decision (mono-router-lib/rotate-gate-decision input)
                        {:keys [active-role target-role]} input
                        same-owner? (and active-role target-role (= (str active-role) (str target-role)))]
                    (recur (inc i) s'
                           (cond-> acc
                             (= decision :refuse) (update :refuse inc)
                             (= decision :proceed) (update :proceed inc)
                             (= decision :proceed-forced) (update :proceed-forced inc)
                             same-owner? (update :ownership-match inc))))))
      floor (quot runs 40)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [b [:refuse :proceed :ownership-match]]
    (when (< (get buckets b 0) floor)
      (report! (str "COVERAGE " b) 13 buckets (str b " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "mono_router_lib rotate-gate-decision properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
