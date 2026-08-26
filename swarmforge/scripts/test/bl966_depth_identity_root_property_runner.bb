#!/usr/bin/env bb
;; BL-966 property tests (coder-authored, declared invariants) over the depth
;; resolution in backlog_depth_lib.bb, driven against REAL scratch git
;; repositories with linked worktrees (and plain non-git roots) - never a
;; reimplementation of the resolution.
;;
;;   Invariant 1: "the depth resolution returns the same cap from the master
;;   checkout and from every linked worktree of it." Each git draw builds a
;;   master repo plus 1-2 linked worktrees with a drawn cap and asserts every
;;   checkout answers identically (and, with an identity present, equals the
;;   identity's pack cap - checked against the DRAWN value, independently of
;;   the lib's own derivation).
;;
;;   Invariant 2: "a cap that does not derive from a resolvable swarm-identity
;;   is never returned silently." Identity-present draws must answer with a
;;   CLEAN stderr; identity-absent draws must carry the fall-through notice
;;   naming the default conf, while still answering the default cap.
;;
;;   Invariant 3: "a non-git scratch root keeps resolving against the given
;;   root with today's stdout and exit code; only the stderr notice may
;;   appear." Non-git draws assert the returned cap is the given root's own
;;   conf value, with the notice on stderr.
;;
;; Each draw spawns real git subprocesses, so the default run count is
;; modest (20; PROPERTY_RUNS overrides) - every draw exercises the full
;; resolution path and the topology space has only three arms to reach.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - resolve-identity-root forced to return project-root unchanged (the
;;     pre-fix behavior) -> failed 6/20 runs, every with-identity draw (the
;;     worktree answered the default conf's cap, not the identity's);
;;   - the fall-through stderr notice removed -> failed 14/20 runs, every
;;     identity-absent and non-git draw (silent default).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(binding [*command-line-args* nil]
  (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "backlog_depth_lib.bb"))))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 20))
(def failures (atom []))
(def coverage (atom {:with-identity 0 :no-identity 0 :non-git 0 :two-worktrees 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- git! [dir & args]
  (let [r (apply process/sh {:continue true :dir (str dir)}
                 "git" "-c" "user.email=t@t" "-c" "user.name=t" args)]
    (when-not (zero? (:exit r))
      (throw (ex-info (str "fixture git failed: " (:err r)) {})))
    (str/trim (:out r))))

(defn- stderr-of [f]
  (let [sw (java.io.StringWriter.)]
    [(binding [*err* sw] (f)) (str sw)]))

(defn- write-conf! [root cap]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        (str "config active_backlog_max_depth " cap "\n")))

(defn- gen-case [s]
  (let [[arm s1] (gen-int s 3)
        [cap s2] (gen-int s1 15)
        [default-cap s3] (gen-int s2 15)
        [n-wt s4] (gen-int s3 2)]
    [{:arm (nth [:with-identity :no-identity :non-git] arm)
      :cap (inc cap)                      ; identity pack cap 1..15
      :default-cap (inc default-cap)      ; tracked default conf cap 1..15
      :n-worktrees (inc n-wt)}            ; 1..2
     s4]))

(defn- run-case! [{:keys [arm cap default-cap n-worktrees]}]
  (let [master (str (fs/canonicalize (fs/create-temp-dir {:prefix "bl966-prop-"})))
        worktrees (atom [])]
    (try
      (write-conf! master default-cap)
      (if (= arm :non-git)
        (let [[got err] (stderr-of #(backlog-depth-lib/read-max-depth master))]
          (cond
            (not= default-cap got)
            (str "non-git root must answer its own conf cap " default-cap ", got " got)
            (not (str/includes? err "no swarm-identity"))
            (str "non-git fall-through must be loud on stderr, got " (pr-str err))
            :else true))
        (do
          (spit (str (fs/path master "README.md")) "init\n")
          (git! master "init" "-q" "-b" "main")
          (git! master "add" "-A")
          (git! master "commit" "-q" "-m" "init")
          (dotimes [i n-worktrees]
            (let [wt (str master "-wt" i)]
              (git! master "worktree" "add" "-q" wt "-b" (str "wt-" i))
              (write-conf! wt default-cap)
              (swap! worktrees conj wt)))
          (when (= arm :with-identity)
            (fs/create-dirs (fs/path master ".swarmforge"))
            (fs/create-dirs (fs/path master "swarmforge" "packs"))
            (spit (str (fs/path master "swarmforge" "packs" "drawn.conf"))
                  (str "config active_backlog_max_depth " cap "\n"))
            (spit (str (fs/path master ".swarmforge" "swarm-identity"))
                  (str "active_backlog_max_depth_conf_path\t"
                       (fs/path master "swarmforge" "packs" "drawn.conf") "\n")))
          (let [checkouts (cons master @worktrees)
                results (mapv (fn [co] (stderr-of #(backlog-depth-lib/read-max-depth co))) checkouts)
                caps (mapv first results)
                errs (mapv second results)
                expected (if (= arm :with-identity) cap default-cap)]
            (cond
              (not= 1 (count (set caps)))
              (str "checkouts disagree (invariant 1): " (pr-str (zipmap checkouts caps)))
              (not= expected (first caps))
              (str "expected cap " expected " from every checkout, got " (first caps))
              (and (= arm :with-identity) (not-every? str/blank? errs))
              (str "identity-derived answers must have clean stderr, got " (pr-str errs))
              (and (= arm :no-identity)
                   (not-every? #(str/includes? % "no swarm-identity") errs))
              (str "no-identity fall-through must be loud from EVERY checkout, got " (pr-str errs))
              :else true))))
      (finally
        (doseq [wt @worktrees]
          (try (git! master "worktree" "remove" "--force" wt) (catch Exception _ nil))
          (fs/delete-tree wt))
        (fs/delete-tree master)))))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[input s'] (gen-case s)
          result (run-case! input)]
      (swap! coverage #(cond-> %
                         true (update (:arm input) inc)
                         (and (not= :non-git (:arm input)) (= 2 (:n-worktrees input)))
                         (update :two-worktrees inc)))
      (when-not (true? result)
        (swap! failures conj (str "FAIL invariants over the real depth resolution\n  input: " (pr-str input) "\n  " result)))
      (recur (inc i) s'))))

(let [{:keys [with-identity no-identity non-git two-worktrees]} @coverage]
  (doseq [[k v] {:with-identity with-identity :no-identity no-identity
                 :non-git non-git :two-worktrees two-worktrees}]
    (when (< v 2)
      (swap! failures conj (str "FAIL generator coverage: " k " reached only " v " of " runs " runs (floor 2)")))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl966 depth identity-root properties: " runs " runs over real git checkouts"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
