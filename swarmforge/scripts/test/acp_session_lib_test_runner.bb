#!/usr/bin/env bb
;; BL-1081: the deterministic layer's ACP view.

(ns acp-session-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "acp_session_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def tmp (str (fs/create-temp-dir {:prefix "bl1081-acp-"})))
(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (try (fs/delete-tree tmp) (catch Exception _ nil)))))

(defn write-snapshot! [role m]
  (fs/create-dirs (fs/path tmp ".swarmforge" "acp"))
  (spit (str (acp-session-lib/snapshot-path tmp role)) (json/generate-string m)))

;; ── a seat with no host is simply not ACP-hosted ─────────────────────────
(assert= "no snapshot file means not ACP-hosted" nil (acp-session-lib/read-snapshot tmp "cleaner"))
(assert= "and the ordinary pane menu check still applies to it"
         true (acp-session-lib/menu-check-applies? (acp-session-lib/read-snapshot tmp "cleaner")))
(assert= "and no idle decision is offered - this widens no other path"
         nil (acp-session-lib/idle-decision (acp-session-lib/read-snapshot tmp "cleaner")))

;; ── an idle ACP seat ─────────────────────────────────────────────────────
(write-snapshot! "coder" {:role "coder" :acp true :stopReason "end_turn" :idle true
                          :idleFrom "stop_reason:end_turn" :permissionPending false
                          :permissionTool nil :turnsEnded 1})
(let [s (acp-session-lib/read-snapshot tmp "coder")]
  (assert= "an ACP seat reads as ACP-hosted" true (acp-session-lib/acp-hosted? s))
  (assert= "the stop reason is available as a fact" "end_turn" (acp-session-lib/stop-reason s))
  (assert= "the seat is idle" true (:idle? (acp-session-lib/idle-decision s)))
  (assert= "and the verdict names the fact it came from" "stop_reason:end_turn"
           (:from (acp-session-lib/idle-decision s)))
  (assert= "the menu check does NOT apply to it" false (acp-session-lib/menu-check-applies? s))
  (assert= "and it is not blocked" false (acp-session-lib/permission-pending? s)))

;; ── mid-turn ─────────────────────────────────────────────────────────────
(write-snapshot! "midturn" {:role "midturn" :acp true :stopReason nil :idle false
                            :idleFrom "no_turn_ended" :permissionPending false
                            :permissionTool nil :turnsEnded 0})
(let [s (acp-session-lib/read-snapshot tmp "midturn")]
  (assert= "no turn ended means no stop reason" nil (acp-session-lib/stop-reason s))
  (assert= "and the seat is not idle - quiet is not done" false (:idle? (acp-session-lib/idle-decision s))))

;; ── blocked on a permission moment ───────────────────────────────────────
(write-snapshot! "blocked" {:role "blocked" :acp true :stopReason nil :idle false
                            :idleFrom "permission_requested:write_file" :permissionPending true
                            :permissionTool "write_file" :turnsEnded 0})
(let [s (acp-session-lib/read-snapshot tmp "blocked")]
  (assert= "a blocked seat is reported blocked" true (acp-session-lib/permission-pending? s))
  (assert= "and is NOT idle - blocked and idle need different responses"
           false (:idle? (acp-session-lib/idle-decision s)))
  (assert= "and the menu CRIT still does not fire for it"
           false (acp-session-lib/menu-check-applies? s)))

;; ── fail-safe: a corrupt or non-ACP file degrades to the pane path ───────
(fs/create-dirs (fs/path tmp ".swarmforge" "acp"))
(spit (str (acp-session-lib/snapshot-path tmp "corrupt")) "{not json")
(assert= "a corrupt snapshot reads as absent, never as a verdict"
         nil (acp-session-lib/read-snapshot tmp "corrupt"))
(assert= "so the ordinary pane checks keep applying to that seat"
         true (acp-session-lib/menu-check-applies? (acp-session-lib/read-snapshot tmp "corrupt")))

(write-snapshot! "notacp" {:role "notacp" :idle true})
(assert= "a file without :acp true is not an ACP snapshot"
         nil (acp-session-lib/read-snapshot tmp "notacp"))

;; The path must agree with acpHostRuntime.ts's own - held by the agreement
;; runner beside this one, not by a comment.
(assert= "the snapshot path is one file per seat"
         (str (fs/path tmp ".swarmforge" "acp" "coder.json"))
         (str (acp-session-lib/snapshot-path tmp "coder")))

;; ── the babysitter's decision site: ACP facts fold into the assess input ──
;; BL-1081 required_wiring: babysitter_assess.bb takes the idle/stuck decision
;; for an ACP seat from the structured stop reason. That merge is pure and
;; lives here so it is testable, because babysitter_assess.bb itself is a
;; top-level script that exits.

(def pane-input
  {:role "coder" :class :standing :alive? true
   :pane-tail "some rendered transcript" :in-process-count 1
   :loop-signal :none :idle-ms 900000})

;; A seat with no ACP host: nothing about the ordinary path may move.
(let [s (acp-session-lib/read-snapshot tmp "cleaner")
      out (acp-session-lib/apply-acp-facts pane-input s (acp-session-lib/stop-reason s))]
  (assert= "a non-ACP seat keeps every pane-derived key untouched"
           pane-input (select-keys out (keys pane-input)))
  (assert= "and is marked not ACP-hosted" false (:acp? out))
  (assert= "with no ACP idle verdict to override the pane path" nil (:acp-idle? out))
  (assert= "its verdict still comes from the pane" "pane" (:idle-from out))
  (assert= "and the interactive-menu CRIT still applies to it"
           true (:menu-check-applies? out)))

;; An idle ACP seat: the verdict comes from the stop reason, and the pane tail
;; SURVIVES (invariant 2 - the babysitter's pane checks are not blinded).
(let [s (acp-session-lib/read-snapshot tmp "coder")
      out (acp-session-lib/apply-acp-facts pane-input s (acp-session-lib/stop-reason s))]
  (assert= "an ACP seat is marked ACP-hosted at the decision site" true (:acp? out))
  (assert= "the stop reason travels with the assessment" "end_turn" (:stop-reason out))
  (assert= "the idle verdict is the structured one" true (:acp-idle? out))
  (assert= "and names the fact it came from, never a pane excerpt"
           "stop_reason:end_turn" (:idle-from out))
  (assert= "the menu CRIT does not fire for it" false (:menu-check-applies? out))
  (assert= "and the pane tail is still handed to the assessor"
           (:pane-tail pane-input) (:pane-tail out)))

;; A blocked ACP seat is blocked, not idle - different conditions, different
;; responses, and conflating them is how a permission moment read as a stall.
(let [s (acp-session-lib/read-snapshot tmp "blocked")
      out (acp-session-lib/apply-acp-facts pane-input s (acp-session-lib/stop-reason s))]
  (assert= "a blocked seat is reported blocked" true (:permission-pending? out))
  (assert= "and is not idle" false (:acp-idle? out))
  (assert= "its verdict names the permission request" "permission_requested:write_file"
           (:idle-from out)))

;; The caller passes the stop reason in BECAUSE the caller is the decision
;; site. A caller naming a different one is deciding on a stale fact, and that
;; must be loud rather than silently preferred either way.
(let [s (acp-session-lib/read-snapshot tmp "coder")
      threw? (try (acp-session-lib/apply-acp-facts pane-input s "max_tokens") false
                  (catch Exception _ true))]
  (assert= "a caller whose stop reason disagrees with the snapshot is rejected" true threw?))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "acp_session_lib_test_runner: ok"))
