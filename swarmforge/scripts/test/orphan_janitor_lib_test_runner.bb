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

(assert= "Darwin TMPDIR tmp. checkout is a disposable root"
         true
         (orphan-janitor-lib/tmp-project-root?
          "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.HPODI2kV"))

(assert= "Darwin TMPDIR bl622 launch sandbox is a disposable root"
         true
         (orphan-janitor-lib/tmp-project-root?
          "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ"))

(assert= "host repo is never a disposable root"
         false
         (orphan-janitor-lib/tmp-project-root? "/home/carillon/swarmforgevc"))

(assert= "Darwin host repo under /Users is never a disposable root"
         false
         (orphan-janitor-lib/tmp-project-root? "/Users/ldecorps/projects/swarmforgevc"))

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

(assert= "extract Darwin TMPDIR disposable root from front-desk bot cmdline"
         "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.HPODI2kV"
         (orphan-janitor-lib/extract-disposable-root
          "node /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.HPODI2kV/extension/out/tools/telegram-front-desk-bot.js http://127.0.0.1:8765 /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.HPODI2kV"))

(assert= "extract Darwin bl622 launch root"
         "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ"
         (orphan-janitor-lib/extract-disposable-root
          "node /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ/extension/out/tools/start-bridge-headless.js /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ 8765"))

(assert= "tmp babysitter tmux detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "tmux -S /tmp/tmp.jIAp73PXra/.swarmforge/babysitter/babysitter-tmux.sock new-session -d -s babysitter"))

(assert= "Darwin TMPDIR telegram bot detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "node /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.HPODI2kV/extension/out/tools/telegram-front-desk-bot.js http://127.0.0.1:8765 /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.HPODI2kV"))

(assert= "Darwin bl622 bridge-headless detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "node /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ/extension/out/tools/start-bridge-headless.js /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ 8765"))

(assert= "worktree babysitterd.sh aimed at Darwin tmp root detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "bash /Users/ldecorps/projects/swarmforgevc/.worktrees/coder/swarmforge/scripts/babysitterd.sh /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.QnO5pbBA"))

(assert= "Darwin tmp bl647 tmux detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "tmux -S /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.NvLjaRF9/bl647.sock new-session -d -s swarmforge-coder -n agent"))

(assert= "Darwin tmp bl647 tmux with absolute binary path detected"
         true
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "/usr/local/bin/tmux -S /var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.yVt4bNQR/bl647.sock new-session -d -s swarmforge-coder -n agent"))

(assert= "host babysitterd.sh never detected as tmp ancillary"
         false
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "bash /Users/ldecorps/projects/swarmforgevc/swarmforge/scripts/babysitterd.sh /Users/ldecorps/projects/swarmforgevc"))

(assert= "host .swarmforge/tmux swarmforge-coder never detected as tmp ancillary"
         false
         (orphan-janitor-lib/tmp-ancillary-cmdline?
          "tmux -S /Users/ldecorps/projects/swarmforgevc/.swarmforge/tmux/3752320954.sock new-session -d -s swarmforge-coder -n swarm"))

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

(assert= "fresh parent-orphaned front-desk bridge/bot is reaped without age gate"
         true
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? false
           :tmp-rooted-ancillary? true
           :stale? false
           :parent-orphaned? true
           :front-desk-bridge-or-bot? true}))

(assert= "fresh parent-orphaned babysitter/tmux still needs the age gate"
         false
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? false
           :tmp-rooted-ancillary? true
           :stale? false
           :parent-orphaned? true
           :front-desk-bridge-or-bot? false}))

(assert= "fresh front-desk with living parent is not reaped"
         false
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? false
           :tmp-rooted-ancillary? true
           :stale? false
           :parent-orphaned? false
           :front-desk-bridge-or-bot? true}))

(assert= "stale front-desk with living parent still reaped via age gate"
         true
         (orphan-janitor-lib/reapable-tmp-ancillary?
          {:in-live-window-set? false
           :tmp-rooted-ancillary? true
           :stale? true
           :parent-orphaned? false
           :front-desk-bridge-or-bot? true}))

(assert= "front-desk bridge cmdline recognised"
         true
         (orphan-janitor-lib/front-desk-bridge-or-bot-cmdline?
          "node /tmp/tmp.VMn06cue6u/extension/out/tools/start-bridge-headless.js /tmp/tmp.VMn06cue6u 9001"))

(assert= "non-front-desk ancillary cmdline not recognised as bridge/bot"
         false
         (orphan-janitor-lib/front-desk-bridge-or-bot-cmdline?
          "tmux -S /tmp/tmp.jIAp73PXra/.swarmforge/babysitter/babysitter-tmux.sock new-session"))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "orphan_janitor_lib_test_runner: ALL CHECKS PASSED"))
