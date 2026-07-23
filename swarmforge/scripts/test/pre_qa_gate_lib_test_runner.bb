#!/usr/bin/env bb
;; TDD runner for pre_qa_gate_lib.bb — BL-531 pure decision surface: arming,
;; required_wiring/abandoned_commits field reading, wiring-entry parsing, and
;; the ordered finding list. No git, no filesystem — every fact this lib
;; needs is passed in as plain data by the caller (pre_qa_gate_cli.bb /
;; swarm_handoff.bb own the git legwork).

(ns pre-qa-gate-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "pre_qa_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── gate-armed? ──────────────────────────────────────────────────────────

(assert-true "git_handoff to QA alone arms"
             (pre-qa-gate-lib/gate-armed? {:type "git_handoff" :to "QA"}))

(assert-true "git_handoff to QA,cleaner arms (membership, not equality)"
             (pre-qa-gate-lib/gate-armed? {:type "git_handoff" :to "QA,cleaner"}))

(assert-true "git_handoff to cleaner,QA arms regardless of order"
             (pre-qa-gate-lib/gate-armed? {:type "git_handoff" :to "cleaner,QA"}))

(assert-false "git_handoff to cleaner alone does not arm"
              (pre-qa-gate-lib/gate-armed? {:type "git_handoff" :to "cleaner"}))

(assert-false "a note to QA does not arm (git_handoff only)"
              (pre-qa-gate-lib/gate-armed? {:type "note" :to "QA"}))

(assert-false "blank to does not arm"
              (pre-qa-gate-lib/gate-armed? {:type "git_handoff" :to ""}))

;; ── message-references-ticket? (whole-token match) ──────────────────────

(assert-true "exact ticket id in a message matches"
             (pre-qa-gate-lib/message-references-ticket? "Fix BL-490 lineage" "BL-490"))

(assert-true "BL-490-VIOLATION matches BL-490 (boundary after digits)"
             (pre-qa-gate-lib/message-references-ticket? "BL-490-VIOLATION: dropped fix" "BL-490"))

(assert-false "BL-49 does not match BL-490"
              (pre-qa-gate-lib/message-references-ticket? "Fix BL-49 typo" "BL-490"))

(assert-false "BL-4900 does not match BL-490"
              (pre-qa-gate-lib/message-references-ticket? "Fix BL-4900 lineage" "BL-490"))

(assert-false "unrelated message does not match"
              (pre-qa-gate-lib/message-references-ticket? "Fix BL-100 typo" "BL-490"))

;; ── parse-wiring-entry ───────────────────────────────────────────────────

(assert= "path::pattern parses with no why"
         {:path "a/b.bb" :pattern "some-fn" :why nil}
         (pre-qa-gate-lib/parse-wiring-entry "a/b.bb::some-fn"))

(assert= "path::pattern::why parses all three"
         {:path "a/b.bb" :pattern "some-fn" :why "why it matters"}
         (pre-qa-gate-lib/parse-wiring-entry "a/b.bb::some-fn::why it matters"))

(assert= "a :: inside why is preserved, not re-split"
         {:path "a/b.bb" :pattern "some-fn" :why "before::after"}
         (pre-qa-gate-lib/parse-wiring-entry "a/b.bb::some-fn::before::after"))

(assert= "surrounding quotes are stripped before parsing"
         {:path "a/b.bb" :pattern "some-fn" :why nil}
         (pre-qa-gate-lib/parse-wiring-entry "\"a/b.bb::some-fn\""))

(assert= "no separator at all is malformed"
         nil
         (pre-qa-gate-lib/parse-wiring-entry "a/b.bb some-fn"))

(assert= "empty path is malformed"
         nil
         (pre-qa-gate-lib/parse-wiring-entry "::some-fn"))

(assert= "empty pattern is malformed"
         nil
         (pre-qa-gate-lib/parse-wiring-entry "a/b.bb::"))

;; ── read-required-wiring (flow / block style) ────────────────────────────

(assert= "absent field reads as not present"
         {:present? false :items nil}
         (pre-qa-gate-lib/read-required-wiring "id: BL-1\nstatus: todo\n"))

(assert= "flow-style list parses"
         {:present? true :items ["a::b" "c::d"]}
         (pre-qa-gate-lib/read-required-wiring "id: BL-1\nrequired_wiring: [a::b, c::d]\nstatus: todo\n"))

(assert= "block-style list parses"
         {:present? true :items ["a/b.bb::fn" "c/d.bb::fn2"]}
         (pre-qa-gate-lib/read-required-wiring
          "id: BL-1\nrequired_wiring:\n  - \"a/b.bb::fn\"\n  - \"c/d.bb::fn2\"\nstatus: todo\n"))

(assert= "present-but-unparseable field reads items nil"
         {:present? true :items nil}
         (pre-qa-gate-lib/read-required-wiring "id: BL-1\nrequired_wiring: a::b, c::d\nstatus: todo\n"))

(assert= "an example line inside a notes: block does not collide (column-0 anchor)"
         {:present? false :items nil}
         (pre-qa-gate-lib/read-required-wiring
          "id: BL-1\nnotes: |\n  e.g. required_wiring: [a::b]\nstatus: todo\n"))

;; ── read-abandoned-commits (flow / block style) ──────────────────────────

(assert= "absent field reads as not present"
         {:present? false :items nil}
         (pre-qa-gate-lib/read-abandoned-commits "id: BL-1\nstatus: todo\n"))

(assert= "flow-style list parses"
         {:present? true :items ["a1b2c3d4e5"]}
         (pre-qa-gate-lib/read-abandoned-commits "id: BL-1\nabandoned_commits: [a1b2c3d4e5]\nstatus: todo\n"))

(assert= "block-style list parses"
         {:present? true :items ["a1b2c3d4e5" "f6a7b8c9d0"]}
         (pre-qa-gate-lib/read-abandoned-commits
          "id: BL-1\nabandoned_commits:\n  - a1b2c3d4e5\n  - f6a7b8c9d0\nstatus: todo\n"))

;; ── format-finding-line ──────────────────────────────────────────────────

(assert= "ancestry finding formats with class, ticket, detail"
         "PRE_QA_GATE_FAIL ancestry BL-490 a1b2c3d4e5 stranded on swarmforge-coder"
         (pre-qa-gate-lib/format-finding-line
          {:class :ancestry :ticket-id "BL-490"
           :detail "a1b2c3d4e5 stranded on swarmforge-coder"}))

(assert= "wiring finding formats with class, ticket, detail"
         "PRE_QA_GATE_FAIL wiring BL-419 swarmforge/roles/coordinator.prompt does not contain \"commit_integrity\""
         (pre-qa-gate-lib/format-finding-line
          {:class :wiring :ticket-id "BL-419"
           :detail "swarmforge/roles/coordinator.prompt does not contain \"commit_integrity\""}))

;; ── evaluate: not armed -> no findings, no work done ─────────────────────

(assert= "unarmed evaluate returns armed? false and no findings"
         {:armed? false :findings []}
         (pre-qa-gate-lib/evaluate
          {:type "git_handoff" :to "cleaner" :ticket-id "BL-1" :cited-commit "aaaaaaaaaa"
           :role-branch-commits {} :main-reachable-set #{} :cited-ancestors-set #{}
           :wiring-entries [] :file-contents {} :abandoned-commits []}))

;; ── evaluate: ancestry findings ───────────────────────────────────────────

(let [opts {:type "git_handoff" :to "QA" :ticket-id "BL-490" :cited-commit "cccccccccc"
            :role-branch-commits {"swarmforge-coder" [{:sha "a1b2c3d4e5" :message "Fix BL-490 lineage"}
                                                       {:sha "b2c3d4e5f6" :message "unrelated commit"}]}
            :main-reachable-set #{}
            :cited-ancestors-set #{}
            :wiring-entries []
            :file-contents {}
            :abandoned-commits []}]
  (let [result (pre-qa-gate-lib/evaluate opts)]
    (assert-true "armed when addressed to QA" (:armed? result))
    (assert= "one stranded ticket commit is one ancestry finding"
             1
             (count (:findings result)))
    (assert= "the finding is class :ancestry naming the stranded sha"
             {:class :ancestry :ticket-id "BL-490" :sha "a1b2c3d4e5" :branch "swarmforge-coder"}
             (select-keys (first (:findings result)) [:class :ticket-id :sha :branch]))))

(assert= "a commit reachable from main is never a finding"
         []
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-490" :cited-commit "cccccccccc"
                      :role-branch-commits {"swarmforge-coder" [{:sha "a1b2c3d4e5" :message "BL-490 bookkeeping"}]}
                      :main-reachable-set #{"a1b2c3d4e5"}
                      :cited-ancestors-set #{}
                      :wiring-entries [] :file-contents {} :abandoned-commits []})))

(assert= "a commit already an ancestor of the cited commit is never a finding"
         []
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-490" :cited-commit "cccccccccc"
                      :role-branch-commits {"swarmforge-coder" [{:sha "a1b2c3d4e5" :message "Fix BL-490"}]}
                      :main-reachable-set #{}
                      :cited-ancestors-set #{"a1b2c3d4e5"}
                      :wiring-entries [] :file-contents {} :abandoned-commits []})))

(assert= "a stranded commit recorded under abandoned_commits is never a finding"
         []
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-490" :cited-commit "cccccccccc"
                      :role-branch-commits {"swarmforge-coder" [{:sha "a1b2c3d4e5" :message "Fix BL-490"}]}
                      :main-reachable-set #{}
                      :cited-ancestors-set #{}
                      :wiring-entries [] :file-contents {}
                      :abandoned-commits ["a1b2c3d4e5"]})))

(assert-true "abandoned_commits matches by sha PREFIX (10-char abbrev covers a longer sha)"
             (empty? (:findings (pre-qa-gate-lib/evaluate
                                  {:type "git_handoff" :to "QA" :ticket-id "BL-490" :cited-commit "cccccccccc"
                                   :role-branch-commits {"swarmforge-coder" [{:sha "a1b2c3d4e5f6a7b8c9d0" :message "Fix BL-490"}]}
                                   :main-reachable-set #{}
                                   :cited-ancestors-set #{}
                                   :wiring-entries [] :file-contents {}
                                   :abandoned-commits ["a1b2c3d4e5"]}))))

(assert= "a commit naming a DIFFERENT ticket is not a finding for this ticket"
         []
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-490" :cited-commit "cccccccccc"
                      :role-branch-commits {"swarmforge-coder" [{:sha "a1b2c3d4e5" :message "Fix BL-100"}]}
                      :main-reachable-set #{}
                      :cited-ancestors-set #{}
                      :wiring-entries [] :file-contents {} :abandoned-commits []})))

;; ── evaluate: wiring findings ──────────────────────────────────────────

(assert= "missing path at cited commit is a wiring finding"
         [{:class :wiring :ticket-id "BL-419" :path "swarmforge/roles/coordinator.prompt"
           :pattern "commit_integrity" :why nil
           :detail "swarmforge/roles/coordinator.prompt not found at cited commit (expected to contain \"commit_integrity\")"}]
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-419" :cited-commit "cccccccccc"
                      :role-branch-commits {} :main-reachable-set #{} :cited-ancestors-set #{}
                      :wiring-entries ["swarmforge/roles/coordinator.prompt::commit_integrity"]
                      :file-contents {}
                      :abandoned-commits []})))

(assert= "path present without the pattern is a wiring finding"
         [{:class :wiring :ticket-id "BL-419" :path "swarmforge/roles/coordinator.prompt"
           :pattern "commit_integrity" :why nil
           :detail "swarmforge/roles/coordinator.prompt does not contain \"commit_integrity\""}]
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-419" :cited-commit "cccccccccc"
                      :role-branch-commits {} :main-reachable-set #{} :cited-ancestors-set #{}
                      :wiring-entries ["swarmforge/roles/coordinator.prompt::commit_integrity"]
                      :file-contents {"swarmforge/roles/coordinator.prompt" "some other content"}
                      :abandoned-commits []})))

(assert= "path present with the pattern is not a finding"
         []
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-419" :cited-commit "cccccccccc"
                      :role-branch-commits {} :main-reachable-set #{} :cited-ancestors-set #{}
                      :wiring-entries ["swarmforge/roles/coordinator.prompt::commit_integrity"]
                      :file-contents {"swarmforge/roles/coordinator.prompt" "calls commit_integrity here"}
                      :abandoned-commits []})))

(assert= "the working tree is irrelevant - file-contents is read at the cited commit only"
         []
         (:findings (pre-qa-gate-lib/evaluate
                     {:type "git_handoff" :to "QA" :ticket-id "BL-419" :cited-commit "cccccccccc"
                      :role-branch-commits {} :main-reachable-set #{} :cited-ancestors-set #{}
                      :wiring-entries ["a/deleted-on-disk.bb::some-fn"]
                      :file-contents {"a/deleted-on-disk.bb" "some-fn lives here at the cited commit"}
                      :abandoned-commits []})))

(let [result (pre-qa-gate-lib/evaluate
              {:type "git_handoff" :to "QA" :ticket-id "BL-531" :cited-commit "cccccccccc"
               :role-branch-commits {} :main-reachable-set #{} :cited-ancestors-set #{}
               :wiring-entries ["a/b.bb no-separator"]
               :file-contents {}
               :abandoned-commits []})]
  (assert= "a malformed entry is a :manifest finding, not :wiring"
           1
           (count (:findings result)))
  (assert= "the manifest finding names the class"
           :manifest
           (:class (first (:findings result)))))

;; ── evaluate: combined + ordering ────────────────────────────────────────

(let [result (pre-qa-gate-lib/evaluate
              {:type "git_handoff" :to "QA" :ticket-id "BL-531" :cited-commit "cccccccccc"
               :role-branch-commits {"swarmforge-coder" [{:sha "a1b2c3d4e5" :message "Fix BL-531"}]}
               :main-reachable-set #{} :cited-ancestors-set #{}
               :wiring-entries ["missing/path.bb::fn"]
               :file-contents {}
               :abandoned-commits []})]
  (assert= "ancestry findings precede wiring findings"
           [:ancestry :wiring]
           (mapv :class (:findings result))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: pre_qa_gate_lib.bb"))
