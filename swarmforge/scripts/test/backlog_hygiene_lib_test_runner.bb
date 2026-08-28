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
