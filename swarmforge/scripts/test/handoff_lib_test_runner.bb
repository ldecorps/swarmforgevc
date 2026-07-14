#!/usr/bin/env bb
;; BL-365: TDD runner for handoff_lib.bb's new atomic-write!/corrupt-handoff?/
;; quarantine-corrupt-handoff!/partition-corrupt - the shared durability +
;; integrity-floor helpers. No real crash, no real timers: durability is
;; proven by injecting write-fn!/sync-fn!/rename-fn! and asserting the
;; ORDER (the "honest mechanical proof" the ticket asks for), and corruption
;; cases are constructed fixture content, not a race.

(ns handoff-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(defn mk-tmp-dir [] (str (fs/create-temp-dir {:prefix "sfvc-handoff-lib-"})))

(def valid-handoff-content
  (str "id: 20260714T000000Z_000001_from_coder\n"
       "from: coder\n"
       "to: cleaner\n"
       "priority: 50\n"
       "type: git_handoff\n"
       "role: coder\n"
       "task: demo-task\n"
       "commit: abcdef0123\n"
       "created_at: 2026-07-14T00:00:00Z\n"
       "\n"
       "Re-read your role and constitution.\n\nmerge_and_process coder abcdef0123"))

;; ── corrupt-handoff? ─────────────────────────────────────────────────────

(assert-false "a genuinely valid handoff is not corrupt" (handoff-lib/corrupt-handoff? valid-handoff-content))

(assert-true "empty content is corrupt" (handoff-lib/corrupt-handoff? ""))

(assert-true "truncated mid-header (missing 'type' and later fields) is corrupt"
             (handoff-lib/corrupt-handoff? "id: 20260714T000000Z_000001_from_coder\nfrom: coder\nto: clea"))

(assert-true "headers with no body is corrupt"
             (handoff-lib/corrupt-handoff?
              (str "id: 20260714T000000Z_000001_from_coder\n"
                   "from: coder\nto: cleaner\npriority: 50\ntype: note\n")))

(assert-true "headers with a blank-line separator but an empty body is corrupt"
             (handoff-lib/corrupt-handoff?
              (str "id: 20260714T000000Z_000001_from_coder\n"
                   "from: coder\nto: cleaner\npriority: 50\ntype: note\n\n")))

;; ── atomic-write! (real defaults - round-trips real content) ────────────

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "real.handoff"))]
  (handoff-lib/atomic-write! target valid-handoff-content)
  (assert-true "atomic-write! installs the target file" (fs/exists? target))
  (assert= "atomic-write! preserves content exactly" valid-handoff-content (slurp target))
  (assert= "atomic-write! leaves no stray tmp file behind"
           1 (count (fs/list-dir dir))))

;; ── atomic-write! (injected adapters - proves write happens BEFORE sync,
;;    and sync happens BEFORE rename; the actual crash-durability property
;;    is not otherwise observable without a real crash) ─────────────────

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "ordered.handoff"))
      call-order (atom [])]
  (handoff-lib/atomic-write!
   target "content"
   {:write-fn! (fn [_tmp _content] (swap! call-order conj :write))
    :sync-fn! (fn [_tmp] (swap! call-order conj :sync))
    :rename-fn! (fn [_tmp _target] (swap! call-order conj :rename))})
  (assert= "atomic-write! calls write, then sync, then rename, in that order"
           [:write :sync :rename] @call-order))

;; ── install-handoff! (BL-365 scenario 03: a sender cannot install an empty
;;    handoff into its outbox) ────────────────────────────────────────────

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "50_x_from_coder_to_cleaner.handoff"))]
  (assert= "install-handoff! returns the target path on a genuine, non-corrupt write"
           target (handoff-lib/install-handoff! target valid-handoff-content))
  (assert-true "the file exists after a successful install" (fs/exists? target))
  (assert= "the file carries the real content" valid-handoff-content (slurp target)))

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "50_y_from_coder_to_cleaner.handoff"))
      ;; Simulates "a role sends a handoff whose contents fail to be
      ;; written" deterministically - never a real crash or a filesystem
      ;; permission-bit trick (both banned by this project's own testing
      ;; rules) - by injecting a write-fn! that installs nothing.
      result (handoff-lib/install-handoff!
              target valid-handoff-content
              {:write-fn! (fn [tmp _content] (spit (str tmp) ""))})]
  (assert= "install-handoff! returns nil when what actually landed on disk is corrupt" nil result)
  (assert-false "no handoff file is left behind in the outbox when the write fails" (fs/exists? target)))

;; ── quarantine-corrupt-handoff! ──────────────────────────────────────────

(let [dir (mk-tmp-dir)
      file (str (fs/path dir "50_20260714T000000Z_000001_from_coder_to_cleaner.handoff"))]
  (spit file "")
  (let [dead-path (handoff-lib/quarantine-corrupt-handoff! (fs/path file))]
    (assert-false "the original corrupt file no longer exists at its old path" (fs/exists? file))
    (assert-true "the quarantined file exists at <name>.handoff.dead" (fs/exists? dead-path))
    (assert= "the quarantine suffix matches chase_sweep_lib.bb's own dead-letter convention exactly"
             (str file ".dead") (str dead-path))))

;; ── partition-corrupt ────────────────────────────────────────────────────

(let [dir (mk-tmp-dir)
      good-file (fs/path dir "50_a_from_coder_to_cleaner.handoff")
      empty-file (fs/path dir "50_b_from_coder_to_cleaner.handoff")
      truncated-file (fs/path dir "50_c_from_coder_to_cleaner.handoff")]
  (spit (str good-file) valid-handoff-content)
  (spit (str empty-file) "")
  (spit (str truncated-file) "id: x\nfrom: coder\nto: clea")
  (let [{:keys [corrupt valid]} (handoff-lib/partition-corrupt [good-file empty-file truncated-file])]
    (assert= "partition-corrupt keeps the one genuinely valid candidate" [good-file] valid)
    (assert= "partition-corrupt reports both corrupt candidates, in order" [empty-file truncated-file] corrupt)
    (assert-true "the good file is untouched at its original path" (fs/exists? good-file))
    (assert-false "the empty file no longer sits at its original path (quarantined)" (fs/exists? empty-file))
    (assert-true "the empty file is quarantined as *.handoff.dead" (fs/exists? (fs/path dir "50_b_from_coder_to_cleaner.handoff.dead")))
    (assert-true "the truncated file is quarantined as *.handoff.dead" (fs/exists? (fs/path dir "50_c_from_coder_to_cleaner.handoff.dead")))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "handoff_lib (BL-365): ALL TESTS PASSED")
  (do (println (str "handoff_lib (BL-365): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
