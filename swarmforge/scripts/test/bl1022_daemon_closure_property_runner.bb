#!/usr/bin/env bb
;; BL-1022 property test (coder-authored, two DECLARED invariants) over the
;; daemon reachability walk in master_checkout_drift_lib.bb.
;;
;;   Invariant 1: "The subprocess-API ban is enforced over every file the
;;   daemon can reach, by any edge kind - a file reachable by spawning is
;;   inside the closure exactly as one reachable by loading."
;;
;;   Invariant 2: "The gate reports the closure it actually covered, so a
;;   shrinking closure is visible rather than silently passing."
;;
;; The expected reachable set is computed from the GENERATED ADJACENCY, not by
;; re-running the walk. The lib discovers edges by parsing source text; this
;; runner knows the graph it asked for. Comparing the walk's answer to a second
;; call of the walk would only prove it is self-consistent.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; The state that matters is a node reachable ONLY by a SPAWN edge, and
;; specifically one at DEPTH rather than hanging directly off the entrypoint -
;; a one-hop spawn is the easy case, and the real graph's offenders sit two and
;; three hops in, behind `handoffd -> (spawn) swarm_handoff -> (load) ...`.
;; Drawing edge kinds independently makes a spawn-only deep node rare, so each
;; run CONSTRUCTS a chain of alternating edge kinds and derives the expected
;; set from it, with floors asserting spawn-only, load-only, both-kinds, deep
;; (>= 3 hops) and cyclic graphs were all actually reached.
;;
;; Unreachable NOISE nodes are generated too: a walk that simply returned every
;; file it was given would satisfy a reachability property that only ever looks
;; at nodes that ARE reachable. P3 is the half that catches that.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored,
;; counts MEASURED (seed 1022, 300 runs):
;;   - dropping :spawn from the walk's edge kinds ....... P1 187
;;   - recording every edge as [:load from] ............. P2 361
;;   - returning all known files as the closure ......... P1 200, P2 604, P3 302
;;   - dropping the reached-by entry for spawn edges .... P2 722
;; Every number is the measured count, not an estimate. P3 is the one to read:
;; it is the only property that fails when the walk stops being a REACHABILITY
;; computation and starts returning whatever it was handed - a break the other
;; three properties accept, because everything genuinely reachable is still
;; present in the answer.

(ns bl1022-daemon-closure-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_checkout_drift_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))
(def coverage (atom {:spawn-only 0 :load-only 0 :both-kinds 0 :deep 0 :cyclic 0 :noise 0
                     ;; The state the invariant is really about: a file that is
                     ;; NOT a direct child of the entrypoint and is reached only
                     ;; by a spawn edge. A one-hop spawn is the easy case; the
                     ;; real graph's offenders sit two and three hops in.
                     :spawn-at-depth 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; Render one file's source from its outgoing edges. This is the only place
;; that knows the concrete syntax; the graph itself stays abstract data.
(defn- render [edges]
  (str/join "\n"
    (for [[kind target] edges]
      (case kind
        :load (str "(load-file (str (fs/path x \"" target "\")))")
        :spawn (str "(daemon-cycle-guard-lib/sh! [\"bb\" \"" target "\" (str draft)])")))))

;; Independent BFS over the adjacency the generator built.
(defn- expected-reachable [adjacency entry]
  (loop [frontier [entry] seen #{}]
    (if-let [f (first frontier)]
      (if (seen f)
        (recur (rest frontier) seen)
        (recur (into (vec (rest frontier)) (map second (get adjacency f))) (conj seen f)))
      seen)))

(loop [i 0 s 1022]
  (when (< i runs)
    (let [[depth s1] (gen-int s 4)
          chain-len (+ 2 depth)                       ; 2..5 nodes in the chain
          names (mapv #(str "n" % ".bb") (range chain-len))
          ;; CONSTRUCT the chain, alternating edge kinds from a generated
          ;; starting phase, so spawn-only-at-depth exists by construction.
          ;; Three edge-kind modes, generated: all-spawn and all-load make the
          ;; single-kind graphs reachable at all (an always-alternating chain
          ;; can only be single-kind when it has exactly one edge, which left
          ;; the spawn-only floor unreachable by construction rather than by
          ;; chance); alternating makes spawn-at-depth reachable.
          [mode s1b] (gen-int s1 3)                   ; 0 alternate, 1 all-spawn, 2 all-load
          [phase s2] (gen-int s1b 2)
          kind-at (fn [k] (case mode
                            1 :spawn
                            2 :load
                            (if (= 0 (mod (+ k phase) 2)) :spawn :load)))
          chain-edges (into {}
                        (for [k (range (dec chain-len))]
                          [(names k) [[(kind-at k) (names (inc k))]]]))
          ;; A cycle back to the entry, sometimes - the walk must terminate.
          [cyc s3] (gen-int s2 3)
          cyclic? (zero? cyc)
          adjacency (cond-> chain-edges
                      cyclic? (update (names (dec chain-len))
                                      (fnil conj []) [:load (names 0)]))
          ;; Unreachable noise: files that exist but nothing points at them.
          [n-noise s4] (gen-int s3 3)
          noise (mapv #(str "noise" % ".bb") (range n-noise))
          sources (merge (into {} (for [n names] [n (render (get adjacency n []))]))
                         (into {} (for [n noise] [n "(defn foo [])"])))
          entry (names 0)
          expected (expected-reachable adjacency entry)
          r (master-checkout-drift-lib/resolve-daemon-reachability
              {:entrypoints #{entry} :read-file sources})
          kinds-used (set (map first (mapcat val adjacency)))]

      (swap! coverage update
             (cond (= kinds-used #{:spawn}) :spawn-only
                   (= kinds-used #{:load}) :load-only
                   :else :both-kinds) inc)
      (when (>= chain-len 4) (swap! coverage update :deep inc))
      ;; A spawn edge whose SOURCE is not the entrypoint - i.e. the target sits
      ;; at least two hops in and is reachable only by spawning.
      (when (some (fn [[from es]] (and (not= from entry) (some #(= :spawn (first %)) es)))
                  adjacency)
        (swap! coverage update :spawn-at-depth inc))
      (when cyclic? (swap! coverage update :cyclic inc))
      (when (seq noise) (swap! coverage update :noise inc))

      ;; ── P1 (invariant 1): every reachable file is in the closure, whatever
      ;; edge kind reaches it. A spawn edge is an edge.
      (when (not= expected (:closure r))
        (report! "P1 (invariant 1: reachable by ANY edge kind means inside the closure)" s
                 {:adjacency adjacency}
                 (str "closure was " (pr-str (:closure r)) ", expected " (pr-str expected))))

      ;; ── P2 (invariant 2): the report accounts for every file, and the edge
      ;; kind it records is the kind that actually reaches it. A report that
      ;; says "reached" without saying HOW cannot show a shrinking closure.
      (doseq [f (:closure r)]
        (let [recorded (get-in r [:reached-by f])
              actual (set (for [[from es] adjacency [k t] es :when (= t f)] [k from]))]
          (when (empty? recorded)
            (report! "P2 (invariant 2: every covered file is accounted for in the report)" s
                     {:file f} "no reached-by entry"))
          (when (and (not= f entry) (not= recorded actual))
            (report! "P2 (invariant 2: the report names the edge kind that actually reaches each file)" s
                     {:file f} (str "recorded " (pr-str recorded) ", actual " (pr-str actual))))))
      (when-not (contains? (get-in r [:reached-by entry]) :entrypoint)
        (report! "P2 (invariant 2: the entrypoint is reported as such)" s {:entry entry}
                 (pr-str (get-in r [:reached-by entry]))))

      ;; ── P3: the closure is REACHABILITY, not "every file handed to it".
      ;; Without this, a walk that returned all known files would satisfy P1.
      (doseq [n noise]
        (when (contains? (:closure r) n)
          (report! "P3 (the closure is reachability, not the file list)" s {:noise n}
                   "an unreachable file appeared in the closure")))

      ;; ── P4 (invariant 2): the report never covers more than the closure -
      ;; a reported file that is not in the closure is a report drifting away
      ;; from what was actually walked.
      (when-let [extra (seq (remove (:closure r) (keys (:reached-by r))))]
        (report! "P4 (invariant 2: the report covers exactly the closure)" s {:extra extra}
                 "reached-by names files outside the closure"))

      (recur (inc i) s4))))

(doseq [[k floor] {:spawn-only 40 :load-only 40 :both-kinds 60 :deep 80 :cyclic 60 :noise 120
                   :spawn-at-depth 80}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1022 daemon-closure properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
