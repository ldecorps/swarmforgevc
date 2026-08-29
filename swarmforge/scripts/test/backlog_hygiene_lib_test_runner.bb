#!/usr/bin/env bb
;; Unit tests for backlog_hygiene_lib.bb (BL-544).

(ns backlog-hygiene-lib-test
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "backlog_hygiene_lib.bb")))

(defn assert= [msg expected actual]
  (when-not (= expected actual)
    (println (str "FAIL: " msg))
    (println (str "  expected: " (pr-str expected)))
    (println (str "  actual:   " (pr-str actual)))
    (System/exit 1))
  (println (str "PASS: " msg)))

(defn sample-slice-missing-epic []
  "id: BL-999
title: test slice
type: feature
priority: 5
")

(defn sample-epic-missing-milestone []
  "id: BL-998
title: EPIC test
type: epic
epic: test-epic
priority: 0
")

(defn sample-clean-slice []
  "id: BL-997
title: test slice
type: feature
epic: test-epic
milestone: M8
priority: 5
")

(defn sample-clean-epic []
  "id: BL-996
title: EPIC test
type: epic
epic: test-epic
milestone: M8
priority: 0
")

(assert=
 "non-epic without epic is a missing-epic violation"
 [{:kind :missing-epic :id "BL-999" :path "fixture.yaml"}]
 (backlog-hygiene-lib/violations-for-text (sample-slice-missing-epic) {:id "BL-999" :path "fixture.yaml"}))

(assert=
 "epic without milestone is a missing-milestone violation"
 [{:kind :missing-milestone :id "BL-998" :path "fixture.yaml"}]
 (backlog-hygiene-lib/violations-for-text (sample-epic-missing-milestone) {:id "BL-998" :path "fixture.yaml"}))

(assert=
 "clean slice has no violations"
 []
 (backlog-hygiene-lib/violations-for-text (sample-clean-slice) {:id "BL-997" :path "fixture.yaml"}))

(assert=
 "clean epic has no violations"
 []
 (backlog-hygiene-lib/violations-for-text (sample-clean-epic) {:id "BL-996" :path "fixture.yaml"}))

;; ── BL-922: unreadable-acceptance (block scalar hiding a feature pointer) ──

(defn sample-block-scalar-hiding-feature [indicator]
  (str "id: BL-995
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: " indicator "
  specs/features/BL-042-example.feature
  (some prose about the contract)
priority: 5
"))

(doseq [indicator ["|" "|-" "|+" ">" ">-"]]
  (assert=
   (str "block scalar '" indicator "' hiding a feature pointer is an unreadable-acceptance violation")
   [{:kind :unreadable-acceptance :id "BL-995" :path "fixture.yaml"
     :feature-path "specs/features/BL-042-example.feature"}]
   (backlog-hygiene-lib/violations-for-text (sample-block-scalar-hiding-feature indicator) {:id "BL-995" :path "fixture.yaml"})))

(defn sample-single-line-pointer []
  "id: BL-994
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: specs/features/BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.feature
priority: 5
")

(assert=
 "a single-line pointer is not an unreadable-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-single-line-pointer)
                                          {:id "BL-994" :path "fixture.yaml"
                                           :repo-root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))))}))

(defn sample-block-scalar-honest-placeholder []
  "id: BL-993
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: |
  Specifier writes the scenarios. Minimum:
  - covers the happy path
priority: 5
")

(assert=
 "a block scalar naming no feature file is not an unreadable-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-block-scalar-honest-placeholder) {:id "BL-993" :path "fixture.yaml"}))

(defn sample-block-scalar-glob-mention []
  "id: BL-990
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: |
  Not yet drafted as a feature file - blocked on a human ruling. Once ruled,
  specifier returns to write specs/features/BL-990-*.feature covering the
  contract.
priority: 5
")

(assert=
 "a glob-shaped mention (BL-990-*.feature) previewing a not-yet-written file is not a real pointer (BL-555/BL-588 regression)"
 []
 (backlog-hygiene-lib/violations-for-text (sample-block-scalar-glob-mention) {:id "BL-990" :path "fixture.yaml"}))

(defn sample-no-acceptance-field []
  "id: BL-992
title: test slice
type: feature
epic: test-epic
milestone: M8
priority: 5
")

(assert=
 "an absent acceptance: field is not an unreadable-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-no-acceptance-field) {:id "BL-992" :path "fixture.yaml"}))

(assert=
 "format-violation names the ticket id, path, and hidden feature path"
 true
 (boolean (re-find #"BL-995.*fixture\.yaml.*specs/features/BL-042-example\.feature"
                    (backlog-hygiene-lib/format-violation
                     {:kind :unreadable-acceptance :id "BL-995" :path "fixture.yaml"
                      :feature-path "specs/features/BL-042-example.feature"}))))

;; ── BL-1105: duplicate ticket id ───────────────────────────────────────────

(assert=
 "duplicate-id keys on the id field across different filename slugs"
 [{:kind :duplicate-id :id "BL-4242" :path "paused/BL-4242-new.yaml"
   :others [{:path "paused/BL-4242-one-slug.yaml"}]}]
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-new.yaml"}]
  {:ok {"BL-4242" [{:path "paused/BL-4242-one-slug.yaml"}]}}
  {:ok {}}))

(assert=
 "an id present only in the published corpus is refused"
 [{:kind :duplicate-id :id "BL-4242" :path "paused/BL-4242-new.yaml"
   :others [{:path "done/BL-4242-published.yaml"}]}]
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-new.yaml"}]
  {:ok {}}
  {:ok {"BL-4242" [{:path "done/BL-4242-published.yaml"}]}}))

(assert=
 "an unreadable published corpus fails closed"
 [{:kind :published-corpus-unreadable :message "published corpus could not be read"}]
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-new.yaml"}]
  {:ok {}}
  {:error "published corpus could not be read"}))

(assert=
 "a unique id against empty corpora has no duplicate-id violation"
 []
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-new.yaml"}]
  {:ok {}}
  {:ok {}}))

;; Two subjects in one gate run, neither yet in the corpus indexes — peer
;; scan must refuse (dropping subject-peer-duplicates would silently pass).
(assert=
 "two subjects claiming the same id in one run are refused even with empty corpora"
 [{:kind :duplicate-id :id "BL-4242" :path "paused/BL-4242-a.yaml"
   :others [{:path "paused/BL-4242-b.yaml"}]}
  {:kind :duplicate-id :id "BL-4242" :path "paused/BL-4242-b.yaml"
   :others [{:path "paused/BL-4242-a.yaml"}]}]
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-a.yaml"}
   {:id "BL-4242" :path "paused/BL-4242-b.yaml"}]
  {:ok {}}
  {:ok {}}))

(assert=
 "format-violation for duplicate-id names both files"
 true
 (boolean (re-find #"DUPLICATE-ID BL-4242.*new\.yaml.*one-slug\.yaml"
                    (backlog-hygiene-lib/format-violation
                     {:kind :duplicate-id :id "BL-4242" :path "paused/BL-4242-new.yaml"
                      :others [{:path "paused/BL-4242-one-slug.yaml"}]}))))

;; ── BL-1194: self-duplicate false positive (relative path + published self) ─
;; backlog-relative normalizes any path to <pool>/<filename> form so the same
;; file compares equal regardless of how the caller spelled it.

(assert= "backlog-relative strips an absolute checkout path to pool/file"
         "paused/BL-4242-x.yaml"
         (backlog-hygiene-lib/backlog-relative "/abs/repo/backlog/paused/BL-4242-x.yaml"))
(assert= "backlog-relative strips a git-relative published path to pool/file"
         "paused/BL-4242-x.yaml"
         (backlog-hygiene-lib/backlog-relative "backlog/paused/BL-4242-x.yaml"))
(assert= "backlog-relative passes through a pool-relative path unchanged"
         "paused/BL-4242-x.yaml"
         (backlog-hygiene-lib/backlog-relative "paused/BL-4242-x.yaml"))
(assert= "backlog-relative falls back to the input when no pool segment is present"
         "stray/BL-4242-x.yaml"
         (backlog-hygiene-lib/backlog-relative "stray/BL-4242-x.yaml"))

;; BL-1194 bug #1: a subject passed by a working-directory-relative path was
;; never excluded from its own absolute local-corpus entry, so every
;; relative-path invocation reported the subject as its own duplicate.
(assert=
 "BL-1194 bug #1: a relative subject path is not reported as its own duplicate when the local index is absolute"
 []
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-new.yaml"}]
  {:ok {"BL-4242" [{:path "/abs/repo/backlog/paused/BL-4242-new.yaml"}]}}
  {:ok {}}))

;; BL-1194 bug #2: even with bug #1 worked around (absolute subject path), a
;; published entry that was simply the subject's own already-committed copy
;; was never recognized as "this ticket" because local-names was derived
;; after subject removal.
(assert=
 "BL-1194 bug #2: a published copy of the subject's own file is not reported as another holder"
 []
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "/abs/repo/backlog/paused/BL-4242-new.yaml"}]
  {:ok {"BL-4242" [{:path "/abs/repo/backlog/paused/BL-4242-new.yaml"}]}}
  {:ok {"BL-4242" [{:path "backlog/paused/BL-4242-new.yaml"}]}}))

;; BL-1194 regression: a genuinely different local file under the same id is
;; still caught, with a relative subject path.
(assert=
 "BL-1194 regression: genuine local duplicate is still caught with a relative subject path"
 [{:kind :duplicate-id :id "BL-4242" :path "paused/BL-4242-new.yaml"
   :others [{:path "/abs/repo/backlog/paused/BL-4242-old.yaml"}]}]
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-new.yaml"}]
  {:ok {"BL-4242" [{:path "/abs/repo/backlog/paused/BL-4242-old.yaml"}]}}
  {:ok {}}))

;; BL-1194 regression: a genuinely different published file (different
;; basename) under the same id is still caught.
(assert=
 "BL-1194 regression: a published entry under the same id but different basename is still reported"
 [{:kind :duplicate-id :id "BL-4242" :path "paused/BL-4242-new.yaml"
   :others [{:path "backlog/done/BL-4242-old.yaml"}]}]
 (backlog-hygiene-lib/duplicate-id-violations
  [{:id "BL-4242" :path "paused/BL-4242-new.yaml"}]
  {:ok {}}
  {:ok {"BL-4242" [{:path "backlog/done/BL-4242-old.yaml"}]}}))

;; BL-1194 invariant 1: verdict is identical whether the subject path is
;; relative or absolute, with both corpora carrying the subject's own copy.
(let [rel-path "paused/BL-4242-new.yaml"
      abs-path "/abs/repo/backlog/paused/BL-4242-new.yaml"
      local    {:ok {"BL-4242" [{:path "/abs/repo/backlog/paused/BL-4242-new.yaml"}]}}
      published {:ok {"BL-4242" [{:path "backlog/paused/BL-4242-new.yaml"}]}}
      rel-result (backlog-hygiene-lib/duplicate-id-violations
                  [{:id "BL-4242" :path rel-path}] local published)
      abs-result (backlog-hygiene-lib/duplicate-id-violations
                  [{:id "BL-4242" :path abs-path}] local published)]
  (assert=
   "BL-1194 invariant 1: verdict is identical for relative and absolute subject paths"
   rel-result abs-result)
  (assert=
   "BL-1194 invariant 1: and that verdict is clean (self never counts as other)"
   [] rel-result))

;; ── BL-1216: pool classification + content verdict ─────────────────────────

(assert= "path-pool reads the pool segment from an absolute or relative path"
         "active" (backlog-hygiene-lib/path-pool "/repo/backlog/active/BL-1-x.yaml"))
(assert= "path-pool reads a bare relative path" "hold"
         (backlog-hygiene-lib/path-pool "hold/BL-1-x.yaml"))
(assert= "path-pool is nil for a path naming no known pool" nil
         (backlog-hygiene-lib/path-pool "backlog/BL-1-x.yaml"))

(assert= "active and paused classify as live" "live"
         (backlog-hygiene-lib/pool-classification "active"))
(assert= "paused classifies as live" "live"
         (backlog-hygiene-lib/pool-classification "paused"))
(assert= "hold and done classify as terminal" "terminal"
         (backlog-hygiene-lib/pool-classification "hold"))
(assert= "done classifies as terminal" "terminal"
         (backlog-hygiene-lib/pool-classification "done"))
(assert= "an unrecognized pool classifies as nil" nil
         (backlog-hygiene-lib/pool-classification "nope"))

(assert= "content-verdict reports identical for byte-identical content, injected reader"
         "CONTENT IDENTICAL"
         (backlog-hygiene-lib/content-verdict "a" ["b"] {"a" "same" "b" "same"}))
(assert= "content-verdict reports differs when content differs, injected reader"
         "CONTENT DIFFERS"
         (backlog-hygiene-lib/content-verdict "a" ["b"] {"a" "same" "b" "different"}))
(assert= "content-verdict reports differs — never identical — when the other file is unreadable"
         "CONTENT DIFFERS"
         (backlog-hygiene-lib/content-verdict "a" ["b"] {"a" "same"}))
(assert= "content-verdict reports differs when the subject itself is unreadable"
         "CONTENT DIFFERS"
         (backlog-hygiene-lib/content-verdict "a" ["b"] {"b" "same"}))
(assert= "content-verdict requires every other to match, not just one"
         "CONTENT DIFFERS"
         (backlog-hygiene-lib/content-verdict "a" ["b" "c"] {"a" "same" "b" "same" "c" "nope"}))

(assert=
 "format-violation for duplicate-id: exactly one live copy is named to keep, pools and content verdict are stated"
 "DUPLICATE-ID BL-4242  backlog/active/BL-4242-x.yaml [active/live]  also: backlog/hold/BL-4242-x.yaml [hold/terminal]  (CONTENT DIFFERS; duplicate ticket id — refuse at mint; keep: backlog/active/BL-4242-x.yaml)"
 (backlog-hygiene-lib/format-violation
  {:kind :duplicate-id :id "BL-4242" :path "backlog/active/BL-4242-x.yaml"
   :others [{:path "backlog/hold/BL-4242-x.yaml"}]}
  (fn [p] (get {"backlog/active/BL-4242-x.yaml" "a" "backlog/hold/BL-4242-x.yaml" "b"} p))))

(assert=
 "format-violation for duplicate-id: a collision confined to live pools names no copy to keep"
 "DUPLICATE-ID BL-4242  backlog/active/BL-4242-x.yaml [active/live]  also: backlog/paused/BL-4242-x.yaml [paused/live]  (CONTENT IDENTICAL; duplicate ticket id — refuse at mint)"
 (backlog-hygiene-lib/format-violation
  {:kind :duplicate-id :id "BL-4242" :path "backlog/active/BL-4242-x.yaml"
   :others [{:path "backlog/paused/BL-4242-x.yaml"}]}
  (fn [_] "same")))

;; Hardener: the converse of the two-live case above — a collision confined
;; to TERMINAL pools (hold + done, zero live copies) must also name no copy
;; to keep. sole-live-keep's own guard is `(= 1 (count live))`, so a mutant
;; loosening that to `(<= 1 (count live))` is caught by the two-live test
;; above, but a mutant loosening it to `(>= 0 (count live))` or otherwise
;; mishandling the zero-live count needs THIS fixture to be seen at all —
;; two live copies and zero live copies are different code paths through
;; the same guard, and neither existing test exercises zero.
(assert=
 "format-violation for duplicate-id: a collision confined to terminal pools names no copy to keep"
 "DUPLICATE-ID BL-4242  backlog/hold/BL-4242-x.yaml [hold/terminal]  also: backlog/done/BL-4242-x.yaml [done/terminal]  (CONTENT DIFFERS; duplicate ticket id — refuse at mint)"
 (backlog-hygiene-lib/format-violation
  {:kind :duplicate-id :id "BL-4242" :path "backlog/hold/BL-4242-x.yaml"
   :others [{:path "backlog/done/BL-4242-x.yaml"}]}
  (fn [p] (get {"backlog/hold/BL-4242-x.yaml" "a" "backlog/done/BL-4242-x.yaml" "b"} p))))

(assert=
 "a missing local backlog root fails closed (never an empty corpus)"
 true
 (boolean (:error (backlog-hygiene-lib/read-local-id-index
                   "/tmp/bl1105-no-such-backlog-root"))))

;; ── BL-1027: dangling acceptance pointer at mint ───────────────────────────

(def ^:private repo-root-for-tests
  (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))))
)

(defn sample-dangling-pointer []
  "id: BL-1027
title: test slice
type: feature
epic: test-epic
milestone: M8
acceptance: specs/features/BL-1027-does-not-exist-anywhere.feature
priority: 5
")

(assert=
 "a single-line pointer to a missing feature file is a dangling-acceptance violation"
 [{:kind :dangling-acceptance :id "BL-1027" :path "fixture.yaml"
   :feature-path "specs/features/BL-1027-does-not-exist-anywhere.feature"}]
 (backlog-hygiene-lib/violations-for-text (sample-dangling-pointer)
                                          {:id "BL-1027" :path "fixture.yaml"
                                           :repo-root repo-root-for-tests}))

(assert=
 "an absent acceptance field is never a dangling-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-no-acceptance-field)
                                          {:id "BL-992" :path "fixture.yaml"
                                           :repo-root repo-root-for-tests}))

(assert=
 "epic-tracker nested none: prose is never a dangling-acceptance violation"
 []
 (backlog-hygiene-lib/violations-for-text
  "id: BL-541
title: EPIC
type: epic
epic: code-quality-gates
milestone: M8
acceptance:
  none: \"tracker only — see decomposes_into children for acceptance\"
priority: 0
"
  {:id "BL-541" :path "fixture.yaml" :repo-root repo-root-for-tests}))

(assert=
 "format-violation for dangling-acceptance names the ticket and the path"
 true
 (boolean (re-find #"DANGLING-ACCEPTANCE BL-1027.*fixture\.yaml.*does-not-exist"
                    (backlog-hygiene-lib/format-violation
                     {:kind :dangling-acceptance :id "BL-1027" :path "fixture.yaml"
                      :feature-path "specs/features/BL-1027-does-not-exist-anywhere.feature"}))))

;; ── BL-1095: retired type: bug at mint ─────────────────────────────────────

(defn sample-retired-bug []
  "id: BL-1095
title: retired type
type: bug
epic: fixture-epic
milestone: M8
severity: high
priority: 5
")

(defn sample-defect-replacement []
  "id: BL-1095
title: replacement type
type: defect
epic: fixture-epic
milestone: M8
severity: high
priority: 5
")

(assert=
 "type: bug is a retired-ticket-type violation"
 [{:kind :retired-ticket-type :id "BL-1095" :path "fixture.yaml" :ticket-type "bug"}]
 (backlog-hygiene-lib/violations-for-text (sample-retired-bug)
                                          {:id "BL-1095" :path "fixture.yaml"
                                           :repo-root repo-root-for-tests}))

(assert=
 "type: defect is never a retired-ticket-type violation"
 []
 (backlog-hygiene-lib/violations-for-text (sample-defect-replacement)
                                          {:id "BL-1095" :path "fixture.yaml"
                                           :repo-root repo-root-for-tests}))

(assert=
 "format-violation for retired-ticket-type names the ticket and type"
 true
 (boolean (re-find #"RETIRED-TICKET-TYPE BL-1095.*fixture\.yaml.*bug"
                    (backlog-hygiene-lib/format-violation
                     {:kind :retired-ticket-type :id "BL-1095" :path "fixture.yaml"
                      :ticket-type "bug"}))))

;; ── BL-533: untracked acceptance + epic wiring checklist ───────────────────

(assert=
 "epic with two unwired children fails checklist"
 false
 (:ok? (backlog-hygiene-lib/epic-wiring-exit-checklist
        "id: BL-E\ntype: epic\ndecomposes_into: [BL-1, BL-2]\n"
        ["id: BL-1\n" "id: BL-2\n"])))

(assert=
 "epic with one wired child passes checklist"
 true
 (:ok? (backlog-hygiene-lib/epic-wiring-exit-checklist
        "id: BL-E\ntype: epic\ndecomposes_into:\n  - BL-1\n  - BL-2\n"
        ["id: BL-1\nrequired_wiring: [a::b]\n" "id: BL-2\n"])))

(assert=
 "single-child epic is not applicable"
 false
 (:applicable? (backlog-hygiene-lib/epic-wiring-exit-checklist
                "id: BL-E\ntype: epic\ndecomposes_into: [BL-1]\n"
                ["id: BL-1\n"])))

(assert=
 "epic-wiring-exit-violation with unwired children"
 {:kind :epic-wiring-missing :id "BL-E" :path "e.yaml" :child-count 2}
 (backlog-hygiene-lib/epic-wiring-exit-violation
  "id: BL-E\ntype: epic\nepic: e\nmilestone: M8\ndecomposes_into: [BL-1, BL-2]\n"
  {:id "BL-E" :path "e.yaml" :child-texts ["id: BL-1\n" "id: BL-2\n"]}))

(assert=
 "format-violation for untracked-acceptance names the path"
 true
 (boolean (re-find #"UNTRACKED-ACCEPTANCE.*ls-files"
                    (backlog-hygiene-lib/format-violation
                     {:kind :untracked-acceptance :id "BL-533" :path "t.yaml"
                      :feature-path "specs/features/BL-533-x.feature"}))))
(println "backlog_hygiene_lib_test: all passed")
