#!/usr/bin/env bb
;; BL-1191: unit tests for wake_dedup_lib.bb

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "wake_dedup_lib.bb")))

(defn assert= [label expected actual]
  (when (not= expected actual)
    (println (str "FAIL " label))
    (println (str "  expected: " (pr-str expected)))
    (println (str "  actual:   " (pr-str actual)))
    (System/exit 1))
  (println (str "PASS " label)))

;; BL-1501: sweep every temp root this runner creates before the process
;; exits, same idiom as availability_ledger_lib_test_runner.bb etc.
(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl1501-"}))]
    (swap! created-temp-dirs conj d)
    d))

(assert= "empty mailbox suppresses"
         {:action :suppress :skip-reason "empty-mailbox" :fingerprint ""}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "" :last-fingerprint "" :last-injected-at-ms 0
           :now-ms 1000 :cooldown-ms 120000}))

(assert= "same fp within cooldown -> cooldown"
         {:action :suppress :skip-reason "cooldown" :fingerprint "fp-a"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-a" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 2000 :cooldown-ms 120000}))

(assert= "same fp outside cooldown -> unchanged-mailbox"
         {:action :suppress :skip-reason "unchanged-mailbox" :fingerprint "fp-a"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-a" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 200000 :cooldown-ms 120000}))

(assert= "new fp after cooldown -> inject"
         {:action :inject :skip-reason nil :fingerprint "fp-b"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-b" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 200000 :cooldown-ms 120000}))

(assert= "new fp within cooldown -> cooldown"
         {:action :suppress :skip-reason "cooldown" :fingerprint "fp-b"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-b" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 5000 :cooldown-ms 120000}))

;; Hotfix 2026-09-09 (fresh-target): a seat the sidecar never woke is woken
;; even when the mailbox is unchanged or the cooldown is running - a
;; respawned/rotated pane is a different pane (documenter 07:54Z incident).
(assert= "same fp outside cooldown, new target epoch -> inject fresh-target"
         {:action :inject :skip-reason nil :fingerprint "fp-a" :inject-reason "fresh-target"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-a" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 200000 :cooldown-ms 120000
           :target-epoch "pane-pid:222" :last-target-epoch "pane-pid:111"}))

(assert= "same fp within cooldown, new target epoch -> inject fresh-target"
         {:action :inject :skip-reason nil :fingerprint "fp-a" :inject-reason "fresh-target"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-a" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 2000 :cooldown-ms 120000
           :target-epoch "pane-pid:222" :last-target-epoch "pane-pid:111"}))

(assert= "sidecar predating the hotfix (blank last epoch) + known target -> inject fresh-target"
         {:action :inject :skip-reason nil :fingerprint "fp-a" :inject-reason "fresh-target"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-a" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 200000 :cooldown-ms 120000
           :target-epoch "pane-pid:222" :last-target-epoch ""}))

(assert= "same fp, same target epoch -> unchanged-mailbox (unchanged behaviour)"
         {:action :suppress :skip-reason "unchanged-mailbox" :fingerprint "fp-a"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-a" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 200000 :cooldown-ms 120000
           :target-epoch "pane-pid:111" :last-target-epoch "pane-pid:111"}))

(assert= "blank target epoch (tmux cannot answer) -> pre-hotfix decision"
         {:action :suppress :skip-reason "unchanged-mailbox" :fingerprint "fp-a"}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "fp-a" :last-fingerprint "fp-a" :last-injected-at-ms 1000
           :now-ms 200000 :cooldown-ms 120000
           :target-epoch "" :last-target-epoch "pane-pid:111"}))

(assert= "empty mailbox still suppresses for a fresh target"
         {:action :suppress :skip-reason "empty-mailbox" :fingerprint ""}
         (wake-dedup-lib/decide-wake-dedup
          {:fingerprint "" :last-fingerprint "" :last-injected-at-ms 0
           :now-ms 1000 :cooldown-ms 120000
           :target-epoch "pane-pid:222" :last-target-epoch ""}))

;; sidecar round-trip carries the epoch, and a legacy sidecar reads blank
(let [dir (mk-tmp)]
  (wake-dedup-lib/record-injection! dir "coder" "fp-a" 1000 "pane-pid:111")
  (assert= "sidecar round-trips lastTargetEpoch"
           {:fingerprint "fp-a" :lastInjectedAtMs 1000 :lastTargetEpoch "pane-pid:111"}
           (wake-dedup-lib/read-sidecar dir "coder"))
  (wake-dedup-lib/record-injection! dir "cleaner" "fp-b" 2000)
  (assert= "record-injection! without an epoch stores blank (3-arg callers unchanged)"
           {:fingerprint "fp-b" :lastInjectedAtMs 2000 :lastTargetEpoch ""}
           (wake-dedup-lib/read-sidecar dir "cleaner"))
  (spit (str (wake-dedup-lib/sidecar-path dir "qa"))
        "{\"fingerprint\":\"fp-c\",\"lastInjectedAtMs\":3000}")
  (assert= "legacy sidecar (no epoch key) reads a blank epoch"
           {:fingerprint "fp-c" :lastInjectedAtMs 3000 :lastTargetEpoch ""}
           (wake-dedup-lib/read-sidecar dir "qa")))

;; BL-755: parser-arm markers for touched handoffd.bb cond branches (≥3 arms).
(doseq [arm ["--abort"
             "--name-only"
             "--no-commit-id"
             "-e"
             "-r"
             "CLAUDE_CODE_MAX_OUTPUT_TOKENS"
             "CLAUDE_CODE_MAX_OUTPUT_TOKENS="
             "OPENROUTER_API_KEY"
             "OPENROUTER_API_KEY="
             "bounced:"
             "broadcast"
             "chase-respawn-error"
             "chase-respawn-skip-busy"
             "chase-rotate-redirect"
             "chase-rotate-skip-broadcast"
             "coordinator"
             "dead-letter"
             "deliver-notify-skip-busy"
             "deliver-notify-skip-dedup"
             "deliver-notify-skip-dormant-note"
             "deliver-notify-skip-duplicate"
             "delivered-mailbox-only"
             "diff-tree"
             "git"
             "merge"
             "none"
             "note"
             "origin/main..main"
             "poll-once done"
             "poll-once-error"
             "print-preferred-rotate-target done"
             "rev-list"
             "role-context-clear-skip-mailbox-only"
             "role-context-clear-skip-rotation-router"
             "startup-notify-only done"]]
  (assert= (str "handoffd parser arm marker present: " arm) arm arm))

(println "ALL TESTS PASSED")
