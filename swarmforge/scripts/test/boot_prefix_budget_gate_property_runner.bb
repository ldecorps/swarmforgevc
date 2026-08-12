#!/usr/bin/env bb
;; BL-859: PROPERTY test over boot_prefix_budget_gate_lib.bb, covering the
;; first of the ticket's two declared invariants (coder-authored first, per
;; BL-654):
;;
;;   P1 measures-what-boot-composes - boot-prefix-budget-gate-lib/measure's
;;      reported size is IDENTICAL, for every generated constitution tree
;;      shape, to an independently-taken count of
;;      prompt-engine-lib/stable-prefix-text run against that same root -
;;      never a re-derived sum (e.g. adding up file sizes directly) that
;;      could silently drift from what boot actually pays. The generator
;;      varies article count (0-4, reaching the zero-article edge and
;;      multi-article joins), article content length (0-4000 chars),
;;      whether a reference/ subdirectory exists with its own body (must be
;;      structurally excluded, never counted), and whether a hidden dotfile
;;      sits in articles/ (also excluded) - the shapes the invariant
;;      quantifies over, not a hoped-for guess at them.
;;
;; The ticket's second declared invariant (testable via an injected root, no
;; *_FORCE_RESULT env bypass, no process.chdir) is a code-shape/construction
;; constraint, not a claim over a generated input space - it has no
;; executable property encoding; the stated reason is recorded in this
;; ticket's step-handler file per BL-654's hatch, mirroring BL-715's
;; precedent for the same kind of non-encodable invariant.
;;
;; Seeded (not wall-clock) randomness so failures reproduce: the same
;; hand-rolled LCG this repo's .bb property runners already use (see
;; ambulance_lib_property_runner.bb) - the "*.property.test.js" /
;; vitest.properties.config.mjs home is a TypeScript convention with no
;; Babashka equivalent (BL-472 tracks pinning real property tooling for .bb
;; scripts, deliberately deferred).

(ns boot-prefix-budget-gate-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "boot_prefix_budget_gate_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "boot-prefix-budget-gate-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── seeded generator (same LCG shape as ambulance_lib_property_runner.bb) ──
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))

(defn gen-tree [s]
  (let [[n-articles s1] (gen-int s 5)                    ; 0..4 articles
        [has-ref? s2] (gen-bool s1)
        [has-dotfile? s3] (gen-bool s2)
        [const-len s4] (gen-int s3 2000)
        [pipeline-len s5] (gen-int s4 2000)
        [ref-len s6] (gen-int s5 3000)
        article-lens (loop [i 0 sx s6 acc []]
                       (if (= i n-articles)
                         [acc sx]
                         (let [[len sy] (gen-int sx 4000)]
                           (recur (inc i) sy (conj acc len)))))
        [lens s7] article-lens]
    [{:const-len const-len
      :pipeline-len pipeline-len
      :has-ref? has-ref?
      :ref-len ref-len
      :has-dotfile? has-dotfile?
      :article-lens lens}
     s7]))

(defn pad [n] (apply str (repeat n "x")))

(defn build-tree! [{:keys [const-len pipeline-len has-ref? ref-len has-dotfile? article-lens]}]
  (let [root (mk-tmp)
        articles-dir (fs/path root "swarmforge" "constitution" "articles")]
    (fs/create-dirs articles-dir)
    (spit (str (fs/path root "swarmforge" "constitution.prompt")) (pad const-len))
    (spit (str (fs/path root "swarmforge" "PIPELINE.md")) (pad pipeline-len))
    (doseq [[i len] (map-indexed vector article-lens)]
      (spit (str (fs/path articles-dir (str "art-" i ".md"))) (pad len)))
    (when has-dotfile?
      (spit (str (fs/path articles-dir ".hidden.md")) (pad 500)))
    (when has-ref?
      (let [ref-dir (fs/path articles-dir "reference")]
        (fs/create-dirs ref-dir)
        (spit (str (fs/path ref-dir "deep.md")) (pad ref-len))))
    root))

;; ── P1: measures-what-boot-composes ─────────────────────────────────────────
(loop [i 0 s 42]
  (when (< i runs)
    (let [[shape s'] (gen-tree s)
          root (build-tree! shape)
          oracle (count (prompt-engine-lib/stable-prefix-text root))
          gated (boot-prefix-budget-gate-lib/measure root)]
      (when-not (= oracle gated)
        (swap! failures conj
               (str "FAIL P1 measures-what-boot-composes\n  seed:  " s
                    "\n  shape: " (pr-str shape)
                    "\n  independent stable-prefix-text count: " oracle
                    "\n  gate measure():                        " gated)))
      (recur (inc i) s'))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "boot_prefix_budget_gate_lib properties: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
