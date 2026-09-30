#!/usr/bin/env bb
;; BL-1815: TDD runner for model_steward_brief_lib.bb - the knowledge-brief
;; decision (owed?), classification, path/text helpers, and the disk-poll
;; wait. The pane-injection side is exercised only through resolve-pane-target
;; returning nil in a fixture with no tmux socket (never a real tmux call);
;; test_model_steward_cli.sh and the acceptance drive the full CLI wiring.
(ns model-steward-brief-lib-test-runner
  (:require [babashka.fs :as fs]))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path scripts-dir "model_steward_brief_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── brief-owed? ───────────────────────────────────────────────────────────
(assert-true "owed only claude -> local-model" (model-steward-brief-lib/brief-owed? "claude" "local-model"))
(assert-true "not owed claude -> claude" (not (model-steward-brief-lib/brief-owed? "claude" "claude")))
(assert-true "not owed local-model -> claude" (not (model-steward-brief-lib/brief-owed? "local-model" "claude")))
(assert-true "not owed claude -> aider" (not (model-steward-brief-lib/brief-owed? "claude" "aider")))
(assert-true "not owed local-model -> local-model" (not (model-steward-brief-lib/brief-owed? "local-model" "local-model")))

;; ── classify-brief ────────────────────────────────────────────────────────
(assert= "nil raw -> no brief" {:ok false :reason "no brief"} (model-steward-brief-lib/classify-brief nil))
(assert= "blank raw -> empty brief" {:ok false :reason "empty brief"} (model-steward-brief-lib/classify-brief "   \n  "))
(assert= "empty string -> empty brief" {:ok false :reason "empty brief"} (model-steward-brief-lib/classify-brief ""))
(assert= "exactly 2000 chars -> ok" {:ok true :brief (apply str (repeat 2000 "x"))}
         (model-steward-brief-lib/classify-brief (apply str (repeat 2000 "x"))))
(assert= "2001 chars -> over 2000" {:ok false :reason "over 2000"}
         (model-steward-brief-lib/classify-brief (apply str (repeat 2001 "x"))))
(assert= "ordinary brief trims and passes" {:ok true :brief "hello"}
         (model-steward-brief-lib/classify-brief "  hello  \n"))

;; ── stable-read?: the D2 poll-stability predicate, pinned with no sleep,
;;    no subprocess, no timing tolerance (hardener-found: the end-to-end
;;    timed tests in test_model_steward_brief_lib.sh cannot discriminate
;;    "accept on first sighting" from "require two consecutive equal
;;    reads" - every one of their fixtures writes its brief exactly once,
;;    so the two behave identically at the timing granularity a shell
;;    test can control. Only this pure predicate can pin it directly.) ────
(assert-true "two absences are never stable" (not (model-steward-brief-lib/stable-read? nil nil)))
(assert-true "a first sighting alone is not stable" (not (model-steward-brief-lib/stable-read? nil "x")))
(assert-true "the same content twice in a row is stable" (model-steward-brief-lib/stable-read? "x" "x"))
(assert-true "different content across two polls is not stable (still in flight)" (not (model-steward-brief-lib/stable-read? "x" "y")))
(assert-true "content disappearing between polls is not stable" (not (model-steward-brief-lib/stable-read? "x" nil)))

;; ── brief-path / brief-dir ────────────────────────────────────────────────
(assert= "brief-path joins .swarmforge/agent-memory/<role>/brief.md"
         (str (fs/path "/tmp/x" ".swarmforge" "agent-memory" "coder" "brief.md"))
         (model-steward-brief-lib/brief-path "/tmp/x" "coder"))

;; ── brief-request-text ────────────────────────────────────────────────────
(let [text (model-steward-brief-lib/brief-request-text "coder" 42 "/tmp/x/brief.md")]
  (assert-true "request text names the path" (clojure.string/includes? text "/tmp/x/brief.md"))
  (assert-true "request text names the 2000-character limit" (clojure.string/includes? text "2000"))
  (assert-true "request text names the wait bound" (clojure.string/includes? text "42"))
  (assert-true "request text names the role" (clojure.string/includes? text "coder")))

;; ── resolve-pane-target: no tmux socket file -> nil, never a tmux call ────
(let [dir (str (fs/create-temp-dir {:prefix "bl1815-brief-lib-"}))]
  (try
    (assert= "no tmux-socket file -> nil pane target"
             nil (model-steward-brief-lib/resolve-pane-target dir "coder"))
    (finally
      (fs/delete-tree dir))))

;; request-brief!'s timed wait/poll (env-driven MODEL_STEWARD_BRIEF_WAIT_S/
;; MODEL_STEWARD_BRIEF_POLL_MS) needs its own subprocess to set those env
;; vars - see test_model_steward_brief_lib.sh for the timed "no brief" and
;; "written within the wait" cases this runner's process-local scope can't
;; drive.

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
