#!/usr/bin/env bb
;; BL-1405 coder pass (BL-654 Invariants): PROPERTY tests over
;; land_approval_cli_lib.bb (this ticket's own testable core) and
;; land_step_lib.bb's pre-existing record-land-approval!, encoding the
;; ticket's two declared invariants:
;;
;;   1. "One writer of the land-approval record: the CLI calls
;;      land_step_lib's record-land-approval! and never carries a second
;;      serializer of the record line." P1 writes an arbitrary set of
;;      DISTINCT (commit, source) pairs through the real writer into one
;;      shared store, then asserts land-approval-cli-lib/already-recorded?
;;      (the CLI's own idempotency reader) answers true for EXACTLY the
;;      pairs that were written and false for every other combination
;;      drawn from the same pool - a reader that merely re-derived the
;;      shape independently, rather than reading what the ONE writer
;;      actually produced, could drift out of agreement with it silently;
;;      this proves it does not.
;;   2. "A record grants nothing on its own... and a record with a missing
;;      sha is refused, never written." P2 generates arbitrary invalid sha
;;      inputs (nil, empty, too-short) crossed with otherwise-valid ones,
;;      and asserts record-land-approval! refuses (:ok? false) and writes
;;      NOTHING (no file is created at all) whenever either side is
;;      invalid. The "grants nothing on its own" half (an unapproved
;;      source's replay still reads unapproved) is BL-1334's own predicate
;;      behavior, unchanged and out of this ticket's scope - proven at the
;;      acceptance layer (scenario 03) against the real is_qa_ancestor.sh,
;;      not re-proven here as a pure property.
;;
;; Same deterministic-seeded-LCG shape as provider_auth_observe_lib_property_
;; runner.bb (BL-472: no mutation/property tooling wired for Babashka).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken already-recorded? that
;;     matched on the commit field ALONE (ignoring source) - failed on
;;     every generated case with 2+ records sharing a commit but not a
;;     source (a shape the generator deliberately includes some of the
;;     time, see the shared-commit-different-source bucket below).
;;   - P2 was run against a deliberately broken record-land-approval! that
;;     dropped the nil-check and always attempted the write - failed on
;;     every generated case with an invalid commit or source (the write
;;     succeeded and a file appeared where invariant 2 requires none).

(ns bl1405-hand-built-land-records-approval-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_approval_cli_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))
(defn- hex-char [n] (nth "0123456789abcdef" n))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 31]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- gen-sha [s len]
  (reduce (fn [[acc sx] _]
            (let [[n sy] (gen-int sx 16)] [(str acc (hex-char n)) sy]))
          ["" s] (range len)))

;; shared-target-root (land_step_lib.bb) resolves via `git rev-parse
;; --git-common-dir` - a bare fs/create-temp-dir is NOT a git repo, so
;; every record-land-approval! call against one would refuse silently
;; (:ok? false, "shared target root could not be resolved") and every
;; already-recorded? check would then correctly - but vacuously - answer
;; false regardless of what the property claims to be testing. Every
;; fixture root here is a real, minimal git init for exactly that reason.
(defn- make-git-fixture-dir! [prefix]
  (let [dir (str (fs/create-temp-dir {:prefix prefix}))]
    (process/shell {:dir dir :out :string :err :string} "git" "init" "-q")
    dir))

;; ── P1: already-recorded? is an exact reader of the one real writer ──────

(defn gen-p1 [s]
  (let [[n-n s1] (gen-int s 5)
        n (+ 2 n-n) ;; 2..6 records
        [pairs s2] (reduce (fn [[acc sx] i]
                              (let [[shared-commit? sy] (gen-bool sx)
                                    [c sz] (if (and shared-commit? (seq acc))
                                             [(:commit (rand-nth acc)) sy] ;; deliberately reuse an earlier commit
                                             (gen-sha sy 10))
                                    [src sw] (gen-sha sz 10)]
                                [(conj acc {:commit c :source src :idx i}) sw]))
                            [[] s1] (range n))]
    [{:pairs pairs} s2]))

(check-all "P1: already-recorded? matches EXACTLY the (commit,source) pairs the real writer wrote"
  gen-p1
  (fn [{:keys [pairs]}]
    (let [dir (make-git-fixture-dir! "bl1405-p1-")]
      (try
        (doseq [{:keys [commit source idx]} pairs]
          (land-step-lib/record-land-approval! {:root dir :commit commit :source source :task-ticket-id (str "BL-" idx)}))
        (let [results
              (for [{:keys [commit source]} pairs
                    other-source (distinct (map :source pairs))]
                (let [expected (boolean (some #(and (= (:commit %) commit) (= (:source %) other-source)) pairs))
                      actual (boolean (land-approval-cli-lib/already-recorded? dir commit other-source))]
                  (when-not (= expected actual)
                    (str "commit=" commit " source=" other-source " expected=" expected " actual=" actual))))
              failures-here (remove nil? results)]
          (if (seq failures-here) (str/join "; " failures-here) true))
        (finally (fs/delete-tree dir))))))

;; ── P2: a missing/invalid sha is refused and writes nothing ──────────────

(def invalid-shas [nil "" "a" "ab12" "123456"]) ;; nil, empty, and <7 chars
(def valid-sha "abc1234567890def")

(defn gen-p2 [s]
  (let [[which-invalid s1] (gen-int s (count invalid-shas))
        [commit-is-invalid? s2] (gen-bool s1)]
    [{:commit (if commit-is-invalid? (nth invalid-shas which-invalid) valid-sha)
      :source (if commit-is-invalid? valid-sha (nth invalid-shas which-invalid))}
     s2]))

(check-all "P2: record-land-approval! refuses and writes nothing when either sha is invalid"
  gen-p2
  (fn [{:keys [commit source]}]
    (let [dir (make-git-fixture-dir! "bl1405-p2-")]
      (try
        (let [result (land-step-lib/record-land-approval! {:root dir :commit commit :source source :task-ticket-id "BL-9009"})
              wrote-anything? (fs/exists? (fs/path dir ".swarmforge" "land-approvals"))]
          (cond
            (:ok? result) (str "expected a refusal for commit=" (pr-str commit) " source=" (pr-str source) ", got :ok? true")
            wrote-anything? "expected NOTHING written on refusal, but the land-approvals dir exists"
            :else true))
        (finally (fs/delete-tree dir))))))

;; ── generator coverage (asserted reachability floors) ─────────────────────

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(let [p1-inputs (sweep-coverage 31 gen-p1 identity)
      p2-inputs (sweep-coverage 31 gen-p2 identity)
      buckets {:p1-shared-commit-diff-source
               (count (filter (fn [{:keys [pairs]}]
                                 (some (fn [p1]
                                         (some #(and (not= (:idx p1) (:idx %)) (= (:commit p1) (:commit %)) (not= (:source p1) (:source %)))
                                               pairs))
                                       pairs))
                               p1-inputs))
               :p2-invalid-commit (count (filter #(nil? (land-approval-cli-lib/short (:commit %))) p2-inputs))
               :p2-invalid-source (count (filter #(nil? (land-approval-cli-lib/short (:source %))) p2-inputs))}
      floor (quot runs 10)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 31 buckets (str k " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1405 hand-built-land-records-approval properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
