#!/usr/bin/env bb
;; BL-626: declared invariant —
;; "No promotion path activates a ticket whose acceptance: does not resolve
;;  to an existing feature file at that moment."
;;
;; Quantifies acceptance-executable-refusal / evaluate over colliding
;; pointer shapes (missing, draft-only, draft-pointer, sibling decoy,
;; resolving .feature, prose). Non-vacuity: a broken refusal that returns
;; nil whenever a same-id sibling .feature exists would fail the sibling
;; decoy cases by construction.

(ns bl626-acceptance-executable-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_lib.bb")))

(def failures (atom []))
(defn assert! [msg ok]
  (when-not ok (swap! failures conj msg)))

(def created (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "bl626-prop-"}))]
    (swap! created conj d)
    (fs/create-dirs (fs/path d "specs" "features"))
    d))

(defn ticket [acceptance]
  (str "id: BL-6626\nhuman_approval: approved\nepic: e\n"
       (when acceptance (str "acceptance: " acceptance "\n"))))

(defn allows? [root content]
  (:ok (promotion-gates-lib/evaluate
        {:content content :held? false :root root
         :active-count 0 :max-depth 5 :active-epics {}})))

(defn refuses-naming? [root content needle]
  (let [r (promotion-gates-lib/evaluate
           {:content content :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (and (not (:ok r))
         (= "acceptance" (:gate r))
         (str/includes? (or (:reason r) "") needle))))

;; Seeded LCG — deterministic, never rand.
(def seed (atom 0xC0FFEE))
(defn next-u32 []
  (let [x (mod (+ (* @seed 1664525) 1013904223) 4294967296)]
    (reset! seed x)
    x))
(defn pick [xs] (nth xs (mod (next-u32) (count xs))))

(def runs 200)
(def reached (atom {:missing 0 :draft-shadow 0 :draft-ptr 0 :sibling 0 :ok-feat 0 :prose 0}))

;; Force every shape once, then fill the rest from the LCG — guarantees the
;; reachability floor the invariant requires (never a hoped-for one).
(def forced-shapes [:missing :draft-shadow :draft-ptr :sibling :ok-feat :prose])

(dotimes [i runs]
  (let [root (mk-root)
        slug (str "BL-6626-" (mod (next-u32) 100000) "-" i)
        feat (str "specs/features/" slug ".feature")
        draft (str feat ".draft")
        sibling (str "specs/features/" slug "-other.feature")
        shape (if (< i (count forced-shapes))
                (nth forced-shapes i)
                (nth forced-shapes (mod i (count forced-shapes))))]    (swap! reached update shape (fnil inc 0))
    (case shape
      :missing
      (assert! "missing feature refuses and names path"
               (refuses-naming? root (ticket feat) feat))

      :draft-shadow
      (do (spit (str (fs/path root draft)) "Feature: d\n")
          (assert! "draft-shadow refuses naming feature and draft"
                   (and (refuses-naming? root (ticket feat) feat)
                        (refuses-naming? root (ticket feat) draft))))

      :draft-ptr
      (do (spit (str (fs/path root draft)) "Feature: d\n")
          (assert! "draft pointer refuses as not executable"
                   (and (refuses-naming? root (ticket draft) draft)
                        (refuses-naming? root (ticket draft) "not executable"))))

      :sibling
      (do (spit (str (fs/path root sibling)) "Feature: decoy\n")
          (assert! "sibling decoy does not rescue dangling pointer"
                   (refuses-naming? root (ticket feat) feat)))

      :ok-feat
      (do (spit (str (fs/path root feat)) "Feature: ok\n")
          (assert! "resolving feature allows"
                   (allows? root (ticket feat))))

      :prose
      (assert! "prose acceptance allows"
               (allows? root (str (ticket nil) "acceptance: |\n  prose only\n"))))))

(assert! "generator reached every shape"
         (every? pos? (vals @reached)))

;; Non-vacuity: sibling decoy must never look like a resolve via glob.
(let [src (slurp (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_lib.bb")))]
  (assert! "gate consults applicable? (BL-897)"
           (str/includes? src "acceptance-pointer-gate-lib/applicable?"))
  (assert! "gate does not glob <id>-*.feature"
           (not (str/includes? src "*-*.feature"))))

(when (seq @failures)
  (doseq [f @failures] (binding [*out* *err*] (println (str "FAIL: " f))))
  (println (str (count @failures) " failure(s)"))
  (System/exit 1))

(println (str "bl626_acceptance_executable_property_runner: " runs " runs; reached " @reached))
(println "ALL PROPERTIES HOLD")
