#!/usr/bin/env bb
;; BL-1494 acceptance scenario 04 (Scenario Outline): the post-QA branch
;; sweep's tell! writes wake: defer on the draft for every surfacing reason
;; except a dirty worktree - the one reason BL-1361's ruling says still
;; wakes. Drives the REAL post-qa-branch-sweep-tell! (handoffd.bb) and the
;; REAL wake-for-reason? (post_qa_branch_sweep_lib.bb) that decides the
;; wake? argument sweep! passes it - the exact composition production code
;; runs - with the one subprocess call (daemon-cycle-guard-lib/sh!,
;; spawning swarm_handoff.bb) stubbed to capture the draft instead of
;; actually sending, so this stays a fast, tmux-free unit check.
;;
;; handoffd.bb's `(apply -main ...)` is BL-1395-guarded
;; (`(when (= *file* (System/getProperty "babashka.file")) (-main))`), so
;; load-file here analyses it silently - it never starts the daemon.

(require '[babashka.fs :as fs])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))

(load-file (str (fs/path scripts-dir "handoffd.bb")))
(load-file (str (fs/path scripts-dir "post_qa_branch_sweep_lib.bb")))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))
(defn pass! [msg] (println (str "PASS: " msg)))

(def captured (atom nil))

(defn tell-and-capture! [role reason text wake?]
  (reset! captured nil)
  (with-redefs [daemon-cycle-guard-lib/sh!
                (fn [cmd & _rest]
                  (reset! captured (slurp (last cmd)))
                  {:exit 0 :out "" :err ""})]
    (handoffd/post-qa-branch-sweep-tell! role reason text wake?))
  @captured)

;; Examples table from the feature file: reason -> expected wake field.
(def examples
  [[:divergent-branch "defer"]
   [:in-process-work "defer"]
   [:dirty-worktree "absent"]])

(doseq [[reason expected-wake] examples]
  ;; wake? is derived the same way production sweep! derives it - via the
  ;; real wake-for-reason?, never hand-picked per example row.
  (let [wake? (post-qa-branch-sweep-lib/wake-for-reason? reason)
        draft (tell-and-capture! "cleaner" reason "branch behind abcdefabcd: probe" wake?)
        has-wake-line? (boolean (re-find #"(?m)^wake: defer$" (or draft "")))]
    (case expected-wake
      "defer"
      (if has-wake-line?
        (pass! (str "04 (" (name reason) "): the wake field of the note it sends is \"defer\""))
        (fail! (str "04 (" (name reason) "): expected wake: defer on the draft, got:\n" draft)))

      "absent"
      (if has-wake-line?
        (fail! (str "04 (" (name reason) "): expected NO wake header (this reason wakes), got:\n" draft))
        (pass! (str "04 (" (name reason) "): the wake field of the note it sends is \"absent\""))))))

(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println (str "FAIL: " f)))
      (System/exit 1)))
