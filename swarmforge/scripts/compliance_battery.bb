#!/usr/bin/env bb
;; BL-231: swarm-compliance battery CLI. Thin subcommand wrapper over
;; compliance_battery_lib.bb - each subcommand prints exactly one JSON
;; scorecard entry (or the aggregated scorecard) to stdout, so the
;; acceptance pipeline's JS step handlers can drive it via execFileSync
;; without re-implementing any check logic themselves (the same
;; "pure lib + thin CLI" split as backlog_depth_lib.bb/swarm_ensure.bb).
;;
;; Usage:
;;   compliance_battery.bb check receive <scratch-worktree>
;;   compliance_battery.bb check complete <scratch-worktree>
;;   compliance_battery.bb check send-handoff <scratch-root> <sender-role> <recipient-role>
;;   compliance_battery.bb check commit-byline <repo-root> <sha> <role>
;;   compliance_battery.bb check no-op-rule <scratch-root> <sender-role> <sha>
;;   compliance_battery.bb check no-scheduling <repo-root> <sha>
;;   compliance_battery.bb rubric <competency> [compliant|non-compliant]
;;   compliance_battery.bb gate specifier <feature-file> <repo-root>
;;   compliance_battery.bb gate coder <project-dir> <shell-cmd>
;;   compliance_battery.bb gate cleaner <project-dir> <shell-cmd> <after-sha>
;;   compliance_battery.bb gate architect <note-text-file> <repo-root>
;;   compliance_battery.bb gate hardener <complexity> <coverage-fraction> <mutants-survived>
;;   compliance_battery.bb gate documenter <repo-root> <sha>
;;   compliance_battery.bb gate qa <repo-root> <feature-file> <claimed-verdict>
;;   compliance_battery.bb gate coordinator <active-count> <max-depth> <candidate-promoted (true|false)>
;;   compliance_battery.bb scorecard <model-name> <entries-json-file>

(ns compliance-battery
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "compliance_battery_lib.bb")))

(defn- emit! [entry]
  (println (json/generate-string entry)))

(defn- usage-and-exit! []
  (binding [*out* *err*]
    (println "See file header for usage."))
  (System/exit 1))

(defn- dispatch-check [args]
  (let [[check & rest-args] args]
    (case check
      "receive" (emit! (compliance-battery-lib/check-receive (first rest-args)))
      "complete" (emit! (compliance-battery-lib/check-complete (first rest-args)))
      "send-handoff" (let [[root sender recipient] rest-args]
                       (emit! (compliance-battery-lib/check-send-handoff root sender recipient)))
      "commit-byline" (let [[repo-root sha role] rest-args]
                         (emit! (compliance-battery-lib/check-commit-byline repo-root sha role)))
      "no-op-rule" (let [[root sender sha] rest-args]
                     (emit! (compliance-battery-lib/check-no-op-rule root sender sha)))
      "no-scheduling" (let [[repo-root sha] rest-args]
                        (emit! (compliance-battery-lib/check-no-scheduling repo-root sha)))
      (usage-and-exit!))))

(defn- dispatch-gate [args]
  (let [[role & rest-args] args]
    (case role
      "specifier" (let [[feature-file repo-root] rest-args]
                    (emit! (compliance-battery-lib/gate-specifier feature-file repo-root)))
      "coder" (let [[project-dir shell-cmd] rest-args]
                (emit! (compliance-battery-lib/gate-build-and-test project-dir shell-cmd)))
      "cleaner" (let [[project-dir shell-cmd after-sha] rest-args]
                  (emit! (compliance-battery-lib/gate-cleaner project-dir shell-cmd after-sha)))
      "architect" (let [[note-text-file repo-root] rest-args]
                    (emit! (compliance-battery-lib/gate-architect (slurp note-text-file) repo-root)))
      "hardener" (let [[complexity coverage-fraction mutants-survived] rest-args]
                   (emit! (compliance-battery-lib/gate-hardener (Double/parseDouble complexity)
                                                                 (Double/parseDouble coverage-fraction)
                                                                 (Integer/parseInt mutants-survived))))
      "documenter" (let [[repo-root sha] rest-args]
                     (emit! (compliance-battery-lib/gate-documenter repo-root sha)))
      "qa" (let [[repo-root feature-file claimed-verdict] rest-args]
             (emit! (compliance-battery-lib/gate-qa repo-root feature-file claimed-verdict)))
      "coordinator" (let [[active-count max-depth candidate-promoted?] rest-args]
                      (emit! (compliance-battery-lib/gate-coordinator (Integer/parseInt active-count)
                                                                       (Integer/parseInt max-depth)
                                                                       (= "true" candidate-promoted?))))
      (usage-and-exit!))))

(defn- dispatch-rubric [args]
  (let [[competency verdict] args]
    (emit! (if verdict
             (compliance-battery-lib/rubric-entry competency (keyword verdict))
             (compliance-battery-lib/rubric-entry competency)))))

(defn- dispatch-scorecard [args]
  (let [[model entries-file] args
        entries (json/parse-string (slurp entries-file) true)]
    (emit! (compliance-battery-lib/scorecard model entries))))

(defn -main [& args]
  (let [[command & rest-args] args]
    (case command
      "check" (dispatch-check rest-args)
      "gate" (dispatch-gate rest-args)
      "rubric" (dispatch-rubric rest-args)
      "scorecard" (dispatch-scorecard rest-args)
      (usage-and-exit!))))

(apply -main *command-line-args*)
