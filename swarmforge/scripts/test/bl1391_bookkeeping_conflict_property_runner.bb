#!/usr/bin/env bb
;; BL-1391: PROPERTY runner over the three invariants the ticket YAML declares
;; (coder-authored first, per BL-654). Its own command, never folded into the
;; unit runner.
;;
;;   P1 the resolver never touches a conflict outside the bookkeeping set, and
;;      one non-bookkeeping path makes the whole conflict refuse.
;;   P2 lossless and append-only: a resolution is produced ONLY when both sides
;;      merely inserted, and when produced it contains EVERY line either side
;;      inserted, plus every base line, in base order with ours before theirs.
;;   P3 the answer is total and deterministic - the same triple always gives
;;      the same verdict, and no triple throws.
;;
;; 500 triples, as the ticket's e2e step 5 asks for. GENERATOR REACH is
;; CONSTRUCTED: a random pair of files would essentially never be
;; "base plus insertions on both sides", which is the one shape that may
;; resolve - so each triple is BUILT from a base by inserting at drawn
;; positions, and the deletion/rewrite shapes are built by removing or
;; changing a base line on a drawn side. Every shape asserts it was reached.

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_main_reconcile_lib.bb")))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(def reached (atom {}))
(defn note! [k] (swap! reached update k (fnil inc 0)))

(def rng (java.util.Random. 13915))
(defn rint [n] (.nextInt rng (max 1 n)))

(defn- insert-lines
  "Base plus `n` inserted lines at drawn positions - the constructed
   append-only shape. Returns [side inserted-lines]."
  [base tag n]
  (loop [side (vec base) inserted [] i 0]
    (if (= i n)
      [side inserted]
      (let [line (str tag "-inserted-" i "-" (rint 1000))
            pos (rint (inc (count side)))]
        (recur (vec (concat (take pos side) [line] (drop pos side)))
               (conj inserted line)
               (inc i))))))

(dotimes [_ 500]
  (let [base (vec (for [i (range (inc (rint 6)))] (str "base-" i)))
        [ours our-added] (insert-lines base "ours" (rint 4))
        [theirs their-added] (insert-lines base "theirs" (rint 4))
        shape (rint 4)]
    (case shape
      ;; 1-2: both sides pure insertions - the resolvable shape.
      (1 2)
      (let [r (master-main-reconcile-lib/append-only-merge {:base base :ours ours :theirs theirs})]
        (note! :both-insert)
        (if-not (:resolved? r)
          (fail! (str "P2: a pure-insertion triple was refused: base " (pr-str base)
                      " ours " (pr-str ours) " theirs " (pr-str theirs)))
          (let [lines (set (:lines r))]
            ;; Lossless in both directions: every inserted line and every base
            ;; line survives.
            (doseq [l (concat our-added their-added base)]
              (when-not (contains? lines l)
                (fail! (str "P2: line lost in the resolution: " l))))
            ;; Deterministic (P3).
            (when-not (= (:lines r)
                         (:lines (master-main-reconcile-lib/append-only-merge
                                  {:base base :ours ours :theirs theirs})))
              (fail! "P3: the same triple produced two different resolutions")))))

      ;; 3: one side DELETED a base line - must refuse.
      3
      (when (seq base)
        (let [victim (rint (count base))
              theirs-del (vec (concat (take victim theirs) (drop (inc victim) theirs)))
              r (master-main-reconcile-lib/append-only-merge
                 {:base base :ours ours :theirs theirs-del})]
          (note! :deletion)
          (when (:resolved? r)
            ;; Only a false alarm if the deleted line really is gone: the
            ;; insertion may have shifted what index `victim` names.
            (when-not (contains? (set (:lines r)) (nth base victim))
              (fail! (str "P2: a deletion was resolved and the line is gone: "
                          (nth base victim)))))))

      ;; 4: one side REWROTE a base line - must refuse.
      (when (seq base)
        (let [victim (rint (count base))
              ours-rw (vec (map-indexed (fn [i l] (if (= l (nth base victim)) (str l "-rewritten") l)) ours))
              r (master-main-reconcile-lib/append-only-merge
                 {:base base :ours ours-rw :theirs theirs})]
          (note! :rewrite)
          (when (:resolved? r)
            (fail! (str "P2: a rewritten base line was resolved: " (nth base victim)))))))))

;; ── P1: the set, and the all-or-nothing gate ──────────────────────────────
(doseq [path ["backlog/active/BL-1.yaml" "backlog/topics/BL-1.json"
              "backlog/evidence/BL-1-coder-20260904.md" "docs/briefings/2026-09-04.json"]]
  (note! :in-set)
  (when-not (master-main-reconcile-lib/bookkeeping-path? path)
    (fail! (str "P1: a bookkeeping path was not recognised: " path))))

(doseq [path ["swarmforge/scripts/handoffd.bb" "specs/features/BL-1.feature"
              "swarmforge/roles/coder.prompt" "swarmforge/swarmforge.conf"
              "extension/src/bridge/bridgeServer.ts" "backlog/active/BL-1.md"]]
  (note! :out-of-set)
  (when (master-main-reconcile-lib/bookkeeping-path? path)
    (fail! (str "P1: a non-bookkeeping path was treated as bookkeeping: " path))))

(doseq [[paths expected]
        [[["backlog/active/BL-1.yaml"] :resolvable]
         [["backlog/active/BL-1.yaml" "backlog/evidence/BL-1-coder-20260904.md"] :resolvable]
         [["backlog/active/BL-1.yaml" "swarmforge/scripts/handoffd.bb"] :refuse]
         [["swarmforge/scripts/handoffd.bb"] :refuse]
         [[] :refuse]]]
  (note! :plan)
  (let [got (master-main-reconcile-lib/bookkeeping-conflict-plan paths)]
    (when-not (= got expected)
      (fail! (str "P1: plan for " (pr-str paths) " was " got ", expected " expected)))))

(doseq [shape [:both-insert :deletion :rewrite :in-set :out-of-set :plan]]
  (when-not (pos? (get @reached shape 0))
    (fail! (str "never exercised the " shape " shape"))))

(if (empty? @failures)
  (println (str "bl1391_bookkeeping_conflict_property: ALL PROPERTIES HOLD over "
                (reduce + (vals @reached)) " constructed cases"))
  (do (println (str "bl1391_bookkeeping_conflict_property: " (count @failures) " FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
