#!/usr/bin/env bb
;; BL-973 property test (coder-authored, DECLARED invariant 1), over the
;; closure walk every fixture copy-list is now derived from.
;;
;;   Invariant 1: "A fixture copy-list of a bb script's dependencies is derived
;;   from, or gate-checked against, the real transitive load-file closure OF
;;   THE ENTRY POINT THAT FIXTURE ACTUALLY DRIVES - never hand-maintained
;;   without a closure guard (a new load-file upstream must fail loudly here,
;;   not silently strand the fixture)."
;;
;; Lane note: this is a bb property runner rather than a *.property.test.js,
;; following the repo's established shape for invariants whose subject is
;; Babashka source (bl1035, bl1043, bl1076). It is still outside the unit lane
;; and still run only on purpose, which is the separation the rule is for.
;;
;; The invariant has THREE clauses and they need different properties:
;;
;; P1 - "the real closure". The walk is transitive and complete: for a randomly
;;      shaped DAG, every node reachable from the entry point is in the answer
;;      and nothing else is. Stated both ways, because a walk that returned the
;;      whole directory would satisfy "complete" and be useless.
;;
;; P2 - "of the entry point that fixture actually drives". The mint-time spec
;;      got this wrong and pinned every list to handoff_lib.bb. So: whenever
;;      one entry point reaches a node another does not, their closures must
;;      differ - a guard that answered the same set for every entry point would
;;      green a fixture missing its own CLI's direct dependency.
;;
;; P3 - "a new load-file edge upstream must fail loudly". For any node already
;;      in the closure, adding an edge from it to a NEW file puts that file in
;;      the closure - so a frozen list is always caught, at any depth. This is
;;      the event that actually happened three times (BL-911, BL-967, BL-1029),
;;      and each time it was found by a red feature rather than by a guard.
;;
;; P4 - the armed-ness backstop, and it is not optional: P1's completeness half,
;;      P2 and P3 are ALL satisfied by a walk that returns every file in the
;;      directory. That would make every fixture copy the whole tree, and no
;;      drift would ever be detectable as drift. So an unreachable file must
;;      never appear in a closure.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-23), each break restored,
;; counts MEASURED (seed 973, 120 runs):
;;   - walk one level only (no transitivity) ............ P1 118
;;   - ignore the entry point, always walk from the
;;     first file in the directory ...................... P1 87, P2 120
;;   - return every .bb file in the directory ........... P1 120, P2 120, P4 120
;; Every number is the measured count, not an estimate.
;;
;; P3 survives the first break, which is worth saying rather than hiding: the
;; probe edge is attached to the shallowest node in the closure, so a depth-1
;; walk still sees it. P3's subject is "does a new edge enter the closure at
;; all", and P1 is what holds the depth - between them the clause is covered,
;; but neither covers it alone.

(ns bl973-closure-guard-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "bb_load_closure_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 120))
(def failures (atom []))
(def coverage (atom {:deep-chain 0 :diamond 0 :multi-root 0 :unreachable-present 0 :edge-added 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- node-name [i] (str "n" i "_lib.bb"))

;; Writes a real .bb file per node, with the project's real load-file idiom -
;; so the walk is parsing what it parses in production, not a simplified form.
(defn- write-tree! [dir edges n-nodes]
  (fs/create-dirs dir)
  (doseq [i (range n-nodes)]
    (let [deps (get edges i [])]
      (spit (str (fs/path dir (node-name i)))
            (str "(ns n" i "-lib)\n"
                 (str/join "\n"
                           (for [d deps]
                             (str "(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) \""
                                  (node-name d) "\")))")))
                 "\n")))))

;; Reachability computed independently of the walk under test - a second
;; implementation, so the property is not the code checking itself.
(defn- reachable-from [edges root]
  (loop [seen #{root} queue [root]]
    (if-let [i (first queue)]
      (let [fresh (remove seen (get edges i []))]
        (recur (into seen fresh) (into (vec (rest queue)) fresh)))
      seen)))

(def tmp-root (str (fs/create-temp-dir {:prefix "bl973-closure-prop-"})))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (try (fs/delete-tree tmp-root) (catch Exception _ nil)))))

(loop [i 0 s 973]
  (when (< i runs)
    (let [[extra s1] (gen-int s 8)
          n-nodes (+ 4 extra)
          ;; A DAG by construction: node i may only depend on nodes > i, so the
          ;; walk always terminates and reachability is well defined. Depth is
          ;; DERIVED rather than left to chance - drawing edges uniformly gives
          ;; mostly shallow trees, and the whole invariant is about
          ;; TRANSITIVITY, which a depth-1 tree cannot exercise.
          [edges s2]
          (loop [k 0 acc {} st s1]
            (if (>= k (dec n-nodes))
              [acc st]
              (let [[extra-edges st1] (gen-int st 3)
                    ;; The chain edge k -> k+1 is always present, which
                    ;; guarantees a path of full depth through every tree.
                    [more st2]
                    (loop [m 0 ds [(inc k)] stx st1]
                      (if (>= m extra-edges)
                        [ds stx]
                        (let [[pick sty] (gen-int stx (- n-nodes k 1))
                              target (+ k 1 pick)]
                          (recur (inc m) (if (some #{target} ds) ds (conj ds target)) sty))))]
                (recur (inc k) (assoc acc k more) st2))))
          ;; An unreachable node, so P4 has something to catch. Reachable only
          ;; if some other node points at it, which by construction none does.
          orphan n-nodes
          n-total (inc n-nodes)
          [entry s3] (gen-int s2 (max 1 (quot n-nodes 2)))
          dir (str (fs/path tmp-root (str "t" i)))
          _ (write-tree! dir edges n-nodes)
          _ (spit (str (fs/path dir (node-name orphan))) (str "(ns n" orphan "-lib)\n"))
          entry-file (node-name entry)
          expected (set (map node-name (reachable-from edges entry)))
          actual (bb-load-closure-lib/compute-closure dir entry-file)
          input {:nodes n-total :entry entry-file :edges edges}]

      (swap! coverage update :unreachable-present inc)
      (when (>= (count (reachable-from edges entry)) 3) (swap! coverage update :deep-chain inc))
      (when (some (fn [[_ ds]] (> (count ds) 1)) edges) (swap! coverage update :diamond inc))
      (when (> n-nodes 5) (swap! coverage update :multi-root inc))

      ;; ── P1 (invariant 1: "the real closure"), both directions.
      (let [missing (sort (remove actual expected))
            surplus (sort (remove expected actual))]
        (when (seq missing)
          (report! "P1 (invariant 1: the walk is transitive - every reachable file is in the closure)" s input
                   (str "unreachable by the walk but genuinely reachable: " (pr-str missing))))
        (when (seq surplus)
          (report! "P1 (invariant 1: the walk is exact - nothing unreachable is in the closure)" s input
                   (str "in the closure but not reachable: " (pr-str surplus)))))

      ;; ── P2 (invariant 1: "of the entry point that fixture actually drives").
      ;; Two entry points with genuinely different reach must get genuinely
      ;; different answers.
      (let [other (mod (+ entry 1) n-nodes)
            other-expected (set (map node-name (reachable-from edges other)))
            other-actual (bb-load-closure-lib/compute-closure dir (node-name other))]
        (when (and (not= expected other-expected) (= actual other-actual))
          (report! "P2 (invariant 1: the closure is OF the entry point, not of the tree)" s input
                   (str "entries " entry-file " and " (node-name other)
                        " reach different sets but got the same closure"))))

      ;; ── P3 (invariant 1: "a new load-file edge upstream must fail loudly").
      ;; Add an edge from a node already in the closure to a brand-new file:
      ;; the closure must grow to include it, so a frozen list is caught.
      (let [from (first (sort (reachable-from edges entry)))
            newdep "bl973_probe_new_lib.bb"]
        (spit (str (fs/path dir newdep)) "(ns bl973-probe-new-lib)\n")
        (spit (str (fs/path dir (node-name from)))
              (str "\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) \"" newdep "\")))\n")
              :append true)
        (swap! coverage update :edge-added inc)
        (let [after (bb-load-closure-lib/compute-closure dir entry-file)]
          (when-not (contains? after newdep)
            (report! "P3 (invariant 1: a new upstream edge enters the closure, so a frozen list is caught)" s input
                     (str "added " newdep " under " (node-name from)
                          " but the closure did not grow")))
          ;; ── P4: armed-ness. A walk returning the whole directory would
          ;; satisfy P1's completeness half, P2 and P3 and detect nothing ever.
          (when (contains? after (node-name orphan))
            (report! "P4 (the walk is not 'everything in the directory')" s input
                     (str "the unreachable " (node-name orphan) " appeared in the closure")))))

      (fs/delete-tree dir)
      (recur (inc i) s3))))

(doseq [[k floor] {:deep-chain 90 :diamond 60 :multi-root 40
                   :unreachable-present 100 :edge-added 100}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl973 closure-guard properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
