#!/usr/bin/env bb
;; BL-1337 TDD runner: a NAMED PROFILE drives the same cherry-pick BL-1181
;; already ships, and no seat becomes runnable without a handshake.
;;
;; Two things the live code was missing and this covers: the policy was
;; hard-coded (`export-bob-starting-cast`), and nothing checked that a chosen
;; model is reachable on THIS HOST - `assignment-eligible?` answers a registry
;; question, not a host one. The live cast's own note records a human doing
;; the host reasoning by hand ("not pure steward top-pick").
;;
;; Pure: the registry is built in-memory and host reachability arrives as an
;; INJECTED predicate, never a real key read - so no test here can touch a
;; credential, and the handshake bar is exercised in both directions.
(ns bl1337-profile-cast-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) ".."))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_factory_lib.bb")))
(load-file (str (fs/path scripts-dir "bob_starting_cast_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg expr] (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── fixture registry ─────────────────────────────────────────────────────
;; coder    : top pick certified + reachable            -> staffed by it
;; cleaner  : top pick NOT certified (registry-ineligible), second is fine
;; architect: top pick certified but UNREACHABLE here, second is fine
;; QA       : nothing above the profile's quality floor -> unstaffable
(defn reg []
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model "anthropic" "claude-opus-5" {})
      (model-steward-lib/certify "anthropic" "claude-opus-5" {:scorecard-id "sc-1"})
      (model-steward-lib/register-model "openrouter" "gemini-3-pro" {})
      (model-steward-lib/register-model "cerebras" "qwen3.8-max" {})
      (model-steward-lib/certify "cerebras" "qwen3.8-max" {:scorecard-id "sc-2"})
      (model-steward-lib/register-model "mistral" "mistral-large" {})
      (model-steward-lib/certify "mistral" "mistral-large" {:scorecard-id "sc-3"})
      (model-steward-lib/add-role-ranking "coder" "anthropic" "claude-opus-5" 0.93 {:scorecard_id "sc-1"})
      ;; cleaner: the top-ranked entry is registered but never certified.
      (model-steward-lib/add-role-ranking "cleaner" "openrouter" "gemini-3-pro" 0.95 {:scorecard_id "sc-x"})
      (model-steward-lib/add-role-ranking "cleaner" "cerebras" "qwen3.8-max" 0.88 {:scorecard_id "sc-2"})
      ;; architect: the top-ranked entry is certified but dead on this host.
      (model-steward-lib/add-role-ranking "architect" "mistral" "mistral-large" 0.91 {:scorecard_id "sc-3"})
      (model-steward-lib/add-role-ranking "architect" "anthropic" "claude-opus-5" 0.90 {:scorecard_id "sc-1"})
      ;; QA: certified and reachable, but below the floor the profile sets.
      (model-steward-lib/add-role-ranking "QA" "cerebras" "qwen3.8-max" 0.40 {:scorecard_id "sc-2"})))

(def reachable-here #{"anthropic/claude-opus-5" "cerebras/qwen3.8-max"})
(defn reachable? [provider model] (contains? reachable-here (str provider "/" model)))

(def profile
  {:name "fixture-mono-router"
   :roles ["coder" "cleaner" "architect"]
   :quality-floor 0.5
   :providers ["anthropic" "cerebras" "mistral" "openrouter"]
   :handshake "registry-and-host"})

;; ── profile parsing ──────────────────────────────────────────────────────
(let [parsed (bob-starting-cast-lib/parse-profile
              {"name" "p" "roles" ["coder"] "quality_floor" 0.7
               "providers" ["anthropic"] "handshake" "registry-only"})]
  (assert= "profile name" "p" (:name parsed))
  (assert= "profile roles" ["coder"] (:roles parsed))
  (assert= "profile floor" 0.7 (:quality-floor parsed))
  (assert= "profile providers" ["anthropic"] (:providers parsed))
  (assert= "profile handshake bar" "registry-only" (:handshake parsed)))

(assert-true "a profile with no roles is refused"
             (try (bob-starting-cast-lib/parse-profile {"name" "p" "roles" []}) false (catch Exception _ true)))
(assert-true "a profile with no name is refused"
             (try (bob-starting-cast-lib/parse-profile {"roles" ["coder"]}) false (catch Exception _ true)))
(assert-true "an unknown handshake bar is refused rather than silently weakened"
             (try (bob-starting-cast-lib/parse-profile {"name" "p" "roles" ["coder"] "handshake" "none"}) false (catch Exception _ true)))

;; ── the handshake decides the seat ───────────────────────────────────────
(let [result (bob-starting-cast-lib/generate-cast-from-profile (reg) profile {:reachable? reachable?})
      roles (get-in result [:cast :roles])]
  (assert-true "a fully handshaken profile is runnable" (:runnable? result))
  (assert= "coder is staffed by its own top pick" "claude-opus-5" (get-in roles ["coder" :model]))
  (assert= "cleaner falls through the registry-ineligible pick" "qwen3.8-max" (get-in roles ["cleaner" :model]))
  (assert= "architect falls through the unreachable pick" "claude-opus-5" (get-in roles ["architect" :model]))
  (assert= "no seat is left unstaffed" [] (:unstaffable result))
  ;; every seat's handshake is recorded, with the REASON a rejected candidate lost
  (let [trail (get-in result [:handshakes "architect"])]
    (assert= "the architect's rejected candidate is recorded" "mistral-large" (:model (first trail)))
    (assert= "and why it lost" :unreachable (:verdict (first trail)))
    (assert= "the accepted candidate is recorded too" :accepted (:verdict (last trail))))
  (let [trail (get-in result [:handshakes "cleaner"])]
    (assert= "the cleaner's rejected candidate lost on registry eligibility"
             :not-assignment-eligible (:verdict (first trail)))))

;; ── an unstaffable seat fails the WHOLE cast, loudly and by name ─────────
(let [result (bob-starting-cast-lib/generate-cast-from-profile
              (reg) (assoc profile :roles ["coder" "QA"]) {:reachable? reachable?})]
  (assert-true "an unstaffable seat makes the cast not runnable" (not (:runnable? result)))
  (assert= "and the failure names that seat" ["QA"] (:unstaffable result))
  (assert-true "the failure text names the seat"
               (str/includes? (bob-starting-cast-lib/generation-failure-text result) "QA"))
  ;; The cast must not pretend: no seat entry for a seat nothing could staff.
  ;; Checked by KEY ABSENCE, not by a nil value - a map that keeps the key
  ;; with a nil entry would pass a bare `nil?` check just as well as true
  ;; omission, but a downstream consumer iterating `(:roles cast)` would see
  ;; a "QA" entry that is not there in any usable sense (hardener-found gap).
  (assert-true "no cast entry is emitted for the unstaffable seat"
               (nil? (get-in result [:cast :roles "QA"])))
  (assert-true "the unstaffable seat's key is truly absent, not nil-valued"
               (not (contains? (get-in result [:cast :roles]) "QA"))))

;; ── the provider allow list is part of the bar ───────────────────────────
(let [result (bob-starting-cast-lib/generate-cast-from-profile
              (reg) (assoc profile :roles ["architect"] :providers ["mistral"]) {:reachable? reachable?})]
  (assert-true "a profile that allows only an unreachable provider is not runnable" (not (:runnable? result)))
  (assert= "and names the seat" ["architect"] (:unstaffable result)))

;; ── the quality floor is a MINIMUM: a score exactly at the floor passes ──
;; (hardener-found boundary gap: `<` vs `<=` are indistinguishable without a
;; candidate scoring exactly the floor).
(let [reg-at-floor (-> model-steward-lib/empty-registry
                       (model-steward-lib/register-model "anthropic" "claude-opus-5" {})
                       (model-steward-lib/certify "anthropic" "claude-opus-5" {:scorecard-id "sc-1"})
                       (model-steward-lib/add-role-ranking "coder" "anthropic" "claude-opus-5" 0.5 {:scorecard_id "sc-1"}))
      result (bob-starting-cast-lib/generate-cast-from-profile
              reg-at-floor (assoc profile :roles ["coder"] :quality-floor 0.5) {:reachable? reachable?})]
  (assert-true "a score exactly at the floor is accepted, not rejected as below it"
               (:runnable? result))
  (assert= "the at-floor candidate is staffed" "claude-opus-5" (get-in result [:cast :roles "coder" :model])))

;; ── registry-only is the WEAKER bar, and says so ─────────────────────────
(let [result (bob-starting-cast-lib/generate-cast-from-profile
              (reg) (assoc profile :roles ["architect"] :handshake "registry-only") {:reachable? reachable?})]
  (assert-true "registry-only staffs the seat without a host probe" (:runnable? result))
  (assert= "with the top certified pick, unreachable or not" "mistral-large" (get-in result [:cast :roles "architect" :model]))
  (assert-true "and the weaker bar is recorded in the evidence note"
               (str/includes? (bob-starting-cast-lib/evidence-note-text result) "registry-only")))

;; ── the apply path is GATED on the handshake (required_wiring anchor) ────
(let [ok (bob-starting-cast-lib/generate-cast-from-profile (reg) profile {:reachable? reachable?})
      bad (bob-starting-cast-lib/generate-cast-from-profile (reg) (assoc profile :roles ["coder" "QA"]) {:reachable? reachable?})]
  (assert-true "a runnable cast still applies through the existing overlay path"
               (= "model-factory-overlay" (:via (bob-starting-cast-lib/apply-via-modelfactory-overlay (:cast ok) ok))))
  (assert-true "a cast that is not runnable is refused by the apply path"
               (try (bob-starting-cast-lib/apply-via-modelfactory-overlay (:cast bad) bad) false
                    (catch Exception _ true)))
  ;; BL-1181's own two-arity call site keeps working unchanged.
  (assert= "the pre-existing single-argument apply still works" "model-factory-overlay"
           (:via (bob-starting-cast-lib/apply-via-modelfactory-overlay (:cast ok)))))

;; ── the evidence note carries no credential material ────────────────────
(let [result (bob-starting-cast-lib/generate-cast-from-profile (reg) profile {:reachable? reachable?})
      note (bob-starting-cast-lib/evidence-note-text result)]
  (assert-true "the note names the profile" (str/includes? note "fixture-mono-router"))
  (assert-true "the note records each seat's handshake result" (every? #(str/includes? note %) ["coder" "cleaner" "architect"]))
  (doseq [secretish ["API_KEY" "sk-" "Bearer " "token="]]
    (assert-true (str "the note carries no credential material: " secretish)
                 (not (str/includes? note secretish)))))

;; ── CLI: host-reachable? fails CLOSED on a provider the map doesn't know ──
;; (hardener-found gap: no fixture registry ever names a provider outside
;; `provider-credential-env`, so the docstring's "fails closed" claim had no
;; test able to see it flip.) Loaded directly rather than via the acceptance
;; subprocess, per the CLI thin-wrapper rule - this is the exported adapter
;; function itself, no argv or process boundary involved.
(load-file (str (fs/path scripts-dir "bob_starting_cast_cli.bb")))
(assert-true "an unrecognised provider is NOT assumed reachable"
             (not (bob-starting-cast-cli/host-reachable? "some-unknown-provider" "some-model")))
(assert-true "a known provider with no credential requirement is reachable by definition"
             (bob-starting-cast-cli/host-reachable? "local" "any-model"))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "ALL PASS: BL-1337 profile-driven handshaken cast"))
