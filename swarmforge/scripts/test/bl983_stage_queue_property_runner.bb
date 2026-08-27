#!/usr/bin/env bb
;; BL-983 declared invariants, coder-first (BL-654). Generative sweep
;; driving the REAL delivery + claim path (swarm_handoff.bb sends,
;; ready_for_next_task.bb claims) over random multi-seat fixtures:
;;
;;   Invariant 1 (exactly one seat): after any interleaving of sends and
;;     seat polls, every parcel sits in EXACTLY ONE place (one seat's
;;     in_process, or still queued for the stage) - never duplicated,
;;     never lost; a redelivered copy of a claimed parcel is never claimed
;;     by a peer (the claimant keeps exactly one copy).
;;   Invariant 2 (single claim PER SEAT): no seat ever holds two live
;;     in_process parcels - a busy seat's re-poll resumes its own parcel
;;     and claims nothing, whatever sits in the stage queue.
;;   Invariant 3 (seat never escapes the mailbox layer): a claiming seat's
;;     forward to the next stage carries NO seat id anywhere in the parcel
;;     (from:/role:/filename are the STAGE) and lands in the next stage's
;;     queue.
;;
;; Fixture: ONE git repo (draw-invariant, hoisted - the BL-978 lesson);
;; per-draw the roles.tsv is rewritten for that draw's random seat set and
;; every mailbox tree reset (asserted gone).
;;
;; Reach floors (absolute, never scaled): two-seat >= 6, three-seat >= 3,
;; all-busy >= 4, redelivery >= 4, forward >= 4.
;;
;; Non-vacuity (staged-first restore, run 2026-08-20, recorded in the
;; parcel commit). Break 1 is the REAL defect this parcel's own e2e probe
;; caught mid-build:
;;   - break 1 (inv 2): ready_for_next_task.bb's in_process listing
;;     reverted to the seat-blind my-handoff-files -> a busy seat looks
;;     idle and claims a second parcel; the per-seat <=1 assertion goes
;;     RED on the first all-busy draw.
;;   - break 2 (inv 1): the sibling in_process shield dropped from the
;;     dequeue's terminal sets -> a redelivered claimed parcel is claimed
;;     by the peer; the exactly-one assertion goes RED on the first
;;     redelivery draw.
;;   - break 3 (inv 3): swarm_handoff.bb's sender-role stage-ification
;;     reverted -> the forward draw goes RED on '@' in the from header.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 16))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))
(defn shuffle* [xs] (let [al (java.util.ArrayList. xs)] (java.util.Collections/shuffle al rng) (vec al)))

(def failures (atom []))
(def coverage (atom {:two-seat 0 :three-seat 0 :all-busy 0 :redeliver 0 :forward 0}))
(defn fail! [msg] (swap! failures conj msg))

(def root (str (fs/create-temp-dir {:prefix "bl983-prop-"})))
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? root) (fs/delete-tree root)))))

(defn sh [opts & args] (apply process/sh (merge {:continue true} opts) args))

;; One-time repo seed (draw-invariant).
(sh {:dir root} "git" "init" "-q" ".")
(fs/create-dirs (fs/path root "backlog" "active"))
(spit (str (fs/path root "backlog" "active" "F.yaml")) "id: F\n")
(fs/create-dirs (fs/path root "bin"))
(spit (str (fs/path root "bin" "tmux")) "#!/usr/bin/env bash\nexit 0\n")
(sh {} "chmod" "+x" (str (fs/path root "bin" "tmux")))
(fs/create-dirs (fs/path root ".swarmforge"))
(spit (str (fs/path root "fake.sock")) "")
(spit (str (fs/path root ".swarmforge" "tmux-socket")) (str root "/fake.sock"))
(sh {:dir root} "git" "add" "-A")
(sh {:dir root} "git" "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "seed")
(def cited (str/trim (:out (sh {:dir root :out :string} "git" "rev-parse" "--short=10" "HEAD"))))

(def env-path (str (fs/path root "bin") ":" (System/getenv "PATH")))

(defn seat-dir [seat] (str (fs/path root (str/replace seat "@" "-"))))

(defn reset-fixture!
  "Rewrites roles.tsv for this draw's seats and resets every mailbox tree,
   each removal asserted gone."
  [seats next-stage]
  (let [all (concat ["specifier"] seats [next-stage])]
    (doseq [r all]
      (let [d (seat-dir r)]
        (fs/delete-tree d)
        (when (fs/exists? d) (fail! (str "reset failed to clear " d)))
        (fs/create-dirs d)))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str (str/join "\n"
                         (for [r all]
                           (str r "\t" (str/replace r "@" "-") "-wt\t" (seat-dir r)
                                "\tswarmforge-" r "\t" r "\tclaude\ttask")))
               "\n"))))

(defn send! [task to]
  (let [draft (str (fs/path (seat-dir "specifier") (str "d-" task ".txt")))]
    (spit draft (str "type: git_handoff\nto: " to "\npriority: 50\ntask: " task "\ncommit: " cited "\n"))
    (sh {:dir (seat-dir "specifier")
         :extra-env {"SWARMFORGE_ROLE" "specifier" "PATH" env-path}}
        "bb" (str (fs/path scripts-dir "swarm_handoff.bb")) draft)))

(defn poll! [seat]
  (sh {:dir (seat-dir seat)
       :extra-env {"SWARMFORGE_ROLE" seat "PATH" env-path}
       :out :string :err :string}
      "bb" (str (fs/path scripts-dir "ready_for_next_task.bb"))))

(defn handoffs-in [dir]
  (if (fs/exists? dir)
    (vec (filter #(str/ends-with? (str %) ".handoff") (fs/list-dir dir)))
    []))

(defn in-process [seat] (handoffs-in (fs/path (seat-dir seat) ".swarmforge" "handoffs" "inbox" "in_process")))
(defn queue-of [stage] (handoffs-in (fs/path (seat-dir stage) ".swarmforge" "handoffs" "inbox" "new")))

(dotimes [i runs]
  (let [stage "coder"
        next-stage "cleaner"
        n-seats (+ 2 (rand-int* 2))
        seats (vec (cons stage (map #(str stage "@s" % (rand-int* 90)) (range 1 n-seats))))
        n-parcels (inc (rand-int* (inc n-seats)))
        tasks (mapv #(str "BL-" (+ 300 (* i 10) %) "-t") (range n-parcels))]
    (swap! coverage update (if (= 3 n-seats) :three-seat :two-seat) inc)
    (reset-fixture! seats next-stage)
    (doseq [t tasks] (send! t stage))
    ;; Random polling order, two sweeps (a busy seat's second poll must
    ;; resume, not claim).
    (doseq [seat (concat (shuffle* seats) (shuffle* seats))]
      (poll! seat))
    ;; Invariant 2: per-seat single claim.
    (doseq [seat seats]
      (when (> (count (in-process seat)) 1)
        (fail! (str "draw " i ": seat " seat " holds " (count (in-process seat)) " in_process parcels"))))
    ;; Invariant 1: every parcel in exactly one place.
    (let [claimed (frequencies (map fs/file-name (mapcat in-process seats)))
          queued (frequencies (map fs/file-name (queue-of stage)))
          everywhere (merge-with + claimed queued)]
      (when-not (= (count tasks) (reduce + 0 (vals everywhere)))
        (fail! (str "draw " i ": " (count tasks) " parcels sent but " (reduce + 0 (vals everywhere)) " accounted for (lost or duplicated): claimed=" claimed " queued=" queued)))
      (doseq [[f n] everywhere]
        (when (> n 1) (fail! (str "draw " i ": parcel " f " exists in " n " places")))))
    ;; All-busy: when parcels >= seats every seat is busy - one more parcel
    ;; must stay queued and change no seat's claim count.
    (when (and (>= n-parcels n-seats) (< (:all-busy @coverage) 8))
      (swap! coverage update :all-busy inc)
      (let [extra (str "BL-" (+ 300 (* i 10) 9) "-extra")
            before (into {} (map (fn [s] [s (count (in-process s))]) seats))]
        (send! extra stage)
        (doseq [seat (shuffle* seats)] (poll! seat))
        ;; The queued file's TASK HEADER names the parcel - send filenames
        ;; carry only from/to (first runner build asserted on the filename
        ;; and went red against correct behavior; recorded here).
        (let [queued-tasks (set (map #(second (re-find #"(?m)^task: (.+)$" (slurp (str %)))) (queue-of stage)))]
          (when-not (contains? queued-tasks extra)
            (fail! (str "draw " i ": all-busy extra parcel not left queued: " queued-tasks))))
        (doseq [seat seats]
          (when (not= (get before seat) (count (in-process seat)))
            (fail! (str "draw " i ": busy seat " seat " claim count changed on re-poll"))))))
    ;; Redelivery: copy a claimed parcel back into the stage queue - no
    ;; peer claims it, the claimant keeps exactly one copy.
    (when (and (seq (mapcat in-process seats)) (< (:redeliver @coverage) 8))
      (swap! coverage update :redeliver inc)
      (let [claimant (first (filter #(seq (in-process %)) seats))
            claimed-file (first (in-process claimant))
            basename (fs/file-name claimed-file)]
        (fs/copy claimed-file (fs/path (seat-dir stage) ".swarmforge" "handoffs" "inbox" "new" basename)
                 {:replace-existing true})
        (doseq [seat (shuffle* (remove #{claimant} seats))] (poll! seat))
        (doseq [seat (remove #{claimant} seats)]
          (when (some #(= basename (fs/file-name %)) (in-process seat))
            (fail! (str "draw " i ": redelivered claimed parcel " basename " claimed by peer " seat))))
        (when (not= 1 (count (filter #(= basename (fs/file-name %)) (in-process claimant))))
          (fail! (str "draw " i ": claimant no longer holds exactly one copy of " basename)))))
    ;; Forward: a claiming seat forwards - the parcel carries no seat id
    ;; and lands in the next stage's queue.
    (when (and (seq (mapcat in-process seats)) (< (:forward @coverage) 8))
      (swap! coverage update :forward inc)
      (let [claimant (rand-nth* (vec (filter #(seq (in-process %)) seats)))
            task (some-> (first (in-process claimant)) str slurp
                         (->> (re-find #"(?m)^task: (.+)$")) second)
            draft (str (fs/path (seat-dir claimant) "fwd.txt"))]
        (spit draft (str "type: git_handoff\nto: " next-stage "\npriority: 50\ntask: " task "\ncommit: " cited "\n"))
        (sh {:dir (seat-dir claimant)
             :extra-env {"SWARMFORGE_ROLE" claimant "PATH" env-path}}
            "bb" (str (fs/path scripts-dir "swarm_handoff.bb")) draft)
        (let [arrived (handoffs-in (fs/path (seat-dir next-stage) ".swarmforge" "handoffs" "inbox" "new"))]
          (if (empty? arrived)
            (fail! (str "draw " i ": forward from " claimant " never reached " next-stage))
            (doseq [f arrived]
              (let [content (slurp (str f))]
                (when (str/includes? (str (fs/file-name f)) "@")
                  (fail! (str "draw " i ": seat id leaked into forwarded filename " (fs/file-name f))))
                (when (str/includes? content "@")
                  (fail! (str "draw " i ": seat id leaked into forwarded parcel content:\n" content)))))))))))

(doseq [[k floor] {:two-seat 6 :three-seat 3 :all-busy 4 :redeliver 4 :forward 4}]
  (when (< (get @coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k) " of " runs " (floor " floor ")"))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl983 stage-queue properties: " runs " draws over the real send/claim/forward path"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
