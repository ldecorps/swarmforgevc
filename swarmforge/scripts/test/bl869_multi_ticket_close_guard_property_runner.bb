#!/usr/bin/env bb
;; BL-869 (BL-654 Invariants): PROPERTY tests for the multi-ticket close
;; guard's three declared invariants:
;;
;;   1. "Every ticket whose active-to-done move appears in a close commit
;;      is validated independently: a commit closing N tickets performs N
;;      approval checks, never fewer."
;;   2. "Adding a further ticket id to a QA note never withdraws credit
;;      from an id the note already named."
;;   3. "Every post-close side effect keyed to a ticket id runs once for
;;      each ticket the commit closed."
;;
;; Mirrors bl798_open_slot_escalation_property_runner.bb's shape: a seeded
;; LCG (never rand, deterministic by construction), a bucketed generator-
;; coverage assertion, and non-vacuity proven by hand at authoring time
;; (documented per property below).
;;
;; P1/P2 are pure (parse-close-move, ticket-ids-from-headers) - no
;; filesystem, full PROPERTY_RUNS budget. P3 exercises the real, side-
;; effecting abandon-inflight-for-ticket! against real temp-dir mailboxes
;; (no git needed - that machinery lives entirely on plain files), so it
;; runs its own smaller budget to keep the suite fast.

(ns bl869-multi-ticket-close-guard-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ticket_close_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def fs-runs (or (some-> (System/getenv "PROPERTY_FS_RUNS") parse-long) 60))
(def failures (atom []))

;; ── seeded LCG - deterministic, never rand ──────────────────────────────
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn n]
  (loop [i 0 s 11]
    (when (< i n)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── shared: generate N (n-min..n-max) distinct ticket ids, index-suffixed
;;    off one random base so they are always distinct by construction ─────
(defn gen-distinct-ids [s n-min n-max]
  (let [[extra s1] (gen-int s (inc (- n-max n-min)))
        n (+ n-min extra)
        [base s2] (gen-int s1 9000)]
    [(vec (map #(str "BL-" (+ base 100 %)) (range n))) s2]))

;; ── P1 (invariant 1): parse-close-move resolves EVERY ticket in a close,
;;    independently, regardless of path order or interspersed decoys ──────

(defn gen-close-paths [s]
  (let [[ids s1] (gen-distinct-ids s 1 6)
        pairs (mapv (fn [id] {:ticket-id id
                               :active (str "backlog/active/" id "-fixture.yaml")
                               :done (str "backlog/done/" id "-fixture.yaml")})
                     ids)
        flat (vec (mapcat (fn [{:keys [active done]}] [active done]) pairs))
        ;; deterministic Fisher-Yates shuffle over the flat active+done list
        [shuffled s2] (loop [v flat i (dec (count flat)) sx s1]
                        (if (< i 1)
                          [v sx]
                          (let [[j sy] (gen-int sx (inc i))]
                            (recur (assoc v i (v j) j (v i)) (dec i) sy))))
        ;; 0..2 decoy ordinary paths that name no real close move at all
        [n-decoys s3] (gen-int s2 3)
        decoys (mapv #(str "backlog/active/BL-DECOY-" % "-a.yaml") (range n-decoys))]
    [{:ids ids :pairs pairs :paths (vec (concat shuffled decoys))} s3]))

(check-all
 "P1 parse-close-move returns exactly one entry per ticket in the close, correctly paired, regardless of path order"
 gen-close-paths
 (fn [{:keys [ids pairs paths]}]
   (let [result (ticket-close-guard-lib/parse-close-move paths)
         by-id (into {} (map (juxt :ticket-id identity) result))]
     (or (and (= (count result) (count ids))
              (= (set (map :ticket-id result)) (set ids))
              (every? (fn [{:keys [ticket-id active done]}]
                        (let [entry (get by-id ticket-id)]
                          (and entry
                               (= (:active-path entry) active)
                               (= (:done-path entry) done))))
                      pairs))
         (str "expected " (count ids) " entries for " (pr-str ids)
              ", got " (pr-str result)))))
 runs)

;; ── P2 (invariant 2): adding a further ticket id to a QA note never
;;    withdraws credit from an id the note already named ──────────────────

(defn qa-note-text [ids]
  (str "QA approved " (str/join "," ids) " @ 0bae185f9b, landed on main. Bookkeep all " (count ids) "."))

(defn gen-growing-note [s]
  (let [[ids s1] (gen-distinct-ids s 2 6)
        [j s2] (gen-int s1 (dec (count ids)))          ;; 0..(n-2): a proper prefix
        prefix-len (inc j)                              ;; 1..(n-1) ids already named
        prefix (vec (take prefix-len ids))]
    [{:prefix prefix :full ids} s2]))

(check-all
 "P2 every id in a narrower QA note is still credited once the note is extended to name more ids"
 gen-growing-note
 (fn [{:keys [prefix full]}]
   (let [full-ids (set (pipeline-stage-lib/ticket-ids-from-headers {:message (qa-note-text full)}))]
     (or (and (every? full-ids prefix)
              (= full-ids (set full)))
         (str "prefix=" (pr-str prefix) " full=" (pr-str full) " extracted=" (pr-str full-ids)))))
 runs)

;; ── P3 (invariant 3): every post-close side effect keyed to a ticket id
;;    runs once for each ticket the commit closed - exercised against the
;;    real abandon-inflight-for-ticket! over real temp-dir mailboxes ──────

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "bl869-property-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- write-roles! [root]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "architect\tarchitect-wt\t" root "/architect\tswarmforge-architect\tArchitect\tclaude\ttask\n"
             "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n")))

(defn- seed-inflight! [root ids]
  (write-roles! root)
  (let [dir (fs/path root "architect" ".swarmforge" "handoffs" "inbox" "new")]
    (fs/create-dirs dir)
    (doseq [[idx id] (map-indexed vector ids)]
      (spit (str (fs/path dir (str "2" idx "_" id ".handoff")))
            (str "id: x\nfrom: architect\nto: hardender\npriority: 20\ntype: git_handoff\n"
                 "task: " id "-fixture\ncommit: a1b2c3d4e5\n\nbody\n")))))

(defn- write-qa-note! [root ids]
  (let [dir (fs/path root ".swarmforge" "handoffs" "coordinator" "inbox" "new")]
    (fs/create-dirs dir)
    (spit (str (fs/path dir "00_qa.handoff"))
          (str "id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: note\n"
               "message: " (qa-note-text ids) "\n\nbody\n"))))

(defn gen-inflight-close [s]
  (let [[ids s1] (gen-distinct-ids s 2 5)]
    [{:ids ids} s1]))

(check-all
 "P3 abandon-inflight-for-ticket! run once per ticket the validated close names abandons exactly one in-flight handoff per ticket, none left behind, none double-counted"
 gen-inflight-close
 (fn [{:keys [ids]}]
   (let [root (mk-root)
         paths (vec (mapcat (fn [id] [(str "backlog/active/" id "-fixture.yaml")
                                       (str "backlog/done/" id "-fixture.yaml")])
                             ids))]
     (write-qa-note! root ids)
     (seed-inflight! root ids)
     (let [close-check (ticket-close-guard-lib/validate-close-allowed root paths)
           ticket-ids (:ticket-ids close-check)
           abandoned (mapcat #(ticket-close-guard-lib/abandon-inflight-for-ticket! root %) ticket-ids)
           new-dir (fs/path root "architect" ".swarmforge" "handoffs" "inbox" "new")
           remaining (if (fs/exists? new-dir) (fs/list-dir new-dir) [])]
       (or (and (:allowed close-check)
                (= (count ticket-ids) (count ids))
                (= (count abandoned) (count ids))
                (empty? remaining))
           (str "ids=" (pr-str ids) " close-check=" (pr-str close-check)
                " abandoned-count=" (count abandoned) " remaining=" (count remaining))))))
 fs-runs)

;; ── generator coverage - both narrow (2-ticket) and wide (5/6-ticket)
;;    closes must actually be exercised, not just the common small case ────

(let [sizes (atom {:small 0 :large 0})]
  (loop [i 0 s 11]
    (when (< i runs)
      (let [[{:keys [ids]} s'] (gen-close-paths s)]
        (swap! sizes update (if (<= (count ids) 2) :small :large) inc)
        (recur (inc i) s'))))
  (println (str "  generator coverage (close size): " (pr-str @sizes)))
  (let [floor (quot runs 20)]
    (doseq [b [:small :large]]
      (when (< (get @sizes b 0) floor)
        (report! (str "COVERAGE " b) 11 @sizes (str b " barely exercised"))))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "ticket_close_guard_lib multi-ticket properties: " runs " pure runs, " fs-runs " fs runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
