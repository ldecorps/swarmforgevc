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
