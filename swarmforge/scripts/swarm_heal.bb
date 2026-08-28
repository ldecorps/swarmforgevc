#!/usr/bin/env bb
;; Operator one-shot: unblock coordinator bookkeeping when main-sync is stuck.
;; Does NOT replace BL-891's automatic sweep — runs the same rematch/merge
;; helper operators use after a batch (BL-1118 post_hotfix_merge_origin).
;;
;; Usage: swarm_heal.bb <project-root>
;; Exit 0 when main_sync action is proceed; 1 when dirty overlap blocks heal;
;; 2 on unexpected failure.

(ns swarm-heal-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "post_hotfix_merge_origin_lib.bb")))

(defn- sh [root & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- porcelain-paths [root]
  (->> (str/split-lines (:out (sh root "git" "status" "--porcelain=v1" "-uall")))
       (remove str/blank?)
       (map (fn [line] (str/trim (subs line 2))))
       (remove str/blank?)
       vec))

(defn- current-branch [root]
  (let [{:keys [exit out]} (sh root "git" "rev-parse" "--abbrev-ref" "HEAD")]
    (when (zero? exit) out)))

(defn- sync-status [root]
  (let [{:keys [exit out]} (apply process/sh
                             {:dir (str root) :continue true}
                             ["bb" (str (fs/path script-dir "main_sync_status_cli.bb")) (str root)])]
    (when (zero? exit)
      (json/parse-string out true))))

(defn- say [& lines]
  (binding [*out* *err*]
    (doseq [l lines] (println l))))

(defn heal! [root]
  (let [root (str (fs/canonicalize root))
        daemon-dir (str (fs/path root ".swarmforge" "daemon"))]
    (fs/create-dirs daemon-dir)
    (say "swarm heal: fetching origin/main …")
    (let [fetch (sh root "git" "fetch" "origin" "main")]
      (when-not (zero? (:exit fetch))
        (say "swarm heal: git fetch failed:" (:err fetch))
        (System/exit 2)))
    (let [branch (current-branch root)]
      (when (and branch (not= branch "main"))
        (say (str "swarm heal: checkout main (was " branch ") …"))
        (let [co (sh root "git" "checkout" "main")]
          (when-not (zero? (:exit co))
            (say "swarm heal: could not checkout main:" (:err co))
            (System/exit 2)))))
    (let [dirty (porcelain-paths root)]
      (when (seq dirty)
        (say ""
              "swarm heal: BLOCKED — master checkout has uncommitted changes."
              "The coordinator cannot self-heal while loose files sit on main."
              "Fix one of:"
              "  • commit the work on a feature branch (not main)"
              "  • git restore / git checkout -- <path>  to discard accidental edits"
              "  • move pilot/WIP into .worktrees/expedite-<ticket>/"
              ""
              "Dirty paths:")
        (doseq [p (take 20 dirty)] (say (str "  " p)))
        (when (> (count dirty) 20)
          (say (str "  … and " (- (count dirty) 20) " more")))
        (say ""
              "Then re-run: ./swarm heal")
        (System/exit 1)))
    (say "swarm heal: syncing local main with origin/main …")
    (let [merge-result (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
                        {:daemon-dir daemon-dir
                         :fetch! (fn [] (sh root "git" "fetch" "origin" "main"))
                         :rev-counts! (fn []
                                        (let [c (sh root "git" "rev-list" "--left-right" "--count" "origin/main...main")]
                                          (when (zero? (:exit c))
                                            (let [[behind ahead] (map parse-long (str/split (:out c) #"\s+"))]
                                              {:ahead (or ahead 0) :behind (or behind 0)}))))
                         :dirty-paths! (fn [] [])
                         :tip-contains-origin! (fn [] (zero? (:exit (sh root "git" "merge-base" "--is-ancestor" "origin/main" "HEAD"))))
                         :would-conflict! (fn [] false)
                         ;; BL-1198: attempt a push first — only reset when
                         ;; that push is rejected (genuine divergence).
                         :rematch! (fn []
                                     (master-main-reconcile-lib/rematch-with-push-first!
                                      {:push! (fn []
                                                (let [r (sh root "git" "push" "origin" "main")]
                                                  {:success (zero? (:exit r)) :error (:err r)}))
                                       :reset! (fn []
                                                 (let [r (sh root "git" "reset" "--hard" "origin/main")]
                                                   {:success (zero? (:exit r)) :error (:err r)}))}))
                         :merge! (fn []
                                   (let [r (sh root "git" "merge" "--ff-only" "--no-edit" "origin/main")]
                                     (if (zero? (:exit r))
                                       {:success true}
                                       {:success false
                                        :conflicted-paths
                                        (post-hotfix-merge-origin-lib/conflicted-paths-from-status
                                         (:out (sh root "git" "status" "--porcelain=v1")))})))
                         ;; BL-1214: a REAL 3-way merge, tried only when
                         ;; :merge! above (--ff-only) failed - absorbs a
                         ;; non-conflicting two-way divergence losslessly
                         ;; instead of falling straight to :rematch!.
                         :merge3! (fn []
                                    (let [r (sh root "git" "merge" "--no-edit" "origin/main")]
                                      (if (zero? (:exit r))
                                        {:success true}
                                        {:success false
                                         :conflicted-paths
                                         (post-hotfix-merge-origin-lib/conflicted-paths-from-status
                                          (:out (sh root "git" "status" "--porcelain=v1")))})))
                         :abort! (fn [] (sh root "git" "merge" "--abort"))
                         :status-porcelain! (fn [] (:out (sh root "git" "status" "--porcelain=v1")))
                         :mid-merge? (fn [] (fs/exists? (fs/path root ".git" "MERGE_HEAD")))})
          sync (sync-status root)
          action (:action sync)
          ready (:ready sync)]
      (say (str "swarm heal: merge outcome " (:outcome merge-result)
                " (ahead=" (:ahead merge-result) " behind=" (:behind merge-result) ")"))
      (when (= action "proceed")
        (say ""
              "swarm heal: OK — coordinator bookkeeping unblocked (main_sync action=proceed)."
              "The coordinator should drain its inbox on the next ready_for_next turn."
              "If the pane is menu-spammed, answer or dismiss the menu first."))
      (when (not= action "proceed")
        (say ""
              "swarm heal: sync still blocked:" (json/generate-string sync {:pretty false})
              "See docs/how-to/BL-891-master-main-reconcile-sweep.md"))
      (println (json/generate-string {:healed (boolean ready)
                                      :sync sync
                                      :merge (select-keys merge-result [:ok? :outcome :ahead :behind])}
                                     {:pretty false}))
      (System/exit (if ready 0 1)))))

(defn -main [& args]
  (heal! (or (first args) ".")))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
