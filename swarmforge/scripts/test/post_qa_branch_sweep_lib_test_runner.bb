#!/usr/bin/env bb
;; TDD runner for post_qa_branch_sweep_lib.bb (BL-668) — no real git.

(ns post-qa-branch-sweep-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "post_qa_branch_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

(assert-true "coordinator excluded from sweep"
             (not (post-qa-branch-sweep-lib/sweep-eligible-role?
                   {:role "coordinator" :worktree-name "master"})))
(assert-true "coder worktree eligible"
             (post-qa-branch-sweep-lib/sweep-eligible-role?
              {:role "coder" :worktree-name "coder"}))

(assert= "already at landed"
         {:action :already-settled}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "abc" :landed-sha "abc" :dirty? false :in-process? false :can-ff? false}))

(assert= "dirty surfaces first"
         {:action :surface :reason :dirty-worktree}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? true :in-process? false :can-ff? true}))

(assert= "in_process surfaces when clean"
         {:action :surface :reason :in-process-work}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? false :in-process? true :can-ff? true}))

(assert= "can ff settles"
         {:action :settle}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? false :in-process? false :can-ff? true}))

(assert= "divergent surfaces"
         {:action :surface :reason :divergent-branch}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? false :in-process? false :can-ff? false}))

(let [daemon-dir (str (fs/path (fs/create-temp-dir {:prefix "bl668-test-"}) "daemon"))
      landed "landed1"
      facts {"coder" {:head-sha "c1" :landed-sha landed :dirty? false :in-process? false :can-ff? true}
             "cleaner" {:head-sha "l1" :landed-sha landed :dirty? true :in-process? false :can-ff? true}
             "architect" {:head-sha "a1" :landed-sha landed :dirty? false :in-process? false :can-ff? false}}
      settle-count (atom 0)
      adapters {:role-facts! #(get facts %)
                :fast-forward! (fn [_ _] (swap! settle-count inc) {:success true})
                :log! (fn [& _])}
      first (post-qa-branch-sweep-lib/sweep! daemon-dir landed ["coder" "cleaner" "architect"] adapters)
      first-settle @settle-count
      second (post-qa-branch-sweep-lib/sweep! daemon-dir landed ["coder" "cleaner" "architect"] adapters)]
  (assert= "first run settles one" 1 first-settle)
  (assert= "first run surfaces two" 2 (count (filter #(= (:type %) :surfaced) (:actions first))))
  (assert= "rerun noop settle" 1 @settle-count)
  (assert= "rerun no duplicate actions" 0 (count (:actions second))))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: post_qa_branch_sweep_lib.bb")
