#!/usr/bin/env bb
;; BL-1378: PROPERTY tests over the three invariants the ticket YAML declares
;; (coder-authored first, per BL-654).
;;
;;   P1 an-added-path-never-a-second-definition - a close with no usable
;;      expedite verdict record decides EXACTLY as it did before this ticket:
;;      allowed iff the coordinator's mailbox holds a QA handoff naming it.
;;      The mailbox answer is never overridden downward by anything the store
;;      does, and never overridden upward by anything but an approved record
;;      whose commit reached main.
;;   P2 an-unusable-store-is-never-an-approval - obstructed, unreadable and
;;      corrupt all refuse and say why; absent falls back to the mailbox and is
;;      never itself an approval, and never reported as a store problem.
;;   P3 a-record-closes-only-what-it-names - a record grants a close only when
;;      ticket, stage "QA" and approval true hold TOGETHER. Two of three is
;;      nothing.
;;
;; Toolchain: the .bb property-runner precedent (expedite_lib_property_runner.bb,
;; bl869_multi_ticket_close_guard_property_runner.bb next door); BL-472 defers
;; property tooling for Babashka and BL-654's *.property.test.js home is the
;; TypeScript lane.
;;
;; GENERATOR REACH. P3's near-miss records are CONSTRUCTED, not drawn: a record
;; whose fields are chosen independently would almost never differ from the
;; asked-for ticket in exactly one place, and "two of three match" is the only
;; interesting neighbourhood. Each near miss is therefore derived from a
;; matching record by breaking exactly one field - the collision-pair shape
;; BL-654 names - and the run fails unless every one was generated.

(ns bl1378-expedite-close-guard-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ticket_close_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))
(def reached (atom #{}))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def store-shapes [:absent :no-match :problem :approved])
(def ancestor-answers [true false nil])

(loop [i 0 s 913780]
  (when (< i runs)
    (let [[mailbox? s1] (gen-bool s)
          [shape s2] (gen-pick s1 store-shapes)
          [anc s3] (gen-pick s2 ancestor-answers)
          store (case shape
                  :absent {:kind :absent}
                  :no-match {:kind :no-match}
                  :problem {:kind :problem :detail "the expedite verdict store is unreadable"}
                  :approved {:kind :approved :commit "c370d1e28a" :store-file "s.jsonl"})
          v (ticket-close-guard-lib/close-verdict
             {:qa-mailbox? mailbox? :store store :ancestor? (when (= shape :approved) anc)})
          input {:mailbox? mailbox? :shape shape :ancestor anc}]
      (swap! reached conj [mailbox? shape (when (= shape :approved) anc)])

      ;; ── P1 ────────────────────────────────────────────────────────────
      (when mailbox?
        (when-not (:allowed? v)
          (report! "P1" s input "a QA mailbox handoff stopped closing the ticket"))
        (when-not (= :qa-mailbox-handoff (:reason v))
          (report! "P1" s input (str "the mailbox path was not the reason: " (pr-str (:reason v))))))
      (when (and (not mailbox?) (contains? #{:absent :no-match} shape))
        (when (:allowed? v)
          (report! "P1" s input "a close with no mailbox handoff and no record was allowed"))
        (when-not (= :missing-qa-approval (:reason v))
          (report! "P1" s input (str "the pre-BL-1378 reason changed: " (pr-str (:reason v))))))
      ;; The ONLY thing that may turn a mailbox "no" into a yes.
      (when (and (not mailbox?) (:allowed? v))
        (when-not (and (= shape :approved) (true? anc))
          (report! "P1" s input "a close was allowed without a mailbox handoff and without an approved, landed record")))

      ;; ── P2 ────────────────────────────────────────────────────────────
      (when (and (not mailbox?) (= shape :problem))
        (when (:allowed? v)
          (report! "P2" s input "an unusable store approved a close"))
        (when-not (= :expedite-store-problem (:reason v))
          (report! "P2" s input (str "an unusable store gave the wrong reason: " (pr-str (:reason v)))))
        (when-not (seq (str (:detail v)))
          (report! "P2" s input "an unusable store refused without saying why")))
      (when (and (not mailbox?) (= shape :absent))
        (when (= :expedite-store-problem (:reason v))
          (report! "P2" s input "an absent store was reported as a store problem")))
      ;; An approved record whose commit did not land, or could not be shown to
      ;; have landed, is not an approval either (the human's ruling, option 1).
      (when (and (not mailbox?) (= shape :approved) (not (true? anc)))
        (when (:allowed? v)
          (report! "P2" s input "an unlanded or undeterminable commit closed its ticket"))
        (when-not (contains? #{:expedite-commit-not-on-main :expedite-ancestry-undeterminable} (:reason v))
          (report! "P2" s input (str "wrong reason for an unlanded commit: " (pr-str (:reason v)))))
        (when-not (str/includes? (str (:detail v)) "c370d1e28a")
          (report! "P2" s input "the refusal did not name the commit")))

      (recur (inc i) s3))))

;; ── P3: the record matcher, over CONSTRUCTED near misses ─────────────────

(def matching {:ticket "BL-9001" :stage "QA" :approval true :commit "c370d1e28a"})
(def near-misses
  ;; each derived from `matching` by breaking exactly ONE field - the only
  ;; neighbourhood where "two of three" can be got wrong.
  {:other-ticket (assoc matching :ticket "BL-9002")
   :other-stage (assoc matching :stage "coder")
   :approval-false (assoc matching :approval false)
   :approval-missing (dissoc matching :approval)
   :ticket-missing (dissoc matching :ticket)
   :stage-missing (dissoc matching :stage)
   ;; a truthy non-true approval is not approval: JSON "true" is not `true`.
   :approval-string (assoc matching :approval "true")})

(when-not (ticket-close-guard-lib/expedite-record-approves? matching "BL-9001")
  (swap! failures conj "FAIL P3: the exactly-matching record did not approve - the near misses below prove nothing"))

(doseq [[label record] near-misses]
  (when (ticket-close-guard-lib/expedite-record-approves? record "BL-9001")
    (swap! failures conj (str "FAIL P3: a record broken only at " label " still approved: " (pr-str record)))))

;; And the other direction: the same record asked about a different ticket.
(doseq [other ["BL-9002" "BL-90011" "bl-9001" "" "BL-900"]]
  (when (ticket-close-guard-lib/expedite-record-approves? matching other)
    (swap! failures conj (str "FAIL P3: BL-9001's record closed " (pr-str other)))))

;; ── the reachability floor ───────────────────────────────────────────────

(doseq [shape store-shapes
        mailbox? [true false]]
  (when-not (some #(and (= mailbox? (first %)) (= shape (second %))) @reached)
    (swap! failures conj (str "FAIL generator reach: mailbox?=" mailbox? " store=" shape " was never generated."))))
(doseq [anc ancestor-answers]
  (when-not (some #(and (= :approved (second %)) (= anc (nth % 2))) @reached)
    (swap! failures conj (str "FAIL generator reach: an approved record with ancestor?=" (pr-str anc)
                              " was never generated - the ruling's landed half is untested."))))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println (str "bl1378 expedite close guard: ALL PROPERTIES HOLD (" runs " runs)")))
