#!/usr/bin/env bb
;; TDD runner for qa_hold_lib.bb (BL-1566) - pure assertions, no filesystem.
(ns qa-hold-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "qa_hold_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def RED-A "extension/test/a.property.test.js")
(def RED-B "extension/test/b.property.test.js")

(defn register-row [file ticket]
  {:lane "property" :file file :ticket ticket :first-seen "2026-09-14" :note ""})

;; ── red-owner ─────────────────────────────────────────────────────────────
(assert= "no register row names the red -> nil"
         nil
         (qa-hold-lib/red-owner [] RED-A))

(assert= "a register row naming the red returns its ticket, lane ignored"
         "BL-9001"
         (qa-hold-lib/red-owner [(register-row RED-A "BL-9001")] RED-A))

;; ── release? ──────────────────────────────────────────────────────────────
(assert= "01: an open hold with no register rows is never released"
         false
         (qa-hold-lib/release? {:reds [RED-A RED-B]} [] #{}))

(assert= "02 row1: one red unowned (owner none) -> never released"
         false
         (qa-hold-lib/release? {:reds [RED-A RED-B]}
                                [(register-row RED-A "BL-9001")]
                                #{"BL-9001"}))

(assert= "02 row2: both reds owned by open tickets -> released"
         true
         (qa-hold-lib/release? {:reds [RED-A RED-B]}
                                [(register-row RED-A "BL-9001") (register-row RED-B "BL-9002")]
                                #{"BL-9001" "BL-9002"}))

(assert= "02 row3: one owner's ticket is NOT in the open set (done/) -> never released"
         false
         (qa-hold-lib/release? {:reds [RED-A RED-B]}
                                [(register-row RED-A "BL-9001") (register-row RED-B "BL-9002")]
                                #{"BL-9002"}))

(assert= "a hold naming no reds is never released"
         false
         (qa-hold-lib/release? {:reds []}
                                [(register-row RED-A "BL-9001")]
                                #{"BL-9001"}))

;; ── hold-status-lines / status-lines ────────────────────────────────────
(assert= "01: an open hold prints a HOLD line per red, owner none, no RELEASED line"
         ["HOLD BL-9000-held abcdef0123 red=extension/test/a.property.test.js owner=none"
          "HOLD BL-9000-held abcdef0123 red=extension/test/b.property.test.js owner=none"]
         (qa-hold-lib/hold-status-lines {:task "BL-9000-held" :commit "abcdef0123" :reds [RED-A RED-B]} [] #{}))

(assert= "an open hold names each red's owner when the register has one but it is not open"
         ["HOLD BL-9000-held abcdef0123 red=extension/test/a.property.test.js owner=BL-9001"]
         (qa-hold-lib/hold-status-lines {:task "BL-9000-held" :commit "abcdef0123" :reds [RED-A]}
                                        [(register-row RED-A "BL-9001")] #{}))

(assert= "a released hold prints exactly one RELEASED line, no HOLD lines"
         ["RELEASED BL-9000-held abcdef0123"]
         (qa-hold-lib/hold-status-lines {:task "BL-9000-held" :commit "abcdef0123" :reds [RED-A RED-B]}
                                        [(register-row RED-A "BL-9001") (register-row RED-B "BL-9002")]
                                        #{"BL-9001" "BL-9002"}))

(assert= "status-lines concatenates every hold's own lines in hold order, decided independently per hold"
         ["RELEASED T1 c1" "HOLD T2 c2 red=extension/test/b.property.test.js owner=none"]
         (qa-hold-lib/status-lines
          [{:task "T1" :commit "c1" :reds [RED-A]}
           {:task "T2" :commit "c2" :reds [RED-B]}]
          [(register-row RED-A "BL-9001")]
          #{"BL-9001"}))

;; ── released-holds ────────────────────────────────────────────────────────
(assert= "released-holds filters to only the released ones, in order"
         [{:task "T1" :commit "c1" :reds [RED-A]}]
         (qa-hold-lib/released-holds
          [{:task "T1" :commit "c1" :reds [RED-A]}
           {:task "T2" :commit "c2" :reds [RED-B]}]
          [(register-row RED-A "BL-9001")]
          #{"BL-9001"}))

;; ── blocks-completion? ────────────────────────────────────────────────────
(def released-hold {:task "BL-9000-held" :commit "abcdef0123" :reds [RED-A]})
(def register-rows [(register-row RED-A "BL-9001")])
(def open-ids #{"BL-9001"})

(assert= "03: a released hold blocks completing a NOTE as QA"
         true
         (qa-hold-lib/blocks-completion?
          {:role "QA" :inbound-type "note" :holds [released-hold]
           :register-rows register-rows :open-ticket-ids open-ids}))

(assert= "04: a released hold never blocks completing a git_handoff (parking)"
         false
         (qa-hold-lib/blocks-completion?
          {:role "QA" :inbound-type "git_handoff" :holds [released-hold]
           :register-rows register-rows :open-ticket-ids open-ids}))

(assert= "an UNRELEASED hold never blocks completing a note either"
         false
         (qa-hold-lib/blocks-completion?
          {:role "QA" :inbound-type "note" :holds [{:task "T" :commit "c" :reds [RED-A]}]
           :register-rows [] :open-ticket-ids #{}}))

(assert= "a note completion is never blocked for a non-QA role, even with a released hold"
         false
         (qa-hold-lib/blocks-completion?
          {:role "coder" :inbound-type "note" :holds [released-hold]
           :register-rows register-rows :open-ticket-ids open-ids}))

(assert= "no holds at all never blocks"
         false
         (qa-hold-lib/blocks-completion?
          {:role "QA" :inbound-type "note" :holds []
           :register-rows [] :open-ticket-ids #{}}))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: qa_hold_lib.bb"))
