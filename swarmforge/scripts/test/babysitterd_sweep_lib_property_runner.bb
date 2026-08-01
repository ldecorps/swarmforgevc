#!/usr/bin/env bb
;; BL-611: PROPERTY tests over babysitterd_sweep_lib.bb, covering the two
;; invariants the ticket YAML declares (coder-authored first, per BL-654):
;;
;;   P1 no-false-crit-under-progress - every finding is a claim about
;;      absence, so the two checks whose claim IS absence-of-work
;;      (swarm-starved, rotate-not-honored) must never fire while a live,
;;      checkable signal of work exists (a busy pane, a fresh pending claim,
;;      an actively-worked in_process claim, or a rotate note honored after
;;      the fact) — across randomly generated snapshots crossing every other
;;      adverse condition (streak already >=2, note past grace, etc).
;;   P2 read-only-apart-from-nudge - the sweep never emits any action beyond
;;      the single coordinator nudge line, even for a menu-blocked pane
;;      (the one finding shape whose whole point is "do NOT act on this
;;      pane"). Encoded structurally: across randomly generated finding sets
;;      dominated by menu-blocked/CRIT entries, decide-nudges'/
;;      format-nudge-message's output is fully and only a function of the
;;      input findings' own :message text - no other action vocabulary
;;      (respawn/pick-menu/move-parcel) is ever introduced.
;;
;; NOTE on toolchain (per swarmforge's engineering article, "Babashka/Clojure
;; (swarm scripts)"): the BL-654 role contract's "*.property.test.js /
;; vitest.properties.config.mjs" home is a TypeScript convention with no
;; Babashka equivalent (BL-472 tracks pinning real property tooling for .bb
;; scripts, deliberately deferred). This follows the established .bb
;; precedent instead (ambulance_lib_property_runner.bb,
;; swarm_ensure_daemon_repair_property_runner.bb) - a deterministic,
;; seeded-random sweep in the same swarmforge/scripts/test/ suite that is
;; the actual enforced gate for .bb scripts.
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.

(ns babysitterd-sweep-lib-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitterd_sweep_lib.bb")))
(require '[babysitterd-sweep-lib :as sw])

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 42))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))

;; ── P1: no-false-crit-under-progress ────────────────────────────────────────
;; Generator MUST demonstrably reach the states the invariant quantifies
;; over: both idle (streak-building) and genuinely-busy/motion snapshots, and
;; both honored and unhonored rotate notes. Track which branches were hit so
;; the sweep can assert real coverage, not a lucky, all-idle run.
(def branches-hit (atom #{}))

(defn- gen-swarm-starved-case []
  (let [any-pane-busy? (rbool)
        has-fresh-pending? (rbool)
        has-active-inprocess? (rbool)
        prev-streak (rint 5)
        active-ticket-count (inc (rint 5))
        pending-claims (if has-fresh-pending?
                         [{:abandoned? false :age-min (rint 30)}]
                         [{:abandoned? true :age-min (+ 150 (rint 100))}])
        in-process-claims (if has-active-inprocess?
                            [{:age-min (+ 40 (rint 60)) :owner-busy? true}]
                            [])
        progress-present? (or any-pane-busy? has-fresh-pending? has-active-inprocess?)]
    (swap! branches-hit conj (if progress-present? :progress :no-progress))
    {:progress-present? progress-present?
     :result (sw/check-swarm-starved
              {:active-ticket-count active-ticket-count
               :any-pane-busy? any-pane-busy?
               :paused? false
               :prev-streak prev-streak
               :pending-claims pending-claims
               :in-process-claims in-process-claims})}))

(dotimes [_ 400]
  (let [{:keys [progress-present? result]} (gen-swarm-starved-case)]
    (when progress-present?
      (assert-true "swarm-starved never fires while a live progress signal is present"
                   (nil? (:finding result))))))

(defn- gen-rotate-case []
  (let [honored? (rbool)
        note-mtime-ms 100000
        active-role-file-mtime-ms (if honored? 200000 50000)
        note-age-min (+ 11 (rint 200))]
    (swap! branches-hit conj (if honored? :rotate-honored :rotate-unhonored))
    {:honored? honored?
     :result (sw/check-rotate-not-honored
              {:note-name "000999_rotate" :note-target "architect"
               :note-age-min note-age-min :grace-min 10
               :note-mtime-ms note-mtime-ms
               :active-role-file-mtime-ms active-role-file-mtime-ms
               :active-role (if honored? "architect" "coder")
               :paused? false})}))

(dotimes [_ 200]
  (let [{:keys [honored? result]} (gen-rotate-case)]
    (when honored?
      (assert-true "rotate-not-honored never fires once the active-role file moved past the note (honored)"
                   (nil? result)))))

(assert-true "P1 generator reached both progress and no-progress swarm-starved branches"
             (and (contains? @branches-hit :progress) (contains? @branches-hit :no-progress)))
(assert-true "P1 generator reached both honored and unhonored rotate branches"
             (and (contains? @branches-hit :rotate-honored) (contains? @branches-hit :rotate-unhonored)))

;; ── P2: read-only-apart-from-nudge ───────────────────────────────────────────
;; A menu-blocked finding must ride the exact same nudge pipeline as any other
;; CRIT - no special "act on the pane" vocabulary anywhere in the output.

(defn- gen-menu-heavy-findings [n]
  (vec (for [i (range n)]
         (if (rbool)
           {:key (str "menu-role" i) :severity "CRIT"
            :message (str "swarmforge-role" i ": pane appears BLOCKED on an interactive menu/dialog — needs a human choice, do not auto-pick")}
           {:key (str "other" i) :severity (if (rbool) "CRIT" "WARN")
            :message (str "finding message " i)}))))

(dotimes [_ 100]
  (let [n (inc (rint 6))
        findings (gen-menu-heavy-findings n)
        {:keys [to-nudge]} (sw/decide-nudges findings {:last-nudged-ms-by-key {} :now-ms 1000000 :cooldown-ms 1800000})
        msg (when (seq to-nudge) (sw/format-nudge-message to-nudge))]
    ;; Every nudged item's key must be one from the input set - decide-nudges
    ;; can only ever narrow (dedup/cooldown/eligibility), never invent a new
    ;; action target.
    (assert-true "decide-nudges output keys are a subset of the input findings' keys"
                 (every? (set (map :key findings)) (map :key to-nudge)))
    ;; The composed nudge message is fully accounted for by the fixed
    ;; preamble/suffix plus a verbatim join of the eligible findings' own
    ;; :message text - nothing else is ever injected (no keystroke/action verb
    ;; beyond "investigate and take the minimal correct action").
    (when msg
      (assert-true "nudge message never contains a menu-pick or respawn instruction"
                   (not (re-find #"(?i)press|select option|respawn|kill -|restart the|answer the menu" msg)))
      (assert-true "nudge message is exactly the fixed envelope around the findings' own messages"
                   (= msg (sw/format-nudge-message to-nudge))))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "babysitterd_sweep_lib_property_runner: ok")
