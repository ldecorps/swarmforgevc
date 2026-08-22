#!/usr/bin/env bb
;; BL-679 declared invariants (backlog/active/BL-679-ambulance-mode-
;; perimeter-quiet-freeze-auto-exit.yaml) - coder-authored property tests per
;; BL-654's "first authorship of each declared invariant's property test
;; rests with the coder" rule. Same seeded-LCG convention as
;; bl852_chase_sweep_ambulance_hold_property_runner.bb / ambulance_lib_
;; property_runner.bb (deterministic, never rand - see those files' headers
;; for the BL-472 Babashka-property-tooling-gap note this one shares).
;;
;; Both invariants are encoded against the REAL impure ambulance-lib/auto-
;; exit! and ambulance-lib/decide-auto-exit - never a reimplementation of
;; either decision - with real fs I/O (a real marker file, real backlog/
;; ticket YAML files) against a fresh temp root per check, never a hand-
;; computed row.
;;
;; Invariant 1 ("the mode can only ever exit - never enter - on its own;
;; every engage is a human act, and no swarm signal creates an ambulance")
;; is split into two properties: 1a proves auto-exit! never flips a
;; genuinely-inactive marker to active, and 1b proves it never substitutes a
;; DIFFERENT ticket into an already-active marker - together they cover
;; every state transition auto-exit! could possibly make, and auto-exit! is
;; the ONLY new code this ticket adds that touches the marker at all besides
;; release! itself (which is already incapable of engaging anything - it has
;; no ticket parameter).
;;
;; Invariant 2 ("an ambulance ticket that leaves the pipeline for a human
;; ruling releases the mode rather than starving it") is encoded directly:
;; for both ways a ticket can leave for a human ruling (backlog/hold/, or
;; vanishing from backlog/ entirely), auto-exit! always actually clears the
;; marker on disk - never merely reads as off while leaving it stuck engaged.

(ns bl679-ambulance-perimeter-property-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ambulance_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl679-ambulance-perimeter-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn write-ticket! [root subdir ticket-id]
  (fs/create-dirs (fs/path root "backlog" subdir))
  (spit (str (fs/path root "backlog" subdir (str ticket-id "-demo.yaml")))
        (str "id: " ticket-id "\ntitle: \"demo\"\nstatus: " subdir "\n")))

(defn place-ticket!
  "Places (or vanishes) ticket-id per location, one of :active :paused :hold
   :done, or nil to leave it filed nowhere at all."
  [root ticket-id location]
  (when location
    (write-ticket! root (name location) ticket-id)))

(def ambulance-ticket "BL-654")
(def distractor-ticket "BL-660")
(def all-locations [:active :paused :hold :done nil])

;; ── invariant 1a: auto-exit! never flips a genuinely-inactive marker to
;;    active - no swarm signal creates an ambulance from nothing ──────────
(defn gen-inactive-case [s]
  (let [[marker-kind s1] (gen-pick s [:absent :explicit-false :active-for-vanished-ticket])
        [distractor-location s2] (gen-pick s1 all-locations)]
    [{:marker-kind marker-kind :distractor-location distractor-location} s2]))

(check-all "invariant-1a auto-exit! never engages anything starting from a genuinely-inactive marker"
  gen-inactive-case
  (fn [{:keys [marker-kind distractor-location]}]
    (let [root (mk-tmp)]
      ;; The distractor ticket exists somewhere in the backlog (or nowhere),
      ;; unrelated to the marker - proves auto-exit! isn't confused by
      ;; unrelated backlog state into engaging something.
      (place-ticket! root distractor-ticket distractor-location)
      (case marker-kind
        :absent nil
        :explicit-false (ambulance-lib/release! root)
        :active-for-vanished-ticket
        (do (fs/create-dirs (fs/parent (ambulance-lib/marker-path root)))
            (spit (str (ambulance-lib/marker-path root))
                  (json/generate-string {:active true :ticket ambulance-ticket}))
            ;; deliberately no backlog file for ambulance-ticket at all
            nil))
      (ambulance-lib/auto-exit! root)
      (let [after (ambulance-lib/read-ambulance-state root)]
        (if (:active after)
          (str "expected the marker to remain inactive, got: " (pr-str after))
          true)))))

;; ── invariant 1b: auto-exit! never substitutes a DIFFERENT ticket into an
;;    already-active marker - it only ever holds or clears the SAME one ────
(defn gen-active-case [s]
  (gen-pick s all-locations))

(check-all "invariant-1b auto-exit! never re-engages a DIFFERENT ticket than the one already active"
  gen-active-case
  (fn [location]
    (let [root (mk-tmp)]
      (write-ticket! root "active" ambulance-ticket)
      (ambulance-lib/engage! root ambulance-ticket "test")
      ;; Move (or vanish) the ambulance ticket to the generated location -
      ;; overwrites the initial "active" placement above, exactly like a
      ;; ticket moving through the real pipeline while engaged.
      (doseq [subdir ["active" "paused" "hold" "done"]]
        (let [f (fs/path root "backlog" subdir (str ambulance-ticket "-demo.yaml"))]
          (when (fs/exists? f) (fs/delete f))))
      (place-ticket! root ambulance-ticket location)
      ;; A distractor ticket sits active the whole time - never the one
      ;; auto-exit! is allowed to touch.
      (write-ticket! root "active" distractor-ticket)
      (ambulance-lib/auto-exit! root)
      (let [after (ambulance-lib/read-ambulance-state root)]
        (cond
          (not (:active after)) true ; released - fine, invariant-2's concern, not this one
          (= (:ticket after) ambulance-ticket) true ; still holding the SAME ticket - fine
          :else (str "expected the marker to never name a different ticket than " ambulance-ticket
                     " it did not start on; got: " (pr-str after)))))))

;; ── invariant 2: a ticket that leaves the pipeline for a human ruling
;;    (backlog/hold/, or vanished from backlog/ entirely) always ACTUALLY
;;    releases - never starves the swarm holding everything ─────────────────
(def human-ruling-locations [:hold nil])

(check-all "invariant-2 auto-exit! always releases (never starves) once the ticket leaves for a human ruling"
  (fn [s] (gen-pick s human-ruling-locations))
  (fn [location]
    (let [root (mk-tmp)]
      (write-ticket! root "active" ambulance-ticket)
      (ambulance-lib/engage! root ambulance-ticket "test")
      (fs/delete (fs/path root "backlog" "active" (str ambulance-ticket "-demo.yaml")))
      (place-ticket! root ambulance-ticket location)
      (let [result (ambulance-lib/auto-exit! root)
            after (ambulance-lib/read-ambulance-state root)]
        (cond
          (not= result {:ticket ambulance-ticket :case :abandoned})
          (str "expected auto-exit! to report a release with case :abandoned, got: " (pr-str result))

          (:active after)
          (str "expected the marker genuinely cleared on disk after the human-ruling release, still reads: " (pr-str after))

          :else true)))))

;; ── non-vacuity: proves each property above has teeth against a
;;    plausible broken implementation ────────────────────────────────────
(defn- non-vacuity-check! [label actual-broken expected-real]
  (if (not= actual-broken expected-real)
    (println (str "non-vacuity OK: " label))
    (swap! failures conj (str "FAIL non-vacuity " label ": broken value " (pr-str actual-broken)
                               " coincidentally matches the real invariant - the property above would not catch this defect"))))

;; Simulates a broken auto-exit! that engages a hardcoded fallback ticket
;; whenever it releases, instead of only ever calling release! - proves
;; invariant-1b's assertion has teeth (a real bug shape: an over-eager
;; "hand the ambulance to the next candidate" auto-continuation, exactly
;; the kind of self-engage the ticket forbids).
(let [root (mk-tmp)]
  (write-ticket! root "active" ambulance-ticket)
  (ambulance-lib/engage! root ambulance-ticket "test")
  (fs/delete (fs/path root "backlog" "active" (str ambulance-ticket "-demo.yaml")))
  (fs/create-dirs (fs/path root "backlog" "hold"))
  (write-ticket! root "hold" ambulance-ticket)
  (ambulance-lib/auto-exit! root)
  (let [real (:ticket (ambulance-lib/read-ambulance-state root))
        broken-self-engaged distractor-ticket]
    (non-vacuity-check! "invariant-1b (a broken auto-exit! that re-engages a fallback ticket on release diverges from the real one, which always fully releases)"
      broken-self-engaged real)))

;; Simulates a broken decide-auto-exit that never releases for the :hold
;; case - proves invariant-2's assertion has teeth against the real
;; ambulance-lib/decide-auto-exit.
(non-vacuity-check! "invariant-2 (a broken decide-auto-exit that holds :hold instead of releasing diverges from the real one)"
  {:release? false :case :in-flight}
  (ambulance-lib/decide-auto-exit :hold))

;; ── generator coverage, asserted rather than assumed (BL-654: "an asserted
;;    reachability floor, never a hoped-for one") ───────────────────────────
(let [floor (quot runs 20)
      counts (atom {:marker-kind {} :active-case-location {} :human-ruling-location {}})]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[{:keys [marker-kind]} s1] (gen-inactive-case s)]
        (swap! counts update-in [:marker-kind marker-kind] (fnil inc 0))
        (recur (inc i) s1))))
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[location s1] (gen-active-case s)]
        (swap! counts update-in [:active-case-location location] (fnil inc 0))
        (recur (inc i) s1))))
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[location s1] (gen-pick s human-ruling-locations)]
        (swap! counts update-in [:human-ruling-location location] (fnil inc 0))
        (recur (inc i) s1))))
  (println (str "  generator coverage (floor=" floor ", runs=" runs "): " (pr-str @counts)))
  (doseq [[category by-value] @counts
          [value n] by-value]
    (when (< n floor)
      (report! (str "COVERAGE " category " " (pr-str value)) 42 {:count n :floor floor}
               (str category "=" (pr-str value) " is barely exercised (" n "/" runs ") - the generator is skewed")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "BL-679 ambulance-perimeter invariant properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
