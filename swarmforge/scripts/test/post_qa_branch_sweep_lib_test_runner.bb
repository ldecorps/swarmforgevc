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


;; ── BL-1361: the sweep TELLS the roles it could not settle ────────────────
;;
;; BL-668's contract says a branch it cannot settle is "surfaced to its role
;; untouched". The first half works; the second was built as a log line.
;; Measured 2026-09-03: 125 surfacings against 3 settles, and not one role was
;; ever told - on 2026-08-27 all six surfaced in one pass and nobody heard.
;;
;; Human ruling: TELL for every reason, WAKE only for a dirty worktree - the
;; one reason that does not resolve itself. A branch that merely cannot
;; fast-forward is merged on that role's next parcel anyway, because a
;; forwarded commit must carry the received commit as an ancestor.

(assert-true "BL-1361: a dirty worktree wakes the role"
             (post-qa-branch-sweep-lib/wake-for-reason? :dirty-worktree))
(assert= "BL-1361: a divergent branch is told but NOT woken"
         false (boolean (post-qa-branch-sweep-lib/wake-for-reason? :divergent-branch)))
(assert= "BL-1361: in_process work is told but not woken"
         false (boolean (post-qa-branch-sweep-lib/wake-for-reason? :in-process-work)))
(assert= "BL-1361: an unknown reason never wakes - waking is the exception"
         false (boolean (post-qa-branch-sweep-lib/wake-for-reason? :something-new)))

(let [text (post-qa-branch-sweep-lib/surface-notice "cleaner" :dirty-worktree "abc1234567")]
  (assert-true "BL-1361: the notice names the landed commit" (str/includes? text "abc1234567"))
  (assert-true "BL-1361: and the reason in the sweep's own words"
               (str/includes? text (post-qa-branch-sweep-lib/surface-reason-text :dirty-worktree)))
  (assert-true "BL-1361: and fits the 80-char note cap" (<= (count text) 80)))

(let [text (post-qa-branch-sweep-lib/surface-notice "architect" :divergent-branch "def4567890")]
  (assert-true "BL-1361: every reason produces a notice" (str/includes? text "def4567890"))
  (assert-true "BL-1361: and it fits the cap too" (<= (count text) 80)))

(let [tells (atom [])
      adapters {:role-facts! (fn [r] (if (= r "cleaner")
                                       {:worktree-path "/w/cleaner" :head-sha "old0000000" :dirty? true
                                        :in-process? false :can-ff? false}
                                       {:worktree-path "/w/architect" :head-sha "old0000000" :dirty? false
                                        :in-process? false :can-ff? true}))
                :fast-forward! (fn [_ _] {:success true})
                :tell! (fn [role reason text wake?]
                         (swap! tells conj {:role role :reason (name reason) :text text :wake? wake?})
                         {:success true})
                :log! (fn [& _] nil)}
      dir (str (fs/create-temp-dir {:prefix "bl1361-tell-"}))]
  (post-qa-branch-sweep-lib/sweep! dir "abc1234567" ["cleaner" "architect"] adapters)
  (assert= "BL-1361: exactly the surfaced role is told - a settled one hears nothing"
           ["cleaner"] (mapv :role @tells))
  (assert= "BL-1361: and the dirty worktree wakes it" true (:wake? (first @tells)))
  (reset! tells [])
  (post-qa-branch-sweep-lib/sweep! dir "abc1234567" ["cleaner" "architect"] adapters)
  (assert= "BL-1361: a repeat sweep of the same state tells nobody" [] @tells)
  (fs/delete-tree dir))

(let [tells (atom [])
      logs (atom [])
      adapters {:role-facts! (fn [_] {:worktree-path "/w" :head-sha "old0000000" :dirty? true
                                      :in-process? false :can-ff? false})
                :fast-forward! (fn [_ _] {:success false :error "no"})
                :tell! (fn [role _ _ _]
                         (swap! tells conj role)
                         (if (= role "cleaner")
                           {:success false :error "mailbox unwritable"}
                           {:success true}))
                :log! (fn [& parts] (swap! logs conj (vec parts)))}
      dir (str (fs/create-temp-dir {:prefix "bl1361-fail-"}))]
  (post-qa-branch-sweep-lib/sweep! dir "abc1234567" ["cleaner" "architect"] adapters)
  (assert= "BL-1361: a role that cannot be told does not withhold the others"
           ["cleaner" "architect"] @tells)
  (assert-true "BL-1361: and the failure is logged"
               (some #(= "post-qa-branch-sweep-tell-failed" (first %)) @logs))
  (fs/delete-tree dir))

(let [dir (str (fs/create-temp-dir {:prefix "bl1361-notell-"}))]
  (post-qa-branch-sweep-lib/sweep!
   dir "abc1234567" ["cleaner"]
   {:role-facts! (fn [_] {:worktree-path "/w" :head-sha "old0000000" :dirty? true
                          :in-process? false :can-ff? false})
    :fast-forward! (fn [_ _] {:success false})
    :log! (fn [& _] nil)})
  (assert-true "BL-1361: a caller with no :tell! adapter still sweeps" true)
  (fs/delete-tree dir))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: post_qa_branch_sweep_lib.bb")
