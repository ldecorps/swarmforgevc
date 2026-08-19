#!/usr/bin/env bb
;; BL-685 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY test over babysitterd_sweep_lib.bb's
;; check-resident-stranded, encoding the executable core of the ticket's
;; declared invariant: "Detection never depends on the stranded resident
;; having done anything - every signal the check reads is observable from
;; outside the resident's own turn."
;;
;; The invariant's WHICH-INPUTS half ("pane state, the active-role file,
;; mailbox contents on disk") quantifies over what the GATHERER reads - a
;; wiring/inspection claim (qa_e2e_procedure step 6 verifies it by
;; inspection, and the acceptance suite's wrong-wiring mutant - role read
;; via gather-rotate-note - proves the sharpest violation is caught).
;; What IS encodable over generated inputs is the pure check's whole truth
;; table: it fires iff EVERY firing condition holds and NO suppressor does,
;; across the full combination space - so no future edit can make it fire
;; on an input combination that requires the resident's cooperation
;; (a busy pane, held work, a sent dispatch note are each the resident
;; DOING something; the stranded shape is their joint absence).
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (BL-472's Babashka property-tooling gap). expected-fire? below is a
;; fresh statement of the ticket's own five-conditions-plus-topology text,
;; not a copy of the implementation's conjunction.
;;
;; Non-vacuity proven by hand at authoring time: deleting the
;; (not resident-pane-busy?) conjunct from check-resident-stranded fails
;; this property on its first busy-pane case; deleting the grace comparison
;; fails it on the first within-grace case. Both restored before landing.
;; Reachability floors are ASSERTED for the fire shape and for every
;; suppressor - never hoped for (the generator draws each axis
;; independently, so every combination has real density).

(ns bl685-resident-stranded-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitterd_sweep_lib.bb")))
(require '[babysitterd-sweep-lib :as sw])

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 2000))
(def failures (atom []))

(def ^:private rng (java.util.Random. 685))
(defn- rpick [coll] (nth (vec coll) (.nextInt rng (count coll))))
(defn- rbool [] (.nextBoolean rng))

(def grace-min 10)
(def grace-ms (* grace-min 60000))

(defn gen-scenario []
  {:rotation-router? (rbool)
   :rotation-home (rpick ["coder" "QA"])
   :resident-active-role (rpick ["coder" "specifier" "QA" "qa" nil])
   :resident-active-role-mtime-ms (rpick [nil 0 (- 1000000 grace-ms -1000)]) ; nil, deep past, just-inside-grace
   :resident-pane-busy? (rbool)
   :resident-mailbox-empty? (rbool)
   :dispatch-note-pending? (rbool)
   :paused? (rbool)
   :now-ms 1000000
   :resident-stranded-grace-min grace-min})

(defn expected-fire?
  "Fresh restatement of the ticket's own firing signature: mono-router pack,
   not paused, resident in a NON-home role (case-insensitive), pane idle,
   mailbox empty, no dispatch note pending, and the idle state persisted
   past the grace period - with every unknowable input (no marker, no
   mtime) failing OPEN to silence."
  [{:keys [rotation-router? rotation-home resident-active-role
           resident-active-role-mtime-ms resident-pane-busy?
           resident-mailbox-empty? dispatch-note-pending? paused? now-ms]}]
  (and rotation-router?
       (not paused?)
       (some? resident-active-role)
       (some? rotation-home)
       (not= (str/lower-case (str resident-active-role))
             (str/lower-case (str rotation-home)))
       (false? resident-pane-busy?)
       (true? resident-mailbox-empty?)
       (false? dispatch-note-pending?)
       (some? resident-active-role-mtime-ms)
       (> (- now-ms resident-active-role-mtime-ms) grace-ms)))

(def fire-shapes-reached (atom 0))
(def suppressor-reached (atom {:home 0 :busy 0 :mailbox 0 :dispatch 0 :grace 0 :topology 0 :paused 0}))

(dotimes [_ runs]
  (let [s (gen-scenario)
        expected (boolean (expected-fire? s))
        actual (boolean (sw/check-resident-stranded s))]
    (when expected (swap! fire-shapes-reached inc))
    (when (and (:resident-active-role s) (:rotation-home s)
               (= (str/lower-case (str (:resident-active-role s)))
                  (str/lower-case (str (:rotation-home s)))))
      (swap! suppressor-reached update :home inc))
    (when (:resident-pane-busy? s) (swap! suppressor-reached update :busy inc))
    (when (false? (:resident-mailbox-empty? s)) (swap! suppressor-reached update :mailbox inc))
    (when (:dispatch-note-pending? s) (swap! suppressor-reached update :dispatch inc))
    (when (= (:resident-active-role-mtime-ms s) (- 1000000 grace-ms -1000))
      (swap! suppressor-reached update :grace inc))
    (when (false? (:rotation-router? s)) (swap! suppressor-reached update :topology inc))
    (when (:paused? s) (swap! suppressor-reached update :paused inc))
    (when (not= expected actual)
      (swap! failures conj
             (str "FAIL: expected fire=" expected " got " actual " for " (pr-str s))))))

(when (zero? @fire-shapes-reached)
  (swap! failures conj "FAIL reachability: the generator never produced the FIRE shape"))
(doseq [[k n] @suppressor-reached]
  (when (zero? n)
    (swap! failures conj (str "FAIL reachability: suppressor " k " never generated"))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println (str "bl685_resident_stranded_property_runner: ok (" runs " runs, "
                @fire-shapes-reached " fire shapes reached)")))
