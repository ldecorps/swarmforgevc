;; BL-477: local-engineering.prompt (Architecture Rule 2) already promised a
;; drift-watch mechanism - upstream-watch.json + a drift-check script +
;; docs/upstream-deviations.md - that was never actually built. This is the
;; pure decision half: given a recorded watch map (repo -> branch -> last-
;; reviewed sha) and a live-refs map (repo -> branch -> current sha, from a
;; real `git ls-remote`), decide which watched-or-new branches drifted. No
;; filesystem, no git, no network - the constitution's testability boundary.
;; The impure fs-reading half (watch-file parse) lives here too, mirroring
;; backlog_depth_lib.bb's own read-max-depth convention; the real network
;; fetch (`git ls-remote`) is the thin adapter injected by the CLI
;; (upstream_drift_check.bb) and by tests, never called from here directly.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "upstream_drift_check_lib.bb")))
;; and referred to as upstream-drift-check-lib/foo.

(ns upstream-drift-check-lib
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

;; ── pure: JSON-shape -> the flat map the comparator wants ─────────────────

(defn watch-json->watch-map
  "Pure. parsed: the deserialized upstream-watch.json ({\"repos\" {repo
   {\"branches\" {branch sha}}}}, string keys throughout - repo names carry
   slashes, so never keywordized). Returns the flat {repo {branch sha}}
   shape drift-report compares against. A repo with no \"branches\" key at
   all degrades to an empty map for that repo, never a crash."
  [parsed]
  (into {}
        (for [[repo entry] (get parsed "repos")]
          [repo (or (get entry "branches") {})])))

(defn watch-json->repo-urls
  "Pure. parsed: same shape as watch-json->watch-map's input. Returns
   {repo url} for every watched repo - the one thing the impure fetch step
   needs to know what to `git ls-remote`."
  [parsed]
  (into {}
        (for [[repo entry] (get parsed "repos")]
          [repo (get entry "url")])))

;; ── pure: the drift decision itself ────────────────────────────────────────

(defn drift-report
  "Pure. watch-map/live-refs-map: {repo {branch sha}}. Compares every
   (repo, branch) pair actually PRESENT in live-refs-map (a real `git
   ls-remote --heads` return, or a test's fixture standing in for one)
   against watch-map's recorded sha for that same pair:
     - no recorded sha at all       -> :new-branches (upstream has a branch
       the watch file has never seen)
     - a recorded sha that differs  -> :drifted (from/to)
     - a recorded sha that matches  -> :clean
   A branch recorded in watch-map but ABSENT from live-refs-map (deleted
   upstream, or a live-refs source that only returned a subset) is never
   reported at all - this tool watches for new/advanced refs, never for
   upstream deletions, matching the ticket's own three acceptance shapes."
  [watch-map live-refs-map]
  (let [pairs (for [[repo branches] live-refs-map
                    [branch live-sha] branches]
                {:repo repo :branch branch :live-sha live-sha
                 :recorded-sha (get-in watch-map [repo branch])})]
    {:drifted (->> pairs
                   (filter #(and (:recorded-sha %) (not= (:recorded-sha %) (:live-sha %))))
                   (mapv #(hash-map :repo (:repo %) :branch (:branch %)
                                    :from (:recorded-sha %) :to (:live-sha %))))
     :new-branches (->> pairs
                        (filter #(nil? (:recorded-sha %)))
                        (mapv #(hash-map :repo (:repo %) :branch (:branch %) :sha (:live-sha %))))
     :clean (->> pairs
                 (filter #(= (:recorded-sha %) (:live-sha %)))
                 (mapv #(hash-map :repo (:repo %) :branch (:branch %) :sha (:live-sha %))))}))

(defn drifted?
  "Pure: true when the report names any drifted or new-upstream-branch
   entry - the ONLY two shapes that mean 'a human should go look'."
  [report]
  (boolean (or (seq (:drifted report)) (seq (:new-branches report)))))

(defn exit-code
  "Pure: the CLI's own exit-code contract - 0 clean, 1 drift/new-branch
   found. A tool/read error is a separate, higher exit code the CLI itself
   assigns; this function only ever sees a successfully-computed report."
  [report]
  (if (drifted? report) 1 0))

(defn render-report
  "Pure: the human-readable stdout rendering. Deliberately fixed, greppable
   keywords (DRIFT / NEW-BRANCH) at the start of each line rather than free
   prose, so both a human skimming the output and an acceptance-test
   assertion can match on it reliably."
  [report]
  (let [lines (concat
               (map (fn [{:keys [repo branch from to]}]
                      (str "DRIFT " repo " " branch ": " from " -> " to))
                    (:drifted report))
               (map (fn [{:keys [repo branch sha]}]
                      (str "NEW-BRANCH " repo " " branch " @ " sha " (not in watch file)"))
                    (:new-branches report)))]
    (if (seq lines)
      (str/join "\n" lines)
      "clean: no drift detected against the recorded baseline")))

;; ── adapter-injected orchestration (mirrors push_sweep_lib.bb's sweep!) ────
;; A test calls this directly, in-process, with a fake fetch-live-refs! (repo
;; -> url map -> {repo {branch sha}}) - the exact seam the ticket's own
;; testability section requires ("main() itself is called in-process by a
;; test ... with an injected/stubbed ls-remote seam"). The REAL fetch-live-
;; refs! (a real `git ls-remote --heads`) lives only in the CLI
;; (upstream_drift_check.bb), which is a thin wrapper over this function -
;; never reimplemented there.

(defn read-watch-file
  "The impure fs-reading half: parses a real upstream-watch.json path.
   String keys throughout (json/parse-string ... false) - repo names carry
   slashes and must never be keywordized."
  [watch-file-path]
  (json/parse-string (slurp watch-file-path) false))

(defn run!
  "watch-file-path: a real path on disk (the tracked upstream-watch.json, or
   a test/QA fixture COPY - this function only ever reads it, never writes
   it). fetch-live-refs!: (fn [{repo url}] -> {repo {branch sha}}) - the one
   injectable I/O seam. Returns {:exit-code int :text string}; never
   catches its own exceptions (an unreadable/malformed watch file, or a
   fetch failure, throws out to the caller - -main's job to turn that into
   a loud, non-zero exit, per the CLI-failure-path testability rule)."
  [watch-file-path fetch-live-refs!]
  (let [parsed (read-watch-file watch-file-path)
        watch-map (watch-json->watch-map parsed)
        repo-urls (watch-json->repo-urls parsed)
        live-refs (fetch-live-refs! repo-urls)
        report (drift-report watch-map live-refs)]
    {:exit-code (exit-code report)
     :text (render-report report)}))
