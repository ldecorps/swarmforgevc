#!/usr/bin/env bb
;; BL-963 property tests (coder-authored, declared invariants) over the
;; open-slot nudge's gate-chain eligibility in chase_sweep_lib.bb, composed
;; with the REAL promotion_gates_lib evaluate chain and the REAL BL-798
;; escalation state machine - never a re-statement of any gate.
;;
;;   Invariant 1: "The open-slot nudge never names, counts toward its fire
;;   decision, or accrues escalation state on a candidate the
;;   promotion_gates evaluate chain refuses for any reason other than
;;   human_approval." Each draw builds a candidate set mixing allowed,
;;   approval-pending, and dependency-refused tickets (both flow- and
;;   block-style depends_on), computes eligibility through
;;   nudge-eligible-candidates, and asserts ALL THREE surfaces: a
;;   chain-refused candidate is absent from the eligible set, never the
;;   named top candidate, and never appears in the escalation state across
;;   three consecutive decide ticks. The refused-TOP-RANKED case - the
;;   false-escalation shape the ticket exists for - is drawn by
;;   CONSTRUCTION (the refused candidate is given the best rank) in a
;;   dedicated arm, never left to chance.
;;
;;   Invariant 2: "A candidate whose only refusal is human_approval remains
;;   nudge-eligible and is named flagged awaiting approval." Draws where the
;;   best eligible candidate is approval-pending assert it survives the
;;   filter, is named with :approved? false, and the nudge message carries
;;   the awaiting-approval flag (BL-798 scenario 03 preserved).
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - nudge-eligible-candidates made an identity pass-through (the pre-fix
;;     behavior) -> failed 35/40 runs (refused candidates surviving the
;;     filter, being named, and accruing state);
;;   - the human_approval exception dropped (every refusal filters) ->
;;     failed 24/40 runs on invariant 2's survival assertion (that surface
;;     was ADDED when the first cut of this break showed 0 direct failures
;;     - only a coverage floor caught it, which is not an encoding).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))
(def coverage (atom {:refused-top 0 :approval-named 0 :all-refused 0 :mixed 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- ticket-yaml [{:keys [id priority approval deps deps-style]}]
  (str "id: " id "\n"
       "title: \"generated\"\n"
       "type: feature\n"
       "priority: " priority "\n"
       "human_approval: " approval "\n"
       (case deps-style
         :flow (str "depends_on: [" (str/join ", " deps) "]\n")
         :block (if (seq deps)
                  (str "depends_on:\n" (str/join "" (map #(str "  - " % "\n") deps)))
                  "depends_on: []\n")
         "")))

(def done-id "BL-9001")

(defn- gen-candidate [s i kind]
  ;; kind: :allowed | :approval | :dep-refused
  (let [[prio s1] (gen-int s 80)
        [style-n s2] (gen-int s1 2)
        style (if (zero? style-n) :flow :block)]
    [{:file (str "bl963-gen-" i ".yaml")
      :kind kind
      :id (str "BL-" (+ 100 i))
      :content (ticket-yaml
                {:id (str "BL-" (+ 100 i))
                 :priority (+ 10 prio)
                 :approval (if (= kind :approval) "pending" "approved")
                 :deps (case kind :dep-refused ["BL-8888"] :allowed [done-id] [])
                 :deps-style style})}
     s2]))

(defn- gen-case [s]
  (let [[arm s1] (gen-int s 3)          ; 0 refused-top, 1 all-refused, 2 mixed
        [n s2] (gen-int s1 4)
        n-candidates (+ 2 n)]
    (loop [i 0 acc [] sx s2]
      (if (= i n-candidates)
        [{:arm (nth [:refused-top :all-refused :mixed] arm) :candidates acc} sx]
        (let [[kind sy] (case (nth [:refused-top :all-refused :mixed] arm)
                          ;; refused-top: candidate 0 is the dep-refused one
                          ;; and gets the BEST rank below; others mixed
                          :refused-top (if (zero? i)
                                         [:dep-refused sx]
                                         (let [[k sz] (gen-int sx 2)]
                                           [(if (zero? k) :allowed :approval) sz]))
                          :all-refused [:dep-refused sx]
                          :mixed (let [[k sz] (gen-int sx 3)]
                                   [(nth [:allowed :approval :dep-refused] k) sz]))
              [cand sz2] (gen-candidate sy i kind)
              ;; refused-top: force the refused candidate to the best rank
              ;; (LOWEST priority number ranks first)
              cand (if (and (= i 0) (str/includes? (:content cand) "BL-8888"))
                     (update cand :content #(str/replace % #"priority: \d+" "priority: 1"))
                     cand)]
          (recur (inc i) (conj acc cand) sz2))))))

(def evaluate-ctx
  {:active-count 1 :max-depth 3 :active-epics nil :done-ids #{done-id}})

(defn- run-case [{:keys [arm candidates]}]
  (let [eligible (chase-sweep-lib/nudge-eligible-candidates candidates evaluate-ctx)
        eligible-files (set (map :file eligible))
        refused (filter #(= :dep-refused (:kind %)) candidates)
        named (chase-sweep-lib/top-open-slot-candidate eligible)
        ;; three consecutive nudge-worthy ticks over the REAL machine
        states (loop [k 0 prev nil acc []]
                 (if (= k 3)
                   acc
                   (let [{:keys [state]} (chase-sweep-lib/decide-open-slot-escalation prev (:id named) 3)]
                     (recur (inc k) state (conj acc state)))))
        refused-ids (set (map :id refused))
        state-ids (set (keep :candidate-id states))]
    (swap! coverage #(cond-> %
                       (= arm :refused-top) (update :refused-top inc)
                       (= arm :all-refused) (update :all-refused inc)
                       (= arm :mixed) (update :mixed inc)
                       (and named (not (:approved? named))) (update :approval-named inc)))
    (cond
      ;; invariant 1, surface 1: refused candidates never in the eligible set
      (some eligible-files (map :file refused))
      (str "a chain-refused candidate survived the filter: " (pr-str (map :file refused)))

      ;; invariant 1, surface 2: never named
      (and named (contains? refused-ids (:id named)))
      (str "a chain-refused candidate was NAMED: " (pr-str named))

      ;; invariant 1, surface 3: never accrues escalation state
      (seq (clojure.set/intersection refused-ids state-ids))
      (str "a chain-refused candidate accrued escalation state: " (pr-str state-ids))

      ;; fire decision: all-refused means zero eligible, so no nudge fires
      (and (= arm :all-refused)
           (chase-sweep-lib/decide-open-slot-nudge? 1 3 (count eligible) {}))
      "every candidate is gate-refused yet the nudge still fires"

      ;; invariant 2, surface 1: an approval-only refusal never filters -
      ;; every approval-pending candidate survives into the eligible set
      (seq (clojure.set/difference
            (set (map :id (filter #(= :approval (:kind %)) candidates)))
            (set (map :id eligible))))
      (str "an approval-pending candidate was filtered out of the eligible set: "
           (pr-str (map :id (filter #(= :approval (:kind %)) candidates))))

      ;; invariant 2, surface 2: an approval-pending candidate that ranks
      ;; best among the eligible is named, unapproved, and message-flagged
      (and named (not (:approved? named))
           (not (str/includes? (chase-sweep-lib/open-slot-nudge-message named) "awaiting approval")))
      (str "an approval-pending named candidate lost its awaiting-approval flag: " (pr-str named))

      ;; soundness: whoever is named came from the eligible set
      (and named (not (contains? (set (map :id eligible)) (:id named))))
      (str "the named candidate is not from the eligible set: " (pr-str named))

      :else true)))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[input s'] (gen-case s)
          result (run-case input)]
      (when-not (true? result)
        (swap! failures conj (str "FAIL BL-963 invariants\n  input: " (pr-str (map (juxt :file :kind) (:candidates input))) "\n  " result)))
      (recur (inc i) s'))))

(let [{:keys [refused-top approval-named all-refused mixed]} @coverage]
  (doseq [[k v] {:refused-top refused-top :approval-named approval-named
                 :all-refused all-refused :mixed mixed}]
    (when (< v 5)
      (swap! failures conj (str "FAIL generator coverage: " k " reached only " v " of " runs " runs (floor 5)")))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl963 nudge gate-chain properties: " runs " runs through the real evaluate chain and escalation machine"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
