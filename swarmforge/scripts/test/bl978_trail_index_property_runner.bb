#!/usr/bin/env bb
;; BL-978 property tests (coder-authored, declared invariants) over the
;; single-pass trail index behind dropped-parcel-items, against generated
;; mailbox trees on real files - never a re-statement of any decision rule.
;;
;;   Invariant 1: "One sweep reads each handoff file at most once: trail
;;   evidence is gathered in a single pass over the scan dirs and indexed
;;   by ticket id, so adding an active ticket adds no additional
;;   filesystem pass." Encoded by binding the *read-handoff-file*
;;   instrumentation seam to a counting wrapper: for every generated tree,
;;   (a) no file's read count exceeds 1 in one sweep, and (b) the TOTAL
;;   read count with 1 active item equals the total with all N generated
;;   items over the same tree - flat in the item count, by measurement.
;;
;;   Invariant 2: "The speed-up changes no decision: for any given tree
;;   the set of ticket ids nudged after the change is identical to the set
;;   the per-item scan produced - including the self-nudge exclusion and
;;   the never-a-false-freshness-signal rule." Encoded as REAL-vs-REAL:
;;   the reference set is computed from the still-present per-item
;;   primitives (collect-dispatched-ticket-ids + newest-trail-event-ms +
;;   decide-dropped-parcel?, the exact pre-change composition), the
;;   candidate set from the new dropped-parcel-items, per generated tree.
;;
;; Generator reach is BY CONSTRUCTION, not hoped-for: every tree draws
;; each active item one of seven shapes (stale trail / fresh trail / live
;; mail / no trail / unparseable-timestamp-only / recent-self-nudge-over-
;; stale-trail / stale-trail-plus-unparseable-file, with a task-vs-message
;; ref draw on each), files land in new, in_process, completed, sent,
;; outbox AND batch_* subdirectories, and per-shape reach floors below
;; assert each shape actually occurred across the run set.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored.
;; TWO of the three breaks survived their first run and forced a stronger
;; encoding - recorded because the misses are the lesson:
;;   - self-nudge exclusion dropped from the index -> invariant 2 failed
;;     (the recent-self-nudge shape's candidate vanished from the new set);
;;   - unparseable timestamps read as fresh (far-future fallback in the
;;     index) -> SURVIVED the first run: unparseable-ONLY cannot see it
;;     (both sides agree on not-a-candidate - nil fails closed, future
;;     reads fresh). The :stale-plus-unparseable shape was ADDED as the
;;     detector; the break then failed invariant 2 on every tree drawing
;;     it (the stale candidate vanished);
;;   - a second evidence pass reintroduced (dropped-parcel-items also
;;     calling newest-trail-event-ms per item) -> SURVIVED the first run:
;;     the seam then wrapped only the index's own reads, so old-path reads
;;     were invisible to the counter. *read-handoff-file* was MOVED down
;;     to read-header-field (every sweep read now flows through it); the
;;     break then failed invariant 1 (files read 5-9x in one sweep).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 30))
(def failures (atom []))
(def coverage (atom {:stale 0 :fresh 0 :live 0 :no-trail 0 :unparseable 0 :self-nudge 0 :stale-plus-unparseable 0 :batch 0 :nonempty-candidates 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(def now-ms (.toEpochMilli (java.time.Instant/parse "2026-08-20T12:00:00Z")))
(def stall-ms (* 45 60 1000))

(defn- iso [ms] (str (java.time.Instant/ofEpochMilli ms)))

(def stale-at (iso (- now-ms (* 3 stall-ms))))
(def fresh-at (iso (- now-ms 60000)))

(defn- write-handoff! [dir name lines]
  (fs/create-dirs dir)
  (spit (str (fs/path dir name)) (str (str/join "\n" lines) "\n\nbody\n")))

;; :stale-plus-unparseable is the never-a-false-freshness detector: a
;; STALE parseable trail plus an unparseable file. The reference nudges it
;; (newest = the stale event); an index that lets an unparseable file read
;; as fresh un-nudges it. Unparseable-ONLY cannot detect that break - both
;; sides agree on not-a-candidate there (nil fails closed vs future-fresh)
;; - so the colliding shape is drawn by construction, per BL-654.
(def shapes [:stale :fresh :live :no-trail :unparseable :self-nudge :stale-plus-unparseable])

(defn- gen-tree!
  "Builds one fixture tree under root: active items (each with a drawn
   shape) plus their handoff files across role dirs and batch_* subdirs.
   Returns {:active-dir .. :all-dirs [..] :live-dirs [..] :items [{:id ..
   :shape ..}] :s <seed>}."
  [root s]
  (let [active-dir (str (fs/path root "backlog" "active"))
        mk (fn [role kind] (str (fs/path root role kind)))
        roles ["coder" "QA" "coordinator"]
        all-dirs (vec (for [r roles, k ["new" "in_process" "completed" "sent" "outbox"]] (mk r k)))
        live-dirs (vec (for [r roles, k ["new" "in_process"]] (mk r k)))
        [n-items s1] (gen-int s 4)
        n-items (+ 2 n-items)]
    (fs/create-dirs active-dir)
    (doseq [d all-dirs] (fs/create-dirs d))
    (loop [i 0 items [] sx s1]
      (if (= i n-items)
        {:active-dir active-dir :all-dirs all-dirs :live-dirs live-dirs :items items :s sx}
        (let [id (str "BL-" (+ 300 i))
              [shape-n sy] (gen-int sx (count shapes))
              shape (nth shapes shape-n)
              [ref-n sz] (gen-int sy 2)
              ref-lines (fn [] (if (zero? ref-n)
                                 [(str "task: " id "-slice")]
                                 [(str "message: " id " needs work")]))
              [batch-n sw] (gen-int sz 3)
              archive-dir (if (zero? batch-n)
                            (str (fs/path (mk "QA" "completed") "batch_x"))
                            (mk "coordinator" "sent"))
              _ (when (zero? batch-n) (swap! coverage update :batch inc))
              _ (spit (str (fs/path active-dir (str id ".yaml")))
                      (str "id: " id "\nassigned_to: coder\n"))]
          (case shape
            :stale (write-handoff! archive-dir (str "a-" id ".handoff")
                                   (conj (ref-lines) (str "enqueued_at: " stale-at)))
            :fresh (write-handoff! archive-dir (str "a-" id ".handoff")
                                   (conj (ref-lines) (str "enqueued_at: " fresh-at)))
            :live (do (write-handoff! archive-dir (str "a-" id ".handoff")
                                      (conj (ref-lines) (str "enqueued_at: " stale-at)))
                      (write-handoff! (mk "coder" "new") (str "l-" id ".handoff")
                                      (conj (ref-lines) (str "enqueued_at: " fresh-at))))
            :no-trail nil
            :unparseable (write-handoff! archive-dir (str "a-" id ".handoff")
                                         (conj (ref-lines) "enqueued_at: not-a-time"))
            :self-nudge (do (write-handoff! archive-dir (str "a-" id ".handoff")
                                            (conj (ref-lines) (str "enqueued_at: " stale-at)))
                            (write-handoff! (mk "coordinator" "sent") (str "n-" id ".handoff")
                                            [(str "message: " (chase-sweep-lib/dropped-parcel-note-message id))
                                             (str "enqueued_at: " fresh-at)]))
            :stale-plus-unparseable
            (do (write-handoff! archive-dir (str "a-" id ".handoff")
                                (conj (ref-lines) (str "enqueued_at: " stale-at)))
                (write-handoff! (mk "coder" "completed") (str "u-" id ".handoff")
                                (conj (ref-lines) "enqueued_at: not-a-time"))))
          (swap! coverage update (case shape :stale :stale :fresh :fresh :live :live
                                        :no-trail :no-trail :unparseable :unparseable :self-nudge :self-nudge
                                        :stale-plus-unparseable :stale-plus-unparseable) inc)
          (recur (inc i) (conj items {:id id :shape shape}) sw))))))

(defn- reference-candidate-ids
  "The exact PRE-change per-item composition, from the still-present
   primitives - the oracle for invariant 2."
  [{:keys [active-dir all-dirs live-dirs]}]
  (let [items (chase-sweep-lib/read-active-items active-dir)
        dispatched (chase-sweep-lib/collect-dispatched-ticket-ids all-dirs)
        live (chase-sweep-lib/collect-dispatched-ticket-ids live-dirs)]
    (set (keep (fn [item]
                 (when (chase-sweep-lib/decide-dropped-parcel?
                        {:has-trail? (contains? dispatched (:id item))
                         :live-mail? (contains? live (:id item))
                         :newest-trail-ms (chase-sweep-lib/newest-trail-event-ms (:id item) all-dirs)}
                        now-ms stall-ms)
                   (:id item)))
               items))))

(defn- counted-sweep
  "Runs the NEW dropped-parcel-items with *read-handoff-file* counting
   every read. Returns {:ids #{..} :reads {path n}}."
  [{:keys [active-dir all-dirs live-dirs]}]
  (let [reads (atom {})]
    (binding [chase-sweep-lib/*read-handoff-file*
              (fn [p] (swap! reads update (str p) (fnil inc 0)) (slurp p))]
      (let [ids (set (map :id (chase-sweep-lib/dropped-parcel-items active-dir all-dirs live-dirs now-ms stall-ms)))]
        {:ids ids :reads @reads}))))

(defn- run-case [root s]
  (let [tree (gen-tree! root s)
        {:keys [ids reads]} (counted-sweep tree)
        reference (reference-candidate-ids tree)
        multi-read (into {} (filter (fn [[_ n]] (> n 1)) reads))
        total-reads (reduce + 0 (vals reads))
        ;; invariant 1 surface (b): the same tree swept with only ONE
        ;; active item must cost exactly the same number of file reads.
        one-item-dir (str (fs/path root "backlog" "active-one"))
        _ (fs/create-dirs one-item-dir)
        _ (spit (str (fs/path one-item-dir "BL-300.yaml")) "id: BL-300\nassigned_to: coder\n")
        {reads-one :reads} (counted-sweep (assoc tree :active-dir one-item-dir))
        total-reads-one (reduce + 0 (vals reads-one))]
    (when (seq ids) (swap! coverage update :nonempty-candidates inc))
    (cond
      (seq multi-read)
      (str "invariant 1: files read more than once in one sweep: " (pr-str multi-read))

      (not= total-reads total-reads-one)
      (str "invariant 1: read count varies with active-item count: " total-reads " vs " total-reads-one " (1 item)")

      (not= ids reference)
      (str "invariant 2: candidate set diverged - new " (pr-str ids) " vs per-item reference " (pr-str reference)
           " for shapes " (pr-str (map (juxt :id :shape) (:items tree))))

      :else true)))

(loop [i 0 s 11]
  (when (< i runs)
    (let [root (str (fs/create-temp-dir {:prefix "bl978-prop-"}))
          [_ s'] (gen-int s 1000)
          result (try (run-case root s) (finally (fs/delete-tree root)))]
      (when-not (true? result)
        (swap! failures conj (str "FAIL BL-978 (run " i "): " result)))
      (recur (inc i) s'))))

(let [floors {:stale 5 :fresh 5 :live 5 :no-trail 5 :unparseable 5 :self-nudge 5 :stale-plus-unparseable 5 :batch 5 :nonempty-candidates 5}]
  (doseq [[k floor] floors]
    (let [v (get @coverage k 0)]
      (when (< v floor)
        (swap! failures conj (str "FAIL generator coverage: " k " reached only " v " (floor " floor ")"))))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl978 trail-index properties: " runs " runs, real files, real index vs the real per-item composition"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
