#!/usr/bin/env bb
;; BL-1253's second declared invariant, coder-authored (BL-654), as a PROPERTY
;; test over hotfix_certification_lib.bb's shipped decision core:
;;
;;   "Green tests alone never write certified or waived into the hotfix
;;    ledger; only a recorded human decision does."
;;
;; The claim is about the ONE function that decides a ledger row's state, so
;; it is asked of that function rather than of a description of it. Everything
;; a green suite could plausibly present to the ledger - a stamp ticket that
;; reached done, an approved human_approval flag, an absent ticket - is drawn,
;; and the state may still only be certified or waived when human-decision
;; itself says so.
;;
;; The FIRST declared invariant - "this stamp-off never reimplements the
;; hotfix" - carries a stated reason instead of a property test, per the
;; coder's invariant contract: it quantifies over this PARCEL's diff, not over
;; a pure module's state space, so there is nothing to generate. It is checked
;; executably instead, deterministically, in the acceptance Background (the
;; hotfix's three source paths are unmodified by this parcel and still carry
;; what landed at 2ec06b6ef1) and in scenario 05 (the ledger file is untouched
;; by this parcel). Generating "arbitrary path sets" and asserting a predicate
;; over them would test a fixture, not the parcel.
;;
;; Deterministic by construction: a seeded LCG, never rand.
;;
;; GENERATOR REACH. human-decision is drawn from the two deciding values and
;; the two non-deciding ones (nil and a blank), and EVERY other field is drawn
;; independently across its full range - the point being that no combination
;; of them may reach certified/waived on its own. The all-green combination -
;; ticket done, human_approval approved, no human decision - is the one a
;; green suite actually presents, so it has its own floor rather than being
;; left to chance.
;;
;; Non-vacuity is proven by breaking the invariant and recording the result -
;; see backlog/evidence/BL-1253-stamp-2ec06b6ef1-20260830.md.

(ns bl1253-stamp-ledger-human-decision-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "hotfix_certification_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {}))
(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result) (report! prop s input (str result)))
        (recur (inc i) s')))))

;; The two values that ARE a human decision, and two that are not. A blank
;; string is included deliberately: an empty field in the YAML must not read
;; as a decision.
(def human-decisions [nil "" "approved" "waived"])
(def stamp-tickets [nil "BL-1253" "BL-1260"])
(def ticket-statuses [nil "todo" "in-progress" "done"])
(def approvals [nil "pending" "approved"])

;; CONSTRUCTED, not sampled. Drawing the four fields independently puts the
;; all-green shape at 1-in-48 and its floor becomes a lottery - the failure
;; mode this repo has now hit three times. The shape is drawn first and its
;; fields are then built to match, so every case that matters is reached by
;; construction and the wide draw remains underneath it.
(defn gen-entry [s]
  (let [[shape s0] (gen-pick s [:green-suite-no-decision :decided :wide])]
    (case shape
      :green-suite-no-decision
      (let [[human-decision s1] (gen-pick s0 [nil ""])
            [ticket s2] (gen-pick s1 (remove nil? stamp-tickets))]
        [{:human-decision human-decision :stamp-ticket ticket
          :stamp-ticket-status "done" :stamp-ticket-human-approval "approved"}
         s2])

      :decided
      (let [[human-decision s1] (gen-pick s0 ["approved" "waived"])
            [ticket s2] (gen-pick s1 stamp-tickets)
            [status s3] (gen-pick s2 ticket-statuses)
            [approval s4] (gen-pick s3 approvals)]
        [{:human-decision human-decision :stamp-ticket ticket
          :stamp-ticket-status status :stamp-ticket-human-approval approval}
         s4])

      (let [[human-decision s1] (gen-pick s0 human-decisions)
            [ticket s2] (gen-pick s1 stamp-tickets)
            [status s3] (gen-pick s2 ticket-statuses)
            [approval s4] (gen-pick s3 approvals)]
        [{:human-decision human-decision :stamp-ticket ticket
          :stamp-ticket-status status :stamp-ticket-human-approval approval}
         s4]))))

(def deciding #{"approved" "waived"})

(check-all
 "P1: certified/waived is reachable ONLY from a recorded human decision"
 gen-entry
 (fn [{:keys [human-decision stamp-ticket stamp-ticket-status stamp-ticket-human-approval] :as entry}]
   (let [decided? (contains? deciding human-decision)]
     (cover! (if decided? :human-decided :no-human-decision))
     ;; The all-green shape: everything a passing suite can put on the table.
     (when (and (not decided?) (= "done" stamp-ticket-status)
                (= "approved" stamp-ticket-human-approval) stamp-ticket)
       (cover! :green-suite-no-decision))
     (when (and (not decided?) (= "" human-decision)) (cover! :blank-decision))
     (when (nil? stamp-ticket) (cover! :no-stamp-ticket))
     (let [{:keys [state open?]} (hotfix-certification-lib/decide-entry-state entry)
           final? (contains? #{"certified" "waived"} state)]
       (cond
         (and final? (not decided?))
         (str "state " state " was reached with human-decision " (pr-str human-decision))
         ;; ...and the other direction, so the invariant is not satisfiable by
         ;; a function that never finalises anything.
         (and decided? (not final?))
         (str "a recorded human decision " (pr-str human-decision) " produced state " state)
         (and decided? (= "approved" human-decision) (not= "certified" state))
         (str "approved produced " state " rather than certified")
         (and decided? (= "waived" human-decision) (not= "waived" state))
         (str "waived produced " state)
         ;; A finalised row must be closed, or the ledger keeps resurfacing a
         ;; hotfix the human has already answered.
         (and final? open?) "a decided row was left open"
         (and (not final?) (not open?)) "an undecided row was closed"
         :else true)))))

(def floors {:human-decided 150 :no-human-decision 150
             :green-suite-no-decision 60 :blank-decision 40 :no-stamp-ticket 60})

(doseq [[k floor] (sort floors)]
  (let [drawn (get @coverage k 0)]
    (when (< drawn floor)
      (swap! failures conj (str "FAIL reach floor: " (name k) " drawn " drawn " < " floor)))))

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str (into (sorted-map) @coverage)) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
