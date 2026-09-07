#!/usr/bin/env bb
;; BL-1470 coder pass (BL-654 Invariants): PROPERTY tests over
;; land_step_lib.bb's bounce-blocking-state/resolve-bounce-store-roots
;; encoding the ticket's two declared invariants against the REAL
;; functions and a REAL git fixture with a REAL linked worktree (BL-1390:
;; the worktree lives inside the fixture's own disposable clone, never on
;; the live repository) - never a reimplementation of the decision.
;;
;;   Invariant 1: "The bounce check's answer never depends on which
;;   checkout asked: from the master checkout or any linked worktree, with
;;   or without an explicit root, a bounce recorded where record-bounce.js
;;   writes (the shared target root) blocks the sibling and is named." P1
;;   draws a random bounce-or-not, unreadable-or-not state at the SHARED
;;   root only (the linked worktree's own store untouched) and asserts
;;   bounce-blocking-state answers IDENTICALLY whether asked with root=the
;;   master checkout or root=the linked worktree.
;;
;;   Invariant 2: "Fail closed and never narrowing: a bounce recorded
;;   under the caller's own root also blocks; an unreadable store under
;;   either root is unreadable and blocking; only the absence of a store
;;   under both roots is never-bounced." P2 draws bounce-present/absent and
;;   unreadable/readable independently for EACH of the shared root and the
;;   linked worktree's own root, asks only from the linked worktree (the
;;   one place the two roots actually differ), and asserts: unreadable in
;;   either root -> :unreadable, blocking; else a bounce record in either
;;   root (and reachable, unreadable-free) -> :bounced, blocking, naming
;;   the commit; else nil.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners. Never `rand`, never a real clock.
;;
;; Non-vacuity proven by hand at authoring time: resolve-bounce-store-roots
;; patched to return only `[(str root)]` (the pre-fix behaviour) failed
;; both P1 (asking from the linked worktree stopped seeing a shared-root
;; bounce, diverging from the master checkout's answer) and P2 (a
;; shared-root-only bounce or unreadable store stopped being seen from the
;; linked worktree) on the very first run each. Restored.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 20))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= 1 i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop seed0 gen-fn pred-fn]
  (loop [i 0 s seed0]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(def ^:private SIBLING "BL-9002")

;; A fresh fixture repo, one commit (also the bounced commit and the tip -
;; ancestry is trivially satisfied), and a linked worktree of it - BL-1390:
;; the worktree is `git worktree add` INSIDE this disposable clone, never
;; on the live repository.
(defmacro with-fixture [[root-sym wt-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1470-prop-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (spit (str (fs/path ~root-sym "seed.txt")) "seed\n")
       (sh! ~root-sym "git" "add" "-A")
       (sh! ~root-sym "git" "commit" "-q" "-m" (str ~SIBLING ": seed"))
       (let [~wt-sym (str (fs/path ~root-sym "linked-wt"))]
         (sh! ~root-sym "git" "worktree" "add" "-q" "--detach" ~wt-sym "HEAD")
         ~@body)
       (finally (fs/delete-tree ~root-sym)))))

(defn- write-bounce! [root ticket commit at]
  (let [dir (fs/path root ".swarmforge" "bounces")]
    (fs/create-dirs dir)
    (spit (str (fs/path dir "2026-09.jsonl"))
          (str "{\"ticket\":\"" ticket "\",\"producingRole\":\"coder\",\"ticketType\":\"defect\","
               "\"failureClass\":\"behavior\",\"commit\":\"" commit "\",\"by\":\"QA\",\"at\":\"" at "\"}\n")
          :append true)))

(defn- write-unreadable! [root]
  (let [dir (fs/path root ".swarmforge" "bounces")]
    (fs/create-dirs dir)
    (spit (str (fs/path dir "2026-09.jsonl")) "not valid json\n")))

;; ── P1: invariant 1 - identical answer from either checkout ──────────────

(defn gen-p1 [s]
  (let [[bounce? s1] (gen-bool s)
        [unreadable? s2] (gen-bool s1)]
    [{:bounce? bounce? :unreadable? unreadable?} s2]))

(defn- p1-case [{:keys [bounce? unreadable?]}]
  (with-fixture [root wt]
    (let [tip (:out (sh! root "git" "rev-parse" "HEAD"))]
      (when unreadable? (write-unreadable! root))
      (when (and bounce? (not unreadable?)) (write-bounce! root SIBLING tip "2026-09-07T11:48:00.000Z"))
      (let [from-master (land-step-lib/bounce-blocking-state root SIBLING tip)
            from-linked (land-step-lib/bounce-blocking-state wt SIBLING tip)]
        (cond
          (not= from-master from-linked)
          (str "asking from the master checkout (" (pr-str from-master)
               ") and the linked worktree (" (pr-str from-linked) ") disagree")

          (and unreadable? (not= :unreadable (:state from-linked)))
          (str "an unreadable shared-root store did not read as unreadable: " (pr-str from-linked))

          (and bounce? (not unreadable?) (not= :bounced (:state from-linked)))
          (str "a shared-root bounce did not block: " (pr-str from-linked))

          (and (not bounce?) (not unreadable?) (not (nil? from-linked)))
          (str "no bounce and no unreadable store, but the answer was not nil: " (pr-str from-linked))

          :else true)))))

(check-all "P1: the answer never depends on which checkout asked (invariant 1)" 1470 gen-p1 p1-case)

;; ── P2: invariant 2 - union, never a narrowing; fail closed ──────────────

(defn gen-p2 [s]
  (let [[shared-bounce? s1] (gen-bool s)
        [caller-bounce? s2] (gen-bool s1)
        [shared-unreadable? s3] (gen-bool s2)
        [caller-unreadable? s4] (gen-bool s3)]
    [{:shared-bounce? shared-bounce? :caller-bounce? caller-bounce?
      :shared-unreadable? shared-unreadable? :caller-unreadable? caller-unreadable?}
     s4]))

(defn- p2-case [{:keys [shared-bounce? caller-bounce? shared-unreadable? caller-unreadable?]}]
  (with-fixture [root wt]
    (let [tip (:out (sh! root "git" "rev-parse" "HEAD"))]
      (if shared-unreadable?
        (write-unreadable! root)
        (when shared-bounce? (write-bounce! root SIBLING tip "2026-09-07T11:48:00.000Z")))
      (if caller-unreadable?
        (write-unreadable! wt)
        (when caller-bounce? (write-bounce! wt SIBLING tip "2026-09-07T11:49:00.000Z")))
      (let [state (land-step-lib/bounce-blocking-state wt SIBLING tip)
            any-unreadable? (or shared-unreadable? caller-unreadable?)
            any-bounce? (or shared-bounce? caller-bounce?)]
        (cond
          (and any-unreadable? (not= :unreadable (:state state)))
          (str "an unreadable store in either root must read as unreadable: " (pr-str state)
               " (shared-unreadable? " shared-unreadable? " caller-unreadable? " caller-unreadable? ")")

          (and any-unreadable? (not (:blocking? state)))
          (str "an unreadable store must block: " (pr-str state))

          (and (not any-unreadable?) any-bounce? (not= :bounced (:state state)))
          (str "a bounce recorded in either readable root must block (union, never a narrowing): " (pr-str state))

          (and (not any-unreadable?) any-bounce? (not (str/includes? (str (:reason state)) tip)))
          (str "a blocking bounce must name its commit: " (pr-str state))

          (and (not any-unreadable?) (not any-bounce?) (not (nil? state)))
          (str "no store under either root is the only real never-bounced answer, but got: " (pr-str state))

          :else true)))))

(check-all "P2: union never a narrowing; fail closed on either root (invariant 2)" 2470 gen-p2 p2-case)

;; ── report ────────────────────────────────────────────────────────────────

(println (str "bl1470 bounce-check-shared-store properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))
