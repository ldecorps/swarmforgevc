#!/usr/bin/env bb
;; BL-992 declared invariants, coder-first (BL-654). Generative sweep
;; driving the REAL swarm_handoff.bb (subprocess per draw - the lookup
;; under test is private to that script and the script runs -main on load,
;; so the CLI boundary IS the unit) over random root states:
;;
;;   Invariant 1 (freshest ref never invisible): a declaration carried by
;;     the freshest resolvable ref is honored whatever the sender's
;;     working tree contains. Draw axes: the declaration lives on local
;;     main only (origin behind - the measured field shape), on
;;     origin/main only (local behind - fetched via a REAL local remote,
;;     never merged), or on both; the working-tree copy is always deleted.
;;     Every such draw's cleaner-addressed send must arrive at QA.
;;   Invariant 2 (lookup never fails a send): no-main-ref roots, no-remote
;;     roots and ticket-nowhere roots each deliver exactly as addressed
;;     AND exit zero.
;;   Invariant 3 (exact id, by ref or tree): collision draws construct the
;;     held id from the sent id by appending digits (the BL-654
;;     derive-one-side guidance) and commit ONLY the longer id's file to
;;     the ref - the shorter id's send must never resolve it (delivered as
;;     addressed).
;;
;; Reach floors (absolute): local-ahead >= 4, origin-ahead >= 4, both >= 3,
;; no-ref >= 3, nowhere >= 3, collision >= 4.
;;
;; Non-vacuity (staged-first restore, run 2026-08-20, recorded in the
;; parcel commit; break 1 doubles as the ticket's own qa_e2e step 7):
;;   - break 1 (inv 1): active-ticket-yaml-content reverted to the
;;     working-tree-only glob -> every ref-only draw RED (delivered to
;;     cleaner, declaration invisible); acceptance scenarios 01-02 RED
;;     while 03-05 stay green, exactly as qa_e2e step 7 predicts.
;;   - break 2 (inv 3): ticket-yaml-at-ref's exact-id recheck dropped and
;;     its grep de-anchored -> collision draws RED (BL-900 resolves
;;     BL-900N's file).
;;   - break 3 (inv 2): ticket-yaml-at-ref's try/catch removed -> no-ref /
;;     hostile-root draws RED on exit status.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))
(def swarm-handoff (str (fs/path scripts-dir "swarm_handoff.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 24))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def failures (atom []))
(def coverage (atom {:local-ahead 0 :origin-ahead 0 :both 0 :no-ref 0 :nowhere 0 :collision 0}))
(defn fail! [msg] (swap! failures conj msg))

(def work (str (fs/create-temp-dir {:prefix "bl992-prop-"})))
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? work) (fs/delete-tree work)))))

(defn sh [opts & args] (apply process/sh (merge {:continue true} opts) args))
(defn git! [dir & args] (apply sh {:dir dir} "git" "-c" "user.email=t@t" "-c" "user.name=t" args))

(defn mk-root!
  "A sender root: git repo on `branch`, seed commit, roles.tsv, active dir."
  [i branch]
  (let [root (str (fs/path work (str "draw-" i)))]
    (fs/create-dirs (fs/path root "specs" "features"))
    (fs/create-dirs (fs/path root "backlog" "active"))
    (fs/create-dirs (fs/path root ".swarmforge"))
    (spit (str (fs/path root "specs" "features" "x.feature")) "Feature: x\n")
    (git! root "init" "-q" ".")
    (git! root "branch" "-M" branch)
    (git! root "add" "-A")
    (git! root "commit" "-q" "-m" "seed")
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str (str/join "\n" (for [r ["coordinator" "coder" "cleaner" "QA"]]
                                (str r "\t" (if (= r "coordinator") "master" r) "\t" root
                                     "\tswarmforge-" r "\tX\tclaude\ttask")))
               "\n"))
    root))

(defn ticket-body [id]
  (str "id: " id "\ntitle: \"probe\"\nstatus: active\nacceptance: specs/features/x.feature\nrequired_stages: [coder, qa]\n"))

(defn commit-ticket!
  "Commits id's yaml on the CURRENT branch and deletes the worktree copy."
  [root id]
  (let [p (str (fs/path root "backlog" "active" (str id "-probe.yaml")))]
    (spit p (ticket-body id))
    (git! root "add" "-A")
    ;; No ticket id in the message - the BL-953 coherence gate matches ids
    ;; in commit subjects and collision draws cite this commit for a
    ;; DIFFERENT id on purpose.
    (git! root "commit" "-q" "-m" "promote probe ticket")
    (fs/delete p)))

(defn add-origin!
  "Wires a REAL local remote: clones root to a bare origin, fetches, and
   optionally advances ORIGIN past local (committing id's ticket there)."
  [root i & {:keys [advance-with]}]
  (let [bare (str (fs/path work (str "origin-" i ".git")))]
    (sh {} "git" "clone" "-q" "--bare" root bare)
    (git! root "remote" "add" "origin" bare)
    (when advance-with
      (let [clone (str (fs/path work (str "clone-" i)))]
        (sh {} "git" "clone" "-q" bare clone)
        (let [p (str (fs/path clone "backlog" "active" (str advance-with "-probe.yaml")))]
          (fs/create-dirs (fs/parent p))
          (spit p (ticket-body advance-with))
          (git! clone "add" "-A")
          (git! clone "commit" "-q" "-m" "promote probe ticket")
          (git! clone "push" "-q" "origin" "HEAD:main"))))
    (git! root "fetch" "-q" "origin")))

(defn send! [root task to]
  (let [commit (str/trim (:out (sh {:dir root :out :string} "git" "rev-parse" "--short=10" "HEAD")))
        draft (str (fs/path root "draft.txt"))]
    (spit draft (str "type: git_handoff\nto: " to "\npriority: 50\ntask: " task "\ncommit: " commit "\n"))
    (let [res (sh {:dir root :out :string :err :string
                   :extra-env {"SWARMFORGE_ROLE" "coder"
                               "SWARMFORGE_SKIP_SYNC_INJECT" "1"
                               "SWARMFORGE_REQUIRED_STAGES_ROUTING" "1"}}
                  "bb" swarm-handoff draft)
          outbox (fs/path root ".swarmforge" "handoffs" "outbox")
          envelope (when (fs/exists? outbox)
                     (some->> (fs/list-dir outbox)
                              (filter #(str/ends-with? (str %) ".handoff"))
                              sort last str slurp))]
      {:exit (:exit res) :out (str (:out res) (:err res))
       :to (some->> envelope str/split-lines (some #(when (str/starts-with? % "to: ") (subs % 4))))})))

(dotimes [i runs]
  (let [shape (rand-nth* [:local-ahead :origin-ahead :both :no-ref :nowhere :collision])]
    (swap! coverage update shape inc)
    (case shape
      :local-ahead
      (let [root (mk-root! i "main")]
        (commit-ticket! root "BL-901")
        (add-origin! root i) ;; origin cloned BEFORE... clone happens after commit; re-shape: origin behind by one more local commit
        (git! root "commit" "-q" "--allow-empty" "-m" "local ahead")
        (let [r (send! root "BL-901-probe" "cleaner")]
          (when-not (and (zero? (:exit r)) (= "QA" (:to r)))
            (fail! (str "draw " i " local-ahead: expected QA/0, got " (:to r) "/" (:exit r) "\n" (:out r))))))

      :origin-ahead
      (let [root (mk-root! i "main")]
        (add-origin! root i :advance-with "BL-901")
        (let [r (send! root "BL-901-probe" "cleaner")]
          (when-not (and (zero? (:exit r)) (= "QA" (:to r)))
            (fail! (str "draw " i " origin-ahead: expected QA/0, got " (:to r) "/" (:exit r) "\n" (:out r))))))

      :both
      (let [root (mk-root! i "main")]
        (commit-ticket! root "BL-901")
        (add-origin! root i)
        (let [r (send! root "BL-901-probe" "cleaner")]
          (when-not (and (zero? (:exit r)) (= "QA" (:to r)))
            (fail! (str "draw " i " both: expected QA/0, got " (:to r) "/" (:exit r) "\n" (:out r))))))

      :no-ref
      (let [root (mk-root! i "trunk")]
        ;; worktree-only declaration on a root with no main ref - fallback.
        (spit (str (fs/path root "backlog" "active" "BL-901-probe.yaml")) (ticket-body "BL-901"))
        (let [r (send! root "BL-901-probe" "cleaner")]
          (when-not (and (zero? (:exit r)) (= "QA" (:to r)))
            (fail! (str "draw " i " no-ref: expected QA/0 via worktree fallback, got " (:to r) "/" (:exit r) "\n" (:out r))))))

      :nowhere
      (let [root (mk-root! i (rand-nth* ["main" "trunk"]))]
        (let [r (send! root "BL-901-probe" "QA")]
          (when-not (and (zero? (:exit r)) (= "QA" (:to r)))
            (fail! (str "draw " i " nowhere: expected as-addressed QA/0, got " (:to r) "/" (:exit r) "\n" (:out r))))))

      :collision
      (let [root (mk-root! i "main")
            base (str "BL-9" (rand-int* 90))
            longer (str base (rand-int* 10))]
        (commit-ticket! root longer)
        (let [r (send! root (str base "-probe") "cleaner")]
          (when-not (and (zero? (:exit r)) (= "cleaner" (:to r)))
            (fail! (str "draw " i " collision: held " longer ", sent " base " - expected cleaner/0 (never resolve the longer id), got "
                        (:to r) "/" (:exit r) "\n" (:out r)))))))))

(doseq [[k floor] {:local-ahead 4 :origin-ahead 4 :both 3 :no-ref 3 :nowhere 3 :collision 4}]
  (when (< (get @coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k) " of " runs " (floor " floor ")"))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl992 declaration-ref-lookup properties: " runs " draws through the real CLI"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
