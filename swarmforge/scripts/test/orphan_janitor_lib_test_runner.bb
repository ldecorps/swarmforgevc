#!/usr/bin/env bb
;; Unit tests for orphan_janitor_lib.bb (pure predicates only).
(ns orphan-janitor-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "orphan_janitor_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(assert= "tmp. prefix is a disposable root"
         true
         (orphan-janitor-lib/tmp-project-root? "/tmp/tmp.Y1XWgEKksC"))

(assert= "host repo is never a disposable root"
         false
         (orphan-janitor-lib/tmp-project-root? "/home/carillon/swarmforgevc"))

(assert= "operator_runtime cmdline detected"
         true
         (orphan-janitor-lib/operator-runtime-cmdline?
          "bb /x/swarmforge/scripts/operator_runtime.bb /tmp/tmp.abc"))

(assert= "parses operator_runtime project root"
         "/tmp/tmp.abc"
         (orphan-janitor-lib/parse-operator-runtime-root
          "bb /x/swarmforge/scripts/operator_runtime.bb /tmp/tmp.abc"))

(assert= "hung acceptance cmdline detected"
         true
         (orphan-janitor-lib/hung-acceptance-cmdline?
          "/usr/bin/node --test /home/carillon/swarmforgevc/specs/pipeline/generated/telegram-cursor-remote-operator-commands.generated.test.js"))

(assert= "bare node generated.test.js also detected"
         true
         (orphan-janitor-lib/hung-acceptance-cmdline?
          "/usr/bin/node /home/carillon/swarmforgevc/specs/pipeline/generated/telegram-cursor-remote-operator-commands.generated.test.js"))

(assert= "unrelated node not detected"
         false
         (orphan-janitor-lib/hung-acceptance-cmdline?
          "/usr/bin/node /home/carillon/swarmforgevc/extension/dist/foo.js"))

(assert= "tmp operator_runtime all gates clear -> reap"
         true
         (orphan-janitor-lib/reapable-tmp-operator-runtime?
          {:in-live-window-set? false
           :is-live-runtime-pid? false
           :tmp-project-root? true
           :stale? true}))

(assert= "live runtime pid never reaped"
         false
         (orphan-janitor-lib/reapable-tmp-operator-runtime?
          {:in-live-window-set? false
           :is-live-runtime-pid? true
           :tmp-project-root? true
           :stale? true}))

(assert= "live window set never reaped"
         false
         (orphan-janitor-lib/reapable-tmp-operator-runtime?
          {:in-live-window-set? true
           :is-live-runtime-pid? false
           :tmp-project-root? true
           :stale? true}))

(assert= "host-rooted operator_runtime never reaped via tmp gate"
         false
         (orphan-janitor-lib/reapable-tmp-operator-runtime?
          {:in-live-window-set? false
           :is-live-runtime-pid? false
           :tmp-project-root? false
           :stale? true}))

(assert= "fresh tmp operator_runtime not reaped"
         false
         (orphan-janitor-lib/reapable-tmp-operator-runtime?
          {:in-live-window-set? false
           :is-live-runtime-pid? false
           :tmp-project-root? true
           :stale? false}))

(assert= "hung acceptance all gates clear -> reap"
         true
         (orphan-janitor-lib/reapable-hung-acceptance?
          {:in-live-window-set? false
           :hung-acceptance? true
           :stale? true}))

(assert= "hung acceptance in live window never reaped"
         false
         (orphan-janitor-lib/reapable-hung-acceptance?
          {:in-live-window-set? true
           :hung-acceptance? true
           :stale? true}))

(assert= "extract disposable root from babysitter sock path"
         "/tmp/tmp.jIAp73PXra"
         (orphan-janitor-lib/extract-disposable-root
          "tmux -S /tmp/tmp.jIAp73PXra/.swarmforge/babysitter/babysitter-tmux.sock new-session"))

(assert= "tmp babysitter tmux detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "tmux -S /tmp/tmp.jIAp73PXra/.swarmforge/babysitter/babysitter-tmux.sock new-session -d -s babysitter"))

(assert= "tmp babysitter launch.sh detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "zsh /tmp/tmp.S1M6f9DBpl/.swarmforge/babysitter/launch.sh"))

(assert= "tmp bridge-headless detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "node /tmp/tmp.VMn06cue6u/extension/out/tools/start-bridge-headless.js /tmp/tmp.VMn06cue6u 9001"))

(assert= "tmp telegram bot detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "node /tmp/tmp.h1qM1ktZN2/extension/out/tools/telegram-front-desk-bot.js http://127.0.0.1:8765 /tmp/tmp.h1qM1ktZN2"))

(assert= "tmp claude Babysitter detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "claude --settings /tmp/tmp.S1M6f9DBpl/.swarmforge/babysitter/babysitter.claude-settings.json -n Babysitter Resume"))

(assert= "host bridge never detected as tmp ancillary"
         false
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "node /home/carillon/swarmforgevc/extension/out/tools/start-bridge-headless.js /home/carillon/swarmforgevc 8765"))

(assert= "host Operator claude never detected as tmp ancillary"
         false
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "claude --settings /home/carillon/swarmforgevc/swarmforge/scripts/operator.claude-settings.json -n Operator"))

(assert= "tmp ancillary all gates clear -> reap"
         true
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? false
           :tmp-rooted-ancillary? true
           :stale? true}))

(assert= "tmp ancillary in live window never reaped"
         false
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? true
           :tmp-rooted-ancillary? true
           :stale? true}))

(assert= "host-rooted ancillary never reaped"
         false
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? false
           :tmp-rooted-ancillary? false
           :stale? true}))

(assert= "fresh tmp ancillary not reaped"
         false
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? false
           :tmp-rooted-ancillary? true
           :stale? false}))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "orphan_janitor_lib_test_runner: ALL CHECKS PASSED"))
