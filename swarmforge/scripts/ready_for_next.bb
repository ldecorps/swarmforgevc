#!/usr/bin/env bb

(ns ready-for-next
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))

(dispatch-lib/run-dispatch! {"batch" "ready_for_next_batch.sh" "task" "ready_for_next_task.sh"})
