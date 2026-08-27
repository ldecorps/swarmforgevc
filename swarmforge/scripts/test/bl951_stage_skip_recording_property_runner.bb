#!/usr/bin/env bb
;; BL-951 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over swarm_handoff.bb's route-required-stages,
;; encoding the ticket's declared invariants 1 and 2 across generated
;; forward hops:
;;
;;   invariant 1 - "Absence of a declaration is never quieter than presence
;;      of one": for the SAME (sender, recipient) forward hop, the recorded
;;      skipped-stage list is identical whether the ticket declares the full
;;      chain, declares invalidly, or omits the field entirely - and the
;;      invalid state additionally carries its rejection reason.
;;   invariant 2 - "Recording a skip never changes delivery": the returned
;;      :recipients equal the literal draft recipients for every declaration
;;      state (the full chain and the default both contain every stage, so
;;      no rewrite is ever in play across this generated space).
;;
;;   invariant 3 ("the envelope header and the log line never disagree") is
;;   NOT encoded here: both artifacts derive from the ONE :routing-skipped
;;   map at the single -main call site (write-handoff! stamps the header,
;;   log-routing-skip! appends the same map), so the claim quantifies over
;;   the caller's wiring, not this function's input space - the acceptance
;;   suite asserts both artifacts on every real send instead.
;;
;; Same seeded-LCG convention as this directory's other property runners.
;; The oracle restates the between-stages rule from the canonical order
;; directly - never by calling hop-skipped-stages.
;;
;; Non-vacuity proven by hand at authoring time: restoring the pre-BL-951
;; :default-full early return fails invariant 1's absent and invalid states
;; on the first hop with a non-empty between (and the acceptance suite's
;; scenario 01 rows fail identically). Restored before landing.

(ns bl951-stage-skip-recording-property-runner
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as shell]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))

(def failures (atom []))
(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 951))
(defn- rpick [coll] (nth (vec coll) (.nextInt rng (count coll))))

(def canonical ["coder" "cleaner" "architect" "hardender" "documenter" "QA"])

;; One fixture root per declaration state, built once; route-required-stages
;; reads the conf and the active ticket YAML from the root.
(def created (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root [declaration]
  (let [root (str (fs/create-temp-dir {:prefix "bl951-prop-"}))]
    (swap! created conj root)
    (fs/create-dirs (fs/path root "backlog" "active"))
    (fs/create-dirs (fs/path root "swarmforge"))
    (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
          "config required_stages_routing_enabled true\n")
    (spit (str (fs/path root "backlog" "active" "BL-951-probe.yaml"))
          (str "id: BL-951\ntitle: \"probe\"\nstatus: active\n" declaration))
    root))

(def roots
  {:absent (mk-root "")
   :invalid (mk-root "required_stages: [coder, cleaner]\n")
   :full-chain (mk-root "required_stages: [coder, cleaner, architect, hardender, documenter, qa]\n")})

;; Load swarm_handoff.bb's fns without running -main: the script guards its
;; entry on *command-line-args*? It does not - it calls -main at load.
;; Instead, drive the real script per-send... too heavy per property run.
;; The honest lighter path: extract the function by loading the file with
;; -main neutralized is fragile. So this runner shells ONE real
;; swarm_handoff send per (state, sender, recipient) case instead - the
;; genuinely-wired path - over a bounded generated sample.
(def swarm-handoff (str (fs/path script-dir ".." "swarm_handoff.bb")))

(defn prepare-git! [root]
  (shell/sh "git" "-C" root "init" "-q")
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root "specs" "features" "x.feature")) "Feature: x\n")
  (shell/sh "git" "-C" root "add" "-A")
  (shell/sh "git" "-C" root "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "seed")
  (let [{:keys [out]} (shell/sh "git" "-C" root "rev-parse" "--short=10" "HEAD")]
    (str/trim out)))

(def commits (into {} (for [[k root] roots] [k (prepare-git! root)])))

(doseq [[_ root] roots]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str/join "" (for [r (conj canonical "coordinator")]
                       (str r "\t" r "\t" root "\tswarmforge-" r "\tX\tclaude\ttask\n")))))
(doseq [[_ root] roots]
  ;; acceptance pointer must resolve at the cited commit (pre-QA gate)
  (spit (str (fs/path root "backlog" "active" "BL-951-probe.yaml"))
        (str (slurp (str (fs/path root "backlog" "active" "BL-951-probe.yaml")))
             "acceptance: specs/features/x.feature\n")))

(defn send! [state sender recipient]
  (let [root (get roots state)
        draft (str (fs/path root "draft.txt"))]
    ;; reset per-send artifacts
    (fs/delete-tree (fs/path root ".swarmforge" "handoffs"))
    (let [skips (fs/path root ".swarmforge" "routing-skips.jsonl")]
      (when (fs/exists? skips) (fs/delete skips)))
    (spit draft (str "type: git_handoff\nto: " recipient "\npriority: 50\ntask: BL-951-probe\ncommit: " (get commits state) "\n"))
    (let [{:keys [exit out err]} (shell/sh "bb" swarm-handoff "draft.txt"
                                            :dir root
                                            :env (merge (into {} (System/getenv))
                                                        {"SWARMFORGE_ROLE" sender
                                                         "SWARMFORGE_SKIP_SYNC_INJECT" "1"
                                                         "SWARMFORGE_REQUIRED_STAGES_ROUTING" "1"}))]
      (when-not (zero? exit)
        (throw (ex-info (str "send failed: " out err) {})))
      (let [envelope-file (last (re-seq #"/[^\s]*\.handoff" (str out err)))
            envelope (slurp envelope-file)
            skips-file (fs/path root ".swarmforge" "routing-skips.jsonl")
            lines (if (fs/exists? skips-file)
                    (mapv #(json/parse-string % true) (remove str/blank? (str/split-lines (slurp (str skips-file)))))
                    [])]
        {:to (some #(when (str/starts-with? % "to: ") (subs % 4)) (str/split-lines envelope))
         :header (some #(when (str/starts-with? % "routing_skipped: ") %) (str/split-lines envelope))
         :log-lines lines}))))

(defn oracle-between [sender recipient]
  (let [si (.indexOf canonical sender)
        ri (.indexOf canonical recipient)]
    (vec (subvec canonical (inc si) ri))))

;; BL-991 amendment. BL-951 was deliberately "visible but not prevented": its
;; invariant 2 asserted that a coder->QA hop is DELIVERED as addressed in
;; every declaration state. The operator has since ruled the declaration
;; binding, so on the :full-chain root a forward hop is redirected to the
;; first declared stage after the sender - which for a full chain is always
;; the sender's immediate successor. :absent and :invalid both resolve to
;; default-full, where sender judgement still stands, so they are untouched
;; and BL-951's own point still has two live states to make it in.
;;
;; The oracles below are computed here rather than read back from the code
;; under test, so this file still fails if the router stops obeying either
;; rule.
(defn oracle-delivered [state sender recipient]
  (if (= :full-chain state)
    (nth canonical (inc (.indexOf canonical sender)))
    recipient))

;; Bounded generated sample: every run picks a random forward pair; every
;; declaration state is sent for that same pair and compared. Reachability
;; floors asserted for the non-empty-between shape and the invalid state's
;; rejection carry.
(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 12))
(def nonempty-between-reached (atom 0))
(def rejection-carried-reached (atom 0))

(dotimes [_ runs]
  (let [si (.nextInt rng 5)
        ri (+ si 1 (.nextInt rng (- 5 si)))
        sender (nth canonical si)
        recipient (nth canonical ri)
        between (oracle-between sender recipient)
        results (into {} (for [state [:absent :invalid :full-chain]]
                           [state (send! state sender recipient)]))]
    (when (seq between) (swap! nonempty-between-reached inc))
    ;; invariant 2, as BL-991 amended it: delivery is unchanged wherever the
    ;; declaration is not usable, and bound to the next declared stage where
    ;; it is.
    (doseq [[state {:keys [to]}] results]
      (assert-true (str "invariant 2: " sender "->" recipient " " state " delivers to "
                        (oracle-delivered state sender recipient) ", got " to)
                   (= (oracle-delivered state sender recipient) to)))
    ;; invariant 1: the two default-full states record identically to each
    ;; other. :full-chain no longer belongs in that comparison - it takes a
    ;; different hop now, so a different (and correct) skip list.
    (let [skipped-of (fn [{:keys [log-lines]}] (mapv :skipped log-lines))
          base (skipped-of (:absent results))]
      (assert-true (str "invariant 1: " sender "->" recipient " invalid records the same skips as absent " base)
                   (= base (skipped-of (:invalid results))))
      ;; BL-991: a bound hop lands on the sender's immediate successor in a
      ;; full chain, so it passes over nothing and correctly records nothing.
      (let [full (:full-chain results)]
        (assert-true (str "invariant 1: " sender "->" recipient " full-chain's bound hop skips nothing, so records nothing")
                     (and (nil? (:header full)) (empty? (:log-lines full)))))
      (if (seq between)
        (do
          (doseq [state [:absent :invalid]]
            (let [{:keys [header log-lines]} (get results state)]
              (assert-true (str "invariant 1: " sender "->" recipient " " state " has header AND exactly one log line")
                           (and header (= 1 (count log-lines))
                                (= between (:skipped (first log-lines)))))))
          (let [inv (:invalid results)]
            (when (some :rejection-reason (:log-lines inv))
              (swap! rejection-carried-reached inc))
            (assert-true (str "invalid declaration carries its rejection reason " sender "->" recipient)
                         (some :rejection-reason (:log-lines inv)))))
        (doseq [state [:absent :invalid]]
          (let [{:keys [header log-lines]} (get results state)]
            (assert-true (str "adjacent hop records nothing in " state)
                         (and (nil? header) (empty? log-lines)))))))))

(when (zero? @nonempty-between-reached)
  (swap! failures conj "FAIL reachability: no generated hop had a non-empty between set"))
(when (zero? @rejection-carried-reached)
  (swap! failures conj "FAIL reachability: the invalid state's rejection carry was never exercised on a skipping hop"))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl951_stage_skip_recording_property_runner: ok (" runs " sampled hops)")))
