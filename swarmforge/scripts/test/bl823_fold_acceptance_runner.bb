#!/usr/bin/env bb
;; BL-823 acceptance glue: drives the REAL availability_ledger_lib.bb
;; fold/read side against a fixture root's ledger files (written by the
;; step handler in the exact production JSONL shape) and prints the
;; resulting intervals as JSON - never a hand-rolled reimplementation of
;; the fold logic itself.
;;
;; Usage: bb bl823_fold_acceptance_runner.bb <root>

(ns bl823-fold-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "availability_ledger_lib.bb")))

(let [root (first *command-line-args*)]
  (println (json/generate-string (availability-ledger-lib/fold root))))
