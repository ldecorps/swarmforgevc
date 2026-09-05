#!/usr/bin/env bb

(ns done-with-current
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))

;; BL-652: refuse argv before receive-mode dispatch so a --help probe cannot
;; archive an in_process batch / task. BL-1422: --no-work "<reason>" is the
;; one exception refuse-unexpected-args! now lets through, and
;; run-dispatch-forwarding-args! carries it to done_with_current_task.sh.
(dispatch-lib/refuse-unexpected-args!)
(dispatch-lib/run-dispatch-forwarding-args! {"batch" "done_with_current_batch.sh" "task" "done_with_current_task.sh"})
