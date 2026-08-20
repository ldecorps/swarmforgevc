#!/usr/bin/env bb
;; BL-965 property tests (coder-authored, declared invariants) over the REAL
;; composed heal wrapper's temp-file cleanup.
;;
;;   Invariant 1: "For every catchable termination of the composed wrapper
;;   (normal exit, INT, TERM, HUP), the wrapper's own temp file is removed;
;;   only an uncatchable SIGKILL may leave residue, and any residue matches
;;   the recognizable ${TMPDIR:-/tmp}/sfh.* pattern." P1 draws a termination
;;   shape (normal-success, normal-failure, INT, TERM, HUP - every catchable
;;   arm common by construction) crossed with a command shape, runs the REAL
;;   wrapper under bash with TMPDIR pointed at a per-draw fixture dir, and
;;   asserts zero sfh.* residue afterward (having first observed the capture
;;   file EXIST mid-run for the signal arms - a wrapper that never creates
;;   the file would pass vacuously otherwise). A SIGKILL arm asserts the
;;   residue half: the leftover file matches sfh.*.
;;
;;   Invariant 2: "Adding cleanup changes nothing else observable: exit
;;   code, combined output, and every BL-960 invariant hold unchanged over
;;   BL-960's own corpus and suites." That invariant quantifies over BL-960's
;;   existing corpus, which already has its own executable encodings - the
;;   BL-960/BL-913/BL-934 acceptance features and the tool_miss_heal unit +
;;   property runners, all run green at this parcel's commit - so it is
;;   deliberately NOT re-encoded here (a second copy of that corpus would be
;;   the drift-prone mirror the engineering rules forbid). P1's normal arms
;;   additionally assert exit code and combined output equal the unwrapped
;;   command's, the direct observable this parcel could have changed.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - the trap block removed from build-healing-wrapper-command (the
;;     pre-fix wrapper) -> P1 failed 6/15 runs, every INT/TERM/HUP draw
;;     (one sfh.* file left per kill);
;;   - the signal traps changed to a bare rm-only combined trap (the
;;     resume-and-cat flaw) -> P1 failed 7/15 runs on the resumed-wrapper
;;     assertion, which was ADDED when this break's first run showed the
;;     residue half alone could not catch it.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tool_miss_heal_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 15))
(def failures (atom []))
(def coverage (atom {:normal 0 :int 0 :term 0 :hup 0 :kill 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(def normal-commands
  ["printf 'ok\\n'"
   "printf 'no trailing newline'"
   "printf 'out\\n'; printf 'err\\n' >&2"
   "printf 'fails\\n'; exit 3"])

(defn- sfh-files [dir]
  (->> (fs/list-dir dir)
       (map fs/file-name)
       (filter #(str/starts-with? % "sfh."))
       vec))

(defn- run-normal [wrapper command tmpdir]
  (let [wrapped (process/sh {:continue true :extra-env {"TMPDIR" (str tmpdir)}}
                            "bash" "-c" wrapper)
        unwrapped (process/sh {:continue true}
                              "bash" "-c" (str "{ " command "\n} 2>&1"))]
    (cond
      (not= (:exit unwrapped) (:exit wrapped))
      (str "exit code changed: wrapped " (:exit wrapped) " vs unwrapped " (:exit unwrapped))
      (not= (:out unwrapped) (:out wrapped))
      (str "combined output changed: " (pr-str (:out wrapped)) " vs " (pr-str (:out unwrapped)))
      (seq (sfh-files tmpdir))
      (str "normal completion left residue: " (pr-str (sfh-files tmpdir)))
      :else true)))

(defn- run-signalled [wrapper tmpdir sig]
  ;; A long-running wrapped command; signal the wrapper bash mid-capture.
  ;; Its own process group (perl setpgrp - macOS ships no setsid), so the
  ;; kill below signals the GROUP - the routine kill shape (Bash-tool
  ;; timeout, respawn-pane -k). bash defers traps while a foreground child
  ;; runs, so a bash-only signal would merely queue the trap behind the
  ;; 600s sleep rather than exercising it.
  (let [proc (process/process ["perl" "-e" "setpgrp(0,0); exec @ARGV or die;"
                               "bash" "-c" wrapper]
                              {:out :string :err :string
                               :extra-env {"TMPDIR" (str tmpdir)}})
        appeared (loop [i 0]
                   (cond
                     (seq (sfh-files tmpdir)) true
                     (>= i 100) false
                     :else (do (Thread/sleep 100) (recur (inc i)))))]
    (if-not appeared
      (do (process/destroy-tree proc) "the capture file never appeared mid-run")
      (do
        (process/sh "kill" (str "-" sig) (str "-" (.pid (:proc proc))))
        (let [done (deref proc 15000 nil)
              _ (process/destroy-tree proc) ; reap the inner sleep either way
              out (str (:out done) (:err done))
              residue (loop [i 0]
                        (let [r (sfh-files tmpdir)]
                          (if (or (empty? r) (>= i 50)) r (do (Thread/sleep 100) (recur (inc i))))))]
          (cond
            (and (= sig "KILL") (seq residue))
            (if (every? #(str/starts-with? % "sfh.") residue)
              true
              (str "SIGKILL residue does not match the sfh.* pattern: " (pr-str residue)))

            (and (not= sig "KILL") (seq residue))
            (str sig " left residue: " (pr-str residue))

            ;; A signal-consuming rm-only trap lets bash RESUME past the
            ;; interrupted child and cat the just-removed file - the killed
            ;; run's output grows an error line it never had pre-fix. The
            ;; wrapper must die on the signal path, never limp onward.
            (and (not= sig "KILL") done
                 (str/includes? out "No such file"))
            (str sig ": the wrapper resumed after the signal and cat'd its removed capture file: " (pr-str out))

            :else true))))))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[arm-n s1] (gen-int s 5)
          arm (nth [:normal :int :term :hup :kill] arm-n)
          [cmd-n s2] (gen-int s1 (count normal-commands))
          tmpdir (fs/create-temp-dir {:prefix "bl965-prop-"})
          result (try
                   (let [command (if (= arm :normal)
                                   (nth normal-commands cmd-n)
                                   "echo started; sleep 600")
                         wrapper (tool-miss-heal-lib/build-healing-wrapper-command
                                  command "/nonexistent-bl965-worktree")]
                     (case arm
                       :normal (run-normal wrapper command tmpdir)
                       :int (run-signalled wrapper tmpdir "INT")
                       :term (run-signalled wrapper tmpdir "TERM")
                       :hup (run-signalled wrapper tmpdir "HUP")
                       :kill (run-signalled wrapper tmpdir "KILL")))
                   (finally (fs/delete-tree tmpdir)))]
      (swap! coverage update arm inc)
      (when-not (true? result)
        (swap! failures conj (str "FAIL BL-965 invariant 1\n  arm: " arm "\n  " result)))
      (recur (inc i) s2))))

(let [{:keys [normal int term hup kill]} @coverage]
  (doseq [[k v] {:normal normal :int int :term term :hup hup :kill kill}]
    (when (< v 1)
      (swap! failures conj (str "FAIL generator coverage: " k " reached " v " of " runs " runs (floor 1)")))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl965 wrapper cleanup properties: " runs " runs over the real composed wrapper"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
