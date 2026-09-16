#!/usr/bin/env bb
;; BL-1547: PROPERTY test over task_scope_gate_lib.bb's closed-ticket
;; exemption (coder-authored first, per BL-654), encoding the ticket's
;; declared invariant:
;;
;;   "A foreign-scope finding names a ticket that is OPEN: its YAML read
;;   under backlog/active, paused or hold on the freshest ref, or not
;;   found at all. A basename whose ticket is read under backlog/done on
;;   that ref is never a finding."
;;
;; This property drives foreign-scope-findings' pure 4th argument
;; (closed-ticket-ids) directly - the git-backed question "which lane is a
;; ticket really filed under" is landed_ticket_lib.bb's own job
;; (ticket-lanes-at-ref/ticket-closed?), exercised against a real git
;; fixture in task_scope_gate_lib_test_runner.bb instead. Keeping the two
;; apart here is deliberate: a property that also drove real git commits
;; per iteration would be the slow, subprocess-heavy shape this repo
;; reserves for cases that need it (e.g. BL-1203's enqueueRoleAnswerNote
;; property), and this invariant has nothing to do with git plumbing - it
;; is purely "does membership in the closed-ticket-ids set suppress a
;; finding, exactly and only for the ids in it."
;;
;; Every generated foreign id is independently marked closed or open (a
;; coin flip per id, not per path) so the SAME id can appear at multiple
;; paths and the exemption is proven to travel with the id, not the path -
;; the shape this ticket's own bug was ("closed" as a per-file guess would
;; have been indistinguishable from "closed" as a per-id fact on a
;; single-path case).
;;
;; Non-vacuity proven by hand: with the 4th argument's `(not (contains?
;; closed-set id))` clause deleted (closed ids always counted as foreign),
;; every closed-id case below fails immediately. Restored before landing.

(ns bl1547-closed-ticket-not-foreign-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "task_scope_gate_lib.bb")))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (fail! (str msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def ^:private rng (java.util.Random. 20260916))
(defn- pick [coll] (nth coll (.nextInt rng (count coll))))
(defn- rand-id [] (str "BL-" (+ 1000 (.nextInt rng 400))))

(def NUM-RUNS 300)

(defn- feature-path [id] (str "specs/features/" id "-contract.feature"))
(defn- yaml-path [id] (str "backlog/active/" id "-thing.yaml"))
(defn- howto-path [id] (str "docs/how-to/" id "-guide.md"))
(defn- code-path [] (str "extension/src/tools/thing" (.nextInt rng 99) ".ts"))

;; ── the invariant itself: closed ids never survive as findings, open/absent
;;    ids always do ─────────────────────────────────────────────────────
(let [saw-closed (atom 0)
      saw-open (atom 0)
      saw-multi-path-same-id (atom 0)]
  (dotimes [_ NUM-RUNS]
    (let [task-id (rand-id)
          num-foreign (inc (.nextInt rng 3))
          foreign-ids (vec (distinct (repeatedly (+ num-foreign 2) rand-id)))
          foreign-ids (into [] (remove #(= % task-id) (take num-foreign foreign-ids)))]
      (when (seq foreign-ids)
        (let [;; each foreign id is independently closed or open
              closed-ids (set (filter (fn [_] (zero? (.nextInt rng 2))) foreign-ids))
              ;; every foreign id gets 1-2 paths of varying shape, so a
              ;; closed id's exemption is proven across every artifact
              ;; shape ticket-id-for-path recognises, not just one.
              id->paths (into {} (for [id foreign-ids]
                                    [id (vec (distinct (repeatedly (inc (.nextInt rng 2))
                                                                    #(pick [(feature-path id) (yaml-path id) (howto-path id)]))))]))
              changed (into [(code-path)] (mapcat val id->paths))
              findings (task-scope-gate-lib/foreign-scope-findings task-id changed nil closed-ids)
              finding-ids (set (map :ticket-id findings))
              finding-paths (set (map :path findings))]
          (doseq [[id paths] id->paths]
            (if (contains? closed-ids id)
              (do (swap! saw-closed inc)
                  (assert= (str "closed id " id " contributes no finding, from any of its paths " (pr-str paths))
                           false (contains? finding-ids id)))
              (do (swap! saw-open inc)
                  (assert= (str "open id " id " contributes a finding for EVERY one of its paths " (pr-str paths))
                           true (every? #(contains? finding-paths %) paths))))
            (when (> (count paths) 1) (swap! saw-multi-path-same-id inc)))
          ;; total count sanity: exactly the open ids' own path counts
          (assert= (str "finding count is exactly the sum of open ids' own path counts, changed=" (pr-str changed))
                   (reduce + (map count (vals (select-keys id->paths (remove closed-ids foreign-ids)))))
                   (count findings))))))
  (when-not (> @saw-closed 100)
    (fail! (str "reach floor: closed-id cases drawn only " @saw-closed " times")))
  (when-not (> @saw-open 100)
    (fail! (str "reach floor: open-id cases drawn only " @saw-open " times")))
  (when-not (> @saw-multi-path-same-id 30)
    (fail! (str "reach floor: multi-path-same-id cases drawn only " @saw-multi-path-same-id " times"))))

;; ── an empty/nil closed-ticket-ids set changes nothing (backward compat
;;    with the pre-BL-1547 2-arity and 3-arity call shapes) ──────────────
(dotimes [_ 50]
  (let [task-id (rand-id)
        foreign-id (loop [c (rand-id)] (if (= c task-id) (recur (rand-id)) c))
        changed [(howto-path foreign-id)]
        three-arity (task-scope-gate-lib/foreign-scope-findings task-id changed nil)
        four-arity-nil (task-scope-gate-lib/foreign-scope-findings task-id changed nil nil)
        four-arity-empty (task-scope-gate-lib/foreign-scope-findings task-id changed nil #{})]
    (assert= "3-arity and 4-arity-with-nil-closed-set agree" three-arity four-arity-nil)
    (assert= "4-arity-with-nil and 4-arity-with-empty-set agree" four-arity-nil four-arity-empty)))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: task_scope_gate_lib.bb BL-1547 closed-ticket-exemption property"))
