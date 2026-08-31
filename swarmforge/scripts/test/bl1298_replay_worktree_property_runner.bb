#!/usr/bin/env bb
;; BL-1298 properties over land_step_lib.bb's replay!.
;;
;; Invariant 1: the scratch checkout is created under the repository's REAL
;;   git common directory, so the main checkout and a linked worktree produce
;;   the same replay for the same ticket and commit.
;; Invariant 2: a FAILED replay leaves the repository exactly as it found it -
;;   no scratch worktree and no scratch branch survive - so a retry can only
;;   fail for the reason the first attempt did.
;;
;; Both are stated against the REPOSITORY, not against the implementation's
;; own spelling of a path: invariant 1 compares the two checkouts' replayed
;; TREES (and asserts nothing was created under the linked worktree's own
;; `.git`, which is a FILE), and invariant 2 compares a full before/after
;; census of branches and registered worktrees. A mutant that rebuilt the old
;; `<root>/.git` path, or that dropped any one failure path's branch delete,
;; diverges immediately.
;;
;; Generator reach (asserted, not hoped for): the checkout kinds and the
;; failure modes are each drawn often enough that every state the invariants
;; quantify over is actually visited - a property that never generated a
;; FAILING replay would pass over invariant 2 vacuously, and one that never
;; stood in a linked worktree would pass over invariant 1 vacuously. Both
;; floors are checked at the end and are a failure when unmet.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))
(def reach (atom {}))
(defn- saw! [k] (swap! reach update k (fnil inc 0)))
(defn- fail! [msg] (swap! failures conj (str "FAIL: " msg)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

;; An ambient GIT_DIR/GIT_WORK_TREE would point every git call below at
;; whatever repository the caller is standing in - this one (BL-1200/BL-1222).
(def clean-env
  (into {} (remove (fn [[k _]] (#{"GIT_DIR" "GIT_WORK_TREE"} k)) (System/getenv))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]}
        (apply process/sh {:dir (str dir) :continue true :env clean-env} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(def ticket-ids ["BL-9001" "BL-42" "BL-100" "BL-1298"])
(def own-names ["own.txt" "a/b/deep.txt" "own-two.txt"])
;; Weighted so BOTH checkout kinds and BOTH replay outcomes are common. The
;; linked kinds outnumber the main one deliberately: the defect lives only
;; there, and a generator that mostly stood in the main checkout would make
;; invariant 1 astronomically unlikely to be exercised where it bites.
(def checkout-kinds [:main :linked :linked :linked-nested])
(def outcomes [:success :success :create-fail :create-fail :nothing-to-commit])

(defn- census [root]
  {:branches (sort (remove str/blank?
                           (map #(str/replace % #"^[* ]+" "")
                                (str/split-lines (:out (sh! root "git" "branch" "--list"))))))
   :worktrees (sort (remove str/blank?
                            (map #(first (str/split % #"\s+"))
                                 (str/split-lines (:out (sh! root "git" "worktree" "list"))))))})

(defn- build-repo! [work ticket own-name]
  (let [origin (str (fs/path work "origin.git"))
        r (str (fs/path work "repo"))]
    (sh! work "git" "init" "-q" "--bare" "-b" "main" origin)
    (sh! work "git" "init" "-q" "-b" "main" r)
    (sh! r "git" "config" "user.email" "t@t")
    (sh! r "git" "config" "user.name" "t")
    (sh! r "git" "config" "commit.gpgsign" "false")
    (sh! r "git" "remote" "add" "origin" origin)
    (spit (str (fs/path r "base.txt")) "base\n")
    (sh! r "git" "add" "-A")
    (sh! r "git" "commit" "-q" "-m" "seed")
    (sh! r "git" "push" "-q" "origin" "main")
    ;; A sibling's unlanded work, then this ticket's own - the entangled shape.
    (spit (str (fs/path r "sib.txt")) "sibling\n")
    (sh! r "git" "add" "-A")
    (sh! r "git" "commit" "-q" "-m" "BL-9002: sibling work.")
    (fs/create-dirs (fs/parent (fs/path r own-name)))
    (spit (str (fs/path r own-name)) "own\n")
    (sh! r "git" "add" "-A")
    (sh! r "git" "commit" "-q" "-m" (str ticket ": own work."))
    {:root r :commit (:out (sh! r "git" "rev-parse" "HEAD"))}))

(defn- checkout-for! [root kind]
  (case kind
    :main root
    :linked (let [wt (str (fs/path (fs/parent root) "linked-wt"))]
              (sh! root "git" "worktree" "add" "-q" "--detach" wt "HEAD") wt)
    :linked-nested (let [wt (str (fs/path (fs/parent root) "nest" "deeper" "wt"))]
                     (fs/create-dirs (fs/parent wt))
                     (sh! root "git" "worktree" "add" "-q" "--detach" wt "HEAD") wt)))

(defn- scratch-of [root ticket commit]
  (str (fs/path (land-step-lib/git-common-dir root)
                "land-replay-worktrees" (str ticket "-" (subs commit 0 10)))))

(defn- branch-of [ticket commit]
  (str "land-replay/" ticket "-" (subs commit 0 10)))

(doseq [i (range runs)]
  (let [s0 (step (+ 7919 (* i 104729)))
        [ticket s1] (gen-pick s0 ticket-ids)
        [own-name s2] (gen-pick s1 own-names)
        [kind s3] (gen-pick s2 checkout-kinds)
        [outcome _] (gen-pick s3 outcomes)
        work (str (fs/create-temp-dir {:prefix "bl1298-prop-"}))]
    (try
      (let [{:keys [root commit]} (build-repo! work ticket own-name)
            caller (checkout-for! root kind)
            branch (branch-of ticket commit)
            ;; :nothing-to-commit replays a path already byte-identical on
            ;; origin/main, so the scratch checkout has nothing to commit.
            own-paths (if (= outcome :nothing-to-commit) ["base.txt"] [own-name])
            scratch (scratch-of caller ticket commit)]
        (saw! kind)
        (saw! outcome)
        (when (= outcome :create-fail)
          (fs/create-dirs (fs/parent scratch))
          (spit scratch "not a directory\n"))
        (let [before (census root)
              result (land-step-lib/replay! {:root caller :commit commit
                                             :task-ticket-id ticket :own-paths own-paths})
              after (census root)]

          ;; ── Invariant 1 ────────────────────────────────────────────────
          ;; The scratch path is under the REAL common dir, which is the same
          ;; directory whichever checkout asked. In a linked worktree `.git`
          ;; is a FILE, so anything created beneath it is the old defect.
          (when (not= (str (fs/path root ".git")) (land-step-lib/git-common-dir caller))
            (fail! (str "invariant 1: " kind " resolved the git directory to "
                        (land-step-lib/git-common-dir caller)
                        ", not the repository's own " (fs/path root ".git"))))
          (when (and (not= kind :main)
                     (fs/directory? (fs/path caller ".git" "land-replay-worktrees")))
            (fail! (str "invariant 1: " kind " created a scratch checkout under its own .git")))

          (if (= outcome :create-fail)
            (do
              ;; ── Invariant 2 ────────────────────────────────────────────
              (when (:success result)
                (fail! (str "generator: " kind "/" outcome " was expected to fail, it succeeded")))
              (when-not (= before after)
                (fail! (str "invariant 2: a failed replay from " kind
                            " changed the repository\n  before: " (pr-str before)
                            "\n  after:  " (pr-str after))))
              (when (seq (:out (sh! root "git" "branch" "--list" branch)))
                (fail! (str "invariant 2: the scratch branch " branch
                            " survived a failed replay from " kind)))
              ;; A retry can only fail for the first attempt's reason: remove
              ;; that reason and the retry must go through.
              (fs/delete-tree scratch {:force true})
              (let [retry (land-step-lib/replay! {:root caller :commit commit
                                                  :task-ticket-id ticket :own-paths own-paths})]
                (when-not (:success retry)
                  (fail! (str "invariant 2: the retry from " kind
                              " failed for a reason the first attempt did not have: "
                              (:reason retry))))))

            ;; The non-failing modes: :success must succeed, :nothing-to-commit
            ;; must fail AND leave nothing behind - it is a failure path too.
            (if (= outcome :nothing-to-commit)
              (do
                (when (:success result)
                  (fail! (str "generator: " kind "/nothing-to-commit succeeded unexpectedly")))
                (when-not (= before after)
                  (fail! (str "invariant 2: a nothing-to-commit replay from " kind
                              " changed the repository\n  before: " (pr-str before)
                              "\n  after:  " (pr-str after)))))
              (do
                (when-not (:success result)
                  (fail! (str "invariant 1: a replay from " kind " failed: " (:reason result))))
                (when (:success result)
                  ;; Same ticket, same commit, the OTHER checkout: same tree.
                  (sh! root "git" "branch" "-q" "-D" branch)
                  (let [other (if (= kind :main) (checkout-for! root :linked) root)
                        again (land-step-lib/replay! {:root other :commit commit
                                                      :task-ticket-id ticket :own-paths own-paths})]
                    (if-not (:success again)
                      (fail! (str "invariant 1: the same replay from the other checkout failed: "
                                  (:reason again)))
                      (let [t1 (:out (sh! root "git" "rev-parse" (str (:commit result) "^{tree}")))
                            t2 (:out (sh! root "git" "rev-parse" (str (:commit again) "^{tree}")))]
                        (when (not= t1 t2)
                          (fail! (str "invariant 1: " kind " and the other checkout replayed "
                                      "different trees for the same ticket and commit"))))))))))))
      (catch Exception e
        (fail! (str "run " i " threw: " (.getMessage e))))
      (finally (fs/delete-tree work {:force true})))))

;; ── reach floors ───────────────────────────────────────────────────────────
;; A floor unmet is a FAILURE, not a note: it means the run said nothing about
;; the state the invariant is actually about.
(def floors {:main 3 :linked 6 :linked-nested 3
             :success 6 :create-fail 6 :nothing-to-commit 3})
(doseq [[k floor] floors]
  (let [seen (get @reach k 0)]
    (when (< seen floor)
      (fail! (str "generator reach: " k " visited " seen " time(s), floor is " floor
                  " - the properties said nothing about that state")))))

(println (str "reach: " (pr-str (into (sorted-map) @reach)) " over " runs " runs"))
(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: BL-1298 replay worktree properties"))
