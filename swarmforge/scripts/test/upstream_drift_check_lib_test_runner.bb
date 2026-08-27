#!/usr/bin/env bb
;; BL-477: TDD runner for upstream_drift_check_lib.bb - pure assertions over
;; provided watch/live-refs maps, plus a fixture-based, in-process proof of
;; run! (the adapter-injected orchestration -main wires to real I/O) with a
;; FAKE fetch-live-refs! - never a real git process, never a real network
;; call, and never a subprocess. This is the exact seam the ticket's own
;; testability section requires: "main() itself is called in-process by a
;; test ... with an injected/stubbed ls-remote seam - never only shelled as
;; a subprocess." The real `git ls-remote` adapter and the compiled CLI's
;; own argv/exit-code wiring are proven separately by
;; test_upstream_drift_check_cli.sh (a real subprocess, real local git
;; repos, no network) - the ADDITION this rule asks for, never the
;; substitute.
(ns upstream-drift-check-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "upstream_drift_check_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── watch-json->watch-map / watch-json->repo-urls (pure) ──────────────────

(def sample-parsed
  {"repos"
   {"swarm-forge" {"url" "https://example.invalid/swarm-forge.git"
                   "branches" {"main" "aaaa"}}
    "aps" {"url" "https://example.invalid/aps.git"
           "branches" {}}}})

(assert= "watch-json->watch-map flattens repo->branches, string keys throughout"
         {"swarm-forge" {"main" "aaaa"} "aps" {}}
         (upstream-drift-check-lib/watch-json->watch-map sample-parsed))

(assert= "watch-json->watch-map degrades a repo with no \"branches\" key to an empty map, not a crash"
         {"bare" {}}
         (upstream-drift-check-lib/watch-json->watch-map {"repos" {"bare" {"url" "https://example.invalid/bare.git"}}}))

(assert= "watch-json->repo-urls extracts just the url per repo"
         {"swarm-forge" "https://example.invalid/swarm-forge.git" "aps" "https://example.invalid/aps.git"}
         (upstream-drift-check-lib/watch-json->repo-urls sample-parsed))

;; ── drift-report (pure) ─────────────────────────────────────────────────

;; upstream-drift-watch-01: an advanced branch is reported as drift.
(assert= "drift-01: a watched branch that advanced past the recorded sha is reported drifted"
         {:drifted [{:repo "swarm-forge" :branch "main" :from "aaaa" :to "bbbb"}]
          :new-branches []
          :clean []}
         (upstream-drift-check-lib/drift-report
          {"swarm-forge" {"main" "aaaa"}}
          {"swarm-forge" {"main" "bbbb"}}))

;; upstream-drift-watch-02: an unchanged branch reports no drift.
(assert= "drift-02: a watched branch whose live head equals the recorded sha reports clean, no drift"
         {:drifted [] :new-branches []
          :clean [{:repo "swarm-forge" :branch "main" :sha "aaaa"}]}
         (upstream-drift-check-lib/drift-report
          {"swarm-forge" {"main" "aaaa"}}
          {"swarm-forge" {"main" "aaaa"}}))

;; upstream-drift-watch-03: a live branch absent from the watch file is new.
(assert= "drift-03: a live branch with no recorded entry at all is a new-branch, not drift"
         {:drifted [] :clean []
          :new-branches [{:repo "swarm-forge" :branch "adversaries" :sha "cccc"}]}
         (upstream-drift-check-lib/drift-report
          {"swarm-forge" {}}
          {"swarm-forge" {"adversaries" "cccc"}}))

(assert= "drift-04: a branch recorded in the watch file but absent from live refs is never reported at all (deletion is out of scope)"
         {:drifted [] :new-branches [] :clean []}
         (upstream-drift-check-lib/drift-report
          {"swarm-forge" {"deleted-branch" "aaaa"}}
          {"swarm-forge" {}}))

(assert= "drift-05: mixed repos/branches each get their own independent entry"
         {:drifted [{:repo "swarm-forge" :branch "main" :from "aaaa" :to "bbbb"}]
          :new-branches [{:repo "aps" :branch "feature-x" :sha "dddd"}]
          :clean [{:repo "aps" :branch "main" :sha "eeee"}]}
         (upstream-drift-check-lib/drift-report
          {"swarm-forge" {"main" "aaaa"} "aps" {"main" "eeee"}}
          {"swarm-forge" {"main" "bbbb"} "aps" {"main" "eeee" "feature-x" "dddd"}}))

;; ── drifted? / exit-code (pure) ─────────────────────────────────────────

(assert-true "drifted? is true when any entry drifted"
             (upstream-drift-check-lib/drifted?
              {:drifted [{:repo "r" :branch "b" :from "a" :to "b"}] :new-branches [] :clean []}))

(assert-true "drifted? is true when any entry is a new branch, even with no drifted entries"
             (upstream-drift-check-lib/drifted?
              {:drifted [] :new-branches [{:repo "r" :branch "b" :sha "a"}] :clean []}))

(assert-false "drifted? is false when only clean entries exist"
              (upstream-drift-check-lib/drifted?
               {:drifted [] :new-branches [] :clean [{:repo "r" :branch "b" :sha "a"}]}))

(assert-false "drifted? is false for a wholly empty report"
              (upstream-drift-check-lib/drifted? {:drifted [] :new-branches [] :clean []}))

;; upstream-drift-watch-01/03: drift or a new branch exits non-zero.
(assert= "exit-code-01: a drifted-only report exits 1"
         1
         (upstream-drift-check-lib/exit-code
          {:drifted [{:repo "r" :branch "b" :from "a" :to "b"}] :new-branches [] :clean []}))

(assert= "exit-code-02: a new-branch-only report exits 1"
         1
         (upstream-drift-check-lib/exit-code
          {:drifted [] :new-branches [{:repo "r" :branch "b" :sha "a"}] :clean []}))

;; upstream-drift-watch-02: no drift exits zero.
(assert= "exit-code-03: an all-clean report exits 0"
         0
         (upstream-drift-check-lib/exit-code
          {:drifted [] :new-branches [] :clean [{:repo "r" :branch "b" :sha "a"}]}))

;; ── render-report (pure) ────────────────────────────────────────────────

(assert= "render-report renders a drifted entry with a greppable DRIFT prefix, from -> to"
         "DRIFT swarm-forge main: aaaa -> bbbb"
         (upstream-drift-check-lib/render-report
          {:drifted [{:repo "swarm-forge" :branch "main" :from "aaaa" :to "bbbb"}] :new-branches [] :clean []}))

(assert= "render-report renders a new-branch entry with a greppable NEW-BRANCH prefix"
         "NEW-BRANCH swarm-forge adversaries @ cccc (not in watch file)"
         (upstream-drift-check-lib/render-report
          {:drifted [] :new-branches [{:repo "swarm-forge" :branch "adversaries" :sha "cccc"}] :clean []}))

(assert= "render-report renders a clean-only report as an explicit no-drift message, never a blank line"
         "clean: no drift detected against the recorded baseline"
         (upstream-drift-check-lib/render-report {:drifted [] :new-branches [] :clean [{:repo "r" :branch "b" :sha "a"}]}))

;; ── run! (adapter-injected orchestration, fixture-based, in-process) ──────
;; The exact seam the ticket's testability section requires: a test drives
;; run! (the same function -main calls) directly, with a FAKE
;; fetch-live-refs!, in-process, no subprocess, no real network.

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "upstream-drift-check-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-watch-file! [path parsed]
  (spit path (json/generate-string parsed)))

(let [root (mk-tmp)
      watch-path (str (fs/path root "upstream-watch.json"))]
  (write-watch-file! watch-path
                      {"repos" {"swarm-forge" {"url" "https://example.invalid/swarm-forge.git"
                                                "branches" {"main" "aaaa"}}}})
  (let [{:keys [exit-code text]}
        (upstream-drift-check-lib/run!
         watch-path
         (fn [_repo-urls] {"swarm-forge" {"main" "bbbb"}}))]
    (assert= "run!-01: a fixture watch file + a fake fetch reporting an advanced sha exits 1"
             1 exit-code)
    (assert= "run!-01: the rendered text names the drift"
             "DRIFT swarm-forge main: aaaa -> bbbb"
             text)))

(let [root (mk-tmp)
      watch-path (str (fs/path root "upstream-watch.json"))]
  (write-watch-file! watch-path
                      {"repos" {"swarm-forge" {"url" "https://example.invalid/swarm-forge.git"
                                                "branches" {"main" "aaaa"}}}})
  (let [{:keys [exit-code text]}
        (upstream-drift-check-lib/run!
         watch-path
         (fn [_repo-urls] {"swarm-forge" {"main" "aaaa"}}))]
    (assert= "run!-02: a fake fetch reporting the same sha exits 0, clean"
             0 exit-code)
    (assert= "run!-02: the rendered text reports clean"
             "clean: no drift detected against the recorded baseline"
             text)))

;; break-then-fix (disk-input wiring rule): the fake fetch is handed the
;; REAL repo-urls read from the fixture file, not a hardcoded value in the
;; test - proven by asserting the fake actually received them.
(let [root (mk-tmp)
      watch-path (str (fs/path root "upstream-watch.json"))
      received-urls (atom nil)]
  (write-watch-file! watch-path
                      {"repos" {"swarm-forge" {"url" "https://example.invalid/swarm-forge.git"
                                                "branches" {"main" "aaaa"}}}})
  (upstream-drift-check-lib/run!
   watch-path
   (fn [repo-urls] (reset! received-urls repo-urls) {"swarm-forge" {"main" "aaaa"}}))
  (assert= "run!-03: run! reads the real watch file off disk and hands the real repo-urls to fetch-live-refs! - the read is load-bearing"
           {"swarm-forge" "https://example.invalid/swarm-forge.git"}
           @received-urls))

;; upstream-drift-watch-04 / read-only: run! never writes the watch file -
;; break-then-fix would be circular here (run! has no write path to break),
;; so this proves it by bytes-unchanged instead, the same assertion
;; test_upstream_drift_check_cli.sh makes end-to-end against the real CLI.
(let [root (mk-tmp)
      watch-path (str (fs/path root "upstream-watch.json"))
      parsed {"repos" {"swarm-forge" {"url" "https://example.invalid/swarm-forge.git"
                                       "branches" {"main" "aaaa"}}}}]
  (write-watch-file! watch-path parsed)
  (let [before (slurp watch-path)]
    (upstream-drift-check-lib/run! watch-path (fn [_] {"swarm-forge" {"main" "bbbb"}}))
    (assert= "run!-04: the watch file on disk is byte-for-byte unchanged after run! reports drift"
             before
             (slurp watch-path))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: upstream_drift_check_lib.bb"))
