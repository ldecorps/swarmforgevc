#!/usr/bin/env bb
;; BL-1141: refuse-rematch rematches onto origin/main (not print+exit alone).
(ns bl1141-refuse-rematch-test-runner
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

;; Process B: ahead=0 behind>0 conflict foresight → refuse-rematch → rematch
(let [daemon (str (fs/create-temp-dir {:prefix "bl1141-refuse-"}))
      _ (master-main-reconcile-lib/write-state! daemon
                                                {:surfaced "refuse-rematch" :ticks 13 :escalated false})
      counts (atom {:ahead 0 :behind 3})
      calls (atom [])
      adapters {:daemon-dir daemon
                :fetch! (fn [] (swap! calls conj :fetch))
                :rev-counts! (fn [] @counts)
                :dirty-paths! (fn [] [])
                :merge-verdict! (fn [] :conflict)
                :tip-contains-origin! (fn [] false)
                :rematch! (fn []
                            (swap! calls conj :rematch)
                            (reset! counts {:ahead 0 :behind 0})
                            {:success true})
                :merge! (fn [] (swap! calls conj :merge) {:success true})
                :abort! (fn [] (swap! calls conj :abort))
                :status-porcelain! (fn [] "")
                :mid-merge? (fn [] false)}
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)
      state (master-main-reconcile-lib/read-state daemon)
      after (master-main-reconcile-lib/after-successful-rematch-status
             {:ahead (:ahead result) :behind (:behind result)
              :deadlock-was-active? false})]
  (when-not (= [:fetch :rematch] @calls)
    (fail! (str "expected fetch+rematch, got " @calls)))
  (when-not (:ok? result)
    (fail! (str "not ok: " result)))
  (when-not (zero? (:behind result))
    (fail! (str "behind not 0: " result)))
  (when-not (= :rematched-refuse (:outcome result))
    (fail! (str "bad outcome: " (:outcome result))))
  (when (seq state)
    (fail! (str "refuse-rematch surface still standing: " state)))
  (when-not (#{:proceed :ff-only} (:sync-action after))
    (fail! (str "sync not proceed/ff-only: " after))))

;; Without rematch!: still surfaces (no MERGE_HEAD)
(let [daemon (str (fs/create-temp-dir {:prefix "bl1141-no-rematch-"}))
      adapters {:daemon-dir daemon
                :fetch! (fn [] nil)
                :rev-counts! (fn [] {:ahead 0 :behind 2})
                :dirty-paths! (fn [] [])
                :merge-verdict! (fn [] :conflict)
                :tip-contains-origin! (fn [] false)
                :merge! (fn [] {:success true})
                :abort! (fn [] nil)
                :status-porcelain! (fn [] "")
                :mid-merge? (fn [] false)}
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)]
  (when (:ok? result)
    (fail! (str "expected surface without rematch!: " result)))
  (when-not (= :refuse-rematch (:outcome result))
    (fail! (str "expected refuse-rematch outcome: " result)))
  (when (:mid-merge? result)
    (fail! "left mid-merge")))

;; IO fixture: diverged clean tip → rematch reaches behind=0, no MERGE_HEAD
(let [root (str (fs/create-temp-dir {:prefix "bl1141-io-"}))
      daemon (str (fs/path root ".swarmforge" "daemon"))
      _ (fs/create-dirs daemon)
      _ (git! root "init" "-b" "main")
      _ (git! root "config" "user.email" "t@t")
      _ (git! root "config" "user.name" "t")
      _ (spit (str (fs/path root "a.txt")) "base\n")
      _ (git! root "add" "a.txt")
      _ (git! root "commit" "-m" "base")
      bare (str (fs/create-temp-dir {:prefix "bl1141-bare-"}))
      _ (process/sh "git" "init" "--bare" "-b" "main" bare)
      _ (git! root "remote" "add" "origin" bare)
      _ (git! root "push" "-u" "origin" "main")
      ;; origin advances a.txt (conflict foresight)
      _ (git! root "checkout" "-b" "origin-land")
      _ (git! root "reset" "--hard" "origin/main")
      _ (spit (str (fs/path root "a.txt")) "landed\n")
      _ (git! root "add" "a.txt")
      _ (git! root "commit" "-m" "qa-land")
      _ (git! root "push" "origin" "HEAD:main")
      _ (git! root "checkout" "main")
      _ (git! root "fetch" "origin" "main")
      ;; local is behind only (ahead=0) with conflict foresight → refuse-rematch plan
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
      result (post-hotfix-merge-origin-lib/run-post-hotfix-merge! adapters)]
  (when-not (:ok? result)
    (fail! (str "io rematch not ok: " result)))
  (when-not (zero? (:behind result))
    (fail! (str "io behind not 0: " result)))
  (when (fs/exists? (fs/path root ".git" "MERGE_HEAD"))
    (fail! "MERGE_HEAD left behind"))
  (when-not (= :rematched-refuse (:outcome result))
    (fail! (str "io bad outcome: " (:outcome result)))))

(if (seq @failures)
  (do (println "bl1141_refuse_rematch: FAILURES")
      (doseq [f @failures] (println f))
      (System/exit 1))
  (println "bl1141_refuse_rematch: ALL TESTS PASSED"))
