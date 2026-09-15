#!/usr/bin/env bb
;; BL-1462: prints the REAL pre_qa_gate_gather_lib.bb's find-ticket-yaml-content
;; result for a project root + ticket id, so the Node test suite (which has
;; no path to a .bb lib) can compare behavior against it without a second,
;; hand-mirrored copy of the search order. Deliberately a thin CLI over the
;; real function - never a reimplementation.
;;
;; Usage: bl1462_find_ticket_yaml_runner.bb <project-root> <ticket-id>
;; Prints the found YAML's raw content on stdout, or nothing (exit 1) when
;; not found.

(require '[babashka.fs :as fs])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "pre_qa_gate_gather_lib.bb")))

(let [[project-root ticket-id] *command-line-args*]
  (when (or (nil? project-root) (nil? ticket-id))
    (binding [*out* *err*]
      (println "Usage: bl1462_find_ticket_yaml_runner.bb <project-root> <ticket-id>"))
    (System/exit 2))
  (if-let [content (pre-qa-gate-gather-lib/find-ticket-yaml-content project-root ticket-id)]
    (print content)
    (System/exit 1)))
