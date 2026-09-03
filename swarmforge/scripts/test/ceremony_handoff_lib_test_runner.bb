#!/usr/bin/env bb
;; TDD runner for ceremony_handoff_lib.bb — BL-1360.
;;
;; The lib is PURE: argv in, a `field: value` draft out. It never sends, never
;; touches a mailbox and never shells out, so every claim below is checked
;; in-process with no fixture and no git (the CLI thin-wrapper rule - the
;; entry point beside it does nothing but hand what this returns to
;; swarm_handoff.sh).
;;
;; What is deliberately NOT asserted here: that the recipient list and
;; priority match handoff-protocol.md. Restating the document's values in a
;; test would be the fourth copy invariant 3 exists to prevent, so that claim
;; is pinned by PARSING the document, in
;; bl1360_ceremony_handoff_property_runner.bb (BL-897).

(ns ceremony-handoff-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ceremony_handoff_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(defn- draft-headers
  "The draft parsed back into a map, the way swarm_handoff.bb reads it."
  [draft]
  (into {}
        (for [line (str/split-lines (str/trim draft))
              :let [i (str/index-of line ": ")]
              :when i]
          [(subs line 0 i) (subs line (+ i 2))])))

;; ── parse-args: pure argv handling, so the CLI stays a thin wrapper ───────

(assert= "a bare ceremony name parses"
         {:ceremony "merge-up"}
         (ceremony-handoff-lib/parse-args ["merge-up"]))

(assert= "options after the name parse into facts"
         {:ceremony "merge-up" :ticket "BL-042" :commit "a1b2c3d4e5"}
         (ceremony-handoff-lib/parse-args ["merge-up" "--ticket" "BL-042" "--commit" "a1b2c3d4e5"]))

(assert= "options BEFORE the name parse identically - order is not a trap"
         {:ceremony "merge-up" :ticket "BL-042" :commit "a1b2c3d4e5"}
         (ceremony-handoff-lib/parse-args ["--ticket" "BL-042" "--commit" "a1b2c3d4e5" "merge-up"]))

(assert= "--dry-run is a flag, not a value-taking option"
         {:ceremony "bookkeep" :ticket "BL-042" :dry-run? true}
         (ceremony-handoff-lib/parse-args ["bookkeep" "--dry-run" "--ticket" "BL-042"]))

(assert= "no arguments at all is an error, not an empty send"
         {:error "no ceremony named"}
         (ceremony-handoff-lib/parse-args []))

(assert= "a flag with no ceremony is an error"
         {:error "no ceremony named"}
         (ceremony-handoff-lib/parse-args ["--dry-run"]))

(assert= "--ticket with no value is an error rather than a nil ticket"
         {:error "--ticket needs a value"}
         (ceremony-handoff-lib/parse-args ["merge-up" "--ticket"]))

(assert= "--commit with no value is an error rather than a nil commit"
         {:error "--commit needs a value"}
         (ceremony-handoff-lib/parse-args ["merge-up" "--commit"]))

(assert= "an unknown option is refused rather than swallowed as the ceremony"
         {:error "unknown option --recipients"}
         (ceremony-handoff-lib/parse-args ["merge-up" "--recipients" "coder"]))

;; A second positional would silently change which ceremony is sent. Refusing
;; is the only safe reading: the sender meant one of them and we cannot know
;; which.
(assert= "a second ceremony name is refused rather than silently overriding the first"
         {:error "more than one ceremony named: merge-up and bookkeep"}
         (ceremony-handoff-lib/parse-args ["merge-up" "bookkeep"]))

;; ── ceremony-names: what an unknown name is refused against ───────────────

(assert= "the defined ceremonies are listed in sorted order"
         ["bookkeep" "merge-up" "spec-ready"]
         (ceremony-handoff-lib/ceremony-names))

;; ── compose: the draft ────────────────────────────────────────────────────

(let [{:keys [draft error]} (ceremony-handoff-lib/compose
                             {:ceremony "merge-up" :ticket "BL-042" :commit "a1b2c3d4e5"})]
  (assert= "a complete merge-up composes without error" nil error)
  (let [h (draft-headers draft)]
    (assert= "the draft is a note, never a git_handoff" "note" (get h "type"))
    (assert= "the merge-up draft carries every worktree role in one comma list"
             "coder,cleaner,architect,hardender,documenter" (get h "to"))
    (assert= "the merge-up draft is priority 00" "00" (get h "priority"))
    (assert-true "the message names the ticket" (str/includes? (get h "message") "BL-042"))
    (assert-true "the message names the commit in full" (str/includes? (get h "message") "a1b2c3d4e5")))
  ;; The draft is what swarm_handoff.sh parses: header lines only, no body,
  ;; no JSON. A brace line would parse as an unknown header and be rejected.
  (assert-false "the draft carries no JSON" (str/includes? draft "{"))
  (assert= "the draft is exactly four header lines" 4 (count (str/split-lines (str/trim draft))))
  ;; Reserved/audit headers are tool-stamped; writing one is rejected.
  (doseq [reserved ["id:" "from:" "recipient:" "role:" "created_at:" "enqueued_at:" "non-forwarding:"]]
    (assert-false (str "the draft writes no reserved header " reserved)
                  (str/includes? draft reserved))))

(let [{:keys [draft]} (ceremony-handoff-lib/compose
                       {:ceremony "bookkeep" :ticket "BL-042" :commit "a1b2c3d4e5"})
      h (draft-headers draft)]
  (assert= "bookkeep goes to the coordinator alone" "coordinator" (get h "to"))
  (assert= "bookkeep is priority 00" "00" (get h "priority"))
  (assert-true "the bookkeep message names the ticket" (str/includes? (get h "message") "BL-042"))
  (assert-true "the bookkeep message names the commit" (str/includes? (get h "message") "a1b2c3d4e5")))

(let [{:keys [draft]} (ceremony-handoff-lib/compose {:ceremony "spec-ready" :ticket "BL-042"})
      h (draft-headers draft)]
  (assert= "spec-ready goes to the coordinator" "coordinator" (get h "to"))
  (assert-true "the spec-ready message names the ticket" (str/includes? (get h "message") "BL-042")))

;; ── compose: refusals ─────────────────────────────────────────────────────

(let [{:keys [error draft]} (ceremony-handoff-lib/compose {:ceremony "merge-down" :ticket "BL-042"})]
  (assert-true "an unknown ceremony is refused" (some? error))
  (assert= "an unknown ceremony composes no draft" nil draft)
  (assert-true "the refusal names the unknown ceremony" (str/includes? error "merge-down"))
  (doseq [known (ceremony-handoff-lib/ceremony-names)]
    (assert-true (str "the refusal lists the defined ceremony " known) (str/includes? error known))))

(let [{:keys [error]} (ceremony-handoff-lib/compose {:ceremony "merge-up" :ticket "BL-042"})]
  (assert-true "merge-up without a commit is refused" (some? error))
  (assert-true "the refusal names the missing fact" (str/includes? error "commit"))
  (assert-true "the refusal names the option that supplies it" (str/includes? error "--commit")))

(let [{:keys [error]} (ceremony-handoff-lib/compose {:ceremony "merge-up" :commit "a1b2c3d4e5"})]
  (assert-true "merge-up without a ticket is refused" (some? error))
  (assert-true "the refusal names the missing ticket" (str/includes? error "ticket")))

(let [{:keys [error]} (ceremony-handoff-lib/compose {:ceremony "merge-up" :ticket "   " :commit "a1b2c3d4e5"})]
  (assert-true "a blank ticket is missing, not present-and-empty" (some? error)))

;; spec-ready needs no commit, so supplying none must NOT be refused - the
;; needs list is per-ceremony, not one global rule.
(assert= "spec-ready composes with no commit at all"
         nil
         (:error (ceremony-handoff-lib/compose {:ceremony "spec-ready" :ticket "BL-042"})))

;; ── the cap: shortened in prose, never truncated ──────────────────────────

(let [long-ticket (apply str "BL-042-" (repeat 60 "x"))
      {:keys [error message]} (ceremony-handoff-lib/compose
                               {:ceremony "merge-up" :ticket long-ticket :commit "a1b2c3d4e5"})]
  (assert-true "a ticket id too long for any form is refused rather than cut" (some? error))
  (assert= "nothing is composed when nothing fits" nil message)
  (assert-true "the refusal explains that truncating was the alternative"
               (str/includes? error "truncat")))

;; The middle case is the one that matters: too long for the roomy form, short
;; enough for the terse one. The prose gives way; the two facts do not.
(let [ticket "BL-1360-a-ceremony-handoffs"
      roomy (str ticket " QA-approved a1b2c3d4e5 - merge your branch up to QA's")
      {:keys [message error]} (ceremony-handoff-lib/compose
                               {:ceremony "merge-up" :ticket ticket :commit "a1b2c3d4e5"})]
  ;; Non-vacuity premise: this ticket length is chosen so the ROOMY form does
  ;; not fit. Without it the assertions below would pass on the roomy form and
  ;; prove nothing about shortening at all.
  (assert-true "premise: the roomy form does not fit this ticket"
               (> (count roomy) ceremony-handoff-lib/message-max-chars))
  (assert= "a mid-length ticket still composes" nil error)
  (assert-true "the shortened message still names the ticket in full" (str/includes? message ticket))
  (assert-true "the shortened message still names the commit in full" (str/includes? message "a1b2c3d4e5"))
  (assert-true "the shortened message is within the cap"
               (<= (count message) ceremony-handoff-lib/message-max-chars))
  (assert-true "the prose gave way, not the facts - the terse form was chosen"
               (str/ends-with? message "- merge up")))

;; ── report ────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "ceremony_handoff_lib: ALL PASS"))
