#!/usr/bin/env bb
;; BL-813 coder pass (BL-654 Invariants): PROPERTY test over ambulance_lib.bb
;; encoding the ticket's 2nd declared invariant verbatim:
;;
;;   "ticket-has-file? never throws on a vanished glob entry; ambulance
;;    degrade-to-off remains the failure mode."
;;
;; Simulates the real race (fs/glob lists a path, the file is gone by the
;; time this code slurps it - the live incident's own root cause, BL-812
;; promoted active/ -> done/ mid-poll) deterministically: with-redefs on
;; babashka.fs/glob calls the REAL glob first to get real matches, then
;; deletes whichever of those matched files this run has flagged to vanish,
;; THEN returns the (now-stale) match list - reproducing exactly "glob saw
;; it, slurp won't" without a real background thread or timing-dependent
;; flakiness.
;;
;;   P1 ticket-has-file? itself: never throws, and degrades to false only
;;      for the specific (ticket, dir) pairs flagged to vanish - a
;;      surviving non-vanishing copy of the same ticket elsewhere under
;;      backlog/ still returns true (partial-vanish robustness).
;;   P2 the same race through the full read path (read-ambulance-state),
;;      when the marker's ONLY ticket file vanishes - proving the fix
;;      propagates to the actual production reader, not just the raw
;;      predicate.
;;
;; Same seeded-LCG convention as ambulance_lib_property_runner.bb. See that
;; file's header for the Babashka-property-tooling-gap note (BL-472) this
;; one shares.
;;
;; Non-vacuity proven by hand at authoring time: both properties threw
;; FileNotFoundException (not a soft assertion failure - a hard crash,
;; matching the live incident) when ticket-has-file?'s try/catch was
;; temporarily removed. Restored to the adopted fix before this commit.

(ns bl813-ambulance-vanish-safety-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ambulance_lib.bb")))

;; Captured BEFORE any with-redefs below ever runs, so the redefinitions can
;; call the real implementation without recursing into themselves.
(def real-glob fs/glob)

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl813-ambulance-vanish-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-ticket! [root subdir ticket-id]
  (fs/create-dirs (fs/path root "backlog" subdir))
  (spit (str (fs/path root "backlog" subdir (str ticket-id "-demo.yaml")))
        (str "id: " ticket-id "\ntitle: \"demo\"\nstatus: " subdir "\n")))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 99]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; Small alphabet so a query ticket often DOES and often DOESN'T match a
;; generated candidate - the recorded generator-weighting lesson (a wide
;; alphabet makes the interesting collision case rare while looking green).
(def tickets ["BL-100" "BL-101"])
(def subdirs ["active" "hold"])

;; ── P1: ticket-has-file? itself never throws, degrades only for the
;;        flagged-to-vanish (ticket, dir) pairs ──────────────────────────

(defn gen-candidate [s]
  (let [[ticket s1] (gen-pick s tickets)
        [subdir s2] (gen-pick s1 subdirs)
        [vanish? s3] (gen-bool s2)]
    [{:ticket ticket :subdir subdir :vanish? vanish?} s3]))

(defn gen-scenario [s]
  (let [[n s1] (gen-int s 4) ; 0..3 candidates
        [candidates s2] (reduce (fn [[acc sx] _]
                                   (let [[c sy] (gen-candidate sx)] [(conj acc c) sy]))
                                 [[] s1] (range n))
        [query s3] (gen-pick s2 tickets)]
    [{:candidates candidates :query query} s3]))

(defn dedupe-candidates
  "Last write wins for a repeated (ticket, subdir) pair - matches real fs
   behavior (write-ticket! overwrites the same file path)."
  [candidates]
  (reduce (fn [acc {:keys [ticket subdir vanish?]}] (assoc acc [ticket subdir] vanish?))
          {} candidates))

(defn vanish-glob-redef
  "Lists real matches, deletes every one whose (ticket, subdir) is flagged
   to vanish in `deduped`, then returns the now-stale match list - the exact
   glob-saw-it-slurp-won't race this ticket hardens against."
  [deduped]
  (fn [dir pattern]
    (let [matches (real-glob dir pattern)]
      (doseq [p matches
              :let [fname (str (fs/file-name p))
                    parent-name (str (fs/file-name (fs/parent p)))]
              [[ticket subdir] vanish?] deduped
              :when (and vanish? (= fname (str ticket "-demo.yaml")) (= parent-name subdir))]
        (fs/delete-if-exists p))
      matches)))

(check-all "P1 ticket-has-file? never throws on a glob-then-vanish race and degrades only for vanished entries" gen-scenario
  (fn [{:keys [candidates query]}]
    (let [root (mk-tmp)
          deduped (dedupe-candidates candidates)]
      (doseq [[[ticket subdir] _] deduped] (write-ticket! root subdir ticket))
      (with-redefs [fs/glob (vanish-glob-redef deduped)]
        (let [result (try (ambulance-lib/ticket-has-file? root query) (catch Exception e [:threw (.getMessage e)]))
              expected (boolean (some (fn [[[ticket _subdir] vanish?]] (and (= ticket query) (not vanish?))) deduped))]
          (cond
            (vector? result) (str "ticket-has-file? THREW: " (second result))
            (not= result expected) (str "expected " expected " got " result " deduped=" (pr-str deduped))
            :else true))))))

;; ── P2: the same race through the full production read path ─────────────
;; The marker names the ONLY ticket file present, and it vanishes mid-race -
;; read-ambulance-state must degrade to {:active false}, never throw.

(defn gen-single-vanish [s]
  (let [[ticket s1] (gen-pick s tickets)
        [subdir s2] (gen-pick s1 subdirs)]
    [{:ticket ticket :subdir subdir} s2]))

(check-all "P2 read-ambulance-state degrades to inactive (never throws) when the marker's only ticket file vanishes mid-race" gen-single-vanish
  (fn [{:keys [ticket subdir]}]
    (let [root (mk-tmp)]
      (write-ticket! root subdir ticket)
      (ambulance-lib/engage! root ticket "test")
      (with-redefs [fs/glob (vanish-glob-redef {[ticket subdir] true})]
        (let [result (try (ambulance-lib/read-ambulance-state root) (catch Exception e [:threw (.getMessage e)]))]
          (cond
            (vector? result) (str "read-ambulance-state THREW: " (second result))
            (not= {:active false} result) (str "expected degrade-to-inactive, got " (pr-str result))
            :else true))))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl813 ambulance-vanish-safety properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
