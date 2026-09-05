#!/usr/bin/env bb
;; TDD runner for post_qa_branch_sweep_lib.bb (BL-668) — no real git.

(ns post-qa-branch-sweep-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "post_qa_branch_sweep_lib.bb")))

(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

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
;; hardener finding: coordinator's own fixture above has worktree-name "master"
;; too, so it cannot distinguish the role-based exclusion from the separate
;; "master" worktree-name check - a specifier fixture with a NON-master
;; worktree-name isolates the role-based branch on its own.
(assert-true "specifier excluded from sweep (role-based, not worktree-name)"
             (not (post-qa-branch-sweep-lib/sweep-eligible-role?
                   {:role "specifier" :worktree-name "specifier"})))

(assert= "already at landed"
         {:action :already-settled}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "abc" :landed-sha "abc" :dirty? false :in-process? false :can-ff? false :contains-landed? false}))

(assert= "dirty surfaces first"
         {:action :surface :reason :dirty-worktree}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? true :in-process? false :can-ff? true :contains-landed? false}))

(assert= "in_process surfaces when clean"
         {:action :surface :reason :in-process-work}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? false :in-process? true :can-ff? true :contains-landed? false}))

(assert= "can ff settles"
         {:action :settle}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? false :in-process? false :can-ff? true :contains-landed? false}))

(assert= "divergent surfaces"
         {:action :surface :reason :divergent-branch}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? false :in-process? false :can-ff? false :contains-landed? false}))

;; ── BL-1433: a HEAD that contains the landed commit is settled whatever
;;    else the worktree holds (invariant 1) ─────────────────────────────

(assert= "holds-landed wins over a clean, fast-forwardable worktree"
         {:action :holds-landed}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "ahead" :landed-sha "new" :dirty? false :in-process? false :can-ff? false :contains-landed? true}))

(assert= "holds-landed wins over a dirty worktree"
         {:action :holds-landed}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "ahead" :landed-sha "new" :dirty? true :in-process? false :can-ff? false :contains-landed? true}))

(assert= "holds-landed wins over in_process work"
         {:action :holds-landed}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "ahead" :landed-sha "new" :dirty? true :in-process? true :can-ff? false :contains-landed? true}))

;; ── BL-1433: an unanswerable containment fact is a skip, never a tell
;;    (invariant 3) - distinct from :missing-ref (head/landed themselves
;;    absent), which is unaffected ─────────────────────────────────────

(assert= "unknown containment skips rather than falling through to divergent"
         {:action :skip :reason :unknown-containment}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? false :in-process? false :can-ff? false :contains-landed? nil}))

(assert= "missing-ref still wins over an absent containment fact (head-sha nil)"
         {:action :skip :reason :missing-ref}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha nil :landed-sha "new" :dirty? false :in-process? false :can-ff? false :contains-landed? nil}))

;; hardener finding: the two prior dirty/in_process cases each set only ONE of
;; the two flags true, so neither can tell which branch decide-role checks
;; FIRST when both are true - a priority-order mutant survived both.
;; BL-1421 (reversing BL-1361's own precedence here): in-process? must win.
;; A role mid-parcel is dirty BY DEFINITION (its own uncommitted work), so
;; checking dirty? first misclassified every in-process role as a
;; resolvable dirty-worktree WAKE instead of the in-process-work it
;; actually is - the human's ruling wakes for dirty-worktree specifically
;; because "it does not resolve itself," which is false for a role that is
;; actively mid-parcel.
(assert= "in_process outranks dirty when both are true (BL-1421)"
         {:action :surface :reason :in-process-work}
         (post-qa-branch-sweep-lib/decide-role
          {:head-sha "old" :landed-sha "new" :dirty? true :in-process? true :can-ff? true :contains-landed? false}))

(let [bl668-root (fs/create-temp-dir {:prefix "bl668-test-"})
      _ (swap! created-temp-dirs conj bl668-root)
      daemon-dir (str (fs/path bl668-root "daemon"))
      landed "landed1"
      facts {"coder" {:head-sha "c1" :landed-sha landed :dirty? false :in-process? false :can-ff? true :contains-landed? false}
             "cleaner" {:head-sha "l1" :landed-sha landed :dirty? true :in-process? false :can-ff? true :contains-landed? false}
             "architect" {:head-sha "a1" :landed-sha landed :dirty? false :in-process? false :can-ff? false :contains-landed? false}}
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

;; ── BL-1433: sweep!-level - holds-landed and unknown-containment produce
;;    no action, no tell, and log their own distinct tag ─────────────────

(let [logs (atom [])
      tells (atom [])
      dir (str (fs/create-temp-dir {:prefix "bl1433-holds-"}))
      _ (swap! created-temp-dirs conj dir)
      adapters {:role-facts! (fn [_] {:head-sha "ahead" :dirty? true :in-process? true
                                       :can-ff? false :contains-landed? true})
                :fast-forward! (fn [_ _] {:success true})
                :tell! (fn [role reason text wake?]
                         (swap! tells conj role)
                         {:success true})
                :log! (fn [& parts] (swap! logs conj (vec parts)))}
      result (post-qa-branch-sweep-lib/sweep! dir "landedX" ["architect"] adapters)]
  (assert= "holds-landed produces no action" [] (:actions result))
  (assert= "holds-landed tells nobody" [] @tells)
  (assert-true "holds-landed is logged under its own tag"
               (some #(= "post-qa-branch-sweep-holds-landed" (first %)) @logs))
  (fs/delete-tree dir))

(let [logs (atom [])
      tells (atom [])
      dir (str (fs/create-temp-dir {:prefix "bl1433-unknown-"}))
      _ (swap! created-temp-dirs conj dir)
      adapters {:role-facts! (fn [_] {:head-sha "old" :dirty? false :in-process? false
                                       :can-ff? false :contains-landed? nil})
                :fast-forward! (fn [_ _] {:success true})
                :tell! (fn [role reason text wake?]
                         (swap! tells conj role)
                         {:success true})
                :log! (fn [& parts] (swap! logs conj (vec parts)))}
      result (post-qa-branch-sweep-lib/sweep! dir "landedY" ["hardener"] adapters)]
  (assert= "unknown-containment produces no action" [] (:actions result))
  (assert= "unknown-containment tells nobody" [] @tells)
  (assert-true "unknown-containment is logged under its own tag"
               (some #(= "post-qa-branch-sweep-unknown-containment" (first %)) @logs))
  (fs/delete-tree dir))


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

;; hardener finding: both cases above land at EXACTLY 80 chars (the short-sha
;; is capped at 10 chars by surface-notice itself, so a longer sha cannot grow
;; the message) - truncation is a no-op at that boundary either way, so the
;; "fits the cap" assertions passed whether or not (subs text 0 80) ran, and a
;; mutant dropping the truncation entirely survived. An UNKNOWN reason falls
;; through surface-reason-text to `(str reason)`, which can be made
;; arbitrarily long and genuinely forces the untruncated text past 80.
(let [long-reason (keyword "some-unusually-long-and-unexpected-future-reason-keyword")
      text (post-qa-branch-sweep-lib/surface-notice "documenter" long-reason "abc1234567")]
  (assert-true "BL-1361: a long unknown reason is truncated to the 80-char cap"
               (= 80 (count text)))
  (assert-true "BL-1361: the truncated notice still starts with the landed commit"
               (str/starts-with? text "branch behind abc1234567:")))

(let [tells (atom [])
      adapters {:role-facts! (fn [r] (if (= r "cleaner")
                                       {:worktree-path "/w/cleaner" :head-sha "old0000000" :dirty? true
                                        :in-process? false :can-ff? false :contains-landed? false}
                                       {:worktree-path "/w/architect" :head-sha "old0000000" :dirty? false
                                        :in-process? false :can-ff? true :contains-landed? false}))
                :fast-forward! (fn [_ _] {:success true})
                :tell! (fn [role reason text wake?]
                         (swap! tells conj {:role role :reason (name reason) :text text :wake? wake?})
                         {:success true})
                :log! (fn [& _] nil)}
      dir (str (fs/create-temp-dir {:prefix "bl1361-tell-"}))
      _ (swap! created-temp-dirs conj dir)]
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
                                      :in-process? false :can-ff? false :contains-landed? false})
                :fast-forward! (fn [_ _] {:success false :error "no"})
                :tell! (fn [role _ _ _]
                         (swap! tells conj role)
                         (if (= role "cleaner")
                           {:success false :error "mailbox unwritable"}
                           {:success true}))
                :log! (fn [& parts] (swap! logs conj (vec parts)))}
      dir (str (fs/create-temp-dir {:prefix "bl1361-fail-"}))
      _ (swap! created-temp-dirs conj dir)]
  (post-qa-branch-sweep-lib/sweep! dir "abc1234567" ["cleaner" "architect"] adapters)
  (assert= "BL-1361: a role that cannot be told does not withhold the others"
           ["cleaner" "architect"] @tells)
  (assert-true "BL-1361: and the failure is logged"
               (some #(= "post-qa-branch-sweep-tell-failed" (first %)) @logs))
  (fs/delete-tree dir))

;; hardener finding: the previous scenario only exercises tell! RETURNING
;; {:success false} - the try/catch around the call also has to survive
;; tell! actually THROWING (a real adapter, e.g. swarm_handoff.bb, can raise
;; on an unwritable mailbox rather than returning a failure map), and no test
;; drove that path - a mutant removing the try/catch entirely survived.
(let [tells (atom [])
      logs (atom [])
      adapters {:role-facts! (fn [_] {:worktree-path "/w" :head-sha "old0000000" :dirty? true
                                      :in-process? false :can-ff? false :contains-landed? false})
                :fast-forward! (fn [_ _] {:success false :error "no"})
                :tell! (fn [role _ _ _]
                         (swap! tells conj role)
                         (if (= role "cleaner")
                           (throw (Exception. "mailbox write threw"))
                           {:success true}))
                :log! (fn [& parts] (swap! logs conj (vec parts)))}
      dir (str (fs/create-temp-dir {:prefix "bl1361-throw-"}))
      _ (swap! created-temp-dirs conj dir)]
  (post-qa-branch-sweep-lib/sweep! dir "abc1234567" ["cleaner" "architect"] adapters)
  (assert= "BL-1361: a tell! that THROWS does not withhold the others either"
           ["cleaner" "architect"] @tells)
  (assert-true "BL-1361: and the thrown error is logged too"
               (some #(and (= "post-qa-branch-sweep-tell-failed" (first %))
                            (str/includes? (str (nth % 2)) "mailbox write threw"))
                      @logs))
  (fs/delete-tree dir))

(let [dir (str (fs/create-temp-dir {:prefix "bl1361-notell-"}))
_ (swap! created-temp-dirs conj dir)]
  (post-qa-branch-sweep-lib/sweep!
   dir "abc1234567" ["cleaner"]
   {:role-facts! (fn [_] {:worktree-path "/w" :head-sha "old0000000" :dirty? true
                          :in-process? false :can-ff? false :contains-landed? false})
    :fast-forward! (fn [_ _] {:success false})
    :log! (fn [& _] nil)})
  (assert-true "BL-1361: a caller with no :tell! adapter still sweeps" true)
  (fs/delete-tree dir))

;; ── BL-1421: a standing surfacing survives a newer landed sha ─────────────

(assert= "normalize-state-for-landed keeps :surfaced across a landed-sha change"
         [{:role "coder" :reason "dirty-worktree" :told-sha "shaA"}]
         (:surfaced (post-qa-branch-sweep-lib/normalize-state-for-landed
                     {:landed-sha "shaA" :settled {"coder" "shaA"}
                      :surfaced [{:role "coder" :reason "dirty-worktree" :told-sha "shaA"}]}
                     "shaB")))

(assert= "normalize-state-for-landed still resets :settled on a landed-sha change"
         {} (:settled (post-qa-branch-sweep-lib/normalize-state-for-landed
                       {:landed-sha "shaA" :settled {"coder" "shaA"} :surfaced []}
                       "shaB")))

(assert= "normalize-state-for-landed is a no-op for the SAME landed-sha"
         {:landed-sha "shaA" :settled {"coder" "shaA"} :surfaced []}
         (post-qa-branch-sweep-lib/normalize-state-for-landed
          {:landed-sha "shaA" :settled {"coder" "shaA"} :surfaced []}
          "shaA"))

(assert= "told-sha-for answers nil for a role/reason never surfaced"
         nil (post-qa-branch-sweep-lib/told-sha-for {:surfaced []} "coder" :dirty-worktree))

(assert= "told-sha-for answers the recorded sha"
         "shaA" (post-qa-branch-sweep-lib/told-sha-for
                 {:surfaced [{:role "coder" :reason "dirty-worktree" :told-sha "shaA"}]}
                 "coder" :dirty-worktree))

(assert-true "surface-already-recorded?: no record at all never blocks (caught-up-to-told? irrelevant)"
             (not (post-qa-branch-sweep-lib/surface-already-recorded? {:surfaced []} "coder" :dirty-worktree false)))

(assert-true "surface-already-recorded?: a record blocks while NOT caught up"
             (post-qa-branch-sweep-lib/surface-already-recorded?
              {:surfaced [{:role "coder" :reason "dirty-worktree" :told-sha "shaA"}]}
              "coder" :dirty-worktree false))

(assert-true "surface-already-recorded?: the SAME record stops blocking once caught up"
             (not (post-qa-branch-sweep-lib/surface-already-recorded?
                   {:surfaced [{:role "coder" :reason "dirty-worktree" :told-sha "shaA"}]}
                   "coder" :dirty-worktree true)))

(assert= "record-surface! upserts - one entry per (role,reason), never a growing duplicate list"
         [{:role "coder" :reason "dirty-worktree" :told-sha "shaB"}]
         (:surfaced (post-qa-branch-sweep-lib/record-surface!
                     {:surfaced [{:role "coder" :reason "dirty-worktree" :told-sha "shaA"}]}
                     "coder" :dirty-worktree "shaB")))

(assert= "legacy state (no :told-sha) is dropped on load, self-healing instead of blocking forever"
         [] (:surfaced (post-qa-branch-sweep-lib/read-state
                         (let [dir (str (fs/create-temp-dir {:prefix "bl1421-legacy-"}))
_ (swap! created-temp-dirs conj dir)]
                           (fs/create-dirs dir)
                           (spit (post-qa-branch-sweep-lib/state-path dir)
                                 "{\"landed-sha\":\"shaA\",\"settled\":{},\"surfaced\":[{\"role\":\"coder\",\"reason\":\"dirty-worktree\"}]}")
                           dir))))

;; ── BL-1421 a-standing-surfacing-is-not-retold-per-landed-commit-01 /
;;    the-2026-09-05-replay-tells-once-04: a role that never merges and
;;    never catches up is told exactly once across many landed shas ────────

(let [tells (atom [])
      dir (str (fs/create-temp-dir {:prefix "bl1421-replay-"}))
      _ (swap! created-temp-dirs conj dir)
      adapters {:role-facts! (fn [_] {:worktree-path "/w" :head-sha "stale0000" :dirty? true
                                      :in-process? false :can-ff? false :contains-landed? false})
                :fast-forward! (fn [_ _] {:success true})
                :caught-up-to-told? (fn [_ _] false)
                :tell! (fn [role reason text wake?]
                         (swap! tells conj {:role role :reason (name reason) :wake? wake?})
                         {:success true})
                :log! (fn [& _] nil)}]
  (dotimes [i 103]
    (post-qa-branch-sweep-lib/sweep! dir (str "landed-" i) ["coder"] adapters))
  (assert= "BL-1421: 103 successive landed shas with the role dirty and behind throughout tells exactly once"
           1 (count @tells))
  (assert= "BL-1421: and wakes exactly once (dirty-worktree wakes)"
           1 (count (filter :wake? @tells)))
  (fs/delete-tree dir))

;; ── BL-1421 catching-up-clears-the-surfacing-02: caught up -> told once
;;    more when it falls behind again ───────────────────────────────────────

(let [tells (atom [])
      caught-up? (atom false)
      dir (str (fs/create-temp-dir {:prefix "bl1421-catchup-"}))
      _ (swap! created-temp-dirs conj dir)
      adapters {:role-facts! (fn [_] {:worktree-path "/w" :head-sha "stale0000" :dirty? true
                                      :in-process? false :can-ff? false :contains-landed? false})
                :fast-forward! (fn [_ _] {:success true})
                :caught-up-to-told? (fn [_ _] @caught-up?)
                :tell! (fn [role reason text wake?]
                         (swap! tells conj {:role role :reason (name reason)})
                         {:success true})
                :log! (fn [& _] nil)}]
  (post-qa-branch-sweep-lib/sweep! dir "shaA" ["coder"] adapters)
  (post-qa-branch-sweep-lib/sweep! dir "shaB" ["coder"] adapters)
  (assert= "BL-1421: still behind shaA (told-sha) - shaB landing alone does not re-tell" 1 (count @tells))
  (reset! caught-up? true)
  (post-qa-branch-sweep-lib/sweep! dir "shaC" ["coder"] adapters)
  (assert= "BL-1421: caught up to shaA and dirty again (commit C lands) - told once more"
           2 (count @tells))
  (assert= "BL-1421: the second telling names the CURRENT landed sha (C), not the stale A"
           "shaC" (post-qa-branch-sweep-lib/told-sha-for
                   (post-qa-branch-sweep-lib/read-state dir) "coder" :dirty-worktree))
  (fs/delete-tree dir))

;; ── BL-1421 in-process-work-is-never-woken-03: told, deferred, not woken ──

(let [tells (atom [])
      dir (str (fs/create-temp-dir {:prefix "bl1421-inprocess-"}))
      _ (swap! created-temp-dirs conj dir)
      adapters {:role-facts! (fn [_] {:worktree-path "/w" :head-sha "stale0000" :dirty? true
                                      :in-process? true :can-ff? false :contains-landed? false})
                :fast-forward! (fn [_ _] {:success true})
                :caught-up-to-told? (fn [_ _] false)
                :tell! (fn [role reason text wake?]
                         (swap! tells conj {:role role :reason (name reason) :wake? wake?})
                         {:success true})
                :log! (fn [& _] nil)}]
  (post-qa-branch-sweep-lib/sweep! dir "shaA" ["coder"] adapters)
  (assert= "BL-1421: a dirty AND in-process role is told for in-process-work, not dirty-worktree"
           "in-process-work" (:reason (first @tells)))
  (assert= "BL-1421: and never woken" false (boolean (:wake? (first @tells))))
  (fs/delete-tree dir))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: post_qa_branch_sweep_lib.bb")
