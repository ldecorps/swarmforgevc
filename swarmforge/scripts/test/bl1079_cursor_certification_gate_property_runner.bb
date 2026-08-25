#!/usr/bin/env bb
;; BL-1079 invariant 2 — coder-authored property test.
;;
;; Specifier note on the feature: BL-525 already covers the generic
;; certification gate by example; this slice's Cursor-specific restatement
;; was dropped on purpose. Invariant 2 is therefore carried HERE, and it
;; must quantify over status × override (ModelFactory) and status × escape
;; (pack seat admission), not spot-check one happy path.
;;
;;   Invariant 2: "Pack apply refuses a candidate Cursor unless certify has
;;   succeeded or an explicit spike-only escape is set."
;;
;; ModelFactory assign is the production routing gate that feeds packs;
;; cursor_seat_guard_lib is the pack-side admission check. Both must agree
;; that an uncertified Cursor identity is not silently routable.
;;
;; REACH: every (status, override) and (status, escape) cell is visited by
;; construction (cartesian product), so a vacuous draw cannot hide a miss.
(ns bl1079-cursor-certification-gate-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))
(load-file (str (fs/path scripts-dir "cursor_seat_guard_lib.bb")))

(def failures (atom []))
(def coverage (atom {:mf-cells 0
                     :mf-cursor-excluded 0
                     :mf-cursor-assigned 0
                     :mf-override-rationale 0
                     :guard-cells 0
                     :guard-refused 0
                     :guard-certified 0
                     :guard-escape 0}))

(defn- fail! [msg]
  (swap! failures conj (str "FAIL: " msg)))

(defn- assert-true [msg expr]
  (when-not expr (fail! msg)))

(defn- assert= [msg expected actual]
  (when (not= expected actual)
    (fail! (str msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def cursor-provider "cursor")
(def cursor-model "auto")
(def fallback-provider "anthropic")
(def fallback-model "claude-sonnet-5")
(def role "documenter")

(defn cursor-registry
  "Cursor identity at `status`, ranked above a certified anthropic fallback
   so eligibility alone decides who wins assign — never score noise."
  [status]
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model cursor-provider cursor-model
                                        {:status status :cost_class "medium" :context_window 200000})
      (model-steward-lib/register-model fallback-provider fallback-model
                                        {:status "certified" :cost_class "medium" :context_window 200000})
      (model-steward-lib/add-role-ranking role cursor-provider cursor-model 0.99 "fixture-cursor")
      (model-steward-lib/add-role-ranking role fallback-provider fallback-model 0.5 "fixture-fallback")))

(defn cursor-assigned? [entry]
  (and (some? entry)
       (= cursor-provider (:provider entry))
       (= cursor-model (:model entry))))

;; ── P1: ModelFactory assign — forall status × override ───────────────────
(def mf-statuses ["candidate" "certified" "deprecated"])
(def mf-overrides [false true])

(doseq [status mf-statuses
        override? mf-overrides]
  (swap! coverage update :mf-cells inc)
  (let [reg (cursor-registry status)
        entry (model-factory-lib/assign-role reg role model-factory-lib/quality-mode
                                             {:override-uncertified? override?})
        certified? (= status "certified")
        expect-cursor? (or certified? override?)]
    (if expect-cursor?
      (do
        (assert-true (str "P1 status=" status " override=" override?
                          ": Cursor must be assigned when eligible")
                     (cursor-assigned? entry))
        (when (cursor-assigned? entry)
          (swap! coverage update :mf-cursor-assigned inc)
          (assert= (str "P1 status=" status " override=" override?
                        ": assigned agent is the derived Cursor token")
                   (model-factory-lib/agent-for-provider cursor-provider)
                   (:agent entry)))
        (when (and override? (not certified?) (cursor-assigned? entry))
          (assert-true (str "P1 status=" status " override=true: rationale names the uncertified override")
                       (str/includes? (str (:reason entry)) "uncertified override"))
          (when (str/includes? (str (:reason entry)) "uncertified override")
            (swap! coverage update :mf-override-rationale inc))))
      (do
        (assert-true (str "P1 status=" status " override=false: Cursor must NOT be assigned")
                     (not (cursor-assigned? entry)))
        (assert= (str "P1 status=" status " override=false: certified fallback wins instead")
                 fallback-provider (:provider entry))
        (when (not (cursor-assigned? entry))
          (swap! coverage update :mf-cursor-excluded inc))))))

;; ── P2: pack seat admission — forall status × escape ─────────────────────
;; Mirrors invariant 2's pack-apply wording: refuse unless certified OR the
;; spike escape is set. Uses the REAL cursor_seat_guard_lib admission.
(def guard-statuses ["candidate" "certified" "retired" "unknown"])
(def guard-escapes [nil "" "0" "1" "true"])

(defn guard-registry [status]
  (if (= status "unknown")
    {"models" {}}
    {"models" {(str cursor-provider "/" cursor-model) {"status" status}}}))

(doseq [status guard-statuses
        escape guard-escapes]
  (swap! coverage update :guard-cells inc)
  (let [a (cursor-seat-guard-lib/admission
           {:registry (guard-registry status)
            :provider cursor-provider
            :model cursor-model
            :escape escape})
        escape-on? (cursor-seat-guard-lib/escape-set? escape)]
    (cond
      (= status "certified")
      (do (assert-true (str "P2 status=certified escape=" (pr-str escape) ": admitted")
                       (:admit? a))
          (assert= (str "P2 status=certified escape=" (pr-str escape) ": reason :certified")
                   :certified (:reason a))
          (when (:admit? a) (swap! coverage update :guard-certified inc)))

      escape-on?
      (do (assert-true (str "P2 status=" status " escape=1: admitted as spike")
                       (:admit? a))
          (assert= (str "P2 status=" status " escape=1: reason :uncertified-escape")
                   :uncertified-escape (:reason a))
          (assert-true (str "P2 status=" status " escape=1: message names UNCERTIFIED")
                       (str/includes? (str (:message a)) "UNCERTIFIED"))
          (when (:admit? a) (swap! coverage update :guard-escape inc)))

      :else
      (do (assert= (str "P2 status=" status " escape=" (pr-str escape) ": refused")
                   false (:admit? a))
          (assert= (str "P2 status=" status " escape=" (pr-str escape) ": reason :uncertified")
                   :uncertified (:reason a))
          (assert-true (str "P2 status=" status ": refusal names the escape that would admit it")
                       (str/includes? (str (:message a)) cursor-seat-guard-lib/escape-env))
          (when (not (:admit? a)) (swap! coverage update :guard-refused inc))))))

;; ── reach floors (cartesian products must have been fully walked) ────────
(let [c @coverage
      mf-expected (* (count mf-statuses) (count mf-overrides))
      guard-expected (* (count guard-statuses) (count guard-escapes))]
  (assert= "P1 visited every status×override cell" mf-expected (:mf-cells c))
  (assert= "P2 visited every status×escape cell" guard-expected (:guard-cells c))
  ;; candidate+deprecated without override = 2 exclusions; certified+all overrides
  ;; that assign cursor = 1 + 3 = 4 assignments; uncertified+override = 2 rationales
  (assert-true (str "P1 excluded Cursor at least twice (uncertified×no-override); got "
                    (:mf-cursor-excluded c))
               (>= (:mf-cursor-excluded c) 2))
  (assert-true (str "P1 assigned Cursor at least four times (certified∪override); got "
                    (:mf-cursor-assigned c))
               (>= (:mf-cursor-assigned c) 4))
  (assert-true (str "P1 recorded uncertified-override rationale at least twice; got "
                    (:mf-override-rationale c))
               (>= (:mf-override-rationale c) 2))
  (assert-true (str "P2 refused at least once; got " (:guard-refused c))
               (>= (:guard-refused c) 1))
  (assert-true (str "P2 certified admissions at least once; got " (:guard-certified c))
               (>= (:guard-certified c) 1))
  (assert-true (str "P2 escape admissions at least once; got " (:guard-escape c))
               (>= (:guard-escape c) 1)))

(if (empty? @failures)
  (do (println "ALL PASS")
      (println (str "coverage " (pr-str @coverage))))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (println (str "coverage " (pr-str @coverage)))
      (System/exit 1)))
