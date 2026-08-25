#!/usr/bin/env bb
;; Property tests for aps_equivalence_lib.bb (BL-959, declared invariants;
;; coder-authored per BL-654).
;;
;;   Invariant 2: "A gate outcome missing from either result set is reported
;;   INCOMPLETE with a non-zero exit - absence is never read as equivalence
;;   (fail closed)." P1 draws a pinned result set and derives the candidate
;;   set BY CONSTRUCTION: each cell is assigned same / divergent /
;;   missing-candidate / missing-pinned / null-candidate, so every draw is a
;;   collision candidate for the exact conflation the invariant forbids
;;   (absence read as equality). Asserted per cell: the verdict matches the
;;   assignment; and per matrix: exit 0 iff every cell was `same` AND at
;;   least one cell exists - the empty matrix exits non-zero too.
;;
;;   Invariant 1: "The equivalence run never modifies swarmforge/vendor/aps/,
;;   swarmforge.lock.json, or upstream-watch.json - pinned surfaces are
;;   read-only to this ticket." The lib's executable half: P2 quantifies over
;;   hostile corpus entry names (dot-dot climbs, separators, a literal
;;   pinned-surface path) and asserts every path in write-targets, after
;;   pure segment normalization, stays strictly under the work dir - so no
;;   entry name can steer a write into a pinned surface. The remainder of
;;   the invariant (the harness CHOOSING its work dir and clone dir outside
;;   pinned surfaces, and only ever writing the targets the lib derives) is
;;   process behavior of the thin shell boundary, not a pure module - per
;;   the coder role's stated-reason carve-out it is recorded here and in the
;;   lib header rather than encoded, and qa_e2e step 3 checks it live via
;;   git status after the full run.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - verdict-matrix's candidate-absent branch flipped to EQUIVALENT ->
;;     P1 failed 40/100 runs (every draw carrying a missing-candidate cell);
;;   - entry-slug's sanitizing dropped (identity on the path) -> P2 failed
;;     65/100 runs, targets normalizing to swarmforge.lock.json /
;;     upstream-watch.json / swarmforge/vendor/aps/ themselves. First
;;     attempt did NOT fail: shallow (<=3 dot-dot) climbs land INSIDE
;;     results/<side>/<gate>/ and prove nothing - the generator gained
;;     :dotdot-deep shapes, the exact weighting failure mode the invariant
;;     contract warns about (reach asserted, never hoped).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "aps_equivalence_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator (same LCG discipline as the sibling runners) ─────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
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

;; ── P1: fail-closed verdicts, candidate derived by construction ───────────

(def cell-ops [:same :divergent :missing-candidate :missing-pinned :null-candidate])

(defn- gen-cells [s]
  (let [[n s1] (gen-int s 4)] ; 0..3 entries - the empty matrix must occur
    (reduce (fn [[acc sx] i]
              (let [[gate sy] (gen-pick sx aps-equivalence-lib/gates)
                    [op sz] (gen-pick sy cell-ops)
                    [v sw] (gen-int sz 100)]
                [(conj acc {:entry (str "specs/features/e" i ".feature")
                            :gate gate :op op :outcome {"exit" 0 "v" v}})
                 sw]))
            [[] s1] (range n))))

(check-all "P1 fail-closed: each cell verdicts per its construction (absence/null -> INCOMPLETE, never EQUIVALENT); exit 0 iff all same and non-empty"
  gen-cells
  (fn [cells]
    (let [pinned (reduce (fn [acc {:keys [entry gate op outcome]}]
                           (if (= op :missing-pinned) acc (assoc-in acc [entry gate] outcome)))
                         {} cells)
          candidate (reduce (fn [acc {:keys [entry gate op outcome]}]
                              (case op
                                :same (assoc-in acc [entry gate] outcome)
                                :divergent (assoc-in acc [entry gate] (assoc outcome "v" "mutated"))
                                :missing-candidate acc
                                :missing-pinned (assoc-in acc [entry gate] outcome)
                                :null-candidate (assoc-in acc [entry gate] nil)))
                            {} cells)
          matrix (aps-equivalence-lib/verdict-matrix pinned candidate)
          by-cell (into {} (map (fn [r] [[(:entry r) (:gate r)] r]) matrix))
          expected {:same "EQUIVALENT" :divergent "DIVERGENT"
                    :missing-candidate "INCOMPLETE" :missing-pinned "INCOMPLETE"
                    :null-candidate "INCOMPLETE"}
          bad (keep (fn [{:keys [entry gate op]}]
                      (let [row (get by-cell [entry gate])]
                        (cond
                          (nil? row) (str "cell " entry "/" gate " (" op ") missing from the matrix")
                          (not= (expected op) (:verdict row))
                          (str "cell " entry "/" gate " constructed " op " but verdicts "
                               (:verdict row) " - " (pr-str row)))))
                    cells)
          want-zero? (and (seq cells) (every? #(= :same (:op %)) cells))
          exit (aps-equivalence-lib/exit-code matrix)]
      (cond
        (seq bad) (str/join "; " bad)
        (not= (count matrix) (count (distinct (map (juxt :entry :gate) cells))))
        (str "matrix has " (count matrix) " rows for " (count cells) " constructed cells")
        (and want-zero? (not= 0 exit)) (str "all-same non-empty matrix exited " exit)
        (and (not want-zero?) (zero? exit)) "a matrix with a constructed defect (or no cells at all) exited 0"
        :else true))))

;; ── P2: write-path containment under hostile entry names ──────────────────

(def entry-shapes
  ;; A result file sits three directories deep (results/<side>/<gate>/), so
  ;; a climb needs FOUR dot-dots before it can even reach the work dir's
  ;; parent - shallower climbs land inside and prove nothing. Both depths
  ;; are drawn, but only the deep ones carry the escape.
  [["specs/features/f%d.feature" :benign]
   ["../../swarmforge/vendor/aps/injected%d.clj" :dotdot]
   ["../../../../../../swarmforge/vendor/aps/injected%d.clj" :dotdot-deep]
   ["../../../../swarmforge.lock.json" :dotdot-deep]
   ["specs/../../../../../upstream-watch.json" :dotdot-deep]
   ["swarmforge/vendor/aps/bb/src/x%d.clj" :pinned-literal]
   ["weird name!/with:chars%d" :benign]])

(defn- gen-entries [s]
  (let [[n s1] (gen-int s 3)]
    (reduce (fn [[acc sx] i]
              (let [[[fmt kind] sy] (gen-pick sx entry-shapes)]
                [(conj acc {:entry (format fmt i) :kind kind}) sy]))
            [[] s1] (range (inc n)))))

(defn- normalize-segments
  "Pure path normalization: resolve `.` and `..` textually, so containment
   is judged on where the path actually lands, not on its spelling."
  [p]
  (loop [segs (str/split p #"/") out []]
    (if (empty? segs)
      (str/join "/" out)
      (let [[h & t] segs]
        (cond
          (or (= h ".") (= h "")) (recur t (if (and (empty? out) (= h "")) (conj out h) out))
          (= h "..") (recur t (if (and (seq out) (not= (peek out) "")) (pop out) (conj out h)))
          :else (recur t (conj out h)))))))

(check-all "P2 write-path containment: every write target normalizes to strictly under the work dir, for hostile entry names included"
  gen-entries
  (fn [entries]
    (let [work "/scratch/aps-equivalence-work"
          targets (aps-equivalence-lib/write-targets work (map :entry entries))
          escaped (remove #(str/starts-with? (normalize-segments %) (str work "/")) targets)]
      (if (seq escaped)
        (str "targets escape the work dir: " (pr-str (vec (take 3 escaped))))
        true))))

;; ── generator coverage floors (reach asserted, never hoped) ───────────────

(let [tally (fn [gen-fn keyfn]
              (loop [i 0 s 7 acc {}]
                (if (= i runs)
                  acc
                  (let [[input s'] (gen-fn s)]
                    (recur (inc i) s' (merge-with + acc (keyfn input)))))))
      p1 (tally gen-cells (fn [cells]
                            (merge-with + (frequencies (map :op cells))
                                        {:empty-matrix (if (empty? cells) 1 0)})))
      p2 (tally gen-entries (fn [entries] (frequencies (map :kind entries))))
      floor (quot runs 20)]
  (println (str "  generator coverage: P1 " (pr-str p1)))
  (println (str "  generator coverage: P2 " (pr-str p2)))
  (doseq [op (conj cell-ops :empty-matrix)]
    (when (< (get p1 op 0) floor)
      (report! (str "COVERAGE P1 " op) 7 {:count (get p1 op 0) :floor floor}
               "this construction is barely exercised")))
  (doseq [kind [:benign :dotdot :dotdot-deep :pinned-literal]]
    (when (< (get p2 kind 0) floor)
      (report! (str "COVERAGE P2 " kind) 7 {:count (get p2 kind 0) :floor floor}
               "this entry shape is barely exercised"))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "aps_equivalence_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
