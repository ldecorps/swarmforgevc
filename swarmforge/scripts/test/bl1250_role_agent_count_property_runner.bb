#!/usr/bin/env bb
;; BL-1250's declared invariant, coder-authored (BL-654), as a PROPERTY test
;; over expedite_lib.bb's role-agent counting:
;;
;;   "A fully healthy pack of N roles is observed as exactly N role agents:
;;    the probe counts roles, so the number of processes a single role happens
;;    to run - launcher, agent, or any future wrapper - never changes the
;;    observed count."
;;
;; Deterministic by construction: a seeded LCG, never rand.
;;
;; GENERATOR REACH. The whole point of the invariant is independence from the
;; per-role process count, so that dimension is drawn WIDE (1..5 processes per
;; role, varying per role within a pack) and the pack size with it (1..12
;; roles) - a generator pinned at today's 8 roles x 2 processes would pass
;; against the very halving the ticket forbids. Both extremes are floored, and
;; so is the mixed-arity case where roles in the SAME pack run different
;; numbers of processes, which is the shape a future wrapper actually
;; produces. Every pack also carries another project root's roles, so BL-782's
;; scoping is asserted on every draw rather than in one example.
;;
;; Non-vacuity is proven by breaking the invariant and recording the result -
;; see backlog/evidence/BL-1250-role-agent-probe-20260830.md.

(ns bl1250-role-agent-count-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {}))
(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-range [s lo hi] (let [[i s'] (gen-int s (inc (- hi lo)))] [(+ lo i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result) (report! prop s input (str result)))
        (recur (inc i) s')))))

(def root "/srv/packs/swarmforgevc")
(def other-root "/srv/packs/someone-elses-checkout")

(defn- launch [r role file] (str r "/.swarmforge/launch/" role file))

;; A role's processes, in the order a launched role actually acquires them:
;; the agent is what makes the role observed, the launcher sits above it, and
;; anything beyond is a wrapper. Constructed rather than drawn from a bag, so
;; "this role has an agent" is true by construction for a HEALTHY role and the
;; property is about arity alone.
(defn- role-processes [role n]
  (let [all (concat [(str "claude --settings " (launch root role ".claude-settings.json"))
                     (str "zsh " (launch root role ".sh"))]
                    (for [i (range 10)]
                      (str "node " (launch root role (str ".wrapper" i ".js")))))]
    (take n all)))

(defn gen-pack [s]
  (let [[n-roles s0] (gen-range s 1 12)
        ;; Per-role arity, drawn per role: a pack where every role runs the
        ;; same number of processes cannot distinguish "counts roles" from
        ;; "divides by a constant".
        [arities s1] (reduce (fn [[acc st] _]
                               (let [[m st'] (gen-range st 1 5)]
                                 [(conj acc m) st']))
                             [[] s0]
                             (range n-roles))
        roles (mapv #(str "role" %) (range n-roles))
        [n-foreign s2] (gen-range s1 0 4)
        ;; Distinctly named, so a lost root prefix changes the COUNT and not
        ;; only the names - a foreign pack sharing this one's role names would
        ;; let a broken scope collapse back onto the right number by accident.
        foreign (mapcat (fn [i] [(str "zsh " (launch other-root (str "foreign" i) ".sh"))
                                 (str "claude --settings "
                                      (launch other-root (str "foreign" i) ".claude-settings.json"))])
                        (range n-foreign))]
    [{:roles roles :arities arities :n-foreign n-foreign
      :argv (concat (mapcat role-processes roles arities) foreign)}
     s2]))

;; ── the declared invariant ────────────────────────────────────────────────

(check-all
 "P1: a healthy pack of N roles is observed as exactly N, whatever each role runs"
 gen-pack
 (fn [{:keys [roles arities n-foreign argv]}]
   (let [n (count roles)]
     (cover! (cond (= 1 n) :one-role (>= n 10) :many-roles :else :some-roles))
     (when (some #(= 1 %) arities) (cover! :single-process-role))
     (when (some #(>= % 3) arities) (cover! :wrapper-role))
     (when (> (count (distinct arities)) 1) (cover! :mixed-arity-pack))
     (when (pos? n-foreign) (cover! :foreign-root-present))
     (let [observed (expedite-lib/count-role-agents root argv)
           names (expedite-lib/role-agent-names root argv)]
       (cond
         (not= n observed)
         (str "a healthy pack of " n " roles was observed as " observed
              " (per-role process counts " (pr-str arities) ")")
         ;; ...and it is the right N: a count that happened to match while
         ;; naming another root's roles would satisfy the arithmetic alone.
         (not= (sort roles) names)
         (str "the observed roles were " (pr-str names) ", not " (pr-str (sort roles)))
         :else true)))))

;; ── the other direction, so the invariant is not satisfiable by a constant ─
;;
;; The ticket is explicit that this must not become an assertion of health:
;; a role whose agent has died must be SHORT, not counted. Without this, a
;; probe that returned the expected number unconditionally would satisfy P1.

(defn gen-degraded [s]
  (let [[{:keys [roles arities]} s0] (gen-pack s)
        n (count roles)
        [n-dead s1] (gen-range s0 1 n)
        dead (set (take n-dead roles))]
    [{:roles roles :dead dead :n-dead n-dead
      :argv (mapcat (fn [role arity]
                      (if (contains? dead role)
                        ;; Its launcher survives its agent - which is why the
                        ;; process table alone reads as "still there".
                        [(str "zsh " (launch root role ".sh"))]
                        (role-processes role arity)))
                    roles arities)}
     s1]))

(check-all
 "P2: a role whose agent has died is short, never counted by its surviving launcher"
 gen-degraded
 (fn [{:keys [roles dead n-dead argv]}]
   (cover! (if (= n-dead (count roles)) :all-dead :some-dead))
   (let [expected (- (count roles) n-dead)
         observed (expedite-lib/count-role-agents root argv)
         names (set (expedite-lib/role-agent-names root argv))]
     (cond
       (not= expected observed)
       (str "expected " expected " live roles, observed " observed)
       (seq (clojure.set/intersection names dead))
       (str "a dead role was counted from its surviving launcher: "
            (pr-str (clojure.set/intersection names dead)))
       ;; ...and the delta the expeditor reports is non-empty, which is the
       ;; verdict the whole defect was falsifying.
       (and (= 8 (count roles)) (pos? n-dead)
            (empty? (expedite-lib/live-set-delta
                     {:tmux-servers 1 :handoffd 1 :handoffd-supervisor 1 :role-agents observed})))
       "an eight-role pack missing agents reported an empty delta"
       :else true))))

(def floors {:one-role 20 :many-roles 40 :some-roles 100
             :single-process-role 150 :wrapper-role 150 :mixed-arity-pack 150
             :foreign-root-present 200 :some-dead 150 :all-dead 20})

(doseq [[k floor] (sort floors)]
  (let [drawn (get @coverage k 0)]
    (when (< drawn floor)
      (swap! failures conj (str "FAIL reach floor: " (name k) " drawn " drawn " < " floor)))))

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str (into (sorted-map) @coverage)) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
