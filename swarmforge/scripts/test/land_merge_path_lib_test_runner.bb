#!/usr/bin/env bb
;; TDD runner for land_merge_path_lib.bb (BL-1901): the pure line verdict that
;; decides whether a queued parcel line lands as a merge of origin/main.
(ns land-merge-path-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_merge_path_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn own [subject] {:sha "a" :subject subject :parents ["p"]})
(defn merge-c [on-main?] {:sha "m" :subject "Merge main 1234567890 into coder." :parents ["p" "q"] :merge-parents-on-main? on-main?})
(defn clean? [commits] (:clean? (land-merge-path-lib/line-verdict "BL-9001" commits)))

;; ── clean lines ─────────────────────────────────────────────────────────
(assert= "commits naming only the landing ticket are clean"
         true (clean? [(own "BL-9001: build") (own "BL-9001: QA review pass evidence (NONE)")]))
(assert= "a merge whose other parent is on origin/main is clean"
         true (clean? [(own "BL-9001: build") (merge-c true)]))
(assert= "the ticket id may appear anywhere in the subject, in any case"
         true (clean? [(own "Fix the guard (bl-9001)")]))

;; ── unclean lines ───────────────────────────────────────────────────────
(assert= "a commit naming another ticket as well is not clean"
         false (clean? [(own "BL-9001: build") (own "BL-9001 and BL-9002: shared fix")]))
(assert= "a commit naming only another ticket is not clean"
         false (clean? [(own "BL-9002: unlanded work")]))
(assert= "a commit naming no ticket that is no merge is not clean"
         false (clean? [(own "tidy up")]))
(assert= "a merge whose other parent is not on origin/main is not clean"
         false (clean? [(merge-c false)]))
(assert= "a merge whose ancestry could not be determined is not clean"
         false (clean? [(assoc (merge-c true) :merge-parents-on-main? nil)]))
;; QA D1/D2 on BL-1901: a merge's subject is held to the same ticket rule as
;; any other commit - no ticket, or only the landing one.
(assert= "a merge whose subject names another ticket is not clean, even with its parents on origin/main"
         false (clean? [(own "BL-9001: build") (assoc (merge-c true) :subject "Merge BL-9002 work into coder.")]))
(assert= "a merge whose subject names the landing ticket and another is not clean"
         false (clean? [(assoc (merge-c true) :subject "Merge BL-9001 and BL-9002 into coder.")]))
(assert= "a merge whose subject names only the landing ticket is clean"
         true (clean? [(own "BL-9001: build") (assoc (merge-c true) :subject "Land BL-9001: merge origin/main 0123456789")]))
(let [v (land-merge-path-lib/line-verdict "BL-9001" [(assoc (merge-c true) :subject "Merge BL-9002 work into coder.")])]
  (assert= "the reason names the merge's other ticket" true (str/includes? (str (:reason v)) "BL-9002")))
(assert= "an empty line (already on origin/main) is not a merge-path land"
         false (clean? []))
(assert= "a prefix of the ticket number is a different ticket"
         false (clean? [(own "BL-90011: build")]))

(let [v (land-merge-path-lib/line-verdict "BL-9001" [(own "BL-9001: ok") (own "BL-9002: other")])]
  (assert= "the reason names the first offending commit's subject"
           true (str/includes? (str (:reason v)) "BL-9002: other")))

;; ── merge-message ───────────────────────────────────────────────────────
(let [m (land-merge-path-lib/merge-message "BL-9001" "0123456789abcdef")]
  (assert= "the merge names the landing ticket" ["BL-9001"] (vec (pipeline-stage-lib/extract-ticket-ids m)))
  (assert= "and the origin/main tip it merges" true (str/includes? m "0123456789")))

;; ── registry-pass-changes (QA spec-gap note 003735) ─────────────────────
;; What the land step's registry pass would change in the merged tree; the
;; merge path declines to the land step whenever it is non-empty.
(def reds "backlog/standing-reds.tsv")
(def allowlist "swarmforge/scripts/property_suite_standing_allowlist.tsv")
(def poles "backlog/suite-poles.tsv")
(defn red-row [owner] (str "unit\textension/test/" owner ".test.js\t" owner "\t2026-10-02\tnote"))
(def header "# lane\tfile\towner\tfirst_seen\tnote")
(defn tsv [& lines] (str (str/join "\n" lines) "\n"))
(defn changes [contents & {:keys [open] :or {open #{}}}]
  (land-merge-path-lib/registry-pass-changes {:ticket "BL-9001" :open-ids open :contents contents}))

(assert= "no register files anywhere: nothing to change"
         [] (changes {}))
(assert= "an untouched register with no landing-ticket row: nothing to change"
         [] (changes {reds {:origin (tsv header (red-row "BL-9002")) :tree (tsv header (red-row "BL-9002"))}}
                     :open #{"BL-9002"}))
(assert= "the landing ticket's own row still in the merged tree is retired"
         [{:registry reds :retire [(red-row "BL-9001")] :restore []}]
         (changes {reds {:origin (tsv header (red-row "BL-9001")) :tree (tsv header (red-row "BL-9001"))}}))
(assert= "an open other ticket's row the merged tree lacks is restored"
         [{:registry reds :retire [] :restore [(red-row "BL-9002")]}]
         (changes {reds {:origin (tsv header (red-row "BL-9002")) :tree (tsv header)}} :open #{"BL-9002"}))
(assert= "a CLOSED other ticket's row the merged tree lacks is not restored (the drain rule)"
         [] (changes {reds {:origin (tsv header (red-row "BL-9002")) :tree (tsv header)}}))
(assert= "a merged tree that deletes the register outright still restores an open row"
         [{:registry reds :retire [] :restore [(red-row "BL-9002")]}]
         (changes {reds {:origin (tsv (red-row "BL-9002")) :tree nil}} :open #{"BL-9002"}))
(assert= "the allowlist reads its owner from the rationale column"
         [{:registry allowlist :retire ["extension/test/a.property.test.js\t2026-10-02\towner BL-9001: slow"] :restore []}]
         (changes {allowlist {:origin nil :tree (tsv "extension/test/a.property.test.js\t2026-10-02\towner BL-9001: slow")}}))
(assert= "the pole register's accepted pole is never retired"
         [] (changes {poles {:origin nil :tree (tsv "extension/test/a.test.js\tBL-9001\t2026-10-02\t9000\taccepted pole")}}))
(assert= "every registry the pass would change is named, in registry order"
         [reds poles]
         (mapv :registry (changes {poles {:tree (tsv "extension/test/a.test.js\tBL-9001\t2026-10-02\t9000\tslow")}
                                   reds {:tree (tsv (red-row "BL-9001"))}})))

(let [r (land-merge-path-lib/registry-decline-reason
         [{:registry reds :retire [(red-row "BL-9001")] :restore [(red-row "BL-9002") (red-row "BL-9003")]}])]
  (assert= "the decline reason names the registry" true (str/includes? r reds))
  (assert= "and how many rows retire" true (str/includes? r "retire 1"))
  (assert= "and how many restore" true (str/includes? r "restore 2")))
(assert= "no changes, no decline" nil (land-merge-path-lib/registry-decline-reason []))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (count @failures) "failure(s)")
      (System/exit 1))
  (println "ALL PASS: land_merge_path_lib.bb"))
