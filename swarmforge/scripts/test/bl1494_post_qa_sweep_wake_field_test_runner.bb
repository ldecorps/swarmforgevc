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
;;
;; BL-1516: this runner drives a REAL writer (post-qa-branch-sweep-tell!
;; writes handoffd.log and dispatch-gap-drafts/draft-*.txt under
;; project-root/.swarmforge/daemon/) through handoffd.bb's own BL-1395
;; probe path - the one live case the probe's inert placeholder was never
;; meant to cover. project-root resolves from *command-line-args*, which
;; `binding` (not alter-var-root - that did NOT take effect, verified)
;; rebinds to a fresh mkdtemp root for the duration of the load, so this
;; runner's own writes land under a throwaway temp dir it controls and
;; removes, never at the top level of whatever the caller's cwd happens
;; to be (observed live: a literal ./bl1395-load-probe-no-root directory
;; at the repo root, this exact runner invoked with no args).
;;
;; SWARMFORGE_ALLOW_TMP_DAEMON=1 (BL-406) is required for a tmp-rooted
;; project-root at all; exported here (bl1458's own idiom) so no caller
;; has to remember it.

(require '[babashka.fs :as fs])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))

;; Re-exec self with the env var set BEFORE creating our own fixture root -
;; bb has no setenv for the CURRENT process and handoffd.bb reads the
;; process env directly, so the child gets its own fresh root and this
;; process (the parent) never creates one it would only have to discard.
(when (nil? (System/getenv "SWARMFORGE_ALLOW_TMP_DAEMON"))
  (let [{:keys [exit out err]} (babashka.process/shell
                                 {:continue true :out :string :err :string
                                  :extra-env {"SWARMFORGE_ALLOW_TMP_DAEMON" "1"}}
                                 "bb" (str *file*))]
    (print out) (flush)
    (binding [*out* *err*] (print err) (flush))
    (System/exit exit)))

(def probe-root (str (fs/create-temp-dir {:prefix "bl1494-handoffd-probe-"})))

(binding [*command-line-args* [probe-root]]
  (load-file (str (fs/path scripts-dir "handoffd.bb"))))
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

;; BL-1516: try/finally, not a bare trailing delete-tree - a thrown
;; assertion or an unexpected exception inside the loop would otherwise
;; skip the cleanup entirely and leak probe-root (tempDirTrapGuard's own
;; guard: every fs/create-temp-dir needs a shutdown hook or a try/finally).
(try
  (doseq [[reason expected-wake] examples]
    ;; wake? is derived the same way production sweep! derives it - via
    ;; the real wake-for-reason?, never hand-picked per example row.
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
  (finally
    (fs/delete-tree probe-root {:force true})))

(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println (str "FAIL: " f)))
      (System/exit 1)))
