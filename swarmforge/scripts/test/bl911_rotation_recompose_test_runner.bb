#!/usr/bin/env bb
;; BL-911: TDD runner for handoff_lib.bb's recompose-role-prompt! - the
;; helper rotate-resident-to! calls so a rotating role boots on a prompt
;; composed from CURRENT sources instead of the one built at the swarm's
;; last full launch. Pure filesystem + an injected compose-fn throughout -
;; no tmux, no real swarm state. The wiring into rotate-resident-to! itself
;; (that it is actually called before the respawn, and that a failure is
;; reported but never blocks rotation) is proven against the real tmux-less
;; fixture in test_rotate_recomposes_role_prompt.sh, matching this
;; project's established split (pure logic here, real-fixture wiring there)
;; for every other rotate-resident-to! concern (BL-805, BL-812).

(ns bl911-rotation-recompose-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-bl911-recompose-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; Every assertion below runs against its own disposable fixture root (never
;; this real worktree's .swarmforge/) via handoff-lib/set-project-root!,
;; reset to nil (the real git-derived fallback) once this file is done.

(defn fixture-root! []
  (let [root (mk-tmp-dir)]
    (fs/create-dirs (fs/path root ".swarmforge" "prompts"))
    (handoff-lib/set-project-root! root)
    root))

(defn write-metadata! [root role metadata]
  (spit (str (handoff-lib/prompt-file-path role) ".metadata.json")
        (json/generate-string metadata)))

;; ── no metadata sidecar: a stable, reportable failure, prompt untouched ────
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "hardender")]
  (spit prompt-file "STALE CONTENT")
  (let [result (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn (fn [& _] (throw (ex-info "must not be called" {})))})]
    (assert= "01: no metadata sidecar fails with a stable reason" {:ok false :reason "no-metadata-sidecar"} result)
    (assert= "01: the prompt file is left completely untouched" "STALE CONTENT" (slurp prompt-file))))

;; ── happy path: writes the compose-fn's result, passes metadata through ───
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "hardender")
      calls (atom [])]
  (spit prompt-file "STALE CONTENT")
  (write-metadata! root "hardender" {:agent "claude" :model "sonnet-5" :two-pack? true :overlay-prompt "swarmforge/packs/two-pack.prompt"})
  (let [compose-fn (fn [role ctx] (swap! calls conj [role ctx]) {:system-prompt "FRESH CONTENT FROM CURRENT SOURCES"})
        result (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn compose-fn})]
    (assert= "02: a successful recompose reports ok" {:ok true} result)
    (assert= "02: the prompt file now carries the freshly composed text" "FRESH CONTENT FROM CURRENT SOURCES" (slurp prompt-file))
    (assert= "02: compose-fn is called once, for the target role" 1 (count @calls))
    (assert= "02: compose-fn's context is derived from the metadata sidecar, not re-derived"
             ["hardender" {:agent "claude" :model "sonnet-5" :two-pack? true :overlay-prompt "swarmforge/packs/two-pack.prompt"}]
             (first @calls))))

;; ── metadata with no model/overlay (a plain solo-role launch) ─────────────
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "hardender")
      calls (atom [])]
  (write-metadata! root "hardender" {:agent "claude" :model nil :two-pack? false :overlay-prompt ""})
  (let [compose-fn (fn [role ctx] (swap! calls conj [role ctx]) {:system-prompt "X"})]
    (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn compose-fn})
    (assert= "03: a blank overlay-prompt/model round-trips as nil/empty, not swallowed or defaulted wrongly"
             ["hardender" {:agent "claude" :model nil :two-pack? false :overlay-prompt ""}]
             (first @calls))))

;; ── invariant 2: a compose-fn exception never loses the previous prompt ───
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "hardender")]
  (spit prompt-file "STALE CONTENT")
  (write-metadata! root "hardender" {:agent "claude" :model "sonnet-5" :two-pack? false :overlay-prompt ""})
  (let [result (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn (fn [& _] (throw (RuntimeException. "source unreadable")))})]
    (assert-false "04: a compose-fn exception is never :ok" (:ok result))
    (assert-true "04: the failure reason names the exception" (str/starts-with? (:reason result) "recompose-exception:"))
    (assert-true "04: the failure reason includes the underlying message" (str/includes? (:reason result) "source unreadable"))
    (assert= "04: the prompt file is left completely untouched" "STALE CONTENT" (slurp prompt-file))))

;; ── invariant 2: a blank compose result is treated as a failure, not written ─
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "hardender")]
  (spit prompt-file "STALE CONTENT")
  (write-metadata! root "hardender" {:agent "claude" :model "sonnet-5" :two-pack? false :overlay-prompt ""})
  (let [result (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn (fn [& _] {:system-prompt ""})})]
    (assert= "05: an empty compose result fails with a stable reason" {:ok false :reason "empty-compose-result"} result)
    (assert= "05: the prompt file is left completely untouched" "STALE CONTENT" (slurp prompt-file))))

;; ── invariant 2: corrupt metadata JSON never crashes the caller ───────────
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "hardender")]
  (spit prompt-file "STALE CONTENT")
  (spit (str prompt-file ".metadata.json") "{not valid json")
  (let [result (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn (fn [& _] (throw (ex-info "must not be called" {})))})]
    (assert-false "06: corrupt metadata JSON is never :ok" (:ok result))
    (assert-true "06: the failure reason names the exception" (str/starts-with? (:reason result) "recompose-exception:"))
    (assert= "06: the prompt file is left completely untouched" "STALE CONTENT" (slurp prompt-file))))

;; ── invariant 4 (no-change loses nothing): re-recomposing with identical
;;    compose-fn output is byte-identical to what was already there ────────
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "hardender")]
  (write-metadata! root "hardender" {:agent "claude" :model "sonnet-5" :two-pack? false :overlay-prompt ""})
  (let [compose-fn (fn [& _] {:system-prompt "UNCHANGED CONTENT"})]
    (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn compose-fn})
    (let [first-write (slurp prompt-file)
          _ (handoff-lib/recompose-role-prompt! "hardender" {:compose-fn compose-fn})
          second-write (slurp prompt-file)]
      (assert= "07: recomposing twice against unchanged sources is byte-identical" first-write second-write))))

;; ── default compose-fn: the REAL PromptEngine composer, end to end ────────
;; No stub anywhere in this one - proves recompose-role-prompt! with no
;; :compose-fn override reaches the real, current swarmforge/roles/coder.prompt
;; in THIS repo (compose's repo-root is pinned to wherever prompt_engine_lib.bb
;; physically sits, never the fixture project-root above).
(let [root (fixture-root!)
      prompt-file (handoff-lib/prompt-file-path "coder")]
  (write-metadata! root "coder" {:agent "claude" :model "sonnet-5" :two-pack? false :overlay-prompt ""})
  (let [result (handoff-lib/recompose-role-prompt! "coder")]
    (assert= "08: the default compose-fn (real PromptEngine) succeeds" {:ok true} result)
    (assert-true "08: the composed text reaches all the way to the real role-prompt source"
                 (str/includes? (slurp prompt-file) "You are the coder."))))

(handoff-lib/set-project-root! nil)

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "bl911_rotation_recompose (BL-911): ALL TESTS PASSED")
  (do (println (str "bl911_rotation_recompose (BL-911): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
