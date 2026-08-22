#!/usr/bin/env bb
;; Unit tests for BL-962: gather-pipeline-code-on-main's merge adjudication
;; against QA-approved parents (babysitter_check.bb). Tests the PURE core
;; (adjudicate-merge-paths, assemble-offending-commits) directly, plus the
;; invariant-2 structural gate over the file's source. The impure wiring
;; (parent enumeration, is_qa_ancestor.sh calls, per-path diffs, the env
;; seam) is covered end-to-end by the BL-962 acceptance scenarios driving
;; the real CLI over scratch git repos.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def check-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_check.bb")))

;; babysitter_check.bb resolves project-root from *command-line-args* at load
;; time (and exits via usage when absent) - bind a throwaway root so the load
;; succeeds; the pure functions under test never read it.
(binding [*command-line-args* ["/nonexistent-bl962-test-root"]]
  (load-file check-file))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── adjudicate-merge-paths (invariant 1's pure decision) ──────────────────

(assert= "a path byte-identical to a QA-approved parent is exempted"
         []
         (babysitter-check/adjudicate-merge-paths
          ["extension/src/landed.ts"]
          [{:parent "p2" :qa-approved? true :identical-paths #{"extension/src/landed.ts"}}]))

(assert= "a path differing from every QA-approved parent stays reported (coat-tails)"
         ["extension/src/rider.ts"]
         (babysitter-check/adjudicate-merge-paths
          ["extension/src/landed.ts" "extension/src/rider.ts"]
          [{:parent "p2" :qa-approved? true :identical-paths #{"extension/src/landed.ts"}}]))

(assert= "identity to a parent that is NOT QA-approved never clears a path"
         ["extension/src/side.ts"]
         (babysitter-check/adjudicate-merge-paths
          ["extension/src/side.ts"]
          [{:parent "p2" :qa-approved? false :identical-paths #{"extension/src/side.ts"}}]))

(assert= "no parents at all: every offending path stays reported"
         ["extension/src/a.ts"]
         (babysitter-check/adjudicate-merge-paths ["extension/src/a.ts"] []))

(assert= "any one QA-approved identical parent suffices among several"
         []
         (babysitter-check/adjudicate-merge-paths
          ["extension/src/a.ts"]
          [{:parent "p2" :qa-approved? false :identical-paths #{"extension/src/a.ts"}}
           {:parent "p3" :qa-approved? true :identical-paths #{"extension/src/a.ts"}}]))

(assert= "reported paths preserve the offending order"
         ["b" "d"]
         (babysitter-check/adjudicate-merge-paths
          ["a" "b" "c" "d"]
          [{:parent "p2" :qa-approved? true :identical-paths #{"a" "c"}}]))

;; ── assemble-offending-commits (invariant 3's pure composition) ───────────

(assert= "all-clean rows assemble to an available empty sweep"
         {:offending-commits [] :ancestry-unavailable? false}
         (babysitter-check/assemble-offending-commits [nil nil]))

(assert= "offender rows pass through in order, nils dropped"
         {:offending-commits [{:sha "a" :subject "s" :paths ["p"]}] :ancestry-unavailable? false}
         (babysitter-check/assemble-offending-commits
          [nil {:sha "a" :subject "s" :paths ["p"]} nil]))

(assert= "one adjudication failure fails the WHOLE sweep closed - valid offenders beside it are withheld, never a partial result that reads as clean"
         {:offending-commits [] :ancestry-unavailable? true}
         (babysitter-check/assemble-offending-commits
          [{:sha "a" :subject "s" :paths ["p"]}
           :babysitter-check/adjudication-failed
           {:sha "b" :subject "t" :paths ["q"]}]))

;; ── BL-962 hardening (hardender, 2026-08-20): non-merge commits are UNTOUCHED ─
;; A hand-authored sweep (BL-638 fallback - this feature has no Scenario
;; Outline, so the BL-113 gate is inapplicable, and .bb has no wired mutation
;; tool) killed 5 of 6 mutants. The survivor deleted offender-row's
;; `(not (commit-is-merge? sha))` branch, sending NON-merge commits through
;; parent adjudication too, and nothing failed - offender-row had no unit
;; coverage at all.
;;
;; It is NOT an equivalent mutant. On the happy path it agrees by accident:
;; merge-non-first-parents drops the first two fields of `rev-list --parents`,
;; so a non-merge commit yields [], parents is empty, and nothing is exempted.
;; But that call is a git subprocess that returns nil on failure, which
;; merge-parent-facts turns into {:ok? false} and offender-row into
;; ::adjudication-failed - failing the WHOLE sweep closed. So the mutant
;; converts an ordinary non-merge offender into a total sweep failure whenever
;; that extra git call fails, and the ticket's own constraint is that non-merge
;; commits are untouched.
;;
;; The test pins the property directly: with adjudication stubbed to FAIL, a
;; non-merge commit must still report its offending paths, because it must
;; never consult adjudication in the first place.

(let [offender-row @#'babysitter-check/offender-row]
  (with-redefs [babysitter-check/commit-touched-paths (fn [_] ["extension/src/live.ts"])
                babysitter-check/offending-paths (fn [touched _] (vec touched))
                babysitter-check/commit-is-merge? (fn [_] false)
                babysitter-check/commit-subject (fn [_] "a plain commit")
                ;; if the non-merge branch is ever removed, THIS is what the
                ;; commit would fall through to - and it fails closed
                babysitter-check/merge-parent-facts (fn [_ _] {:ok? false})]
    (assert= "a NON-merge commit reports its offending paths without consulting adjudication"
             {:sha "abc123" :subject "a plain commit" :paths ["extension/src/live.ts"]}
             (offender-row "abc123" #{}))))

(let [offender-row @#'babysitter-check/offender-row]
  (with-redefs [babysitter-check/commit-touched-paths (fn [_] ["extension/src/live.ts"])
                babysitter-check/offending-paths (fn [touched _] (vec touched))
                babysitter-check/commit-is-merge? (fn [_] true)
                babysitter-check/commit-subject (fn [_] "a merge")
                babysitter-check/merge-parent-facts (fn [_ _] {:ok? false})]
    (assert= "a MERGE whose parent facts cannot be gathered fails closed (the same stub, opposite side)"
             :babysitter-check/adjudication-failed
             (offender-row "def456" #{}))))

;; ── invariant 2 structural gate ────────────────────────────────────────────
;; "Whether a parent is QA-approved is decided only by is_qa_ancestor.sh" -
;; babysitter_check.bb must contain NO second ancestry primitive of its own
;; (`merge-base` / `--is-ancestor` are the shapes a second predicate would
;; take), and must name is_qa_ancestor.sh at exactly ONE site (the resolver
;; behind qa-ancestor?, seam included).
;;
;; Architect bounce D1 (2026-08-20): the first cut stripped STRING CONTENTS
;; before scanning - but in Babashka a git subcommand is always a
;; string-literal argument to a shell-out, so `merge-base`/`--is-ancestor`
;; can ONLY ever appear inside strings, and a rival predicate passed the
;; gate unnoticed (a gate green against a deliberately broken
;; implementation). The scan now strips ;-comments only - whole-line AND
;; trailing - while PRESERVING string contents, so string data trips the
;; gate and prose about the rule still cannot.

(defn strip-comments-keep-strings
  "Blanks ;-comments (any ; outside a string, to end of line) while KEEPING
   string contents - the text a bb shell-out's git subcommands live in. A
   backslash outside a string starts a char literal; its next char is
   copied through, so the \\\" and \\; char literals never confuse the
   walker."
  [content]
  (let [sb (StringBuilder.)]
    (loop [chars (seq content) in-string? false escaped? false]
      (if-let [c (first chars)]
        (cond
          in-string?
          (cond
            escaped? (do (.append sb c) (recur (rest chars) true false))
            (= c \\) (do (.append sb c) (recur (rest chars) true true))
            (= c \") (do (.append sb c) (recur (rest chars) false false))
            :else (do (.append sb c) (recur (rest chars) true false)))
          (= c \\) (do (.append sb c)
                       (when-let [n (second chars)] (.append sb n))
                       (recur (rest (rest chars)) false false))
          (= c \") (do (.append sb c) (recur (rest chars) true false))
          (= c \;) (recur (drop-while #(not= % \newline) chars) false false)
          :else (do (.append sb c) (recur (rest chars) false false)))
        (str sb)))))

(let [raw (slurp check-file)
      code (strip-comments-keep-strings raw)
      ancestry-refs (count (filter #(str/includes? % "is_qa_ancestor.sh")
                                   (str/split-lines code)))]
  (assert= "no second ancestry predicate: `merge-base`/`--is-ancestor` never appears in babysitter_check.bb's code, string arguments included"
           nil (re-find #"merge-base|--is-ancestor" code))
  (assert= "is_qa_ancestor.sh is named at exactly one code site (the qa-ancestor? resolver)"
           1 ancestry-refs))

;; ── report ─────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS: bl962 merge adjudication (babysitter_check.bb pure core)")
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
