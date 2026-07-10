#!/usr/bin/env bb
;; Test-only harness for agent_runtime_lib.bb's BL-207 classify-provider-error
;; - prints {:category :detail} as JSON so acceptance step handlers can
;; assert against the real bb classifier (and compare it against the real
;; TS classifyProviderError for cross-language parity).
;;
;; Usage: classify_provider_error_harness.bb <detail> [code]

(ns classify-provider-error-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "agent_runtime_lib.bb")))

(def detail (nth *command-line-args* 0))
(def code (nth *command-line-args* 1 nil))

(def result (agent-runtime-lib/classify-provider-error detail code))

(println (json/generate-string {:category (name (:category result)) :detail (:detail result)}))
