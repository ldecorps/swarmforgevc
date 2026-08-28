#!/usr/bin/env bb
;; Unit tests for boot_prefix_budget_gate_lib.bb (BL-859).

(ns boot-prefix-budget-gate-lib-test
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "boot_prefix_budget_gate_lib.bb")))

(defn assert= [msg expected actual]
  (when-not (= expected actual)
    (println (str "FAIL: " msg))
    (println (str "  expected: " (pr-str expected)))
    (println (str "  actual:   " (pr-str actual)))
    (System/exit 1))
  (println (str "PASS: " msg)))

(defn assert-true [msg v]
  (assert= msg true (boolean v)))

;; ── synthetic tree helper ────────────────────────────────────────────────
(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "boot-prefix-budget-gate-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn pad [n] (apply str (repeat (max 0 n) "x")))

;; Calibrates against boot-prefix-budget-gate-lib/measure itself (the SAME
;; composer path the gate uses in production - BL-859's "never re-derived by
;; a second implementation" invariant), rather than hand-deriving the join
;; arithmetic stable-prefix-text uses internally: build an empty tree, measure
;; its baseline size, then pad one article file so the total lands on
;; target-chars exactly. Self-verifying - a wrong calibration fails the
;; caller's own measure assertion immediately, it is never silently trusted.
(defn build-tree-of-exact-size! [root target-chars]
  (fs/create-dirs (fs/path root "swarmforge" "constitution" "articles"))
  (spit (str (fs/path root "swarmforge" "constitution.prompt")) "")
  (spit (str (fs/path root "swarmforge" "PIPELINE.md")) "")
  (let [article-path (str (fs/path root "swarmforge" "constitution" "articles" "01_article.md"))]
    (spit article-path "")
    (let [baseline (boot-prefix-budget-gate-lib/measure root)
          pad-len (- target-chars baseline)]
      (when (neg? pad-len)
        (throw (ex-info "target-chars too small for this tree shape"
                         {:target target-chars :baseline baseline})))
      (spit article-path (pad pad-len))))
  root)

;; ── verdict boundary scenarios (BL-859 budget-verdict-01) ───────────────────
(doseq [[chars expected-exit] [[43999 0] [44000 0] [44001 1] [65138 1]]]
  (let [root (mk-tmp)
        _ (build-tree-of-exact-size! root chars)
        measured (boot-prefix-budget-gate-lib/measure root)
        v (boot-prefix-budget-gate-lib/verdict measured)]
    (assert= (str "measured size for a " chars "-char synthetic tree") chars measured)
    (assert= (str "verdict exit-code at " chars " chars") expected-exit (:exit-code v))))

;; ── actionable-remedy (BL-859 actionable-remedy-04): 65138 is 21138 over ────
;; the 44000 budget - the same overage the ticket's own approval_context cites.
(let [root (mk-tmp)
      _ (build-tree-of-exact-size! root 65138)
      v (boot-prefix-budget-gate-lib/verdict (boot-prefix-budget-gate-lib/measure root))]
  (assert= "over-budget amount at 65138 chars" 21138 (:over v))
  (let [report (boot-prefix-budget-gate-lib/format-report v)]
    (assert-true "FAIL report states the measured size" (str/includes? report "65138"))
    (assert-true "FAIL report states the budget" (str/includes? report "44000"))
    (assert-true "FAIL report states how many characters to move" (str/includes? report "21138"))))

;; ── ok report shape ──────────────────────────────────────────────────────
(let [root (mk-tmp)
      _ (build-tree-of-exact-size! root 100)
      v (boot-prefix-budget-gate-lib/verdict (boot-prefix-budget-gate-lib/measure root))]
  (assert= "verdict exit-code well under budget" 0 (:exit-code v))
  (assert= "over is zero when under budget" 0 (:over v))
  (assert-true "ok report states the measured size" (str/includes? (boot-prefix-budget-gate-lib/format-report v) "100")))

;; ── measures the SAME text the real composer produces (BL-859 ──────────────
;; measures-what-boot-composes-02) - cross-checked against prompt-engine-lib's
;; own stable-prefix-text directly, not against this gate lib's own output.
(assert= "measure() with no root matches prompt-engine-lib/stable-prefix-text on the real repo"
         (count (prompt-engine-lib/stable-prefix-text))
         (boot-prefix-budget-gate-lib/measure))

;; ── reference/ exclusion (BL-859 reference-bodies-excluded-03) ──────────────
(let [root (mk-tmp)
      _ (build-tree-of-exact-size! root 500)
      without-ref (boot-prefix-budget-gate-lib/measure root)]
  (fs/create-dirs (fs/path root "swarmforge" "constitution" "articles" "reference"))
  (spit (str (fs/path root "swarmforge" "constitution" "articles" "reference" "deep.md"))
        (pad 5000))
  (assert= "a reference/ subdir file does not count toward the measured size"
           without-ref
           (boot-prefix-budget-gate-lib/measure root)))

(println "boot_prefix_budget_gate_lib: ALL PASS")
