#!/usr/bin/env bb
;; BL-317: TDD runner for routing_manifest_lib.bb's pure functions - no
;; filesystem, no tmux, no clock. Mirrors operator_lib_test_runner.bb.

(ns routing-manifest-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "routing_manifest_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── read-roles: absent field defaults to the full standard chain ──────────
(assert= "no roles: field -> full standard chain"
         ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"]
         (routing-manifest-lib/read-roles "id: BL-1\nstatus: todo\nsource: \"x\"\n"))

(assert= "a multi-line notes: block mentioning the word roles: in prose is never mistaken for the field"
         ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"]
         (routing-manifest-lib/read-roles "id: BL-1\nnotes: |\n  (b) a ticket YAML declaring roles: [coder, QA] -> assert\nstatus: todo\n"))

;; ── hardener-added: an INDENTED notes: example line that is itself a
;;    well-formed flow-list (not just prose mentioning the word) must
;;    never be mistaken for the real field - a real field is never
;;    indented. Regression guard for a real bug found during hardening: an
;;    earlier version of parse-roles-field trimmed the line before the
;;    starts-with? check, stripping the indentation that is the ONLY thing
;;    distinguishing this from a genuine top-level declaration. ──────────
(assert= "an indented, well-formed-looking roles: example line inside notes: is never mistaken for the real field"
         ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"]
         (routing-manifest-lib/read-roles
          "id: BL-1\nnotes: |\n  Example: roles: [coder, QA] is what a declaration looks like.\n  On its own line:\n  roles: [coder, QA]\nstatus: todo\n"))

;; ── read-roles: an explicit flow-style list is read back exactly ──────────
(assert= "roles: [coder, QA] is read back exactly as declared"
         ["coder" "QA"]
         (routing-manifest-lib/read-roles "id: BL-1\nroles: [coder, QA]\nstatus: todo\n"))

(assert= "roles: list with extra whitespace/quoting is still read back cleanly"
         ["coder" "cleaner" "QA"]
         (routing-manifest-lib/read-roles "id: BL-1\nroles: [ coder,  \"cleaner\" , 'QA' ]\nstatus: todo\n"))

;; ── validate-roles: coder/QA are always required ───────────────────────────
(assert-true "a list with both coder and QA is valid"
             (:valid? (routing-manifest-lib/validate-roles ["coder" "QA"])))
(assert-false "a list missing coder is invalid"
              (:valid? (routing-manifest-lib/validate-roles ["QA" "architect"])))
(assert-false "a list missing QA is invalid"
              (:valid? (routing-manifest-lib/validate-roles ["coder" "architect"])))

;; ── validate-roles: coordinator/unknown roles are rejected ─────────────────
(assert-false "a list naming coordinator is invalid"
              (:valid? (routing-manifest-lib/validate-roles ["coder" "QA" "coordinator"])))
(assert-false "a list naming an unknown role is invalid"
              (:valid? (routing-manifest-lib/validate-roles ["coder" "QA" "nonsense"])))

;; ── validate-roles: a full, correctly-ordered declared list is valid ───────
(assert-true "the full standard chain, explicitly declared, validates"
             (:valid? (routing-manifest-lib/validate-roles
                       ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"])))

;; ── validate-roles: a narrower-but-legal list validates ────────────────────
(assert-true "coder + architect + QA (a legal narrower subset) validates"
             (:valid? (routing-manifest-lib/validate-roles ["coder" "architect" "QA"])))

;; ── BL-317 bounce fix (scope 4b): block-style roles: lists ────────────────
(assert= "a block-style roles: list is read back exactly as declared"
         ["coder" "QA"]
         (routing-manifest-lib/read-roles "id: BL-1\nroles:\n  - coder\n  - QA\nstatus: todo\n"))

(assert= "a block-style list with quoting/extra whitespace is still read back cleanly"
         ["coder" "cleaner" "QA"]
         (routing-manifest-lib/read-roles "id: BL-1\nroles:\n  - coder\n  -  \"cleaner\"  \n  - 'QA'\nstatus: todo\n"))

(assert= "an indented block-style example inside notes: is never mistaken for the real field"
         ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"]
         (routing-manifest-lib/read-roles
          "id: BL-1\nnotes: |\n  roles:\n    - coder\n    - QA\nstatus: todo\n"))

;; ── BL-317 bounce fix (scope 4b): absent vs. present-but-unparseable ──────
(assert-true "validate-manifest: a genuinely absent roles: field is always valid (defaults to the full chain)"
             (:valid? (routing-manifest-lib/validate-manifest "id: BL-1\nstatus: todo\n")))

(assert-true "validate-manifest: a well-formed flow-style manifest validates"
             (:valid? (routing-manifest-lib/validate-manifest "id: BL-1\nroles: [coder, QA]\nstatus: todo\n")))

(assert-true "validate-manifest: a well-formed block-style manifest validates"
             (:valid? (routing-manifest-lib/validate-manifest "id: BL-1\nroles:\n  - coder\n  - QA\nstatus: todo\n")))

(assert-false "validate-manifest: a present-but-unparseable roles: field is REJECTED, never treated as absent"
              (:valid? (routing-manifest-lib/validate-manifest "id: BL-1\nroles: coder, QA\nstatus: todo\n")))

(assert= "validate-manifest's rejection reason names the parse failure, distinct from a coder/QA/coordinator reason"
         "roles: field is present but could not be parsed (expected a flow-style [a, b] or block-style - a / - b list)"
         (:reason (routing-manifest-lib/validate-manifest "id: BL-1\nroles: coder, QA\nstatus: todo\n")))

(assert= "read-roles still safely defaults an unparseable field to the full chain (validate-manifest is the enforcement point, not read-roles)"
         ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"]
         (routing-manifest-lib/read-roles "id: BL-1\nroles: coder, QA\nstatus: todo\n"))

(assert-false "validate-manifest still rejects a present, PARSED-but-invalid list (missing coder) exactly like validate-roles"
              (:valid? (routing-manifest-lib/validate-manifest "id: BL-1\nroles: [QA]\nstatus: todo\n")))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "routing_manifest_lib: ALL TESTS PASSED"))
