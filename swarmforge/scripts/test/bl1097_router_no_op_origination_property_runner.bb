#!/usr/bin/env bb
;; BL-1097 property test (coder-authored, TWO declared invariants) over the
;; router-side dispatch-trail surface in chase_sweep_lib.bb and its wiring into
;; route_backlog_to_coder.sh.
;;
;;   Invariant 1: "A router never originates a parcel whose cited commit
;;   already contains the finished work for that parcel's ticket - the no-op
;;   rule binds the sender, not only the forwarder."
;;
;;   Invariant 2: "The router and the daemon's dispatch-gap sweep agree on
;;   whether a ticket has been dispatched - two components must not hold
;;   contradictory answers to the same question."
;;
;; SCOPE OF INVARIANT 1's ENCODING, stated because it is narrower than the
;; sentence. "Already contains the finished work" is not decidable from a
;; commit: it quantifies over what a diff means. The ticket itself names the
;; decidable proxy the fix must use - the dispatch trail the daemon already
;; computes - and P1 below is that proxy stated exactly: the router refuses IF
;; AND ONLY IF a trail exists. The equivalence matters in both directions. One
;; way round is satisfied by a router that refuses everything, which would
;; starve the pipeline; the other by the shipped defect, which refused nothing.
;;
;; P1 is invariant 1 over a generated mailbox tree whose trail content is known
;; BY CONSTRUCTION, not re-derived from the code under test. The states it has
;; to reach are the ones a naive scan misses - a trail sitting only in
;; `completed`/`sent`/`outbox` rather than `inbox/new`, and a trail nested one
;; level down inside a `batch_*` subdirectory - so those are asserted
;; reachability floors below, not hoped for.
;;
;; P2 is invariant 2, and its generator draws COLLIDING PAIRS BY CONSTRUCTION
;; rather than two independent ids. Drawing decoys independently would make a
;; near-miss astronomically rare and the property would pass against a live
;; conflation. Every decoy here is DERIVED from the target by a transformation
;; the id extractor could plausibly conflate: case-folding, dropping the prefix
;; hyphen, gluing a letter in front (the BL-488 "ABL-217" shape), and extending
;; the digits (BL-9097 -> BL-90970). If router and sweep ever disagreed about
;; which of a derived pair a trail belongs to, this is where it shows.
;;
;; P3 and P4 are claims about the SOURCE TREE, and they are what make invariant
;; 2 durable rather than momentarily true. Invariant 2 is met here by having
;; exactly ONE predicate - ticket-dispatched? is decide-dispatch-gaps asked
;; about one ticket, and the trail directories are one list both components
;; read. A behavioural property cannot catch a refactor that splits them back
;; into two copies that happen to agree today, so P3 asserts the definition and
;; P4 asserts the router actually consults it. Without P4 the library could be
;; perfect and the router still emit the parcel.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-23), each break applied to the
;; real file and then restored, counts MEASURED at the defaults (seed 1097,
;; 200 runs). Every number below is a measured failure count, not an estimate:
;;
;;   break                                                    caught by
;;   ---------------------------------------------------------------------
;;   dispatch-trail-states narrowed to [:new] ............... P1  101
;;   (mapcat list-handoff-files-with-batches) -> the
;;     non-batch reader, dropping batch_* nesting ........... P1   22
;;   ticket-dispatched? rewritten as a bare
;;     (contains? dispatched-ids ticket-id) ................. P3    1
;;   handoffd's dispatch-gap-scan-dirs reverted to its own
;;     private state list instead of delegating ............. P3    1
;;   route_backlog_to_coder.sh's dispatch_trail_cli.bb call
;;     replaced by a hardcoded UNDISPATCHED ................. P4    1
;;
;; Two of those five are caught ONLY by a source claim, and that is the finding
;; worth carrying: the bare-contains? rewrite is behaviourally identical today,
;; because every id this swarm mints is already in canonical form, so P1 and P2
;; both stay green against it. It is still the second predicate invariant 2
;; forbids, and it would diverge the first time decide-dispatch-gaps learned a
;; nuance about ids. A behavioural property alone would have shipped it.
;;
;; Deleting ticket-dispatched? outright is not in the table because it does not
;; reach any property: the runner fails to load. That is a louder failure than
;; an assertion, not a quieter one.

(ns bl1097-router-no-op-origination-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def repo-root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*)))))))
(def scripts-dir (str (fs/path repo-root "swarmforge" "scripts")))
(load-file (str (fs/path scripts-dir "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def seed (or (some-> (System/getenv "PROPERTY_SEED") parse-long) 1097))
(def rng (java.util.Random. seed))
(def failures (atom []))
(def coverage (atom {:dispatched 0 :undispatched 0
                     :trail-only-outside-inbox-new 0
                     :trail-only-in-batch-subdir 0
                     :decoys-but-no-trail 0
                     :derived-collision-decoy 0
                     :multi-role-trail 0}))

(defn bump! [k] (swap! coverage update k inc))
(defn fail! [prop msg] (swap! failures conj (str "FAIL " prop ": " msg)))
(defn pick [coll] (nth coll (.nextInt rng (count coll))))
(defn chance [n] (< (.nextInt rng 100) n))

;; ── fixture temp roots ────────────────────────────────────────────────────
;; BL-971: swept by PREFIX before the run, not merely cleaned up after -
;; nothing traps SIGKILL, so a killed run would otherwise leave roots behind
;; for the next run to trip over. Removal after the run is in a shutdown hook
;; so it fires on a throw as well as a clean exit (BL-459/BL-1033).

(def fixture-prefix "bl1097-prop-")
(def tmp-parent (str (fs/path (System/getProperty "java.io.tmpdir"))))

(doseq [d (fs/glob tmp-parent (str fixture-prefix "*"))]
  (try (fs/delete-tree d) (catch Exception _ nil)))

(def created (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix fixture-prefix}))]
    (swap! created conj d)
    d))

;; ── generators ────────────────────────────────────────────────────────────

(def roles ["coder" "cleaner" "architect" "hardender" "documenter" "QA"])

(defn gen-ticket-id []
  (str "BL-" (+ 1000 (.nextInt rng 9000))))

;; Every decoy is DERIVED from the target, so each generated pair is a
;; collision candidate by construction. Two of these MUST resolve to the
;; target (case-fold, hyphen-drop) and two MUST NOT (glue, digit-extend) -
;; a conflation in either direction is a disagreement.
(defn derive-decoy [target]
  (let [[_ digits] (re-find #"BL-(\d+)" target)]
    (pick [{:text (str/lower-case target) :same? true  :kind :case-folded}
           {:text (str "BL" digits)       :same? true  :kind :hyphen-dropped}
           {:text (str "ABL-" digits)     :same? false :kind :prefix-glued}
           {:text (str "BL-" digits "0")  :same? false :kind :digit-extended}])))

(defn write-handoff! [dir filename headers]
  (fs/create-dirs dir)
  (spit (str (fs/path dir filename))
        (str (str/join "\n" (map (fn [[k v]] (str (name k) ": " v)) headers)) "\n\nbody\n")))

;; The test's OWN list of the states a sent parcel can be sitting in, stated
;; here independently of the library's. That independence is the point: trails
;; are PLACED across all five from this list and READ back through
;; chase-sweep-lib/dispatch-trail-dirs, so narrowing the library's list makes
;; the placements it dropped unfindable and P1 fails. If the test reused the
;; library's list, both sides would narrow together and the break would be
;; invisible - which is exactly how a scan-too-few-states defect survives.
(def trail-states [:new :in_process :completed :sent :outbox])

;; Real role-infos over real per-role worktree paths, resolved through the real
;; handoff-lib/mailbox-dir - the same BL-128 resolver production uses. A
;; hand-built path here would test a directory shape no live root has, which is
;; the mistake the ticket records an investigation making.
(defn role-infos [root]
  (vec (for [role roles]
         {:role role :worktree-name role :worktree-path (str (fs/path root role))})))

(defn state-dir [root role state]
  (handoff-lib/mailbox-dir {:role role :worktree-name role :worktree-path (str (fs/path root role))}
                           state))

(defn all-dirs [root]
  (chase-sweep-lib/dispatch-trail-dirs (role-infos root)))

(defn place-trail!
  "Writes one trail file referencing `text`, in a random role/state, sometimes
   nested one level inside a batch_* subdirectory. Returns the state used."
  [root text i]
  (let [role (pick roles)
        state (pick trail-states)
        base (state-dir root role state)
        batched? (chance 30)
        dir (if batched? (fs/path base (str "batch_20260823T00000" (mod i 10) "Z_01")) base)
        note? (chance 50)]
    (write-handoff! (str dir) (str "p" i "-" (.nextInt rng 100000) ".handoff")
                    (if note?
                      {:from "coordinator" :to role :type "note"
                       :message (str "Work " text ": read file in backlog/active")}
                      {:from "coordinator" :to role :type "git_handoff" :task (str text "-slice")}))
    {:role role :state state :batched? batched?}))

;; ── the run ───────────────────────────────────────────────────────────────

(dotimes [i runs]
  (let [root (mk-root)
        target (gen-ticket-id)
        dispatched? (chance 55)
        n-trails (if dispatched? (inc (.nextInt rng 3)) 0)
        n-decoys (.nextInt rng 4)
        placements (doall (for [k (range n-trails)] (place-trail! root target (+ (* i 10) k))))
        decoys (doall (for [k (range n-decoys)]
                        (let [d (derive-decoy target)]
                          (assoc d :placement (place-trail! root (:text d) (+ 500 (* i 10) k))))))
        ;; A decoy DERIVED from the target that resolves back to it is a trail
        ;; for the target, whatever it was meant to be. That is the collision
        ;; the pair generator exists to produce, and the expected answer has to
        ;; account for it or the property would assert the wrong thing.
        expected (boolean (or dispatched? (some :same? decoys)))
        dirs (all-dirs root)]

    (when (seq decoys) (bump! :derived-collision-decoy))
    (if expected (bump! :dispatched) (bump! :undispatched))
    (when (and (seq placements) (every? #(not= :new (:state %)) placements))
      (bump! :trail-only-outside-inbox-new))
    (when (and (seq placements) (every? :batched? placements))
      (bump! :trail-only-in-batch-subdir))
    (when (and (zero? n-trails) (seq decoys)) (bump! :decoys-but-no-trail))
    (when (> (count (set (map :role placements))) 1) (bump! :multi-role-trail))

    ;; ── P1: the router refuses IF AND ONLY IF a trail exists ──────────────
    (let [actual (chase-sweep-lib/ticket-dispatched-in? target dirs)]
      (when (not= expected actual)
        (fail! "P1" (str "run " i ": " target " expected dispatched?=" expected
                         " got " actual
                         " (trails: " (pr-str (map (juxt :state :batched?) placements))
                         ", decoys: " (pr-str (map (juxt :kind :same?) decoys)) ")"))))

    ;; ── P2: router and sweep partition the same corpus identically ────────
    (let [active-dir (str (fs/path root "backlog" "active"))
          corpus (distinct (cons target (map (comp str/upper-case :text) decoys)))]
      (fs/create-dirs active-dir)
      (doseq [id corpus]
        (spit (str (fs/path active-dir (str id "-gen.yaml")))
              (str "id: " id "\ntitle: \"gen\"\nstatus: todo\nassigned_to: coder\n")))
      (let [sweep-says (set (map :id (chase-sweep-lib/dispatch-gap-items active-dir dirs)))
            trail-set (chase-sweep-lib/collect-dispatched-ticket-ids dirs)
            router-says (set (remove #(chase-sweep-lib/ticket-dispatched? % trail-set) corpus))]
        (when (not= sweep-says router-says)
          (fail! "P2" (str "run " i ": sweep said " (pr-str sweep-says)
                           " router said " (pr-str router-says))))))))

;; ── P3: ONE predicate, ONE trail-directory list (source claim) ────────────
;; Invariant 2 is met by construction, not by discipline. These assertions are
;; what stop a later refactor from quietly recreating the second copy.

;; The defn's LIVE CODE, with its docstring and comments removed. Reading the
;; raw form would let prose satisfy the check: this function's own docstring
;; says "decide-dispatch-gaps", so a body rewritten to a bare contains? passed
;; a first version of P3 while being exactly the second predicate the invariant
;; forbids. Only executable text counts, here as in P4 below.
(defn defn-body [source fn-name]
  (when-let [after (second (str/split source (re-pattern (str "\\(defn " fn-name "\\s")) 2))]
    (-> (first (str/split after #"\n\(" 2))
        (str/replace #"\"(?:[^\"\\\\]|\\\\.)*\"" "")
        (str/replace #";[^\n]*" ""))))

(let [lib (slurp (str (fs/path scripts-dir "chase_sweep_lib.bb")))
      body (defn-body lib "ticket-dispatched\\?")]
  (cond
    (nil? body)
    (fail! "P3" "chase_sweep_lib.bb no longer defines ticket-dispatched?")

    (not (str/includes? body "decide-dispatch-gaps"))
    (fail! "P3" (str "ticket-dispatched?'s BODY no longer answers via decide-dispatch-gaps - "
                     "that is a SECOND predicate, and invariant 2 forbids two answers to one "
                     "question. Its docstring saying so is not the same thing."))))

(let [daemon (slurp (str (fs/path scripts-dir "handoffd.bb")))
      body (defn-body daemon "dispatch-gap-scan-dirs")]
  (cond
    (nil? body)
    (fail! "P3" "handoffd.bb no longer defines dispatch-gap-scan-dirs")

    (not (str/includes? body "dispatch-trail-dirs"))
    (fail! "P3" (str "handoffd.bb's dispatch-gap-scan-dirs no longer delegates to "
                     "chase-sweep-lib/dispatch-trail-dirs - the daemon and the router would "
                     "scan two independently-maintained directory lists"))))

;; ── P4: the router actually consults it (wiring claim) ────────────────────
;; The library being right is not the invariant. The invariant is that no
;; parcel is originated, and only the router can honour that.

(let [router (slurp (str (fs/path scripts-dir "route_backlog_to_coder.sh")))
      code-only (->> (str/split-lines router)
                     (remove #(re-find #"^\s*#" %))
                     (str/join "\n"))]
  (when-not (str/includes? code-only "dispatch_trail_cli.bb")
    (fail! "P4" "route_backlog_to_coder.sh no longer consults dispatch_trail_cli.bb - it can originate a parcel for finished work again"))
  (when-not (re-find #"exit 3" code-only)
    (fail! "P4" "route_backlog_to_coder.sh no longer has the refusal exit - a refusal that still returns 0 reads as a successful route")))

;; ── reachability floors ───────────────────────────────────────────────────
;; Asserted, never hoped for. A generator that technically CAN reach a state
;; but reaches it once in ten thousand draws lets a live defect pass hundreds
;; of runs, so each of the states P1 and P2 are actually about carries a floor.

;; Expressed as a FRACTION of runs, not an absolute count, so a smaller
;; PROPERTY_RUNS smoke run checks the same reach rather than failing on
;; arithmetic. The fractions are set below the rates measured at the default
;; 200 runs, with headroom for draw noise - close enough to bite when the
;; generator stops reaching a state, loose enough not to flake.
(def floor-fractions
  {:dispatched 0.40
   :undispatched 0.10
   :trail-only-outside-inbox-new 0.20
   :trail-only-in-batch-subdir 0.02
   :decoys-but-no-trail 0.10
   :derived-collision-decoy 0.55
   :multi-role-trail 0.08})

(doseq [[k fraction] floor-fractions]
  (let [floor (max 1 (int (Math/ceil (* fraction runs))))
        got (get @coverage k 0)]
    (when (< got floor)
      (fail! "REACH" (str "generator reached " (name k) " only " got " time(s) in " runs
                          " runs, floor is " floor " - the properties above are not exercising "
                          "the state they claim to quantify over")))))

;; ── report ────────────────────────────────────────────────────────────────

(println (str "bl1097 property runner: " runs " runs, seed " seed))
(println (str "  coverage: " (pr-str @coverage)))
(if (seq @failures)
  ;; Tallied by property as well as listed. The list is truncated so a total
  ;; break does not bury the summary, and the tally is what the non-vacuity
  ;; table in this file's header quotes - a truncated list cannot be counted.
  (do (doseq [f (take 20 @failures)] (println f))
      (when (> (count @failures) 20)
        (println (str "  ... " (- (count @failures) 20) " more")))
      (println (str "\n  by property: "
                    (pr-str (into (sorted-map)
                                  (frequencies (map #(second (re-find #"^FAIL (\S+):" %)) @failures))))))
      (println (str "  " (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: bl1097 router no-op origination properties"))
