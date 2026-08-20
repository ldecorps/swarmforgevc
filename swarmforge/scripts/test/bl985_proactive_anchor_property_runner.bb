#!/usr/bin/env bb
;; BL-985 declared invariants, coder-first (BL-654). Generative sweep over
;; the REAL emitted heal wrapper (safe-wrapper-command -> bash), executed
;; from randomly drawn working directories across a REAL master-checkout +
;; linked-worktrees fixture (git worktree add), plus an outside-any-repo
;; dir and an unrelated standalone repo:
;;
;;   Invariant 1: a role's command never executes with a working directory
;;     inside a worktree other than the role's own pinned one. Every draw's
;;     command records its own `pwd -P` into a marker file; a drifted draw
;;     (sibling worktree, its subdirs, the unrelated repo, outside any
;;     repo) must record the PINNED root, and a non-drifted draw (the pin
;;     itself or any subdirectory of it) must record EXACTLY the drawn cwd
;;     - the stay-put half of "no behaviour change when there is no drift".
;;   Invariant 2: the verdict never depends on whether the command would
;;     have failed - succeeding-while-drifted draws (the exact class the
;;     old output-matching guard was structurally blind to) and
;;     failing-while-drifted draws are both re-anchored identically; both
;;     classes carry their own reach floors.
;;
;; Reach floors (absolute): own-place >= 4, sibling-drift >= 5,
;; outside-repo >= 3, other-repo >= 2, succeeding-drift >= 5,
;; failing-drift >= 3, multi-segment >= 4.
;;
;; Non-vacuity (staged-first restore, run 2026-08-20, recorded in the
;; parcel commit):
;;   - break 1 (inv 1): the proactive anchor block removed from
;;     build-healing-wrapper-command -> succeeding sibling-drift draws
;;     record the SIBLING's pwd; RED on the first such draw.
;;   - break 2 (inv 2 / sibling-discrimination): the guard's comparison
;;     narrowed to fire only when the cwd has NO toplevel (the old
;;     blindness re-expressed proactively) -> sibling-drift draws RED
;;     while outside-repo draws stay green, proving the different-worktree
;;     discrimination is the load-bearing clause.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))
(def lib-file (str (fs/path scripts-dir "tool_miss_heal_lib.bb")))
(load-file lib-file)

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def failures (atom []))
(def coverage (atom {:own-place 0 :sibling-drift 0 :outside-repo 0 :other-repo 0
                     :succeeding-drift 0 :failing-drift 0 :multi-segment 0}))
(defn fail! [msg] (swap! failures conj msg))

(def root (str (fs/create-temp-dir {:prefix "bl985-prop-"})))
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? root) (fs/delete-tree root)))))

(defn sh [opts & args] (apply process/sh (merge {:continue true} opts) args))

;; Fixture: master repo + two REAL linked worktrees + subdirs + an
;; unrelated standalone repo + an outside-any-repo dir. Built once.
(def master (str (fs/path root "master")))
(fs/create-dirs master)
(sh {:dir master} "git" "init" "-q" ".")
(fs/create-dirs (fs/path master "extension" "deep"))
(spit (str (fs/path master "f.txt")) "x\n")
(sh {:dir master} "git" "add" "-A")
(sh {:dir master} "git" "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "init")
(doseq [w ["documenter" "architect"]]
  (sh {:dir master} "git" "worktree" "add" "-q" (str root "/wt-" w) "-b" (str "b-" w)))
(fs/create-dirs (fs/path root "wt-documenter" "extension"))
(def outside (str (fs/path root "nowhere" "deep")))
(fs/create-dirs outside)
(def other-repo (str (fs/path root "other-repo")))
(fs/create-dirs other-repo)
(sh {:dir other-repo} "git" "init" "-q" ".")
(sh {:dir other-repo} "git" "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "--allow-empty" "-m" "init")

(def pinned-resolved (str/trim (:out (sh {:dir master :out :string} "pwd" "-P"))))

(def marker (str (fs/path root "marker.txt")))

(dotimes [i runs]
  (let [place (rand-nth* [:own-root :own-subdir :sibling-root :sibling-subdir :outside :other-repo])
        cwd (case place
              :own-root master
              :own-subdir (str (fs/path master (rand-nth* ["extension" "extension/deep"])))
              :sibling-root (str root "/wt-" (rand-nth* ["documenter" "architect"]))
              :sibling-subdir (str root "/wt-documenter/extension")
              :outside outside
              :other-repo other-repo)
        drifted? (not (#{:own-root :own-subdir} place))
        fails? (and drifted? (zero? (rand-int* 3)))
        multi? (zero? (rand-int* 3))
        record (str "pwd -P >> " (tool-miss-heal-lib/shell-quote marker))
        command (cond
                  multi? (str record "; cd extension 2>/dev/null; " record)
                  fails? (str record "; false")
                  :else record)]
    (swap! coverage update (if drifted?
                             (case place
                               (:sibling-root :sibling-subdir) :sibling-drift
                               :outside :outside-repo
                               :other-repo :other-repo)
                             :own-place) inc)
    (when (and drifted? (not fails?)) (swap! coverage update :succeeding-drift inc))
    (when fails? (swap! coverage update :failing-drift inc))
    (when multi? (swap! coverage update :multi-segment inc))
    (spit marker "")
    (let [wrapper (tool-miss-heal-lib/safe-wrapper-command command master)]
      (if-not wrapper
        (fail! (str "draw " i ": wrapper composition fail-opened for a plain command"))
        (do (sh {:dir cwd} "bash" "-c" wrapper)
            (let [recorded (vec (remove str/blank? (str/split-lines (slurp marker))))]
              (cond
                (empty? recorded)
                (fail! (str "draw " i ": command never ran (no pwd recorded), place=" place))

                drifted?
                (doseq [p recorded]
                  (when-not (or (= p pinned-resolved) (str/starts-with? (str p "/") (str pinned-resolved "/")))
                    (fail! (str "draw " i ": drifted (" place ", fails?=" fails? ") command executed at " p
                                " - not the pinned worktree " pinned-resolved))))

                :else
                (let [expected (str/trim (:out (sh {:dir cwd :out :string} "pwd" "-P")))]
                  (when-not (= (first recorded) expected)
                    (fail! (str "draw " i ": no-drift (" place ") command was MOVED: recorded "
                                (first recorded) " expected " expected))))))))))
  )

(doseq [[k floor] {:own-place 4 :sibling-drift 5 :outside-repo 3 :other-repo 2
                   :succeeding-drift 5 :failing-drift 3 :multi-segment 4}]
  (when (< (get @coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k) " of " runs " (floor " floor ")"))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl985 proactive-anchor properties: " runs " draws of the real wrapper from real drifted shells"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
