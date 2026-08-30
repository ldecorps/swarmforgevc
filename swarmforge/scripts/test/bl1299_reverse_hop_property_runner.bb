#!/usr/bin/env bb
;; BL-1299 properties over reverse_hop_lib.bb's recipient selection.
;;
;; Invariant 1: no reverse git_handoff copy is ever addressed to a role whose
;;   roles-table worktree is the master checkout.
;; Invariant 2: changing the reverse-recipient set never changes which role is
;;   stamped terminal - last-pipeline-role still resolves to the last
;;   code-worktree role.
;;
;; Both quantify over ARBITRARY roles tables, not the live one: the whole
;; point of the human's "derive, do not hardcode" ruling is that residency is
;; a property of the row, so the generator makes ordinary pipeline roles
;; master-resident at random positions. Reach floors below assert the
;; generator actually lands in those states rather than merely being able to.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "reverse_hop_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))
(def reach (atom {}))
(defn- saw! [k] (swap! reach update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def stages ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])
(def modes ["forward-only" "back-one" "back-all" "" "back-alll"])
(def root "/repo")

(defn- row
  "A REALISTIC row: a master-resident role pairs worktree name 'master' with
   the repo root as its path, exactly as swarmforge.sh's parse_config writes
   the pair, so neither column can pick a winner between two correct
   derivations."
  [role worktree mode]
  (let [master? (contains? reverse-hop-lib/master-worktree-names worktree)]
    (str/join "\t" [role worktree (if master? root (str root "/.worktrees/" worktree))
                    (str "swarmforge-" role) role "claude" "task" "off" mode])))

(defn- gen-table
  "A roles table over a random subset of the stages in pipeline order, each
   row independently master-resident ('master' or 'none') or holding its own
   worktree, with a random propagation mode."
  [s]
  (loop [[stage & more] stages s s acc []]
    (if (nil? stage)
      [acc s]
      (let [[keep? s1] (gen-int s 10)
            [wt s2] (gen-pick s1 ["master" "none" :own :own :own])
            [mode s3] (gen-pick s2 modes)]
        (recur more s3
               (if (< keep? 2)
                 acc
                 (conj acc (row stage (if (= :own wt) stage wt) mode))))))))

;; Independent oracle: the last row that is neither coordinator nor
;; master-resident, computed by a different route than pipeline-roles.
(defn- expected-terminal [lines]
  (->> lines
       (remove str/blank?)
       (filter (fn [l]
                 (let [f (str/split l #"\t" -1)]
                   (and (not= "coordinator" (first f))
                        (not (contains? #{"master" "none"} (str/trim (or (get f 1) ""))))))))
       last
       (#(when % (first (str/split % #"\t" -1))))))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[table s1] (gen-table s)
          roles (reverse-hop-lib/pipeline-roles table)
          master-rows (filter reverse-hop-lib/master-resident-row? table)
          master-names (set (map reverse-hop-lib/row-role master-rows))]

      (when (seq master-rows) (saw! :any-master-resident))
      (when (seq (disj master-names "specifier" "coordinator")) (saw! :non-obvious-master-resident))
      (when (>= (count roles) 3) (saw! :deep-pipeline))

      ;; ── Invariant 1 ────────────────────────────────────────────────────
      (doseq [line table
              :let [sender (reverse-hop-lib/row-role line)]
              mode ["back-one" "back-all" (reverse-hop-lib/propagation-for table sender)]]
        (let [got (reverse-hop-lib/reverse-recipients table sender mode)]
          (when (seq got) (saw! :non-empty-reverse))
          (when-let [bad (seq (filter master-names got))]
            (swap! failures conj
                   (str "FAIL invariant 1: master-resident role addressed a reverse copy\n"
                        "  sender=" sender " mode=" mode " got=" (pr-str got)
                        " master-resident=" (pr-str master-names))))
          ;; a reverse recipient is always an EARLIER pipeline role, never the
          ;; sender itself and never a duplicate.
          (when (contains? (set got) sender)
            (swap! failures conj (str "FAIL invariant 1: sender addressed itself: " sender)))
          (when (not= (count got) (count (set got)))
            (swap! failures conj (str "FAIL invariant 1: duplicate recipients " (pr-str got))))))

      ;; ── Invariant 2 ────────────────────────────────────────────────────
      (let [terminal (reverse-hop-lib/last-pipeline-role table)]
        (when (not= (expected-terminal table) terminal)
          (swap! failures conj
                 (str "FAIL invariant 2: terminal role disagrees with oracle\n"
                      "  got=" (pr-str terminal) " oracle=" (pr-str (expected-terminal table)))))
        ;; Metamorphic: making EARLIER roles master-resident shrinks the
        ;; reverse-recipient set but must never move the terminal stamp.
        (when (> (count roles) 1)
          (saw! :terminal-metamorphic)
          (let [victim (first roles)
                shrunk (mapv (fn [l]
                               (if (= victim (reverse-hop-lib/row-role l))
                                 (row victim "master" (reverse-hop-lib/propagation-for table victim))
                                 l))
                             table)
                before (set (reverse-hop-lib/reverse-recipients table (last roles) "back-all"))
                after (set (reverse-hop-lib/reverse-recipients shrunk (last roles) "back-all"))]
            (when-not (contains? before victim)
              (swap! failures conj (str "FAIL generator: victim " victim " was not a recipient before")))
            (when (contains? after victim)
              (swap! failures conj (str "FAIL invariant 1: " victim " still addressed after going master-resident")))
            (when (not= terminal (reverse-hop-lib/last-pipeline-role shrunk))
              (swap! failures conj
                     (str "FAIL invariant 2: terminal moved when the recipient set shrank\n"
                          "  before=" (pr-str terminal)
                          " after=" (pr-str (reverse-hop-lib/last-pipeline-role shrunk))))))))
      (recur (inc i) s1))))

;; ── Reach floors: the generator must LAND in the interesting states ──────
(def floors {:any-master-resident (quot runs 4)
             :non-obvious-master-resident (quot runs 4)
             :deep-pipeline (quot runs 4)
             :non-empty-reverse (quot runs 4)
             :terminal-metamorphic (quot runs 4)})

(doseq [[k floor] floors]
  (let [n (get @reach k 0)]
    (if (>= n floor)
      (println (format "REACH %-30s %5d  (floor %d)" (name k) n floor))
      (swap! failures conj
             (format "FAIL reach: %s hit %d times, floor %d - the property would pass vacuously"
                     (name k) n floor)))))

(if (empty? @failures)
  (do (println (str "ALL PASS (" runs " runs)")) (System/exit 0))
  (do (doseq [f @failures] (println f))
      (println "FAILURES:" (count @failures))
      (System/exit 1)))
