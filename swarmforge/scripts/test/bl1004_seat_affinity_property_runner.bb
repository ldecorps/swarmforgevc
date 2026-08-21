#!/usr/bin/env bb
;; BL-1004 declared invariants, coder-first (BL-654). Generative sweep over
;; the PURE claim decision (seat_affinity_lib.bb) - the layer every wiring
;; path funnels through - plus the invariant-2 diagnostic renderers. The
;; end-to-end wiring of the same decision through the real
;; ready_for_next_task.bb is the BL-1004 acceptance feature (five
;; scenarios); BL-983's own property runner keeps covering the claim
;; race/dedup mechanics this decision sits inside.
;;
;;   Invariant 1 (a deferral is always bounded): a :defer decision REQUIRES
;;     a parseable age strictly below the deadline. Age at/past the
;;     deadline, and age no header parses, must both claim - a parcel whose
;;     clock cannot be read must never wait on this decision forever.
;;   Invariant 2 (seat identity never escapes the mailbox layer): the
;;     diagnostic renderers RECEIVE the sibling seat ids (naming "the seat
;;     that worked it" is the obvious temptation) and must never render one,
;;     nor any '@' seat syntax at all.
;;   Invariant 3 (a single-seat stage is behaviourally identical): with an
;;     empty sibling task set the decision is :claim for EVERY input, so
;;     the deferral path is unreachable exactly when a stage has one seat.
;;
;; Generator reach: draws are CONSTRUCTED per shape (sibling-collision by
;; deriving the sibling set from the drawn task, ages derived from the
;; drawn deadline), never hoped for - the floors below are absolute.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "seat_affinity_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def seed (or (some-> (System/getenv "PROPERTY_SEED") parse-long) (System/nanoTime)))
(def rng (java.util.Random. seed))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def failures (atom []))
(def coverage (atom {:defer 0 :cross-seat-aged 0 :cross-seat-unreadable 0
                     :self-affinity 0 :empty-sibling 0 :non-handoff 0}))
(defn fail! [msg] (swap! failures conj msg))

(def task-pool ["BL-901" "BL-902-rework" "BL-903" "BL-1004-x" "T-9"])
(def seat-pool ["coder@sonnet2" "coder@extra" "hardender@zz9" "cleaner@b"])

(defn iso [ms] (str (java.time.Instant/ofEpochMilli ms)))

(defn draw []
  (let [task (rand-nth* task-pool)
        deadline-ms (+ 60000 (rand-int* 3600000))
        now-ms (+ 1700000000000 (rand-int* 100000000))
        ;; shape first, inputs derived from it - reach by construction
        shape (rand-nth* [:defer :cross-seat-aged :cross-seat-unreadable
                          :self-affinity :empty-sibling :non-handoff])
        ;; a colliding sibling set is DERIVED from the drawn task (the
        ;; transformation the code could conflate), never drawn
        ;; independently
        colliding (conj (set (take (rand-int* 3) task-pool)) task)
        age-below (rand-int* deadline-ms)
        age-at-or-past (+ deadline-ms (rand-int* deadline-ms))
        base {:type "git_handoff"
              :task task
              :sibling-tasks colliding
              :my-tasks #{}
              :enqueued-at nil
              :created-at nil
              :now-ms now-ms
              :deadline-ms deadline-ms}
        input (case shape
                :defer (assoc base
                              (rand-nth* [:enqueued-at :created-at])
                              (iso (- now-ms age-below)))
                :cross-seat-aged (assoc base
                                        (rand-nth* [:enqueued-at :created-at])
                                        (iso (- now-ms age-at-or-past)))
                :cross-seat-unreadable (assoc base
                                              :enqueued-at (rand-nth* [nil "" "not-a-time" "2026-13-99T99:99:99Z"])
                                              :created-at (rand-nth* [nil "" "soon"]))
                :self-affinity (assoc base
                                      :my-tasks (conj (set (take (rand-int* 2) task-pool)) task)
                                      (rand-nth* [:enqueued-at :created-at]) (iso (- now-ms age-below)))
                :empty-sibling (assoc base
                                      :sibling-tasks #{}
                                      (rand-nth* [:enqueued-at :created-at])
                                      (iso (- now-ms (rand-nth* [age-below age-at-or-past]))))
                :non-handoff (assoc base :type (rand-nth* ["note" "awake" "rule_proposal"])))]
    {:shape shape :input input}))

(defn age-of [{:keys [enqueued-at created-at now-ms]}]
  (when-let [t (or (seat-affinity-lib/parse-instant-ms enqueued-at)
                   (seat-affinity-lib/parse-instant-ms created-at))]
    (- now-ms t)))

(dotimes [i runs]
  (let [{:keys [shape input]} (draw)
        decision (seat-affinity-lib/rework-claim-decision input)
        age (age-of input)]
    ;; determinism: the decision is a pure value
    (when (not= decision (seat-affinity-lib/rework-claim-decision input))
      (fail! (str "draw " i ": decision is not deterministic for " (pr-str input))))
    ;; invariant 1: every :defer has a KNOWN age strictly below the deadline
    (when (= :defer (:action decision))
      (when (nil? age)
        (fail! (str "draw " i ": deferred with no readable age - unbounded wait: " (pr-str input))))
      (when (and age (>= age (:deadline-ms input)))
        (fail! (str "draw " i ": deferred at/past the deadline: " (pr-str input)))))
    ;; invariant 1, contrapositive: unreadable or expired age never defers
    (when (and (or (nil? age) (>= age (:deadline-ms input)))
               (= :defer (:action decision)))
      (fail! (str "draw " i ": bounded-deferral breach: " (pr-str input))))
    ;; invariant 3: empty sibling set claims, whatever else is true
    (when (and (empty? (:sibling-tasks input))
               (not= {:action :claim} decision))
      (fail! (str "draw " i ": single-seat stage decided " (pr-str decision) " for " (pr-str input))))
    ;; self-affinity: a seat that worked the task itself always claims
    (when (and (contains? (:my-tasks input) (:task input))
               (not= {:action :claim} decision))
      (fail! (str "draw " i ": self-worked task not claimed: " (pr-str input))))
    ;; only a git_handoff is ever deferred or cross-seat flagged
    (when (and (not= "git_handoff" (:type input))
               (not= {:action :claim} decision))
      (fail! (str "draw " i ": non-git_handoff decided " (pr-str decision))))
    ;; invariant 2: renderers receive seat ids and never leak one
    (let [render-in {:basename (str "50_x_from_hardender_to_coder_" i ".handoff")
                     :task (:task input)
                     :sibling-seats seat-pool}]
      (doseq [line [(seat-affinity-lib/deferral-line render-in)
                    (seat-affinity-lib/cross-seat-claim-line render-in)]]
        (when (str/includes? line "@")
          (fail! (str "draw " i ": seat syntax leaked into a diagnostic line: " line)))
        (doseq [seat seat-pool]
          (when (str/includes? line seat)
            (fail! (str "draw " i ": seat id " seat " leaked into a diagnostic line: " line))))))
    ;; coverage bookkeeping, keyed by the OBSERVED decision so a generator
    ;; drift that stops reaching a branch fails the floor, not just the shape
    (case (:action decision)
      :defer (swap! coverage update :defer inc)
      :claim-cross-seat (swap! coverage update (if (nil? age) :cross-seat-unreadable :cross-seat-aged) inc)
      :claim (cond
               (not= "git_handoff" (:type input)) (swap! coverage update :non-handoff inc)
               (empty? (:sibling-tasks input)) (swap! coverage update :empty-sibling inc)
               (contains? (:my-tasks input) (:task input)) (swap! coverage update :self-affinity inc)
               :else nil))))

;; Reach floors are ABSOLUTE (never scaled to PROPERTY_RUNS): each shape is
;; drawn ~1/6 of 400 by construction, so 20 is far below expectation and
;; still proves the branch is genuinely exercised.
(doseq [[k floor] {:defer 20 :cross-seat-aged 20 :cross-seat-unreadable 20
                   :self-affinity 20 :empty-sibling 20 :non-handoff 20}]
  (when (< (get @coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k)
                " of " runs " (floor " floor ")"))))

(println (str "  seed " seed " runs " runs " coverage " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl1004 seat-affinity properties: " runs " draws over the pure claim decision"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
