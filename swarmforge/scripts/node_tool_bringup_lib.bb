#!/usr/bin/env bb
;; node_tool_bringup_lib.bb — BL-1010: what to say when a compiled node tool is
;; not there.
;;
;; handoffd shells out to compiled TypeScript CLIs (Babashka cannot import
;; them). On a checkout that has never been built, `node <path>` fails with a
;; module-not-found naming extension/out/tools/<tool>.js - a BUILD ARTIFACT,
;; not the bring-up step that is missing. The WSL2 secondary swarm reported
;; exactly that every handoffd cycle: a loud, repeated, unactionable error.
;;
;; Pure by design: this lib is load-file'd into the daemon, so it sits inside
;; the BL-1022 subprocess-API ban closure. It decides text and nothing else.

(ns node-tool-bringup-lib
  (:require [clojure.string :as str]))

;; npm runs from extension/, never the repo root - the root's package-lock.json
;; is a stray artifact and installing from there rewrites it before failing.
(def bring-up-command "npm install && npm run compile")
(def bring-up-dir "extension/")

(defn missing-tool-message
  "Pure: the operator-facing reason a compiled node tool could not be run.
   Names the STEP to run, not just the artifact that is absent - an error that
   names only the missing file sends the reader looking for a build output
   instead of running the build."
  [tool-name cli-path]
  (str "cannot publish: " tool-name " has never been compiled in this checkout"
       " (" cli-path " does not exist)"
       " - run `" bring-up-command "` in " bring-up-dir " to bring this swarm up"))

(defn names-bring-up-step?
  "Does `message` actually tell the reader what to run? The gate for the above:
   a message naming only the artifact fails this, which is the defect BL-1010
   is about."
  [message]
  (and (string? message)
       (str/includes? message bring-up-command)
       (str/includes? message bring-up-dir)))
