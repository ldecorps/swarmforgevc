#!/usr/bin/env bb
;; BL-1078: the Cursor-seat admission guard, and its agreement with the
;; TypeScript side that declares the same rule.

(ns cursor-seat-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; FOUR parents: this file is swarmforge/scripts/test/<name>.bb, so three
;; lands on swarmforge/ and every path below silently misses.
(def repo-root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*)))))))
(load-file (str (fs/path repo-root "swarmforge" "scripts" "cursor_seat_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── the model a window line selects ──────────────────────────────────────
(assert= "no --model means the default, never an empty key"
         cursor-seat-guard-lib/default-model (cursor-seat-guard-lib/model-from-cli nil))
(assert= "and an empty CLI is the same" cursor-seat-guard-lib/default-model (cursor-seat-guard-lib/model-from-cli ""))
(assert= "--model <m> is read" "composer-1" (cursor-seat-guard-lib/model-from-cli "--model composer-1"))
(assert= "--model=<m> is read too - a pack author writes either"
         "composer-1" (cursor-seat-guard-lib/model-from-cli "--model=composer-1"))
(assert= "and it is found among other flags"
         "gpt-5" (cursor-seat-guard-lib/model-from-cli "--force --model gpt-5 --trust"))

;; ── status, failing closed at every step ─────────────────────────────────
(def certified {"models" {"cursor/composer-1" {"status" "certified"}}})

(assert= "a certified entry reads certified"
         "certified" (cursor-seat-guard-lib/identity-status certified "cursor" "composer-1"))
(assert= "an absent entry is unknown, never certified"
         "unknown" (cursor-seat-guard-lib/identity-status certified "cursor" "auto"))
(assert= "a registry that is not a map at all is unknown"
         "unknown" (cursor-seat-guard-lib/identity-status nil "cursor" "composer-1"))
(assert= "a registry with no models map is unknown"
         "unknown" (cursor-seat-guard-lib/identity-status {"schema" 1} "cursor" "composer-1"))
(assert= "an entry with no status is unknown"
         "unknown" (cursor-seat-guard-lib/identity-status {"models" {"cursor/x" {}}} "cursor" "x"))
(assert= "a status this guard does not understand is unknown, not passed through"
         "unknown" (cursor-seat-guard-lib/identity-status {"models" {"cursor/x" {"status" "blessed"}}} "cursor" "x"))
(assert= "a candidate is a candidate - and admission still refuses it"
         "candidate" (cursor-seat-guard-lib/identity-status {"models" {"cursor/x" {"status" "candidate"}}} "cursor" "x"))

;; ── the escape, matched exactly ──────────────────────────────────────────
(assert-true "the declared value sets the escape" (cursor-seat-guard-lib/escape-set? "1"))
(assert-true "surrounding whitespace does not defeat it" (cursor-seat-guard-lib/escape-set? " 1 "))
(assert= "an unset escape is unset" false (cursor-seat-guard-lib/escape-set? nil))
(assert= "an empty one is unset" false (cursor-seat-guard-lib/escape-set? ""))
(assert= "and 0 does NOT open it - any-non-empty would be opened by a stray 0"
         false (cursor-seat-guard-lib/escape-set? "0"))
(assert= "nor does an arbitrary truthy-looking string" false (cursor-seat-guard-lib/escape-set? "true"))

;; ── admission ────────────────────────────────────────────────────────────
(let [a (cursor-seat-guard-lib/admission {:registry certified :provider "cursor" :model "composer-1"})]
  (assert-true "a certified identity is admitted with no escape at all" (:admit? a))
  (assert= "and says so" :certified (:reason a)))

(let [a (cursor-seat-guard-lib/admission {:registry certified :provider "cursor" :model "auto"})]
  (assert= "an uncertified identity is refused" false (:admit? a))
  (assert= "for the stated reason" :uncertified (:reason a))
  (assert-true "and the refusal NAMES the escape that would admit it"
               (str/includes? (:message a) cursor-seat-guard-lib/escape-env))
  (assert-true "with the value that sets it, not just the name"
               (str/includes? (:message a) (str cursor-seat-guard-lib/escape-env "=" cursor-seat-guard-lib/escape-value))))

(let [a (cursor-seat-guard-lib/admission {:registry certified :provider "cursor" :model "auto" :escape "1"})]
  (assert-true "the escape admits it" (:admit? a))
  (assert= "as an escape, distinguishable from certification" :uncertified-escape (:reason a))
  (assert-true "and the run is TOLD the identity is uncertified"
               (str/includes? (:message a) "UNCERTIFIED")))

(let [a (cursor-seat-guard-lib/admission {:registry nil :escape nil})]
  (assert= "no registry, no escape, no identity given: still refused"
           false (:admit? a))
  (assert= "keyed on the default model rather than an empty identity"
           (str "cursor/" cursor-seat-guard-lib/default-model) (:identity a)))

;; ── BL-897: the rule is mirrored across a boundary no import bridges ─────
;; extension/src/swarm/cursorIdentity.ts declares the same escape name, the
;; same value and the same provider/model key. A rename on one side and not
;; the other fails silently - the guard would key on an identity the registry
;; never holds, refuse everything, and an operator would set an env var that
;; no longer exists. So the REAL TypeScript is driven here.

(def cursor-identity-js (fs/path repo-root "extension" "out" "swarm" "cursorIdentity.js"))

(if-not (fs/exists? cursor-identity-js)
  (swap! failures conj (str "FAIL: extension/out is not compiled - " (str cursor-identity-js)
                            " is missing, so the agreement gate would pass by testing nothing"))
  (let [expr (str "const m=require(" (json/generate-string (str cursor-identity-js)) ");"
                  "process.stdout.write(JSON.stringify({"
                  "env:m.CURSOR_SEAT_SPIKE_ESCAPE_ENV,"
                  "value:m.CURSOR_SEAT_SPIKE_ESCAPE_VALUE,"
                  "key:m.identityKey({provider:'cursor',model:'composer-1'}),"
                  "certified:m.readIdentityStatus({models:{'cursor/composer-1':{status:'certified'}}},{provider:'cursor',model:'composer-1'}),"
                  "absent:m.readIdentityStatus({models:{}},{provider:'cursor',model:'auto'}),"
                  "bogus:m.readIdentityStatus({models:{'cursor/x':{status:'blessed'}}},{provider:'cursor',model:'x'})"
                  "}));")
        r (process/sh ["node" "-e" expr])]
    (if-not (zero? (:exit r))
      (swap! failures conj (str "FAIL: the TypeScript identity module failed: " (:err r)))
      (let [ts (json/parse-string (str/trim (str (:out r))) true)]
        (assert= "the escape ENV NAME agrees across the boundary" cursor-seat-guard-lib/escape-env (:env ts))
        (assert= "and so does the value that sets it" cursor-seat-guard-lib/escape-value (:value ts))
        (assert= "and the provider/model key format"
                 (cursor-seat-guard-lib/identity-key "cursor" "composer-1") (:key ts))
        (assert= "a certified status agrees" "certified" (:certified ts))
        (assert= "an absent entry fails closed on BOTH sides" "unknown" (:absent ts))
        (assert= "and so does a status neither side understands" "unknown" (:bogus ts))))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "cursor_seat_guard_lib_test_runner: ok"))
