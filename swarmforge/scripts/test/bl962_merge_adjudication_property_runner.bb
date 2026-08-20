#!/usr/bin/env bb
;; BL-962 property tests (coder-authored, declared invariants) over the pure
;; merge-adjudication core in babysitter_check.bb.
;;
;;   Invariant 1: "A merge commit is never reported for a path whose
;;   merge-result content is byte-identical to a QA-approved parent's version
;;   of that path; a QA-exclusive path differing from every QA-approved
;;   parent remains reported even on such a merge (the coat-tails case)."
;;   P1 asserts BOTH directions verbatim over adjudicate-merge-paths: nothing
;;   reported that a QA-approved parent holds byte-identical, nothing dropped
;;   without such a parent, order preserved. The generator constructs
;;   identical-path sets BY DRAWING FROM the offending list (collision pairs
;;   by construction - independent draws would almost never collide), mixes
;;   in approved and unapproved parents, and counts coverage of the four
;;   decisive shapes (exempted, coat-tails survivor, zero-parents,
;;   all-exempted) with hard floors.
;;
;;   Invariant 3: "Any failure in the added per-parent adjudication (ancestry
;;   call or content diff) fails the WHOLE sweep closed to
;;   ancestry-unavailable, never to a partial result that reads as clean."
;;   The per-call failure collapse lives in merge-parent-facts/{:ok? false}
;;   (impure, driven end-to-end by acceptance scenario 05); the WHOLE-sweep
;;   half is pure and P2 asserts it over assemble-offending-commits: one
;;   failed row anywhere yields exactly {[] :ancestry-unavailable? true} no
;;   matter how many valid offenders sit beside it - the generator floors
;;   coverage of exactly that failed+offenders mix.
;;
;;   Invariant 2 ("decided only by is_qa_ancestor.sh") quantifies over the
;;   file's code, not generated inputs - encoded as the structural gate in
;;   bl962_merge_adjudication_test_runner.bb (no second ancestry primitive,
;;   one resolver site) plus acceptance scenario 05 flipping the predicate
;;   through the seam; stated here rather than manufactured as a property.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - adjudicate-merge-paths' `(and qa-approved? ...)` dropped (identity to
;;     ANY parent exempts) -> P1 failed 174/500 runs (the unapproved-identical
;;     draws);
;;   - assemble-offending-commits keeping offenders alongside a failure
;;     (partial result) -> P2 failed 249/500 runs (exactly the
;;     failed-with-offenders coverage count).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(binding [*command-line-args* ["/nonexistent-bl962-prop-root"]]
  (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_check.bb"))))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(zero? i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop n gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i n)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── P1: invariant 1 over adjudicate-merge-paths ────────────────────────────

(def path-pool (mapv #(str "extension/src/p" % ".ts") (range 8)))

(def p1-coverage (atom {:exempted 0 :coat-tails 0 :zero-parents 0 :all-exempted 0}))

(defn- gen-subset-of
  "A subset of coll drawn FROM coll (collision by construction), possibly
   empty. One noise path outside coll is mixed in ~1/4 of the time - identity
   to a path the merge never offended on must never matter."
  [s coll]
  (let [[mask s1] (gen-int s (bit-shift-left 1 (count coll)))
        subset (set (keep-indexed (fn [i p] (when (bit-test mask i) p)) coll))
        [noise? s2] (gen-bool s1)
        [noise2? s3] (gen-bool s2)]
    [(if (and noise? noise2?) (conj subset "docs/never-offending.md") subset) s3]))

(defn- gen-p1-case [s]
  (let [[n-paths s1] (gen-int s 6)
        offending (vec (take (inc n-paths) path-pool))
        [n-parents s2] (gen-int s1 4)
        [parents s3] (loop [k 0 acc [] sx s2]
                       (if (= k n-parents)
                         [acc sx]
                         (let [[approved? sa] (gen-bool sx)
                               [ident sb] (gen-subset-of sa offending)]
                           (recur (inc k)
                                  (conj acc {:parent (str "parent-" k)
                                             :qa-approved? approved?
                                             :identical-paths ident})
                                  sb))))]
    [{:offending offending :parents parents} s3]))

(defn- exempting-parent? [parents path]
  (some (fn [{:keys [qa-approved? identical-paths]}]
          (and qa-approved? (contains? identical-paths path)))
        parents))

(check-all
 "P1 invariant 1: reported = exactly the offending paths no QA-approved parent holds byte-identical, in offending order"
 runs
 gen-p1-case
 (fn [{:keys [offending parents]}]
   (let [reported (babysitter-check/adjudicate-merge-paths offending parents)
         reported-set (set reported)
         expected-survivors (filterv #(not (exempting-parent? parents %)) offending)]
     ;; coverage accounting
     (let [exempted (remove reported-set offending)
           coat-tails (filter (fn [p] (and (contains? reported-set p)
                                           (some #(contains? (:identical-paths %) p) parents)))
                              offending)]
       (swap! p1-coverage
              #(cond-> %
                 (seq exempted) (update :exempted inc)
                 (seq coat-tails) (update :coat-tails inc)
                 (empty? parents) (update :zero-parents inc)
                 (and (seq offending) (empty? reported)) (update :all-exempted inc))))
     (cond
       ;; soundness: never report a path a QA-approved parent holds identical
       (some #(exempting-parent? parents %) reported)
       (str "reported an exempt path: " (pr-str reported))
       ;; completeness: never drop a path WITHOUT such a parent (coat-tails)
       (not= expected-survivors reported)
       (str "expected survivors " (pr-str expected-survivors) ", got " (pr-str reported))
       :else true))))

;; Generator-reach floors: each decisive shape must be COMMON, not
;; astronomically rare (the BL-654 known failure shape).
(let [{:keys [exempted coat-tails zero-parents all-exempted]} @p1-coverage
      floor (max 5 (quot runs 50))]
  (doseq [[k v] {:exempted exempted :coat-tails coat-tails
                 :zero-parents zero-parents :all-exempted all-exempted}]
    (when (< v floor)
      (swap! failures conj (str "FAIL P1 generator coverage: " k " reached only " v " of " runs " runs (floor " floor ")")))))

;; ── P2: invariant 3 over assemble-offending-commits ────────────────────────

(def p2-coverage (atom {:failed 0 :failed-with-offenders 0 :clean 0 :offenders-only 0}))

(defn- gen-row [s]
  (let [[kind s1] (gen-int s 3)]
    [(case kind
       0 nil
       1 {:sha (str "sha-" (mod s1 97)) :subject "s" :paths ["extension/src/x.ts"]}
       2 :babysitter-check/adjudication-failed)
     s1]))

(defn- gen-p2-case [s]
  (let [[n s1] (gen-int s 9)]
    (loop [k 0 acc [] sx s1]
      (if (= k n)
        [acc sx]
        (let [[row sy] (gen-row sx)]
          (recur (inc k) (conj acc row) sy))))))

(check-all
 "P2 invariant 3: any adjudication failure yields the closed sweep exactly; otherwise offenders pass through in order"
 runs
 gen-p2-case
 (fn [rows]
   (let [result (babysitter-check/assemble-offending-commits rows)
         failed? (boolean (some #(= :babysitter-check/adjudication-failed %) rows))
         offenders (filterv map? rows)]
     (swap! p2-coverage
            #(cond-> %
               failed? (update :failed inc)
               (and failed? (seq offenders)) (update :failed-with-offenders inc)
               (and (not failed?) (empty? offenders)) (update :clean inc)
               (and (not failed?) (seq offenders)) (update :offenders-only inc)))
     (if failed?
       (or (= {:offending-commits [] :ancestry-unavailable? true} result)
           (str "a failed row must close the WHOLE sweep, got " (pr-str result)))
       (or (= {:offending-commits offenders :ancestry-unavailable? false} result)
           (str "expected offenders " (pr-str offenders) " available, got " (pr-str result)))))))

(let [{:keys [failed failed-with-offenders clean offenders-only]} @p2-coverage
      floor (max 5 (quot runs 50))]
  (doseq [[k v] {:failed failed :failed-with-offenders failed-with-offenders
                 :clean clean :offenders-only offenders-only}]
    (when (< v floor)
      (swap! failures conj (str "FAIL P2 generator coverage: " k " reached only " v " of " runs " runs (floor " floor ")")))))

;; ── report ──────────────────────────────────────────────────────────────────
(println (str "  generator coverage: P1 " (pr-str @p1-coverage)))
(println (str "  generator coverage: P2 " (pr-str @p2-coverage)))
(if (empty? @failures)
  (do (println (str "bl962 merge adjudication properties: P1=" runs " runs, P2=" runs " runs"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
