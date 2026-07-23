#!/usr/bin/env bb
;; Test-only harness for closing_context_clear_lib.bb's
;; evaluate-closing-context-clear! - drives the real library with fake
;; :inject-clear!/:inject-startup-reread!/:record-clear! adapters (no real
;; tmux) and injected state, printing a JSON result for acceptance step
;; handlers to assert against.
;;
;; Usage: closing_context_clear_harness.bb <idle:true|false> <closed-ticket-id|-> <last-cleared-ticket-id|->
;;   "-" means nil (no closed ticket / never cleared before).

(ns closing-context-clear-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "closing_context_clear_lib.bb")))

(defn- nil-dash [s] (when (not= s "-") s))

(def idle? (= "true" (nth *command-line-args* 0)))
(def closed-ticket-id (nil-dash (nth *command-line-args* 1)))
(def last-cleared-ticket-id (nil-dash (nth *command-line-args* 2)))

(def calls (atom []))

(def result
  (closing-context-clear-lib/evaluate-closing-context-clear!
   {:idle? idle?
    :closed-ticket-id closed-ticket-id
    :last-cleared-ticket-id last-cleared-ticket-id
    :role-name "coordinator"}
   {:inject-clear! (fn [] (swap! calls conj {:op "inject-clear"}))
    :inject-startup-reread! (fn [text] (swap! calls conj {:op "inject-startup-reread" :text text}))
    :record-clear! (fn [ticket-id] (swap! calls conj {:op "record-clear" :ticketId ticket-id}))}))

(println (json/generate-string {:action (name (or (:action result) "none")) :calls @calls}))
