#!/usr/bin/env bb

(ns done-with-current
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))

;; BL-652: refuse argv before receive-mode dispatch so a --help probe cannot
;; archive an in_process batch / task.
(dispatch-lib/refuse-unexpected-args!)
(dispatch-lib/run-dispatch! {"batch" "done_with_current_batch.sh" "task" "done_with_current_task.sh"})
