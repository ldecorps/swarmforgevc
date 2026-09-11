#!/usr/bin/env bb
;; TDD runner for handoff_draft_root_guard_lib.bb (BL-1518) - the send-time
;; guard that refuses swarm_handoff.bb when its draft file does not lie
;; under the project root the invocation resolved.

(ns handoff-draft-root-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_draft_root_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── outside-root?: the pure containment decision ─────────────────────────

(assert-false "a draft directly under the root is inside"
              (handoff-draft-root-guard-lib/outside-root? "/root/tmp/handoff.txt" "/root"))
(assert-false "a draft nested several levels under the root is inside"
              (handoff-draft-root-guard-lib/outside-root? "/root/a/b/c/handoff.txt" "/root"))
(assert-false "a draft path equal to the root itself is inside"
              (handoff-draft-root-guard-lib/outside-root? "/root" "/root"))
(assert-true "a draft in a sibling directory is outside"
             (handoff-draft-root-guard-lib/outside-root? "/tmp/fixture-a/tmp/handoff.txt" "/home/user/project"))
(assert-true "a draft in the parent of the root is outside"
             (handoff-draft-root-guard-lib/outside-root? "/root-parent/handoff.txt" "/root-parent/root"))
;; Boundary: a sibling whose name merely shares the root as a TEXT prefix
;; must never read as contained - the whole point of checking at a path
;; separator rather than a bare string prefix.
(assert-true "a sibling directory that shares the root as a text prefix is outside"
             (handoff-draft-root-guard-lib/outside-root? "/a/bc/x" "/a/b"))
(assert-true "an unrelated mkdtemp fixture root is outside a real worktree root"
             (handoff-draft-root-guard-lib/outside-root?
              "/tmp/bl1518-fixture-xyz/tmp/handoff.txt"
              "/home/carillon/swarmforgevc/.worktrees/coder"))

;; ── refusal-message: names both paths, UNDER THE RIGHT LABEL ─────────────
;; A bare "includes somewhere" check cannot catch the two labels being
;; swapped - both paths would still appear in the message. Anchor each
;; path to its own "draft: "/"root:  " prefix so a swap fails loudly.

(let [msg (handoff-draft-root-guard-lib/refusal-message "/fixture/tmp/handoff.txt" "/worktree")]
  (assert-includes "the refusal names the draft path" msg "/fixture/tmp/handoff.txt")
  (assert-includes "the refusal names the resolved root" msg "/worktree")
  (assert-includes "the refusal is unambiguous about refusing" msg "Refusing")
  (assert-includes "the draft path is labeled \"draft: \", not swapped with root"
                    msg "draft: /fixture/tmp/handoff.txt")
  (assert-includes "the root path is labeled \"root:  \", not swapped with draft"
                    msg "root:  /worktree"))

(if (empty? @failures)
  (println "ALL PASS: handoff_draft_root_guard_lib.bb")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
