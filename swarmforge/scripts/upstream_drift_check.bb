#!/usr/bin/env bb

;; BL-477: the drift-check script local-engineering.prompt (Architecture
;; Rule 2) already promises. Reads upstream-watch.json (repo root, or a
;; given path), `git ls-remote`s each watched upstream repo, and reports any
;; branch whose live head differs from the recorded sha (advanced) or that
;; is absent from the watch file entirely (new). Strictly READ-ONLY: it
;; never rewrites upstream-watch.json, never bumps swarmforge.lock.json or
;; any other install pin, never fetches into the working tree, and never
;; auto-adopts anything - it only tells a human where to look. Advancing a
;; watch sha (recording "reviewed up to here") stays a human commit.
;;
;; Thin wrapper only: every actual decision is upstream_drift_check_lib.bb's
;; own drift-report/exit-code/render-report + run! (the injectable-fetch
;; orchestration) - this file wires run! to a REAL `git ls-remote --heads`
;; and to argv/exit, nothing more (thin-wrapper rule, engineering.prompt).
;;
;; Usage: upstream_drift_check.bb [watch-file-path]
;;   watch-file-path defaults to the tracked repo-root upstream-watch.json.
;;   Pass an explicit path to check a COPY (e.g. QA's own E2E procedure step
;;   2: hand-edit a copy to an older sha and confirm drift, without ever
;;   touching the real file).
;; Exit 0: no drift. Exit 1: drift or a new upstream branch found. Exit 2:
;; the watch file could not be read/parsed, or a `git ls-remote` failed.

(ns upstream-drift-check-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)))))

(load-file (str (fs/path script-dir "upstream_drift_check_lib.bb")))

(def default-watch-path (str (fs/path script-dir ".." ".." "upstream-watch.json")))

;; ── the one real I/O adapter: a real `git ls-remote --heads <url>` per
;;    watched repo, parsed into {branch sha}. This is the thin network
;;    boundary the ticket's testability section names - tests inject a
;;    fake fetch-live-refs! into upstream-drift-check-lib/run! directly and
;;    never reach this function at all. ─────────────────────────────────
(defn- ls-remote-heads! [url]
  (let [{:keys [exit out err]} (process/sh {:continue true} "git" "ls-remote" "--heads" url)]
    (when-not (zero? exit)
      (throw (ex-info (str "git ls-remote --heads failed for " url ": " (str/trim (or err "")))
                       {:url url :exit exit})))
    (into {}
          (for [line (str/split-lines (str/trim out))
                :when (not (str/blank? line))
                :let [[sha ref] (str/split line #"\t")]]
            [(str/replace ref #"^refs/heads/" "") sha]))))

(defn- fetch-live-refs! [repo-urls]
  (into {} (for [[repo url] repo-urls] [repo (ls-remote-heads! url)])))

(defn -main [& args]
  (let [watch-path (or (first args) default-watch-path)]
    (try
      (let [{:keys [exit-code text]} (upstream-drift-check-lib/run! watch-path fetch-live-refs!)]
        (println text)
        (System/exit exit-code))
      (catch Exception e
        (binding [*out* *err*] (println (str "error: " (.getMessage e))))
        (System/exit 2)))))

(apply -main *command-line-args*)
