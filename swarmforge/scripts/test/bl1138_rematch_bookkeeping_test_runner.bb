#!/usr/bin/env bb
;; BL-1138: fixture — rematch-bookkeeping recovery resets onto origin tip.
(ns bl1138-rematch-bookkeeping-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "post_hotfix_merge_origin_lib.bb")))

(defn- sh [dir & args]
  (apply process/sh {:dir (str dir) :continue true} args))

(defn- git! [dir & args]
  (let [r (apply sh dir (into ["git"] args))]
    (when-not (zero? (:exit r))
      (throw (ex-info "git failed" r)))
    r))

(def failures (atom []))
(defn fail! [m] (swap! failures conj m))

(let [root (str (fs/create-temp-dir {:prefix "bl1138-io-"}))
      daemon (str (fs/path root ".swarmforge" "daemon"))
      _ (fs/create-dirs daemon)
      _ (git! root "init" "-b" "main")
      _ (git! root "config" "user.email" "t@t")
      _ (git! root "config" "user.name" "t")
      _ (spit (str (fs/path root "a.txt")) "base\n")
      _ (git! root "add" "a.txt")
      _ (git! root "commit" "-m" "base")
      _ (git! root "remote" "add" "origin" root) ;; local fake; use bare later
      ]
  ;; Build diverged: origin advances a.txt; local advances b.txt then conflicts a.txt
  (let [bare (str (fs/create-temp-dir {:prefix "bl1138-bare-"}))
        _ (process/sh "git" "init" "--bare" "-b" "main" bare)
        _ (git! root "remote" "remove" "origin")
        _ (git! root "remote" "add" "origin" bare)
        _ (git! root "push" "-u" "origin" "main")
        ;; local bookkeeping commit
        _ (spit (str (fs/path root "bookkeep.txt")) "bk\n")
        _ (git! root "add" "bookkeep.txt")
        _ (git! root "commit" "-m" "bookkeep")
        ;; origin advances overlapping path
        _ (git! root "checkout" "-b" "origin-land")
        _ (git! root "reset" "--hard" "origin/main")
        _ (spit (str (fs/path root "a.txt")) "landed\n")
        _ (git! root "add" "a.txt")
        _ (git! root "commit" "-m" "qa-land")
        _ (git! root "push" "origin" "HEAD:main")
        _ (git! root "checkout" "main")
        _ (git! root "fetch" "origin" "main")
        counts-before (let [r (git! root "rev-list" "--left-right" "--count" "origin/main...main")
                            [b a] (map parse-long (str/split (str/trim (:out r)) #"\s+"))]
                        {:ahead a :behind b})
        _ (master-main-reconcile-lib/write-deadlock! daemon
                                                     {:active true :reason "rematch-bookkeeping"})
        adapters {:daemon-dir daemon
                  :fetch! (fn [] (git! root "fetch" "origin" "main"))
                  :rev-counts! (fn []
                                 (let [r (git! root "rev-list" "--left-right" "--count"
                                               "origin/main...main")
                                       [b a] (map parse-long (str/split (str/trim (:out r)) #"\s+"))]
                                   {:ahead a :behind b}))
                  :dirty-paths! (fn [] [])
                  :merge-verdict! (fn [] :conflict)
                  :tip-contains-origin! (fn [] false)
                  :rematch! (fn []
                              (let [r (sh root "git" "reset" "--hard" "origin/main")]
                                {:success (zero? (:exit r))}))
                  :merge! (fn [] {:success false})
                  :abort! (fn [] nil)
                  :status-porcelain! (fn [] "")
                  :mid-merge? (fn [] false)}
        result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)
        dl (master-main-reconcile-lib/read-deadlock daemon)]
    (when-not (and (pos? (:ahead counts-before)) (pos? (:behind counts-before)))
      (fail! (str "fixture not diverged: " counts-before)))
    (when-not (:ok? result)
      (fail! (str "rematch not ok: " result)))
    (when-not (zero? (:behind result))
      (fail! (str "behind not 0: " result)))
    (when (master-main-reconcile-lib/deadlock-active? dl)
      (fail! (str "deadlock still active: " dl)))
    (when (fs/exists? (fs/path root ".git" "MERGE_HEAD"))
      (fail! "MERGE_HEAD left behind"))
    (when-not (= :rematched-bookkeeping (:outcome result))
      (fail! (str "bad outcome: " (:outcome result))))))

(if (seq @failures)
  (do (println "bl1138_rematch_bookkeeping: FAILURES")
      (doseq [f @failures] (println f))
      (System/exit 1))
  (println "bl1138_rematch_bookkeeping: ALL TESTS PASSED"))
