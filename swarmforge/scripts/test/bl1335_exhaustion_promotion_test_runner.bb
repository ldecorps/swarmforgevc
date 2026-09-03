#!/usr/bin/env bb
;; BL-1335: TDD runner for the exhaustion -> failover-record promotion.
;; Opening a record costs a real seat swap, so the false-positive half of this
;; runner matters as much as the positive one.

(ns bl1335-exhaustion-promotion-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "exhaustion_failover_promotion_lib.bb")))
(load-file (str (fs/path script-dir ".." "provider_outage_record_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(def seat "documenter")
(def provider "anthropic")
(def model "claude-opus-5")
(def now 1788400000000)

(defn- decide [text records]
  (exhaustion-failover-promotion-lib/promotion-decision
   {:evidence {:text text} :records records
    :seat seat :provider provider :model model :now-ms now}))

;; ── scenario 01: unambiguous exhaustion opens ONE well-formed record ─────

(let [d (decide "Token Plan weekly quota exhausted, resets at 2026-09-08T00:00Z" [])]
  (assert= "unambiguous exhaustion promotes" :promote (:action d))
  (assert= "the record names the seat" [seat] (:affected-seats (:record d)))
  (assert= "and the provider" provider (:provider (:record d)))
  (assert= "and the model" model (:model (:record d)))
  (assert= "and it is OPEN" nil (:ended-at-utc (:record d)))
  (assert= "and carries the reset time the evidence reported"
           "2026-09-08T00:00Z" (:period-reset-at (:record d))))

;; The record must be readable by BL-669's own normalizer, unchanged - that
;; is invariant 2, and asserting the shape by hand would not prove it.
(let [d (decide "weekly quota exhausted" [])
      normalized (provider-outage-record-lib/normalize-record (:record d))]
  (assert= "BL-669's normalizer reads the promoted record" provider (:provider normalized))
  (assert= "and sees the seat" [seat] (:affected-seats normalized))
  (assert-true "and sees it as open" (provider-outage-record-lib/outage-open? normalized))
  (assert-true "and as affecting the seat" (provider-outage-record-lib/affects-seat? normalized seat)))

;; ── scenario 02: non-exhaustion opens nothing (the false-positive guard) ──

(doseq [text ["connection reset by peer while streaming"
              "401 Unauthorized: invalid api key"
              "model returned malformed JSON, retrying"
              "some text that matches nothing at all"
              ""]]
  (let [d (decide text [])]
    (assert= (str "non-exhaustion opens nothing: " (pr-str text)) :none (:action d))))

;; ── the human's ruling: ambiguous announces, never acts ──────────────────

(doseq [text ["rate limit reached, backing off"
              "429 too many requests"
              "usage limit approaching"]]
  (let [d (decide text [])]
    (assert= (str "ambiguous text announces rather than promoting: " (pr-str text))
             :announce (:action d))
    (assert-includes "and the announcement says why it did not act" (:reason d) "confirmation")))

;; ── scenario 03: idempotent per open incident ────────────────────────────

(let [open-record {:provider provider :model model :affected-seats [seat] :ended-at-utc nil}
      d (decide "weekly quota exhausted" [open-record])]
  (assert= "repeated evidence while a record is open opens no second" :none (:action d))
  (assert-includes "and says which record already covers it" (:reason d) seat))

;; A CLOSED record does not suppress a new incident.
(let [closed {:provider provider :model model :affected-seats [seat] :ended-at-utc "2026-09-01T00:00Z"}
      d (decide "weekly quota exhausted" [closed])]
  (assert= "a closed record does not suppress a fresh exhaustion" :promote (:action d)))

;; A record for a DIFFERENT model of the same provider does not suppress.
(let [other {:provider provider :model "claude-sonnet-5" :affected-seats [seat] :ended-at-utc nil}
      d (decide "weekly quota exhausted" [other])]
  (assert= "an open record for another model does not suppress this one" :promote (:action d)))

;; Nor does one for a different seat.
(let [other-seat {:provider provider :model model :affected-seats ["coder"] :ended-at-utc nil}
      d (decide "weekly quota exhausted" [other-seat])]
  (assert= "an open record for another seat does not suppress this one" :promote (:action d)))

;; The camelCase spelling BL-669's own store writes is honoured too.
(let [camel {:provider provider :model model :affectedSeats [seat] :endedAtUtc nil}
      d (decide "weekly quota exhausted" [camel])]
  (assert= "an open record in camelCase still suppresses" :none (:action d)))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: BL-1335 exhaustion promotion"))
