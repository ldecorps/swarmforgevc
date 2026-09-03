#!/usr/bin/env bb
;; BL-1335: promote token-exhaustion EVIDENCE into a failover RECORD.
;;
;; Both halves of this path already run and neither writes to the other's
;; file: BL-840's producer appends evidence to provider-outage-YYYY-MM.jsonl,
;; and BL-669's consumer reads provider-outages.jsonl - which held exactly one
;; line, typed by a human, whose own note said why they typed it. This
;; namespace is the missing middle, and nothing else: it opens a record in the
;; shape provider_outage_record_lib/normalize-record already expects, so the
;; consumer needs no change at all (invariant 2 - no third store, no second
;; assignment path).
;;
;; Human ruling 2026-09-03: promote automatically ONLY when the classification
;; is unambiguous; otherwise announce for operator confirmation. Opening a
;; record is not inert - BL-669 will restaff the seat - and the signal being
;; classified is pane text, the least structured input in the system. So the
;; decision has three outcomes, and the default of the three is to do nothing.

(ns exhaustion-failover-promotion-lib
  (:require [clojure.string :as str]))

;; Unambiguous: the provider itself says the plan period or quota is spent.
;; Each pattern must be something only an exhaustion message says - a phrase
;; that also appears in an ordinary rate-limit blip would buy a seat swap on a
;; transient.
(def ^:private unambiguous-exhaustion-patterns
  [#"(?i)\b(?:weekly|monthly|daily)\s+(?:quota|limit)\s+(?:exhausted|reached|exceeded)\b"
   #"(?i)\bplan\s+period\s+(?:quota\s+)?(?:exhausted|used up)\b"
   #"(?i)\btoken\s+plan\s+(?:weekly\s+)?quota\s+exhausted\b"
   #"(?i)\byou(?:'ve| have)\s+used\s+(?:up\s+)?(?:your|all)\s+(?:\w+\s+)?(?:quota|credits|tokens)\b"
   ;; "out of tokens/credits" IS exhaustion however the period is worded -
   ;; the earlier pattern demanded "this|the week|month|period" exactly and
   ;; missed "until the next week", which my own corpus produced.
   #"(?i)\bout of (?:credits|tokens)\b"])

;; Suspicious but not conclusive: an exhaustion message MIGHT look like this,
;; and so might a transient. These announce for a human rather than acting.
(def ^:private ambiguous-exhaustion-patterns
  [#"(?i)\brate limit\b"
   #"(?i)\bquota\b"
   #"(?i)\busage limit\b"
   #"(?i)\btoo many requests\b"])

(def ^:private reset-time-patterns
  [#"(?i)resets?\s+(?:at|on)\s+([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)"
   #"(?i)(?:until|available again(?:\s+at)?)\s+([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)"])

(defn classify-evidence
  "What one evidence line says, as one of three answers:

     :exhausted   unambiguous period/quota exhaustion - safe to promote
     :suspected   might be exhaustion, might be a transient - announce only
     nil          anything else, including text that matches nothing

   Fails CLOSED by construction: the last cond branch is nil, so an
   unrecognised line opens nothing rather than defaulting to exhaustion. That
   matters because the input is pane text and a misclassification costs a real
   seat swap."
  [{:keys [text]}]
  (let [t (str text)]
    (cond
      (some #(re-find % t) unambiguous-exhaustion-patterns) :exhausted
      (some #(re-find % t) ambiguous-exhaustion-patterns) :suspected
      :else nil)))

(defn reset-time-of
  "The period reset instant the evidence reported, or nil when it named none.
   A record may legitimately carry no reset time; the scenario that asks for
   one supplies one."
  [{:keys [text]}]
  (some (fn [p] (second (re-find p (str text)))) [(first reset-time-patterns) (second reset-time-patterns)]))

(defn- open-record-for?
  "Invariant 3: an OPEN record for this seat/provider/model already exists.
   Matched on the same three fields the record carries, so a record for a
   different model of the same provider does not suppress a real one."
  [records {:keys [seat provider model]}]
  (boolean
   (some (fn [r]
           (and (nil? (or (:ended-at-utc r) (:endedAtUtc r)))
                (= provider (:provider r))
                (= model (:model r))
                (some #(= seat %) (or (:affected-seats r) (:affectedSeats r) []))))
         records)))

(defn promotion-decision
  "Whether this evidence should open a failover record, and what to open.

   {:action :promote  :record {...}}  unambiguous exhaustion, nothing open yet
   {:action :announce :reason \"...\"} suspected exhaustion - the human's ruling
                                      says announce for confirmation, never act
   {:action :none     :reason \"...\"} not exhaustion, or a record is already
                                      open for this seat/provider/model

   The record is built in normalize-record's own shape so BL-669's consumer
   reads it unchanged."
  [{:keys [evidence records seat provider model now-ms]}]
  (let [classification (classify-evidence evidence)]
    (cond
      (nil? classification)
      {:action :none :reason "evidence is not exhaustion"}

      (= :suspected classification)
      {:action :announce
       :reason (str "possible exhaustion for " seat " on " provider "/" model
                    " - text is not conclusive, so it is announced for operator"
                    " confirmation rather than opening a failover record")}

      (open-record-for? records {:seat seat :provider provider :model model})
      {:action :none
       :reason (str "a failover record is already open for " seat " on " provider "/" model)}

      :else
      {:action :promote
       :record (cond-> {:id (str provider "/" model "/" now-ms)
                        :provider provider
                        :model model
                        :affected-seats [seat]
                        :started-at-ms now-ms
                        :ended-at-utc nil
                        :recordedBy "exhaustion-promoter"
                        :incident "provider period/quota exhausted"
                        :note (str "opened from BL-840 outage evidence classified as exhaustion"
                                   " (BL-1335); BL-669 failover reads this record")}
                 (reset-time-of evidence) (assoc :period-reset-at (reset-time-of evidence)))})))
