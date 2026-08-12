#!/usr/bin/env bb
;; BL-885 coder pass (BL-654 Invariants): PROPERTY tests over the leaked
;; -dims caffeinate reap class, authored first by the coder per the
;; Invariants section (BL-654) of BL-885's own ticket.
;;
;; NOTE on toolchain (per swarmforge/constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)"): follows the .bb property-test
;; precedent this repo already established (bl879_parent_orphaned_front_
;; desk_property_runner.bb, bl886_vitest_orphan_reaper_janitor_property_
;; runner.bb) - a hand-rolled seeded generator in this same
;; swarmforge/scripts/test/ suite, the actual enforced gate for .bb code.
;;
;; Covers the three declared invariants:
;;   1. "A caffeinate is reaped only when every ownership signal holds at
;;      once: exact -dims argv, cwd under the host root or a registered
;;      worktree, and PID differing from the pidfile's live PID - any
;;      single missing signal keeps it alive."
;;   2. "An unreadable ownership signal fails closed: a cwd that cannot be
;;      determined never reads as project-scoped, so the process is never
;;      reaped on it."
;;   3. "No caffeinate younger than the stale threshold is ever reaped,
;;      tracked or not - PPID 1 is normal for every detached caffeinate, so
;;      parenthood never buys a fast path for this class."
;;
;; P1 exhaustively enumerates the reapable-leaked-caffeinate? decision
;; table's full input space (2^5 = 32 combinations - small enough to cover
;; completely rather than sample) and asserts its output always equals the
;; conjunction the invariants describe. Invariant 3 is folded into the same
;; conjunction: "tracked or not" means stale? is required regardless of
;; is-live-caffeinate-pid?, which the conjunction already encodes (there is
;; no parent-orphaned term at all - this class has none).
;;
;; P2 covers invariant 2 specifically: project-scoped-path? (the real,
;; unmocked function this ticket reuses rather than reimplementing) never
;; reads a caffeinate candidate as scoped when its cwd cannot be determined
;; - caffeinate's cmdline never embeds a path (invariant 1's cmdline is a
;; fixed "caffeinate -dims" literal), so cwd is the class's only ownership
;; signal, and nil cwd must fail closed across many different project
;; roots. A positive control (cwd genuinely under the root) proves the same
;; property is not vacuously true for every cwd.
;;
;; Non-vacuity proven by hand at authoring time: P1 failed (33/32 - some
;; case wrong) when reapable-leaked-caffeinate? was temporarily changed to
;; drop the `is-live-caffeinate-pid? -> false` cond clause (the pidfile
;; exemption silently stopped applying). P2 failed when project-scoped-
;; path?'s in-path? was temporarily changed to treat a nil s as truthy.
;; Both mutations reverted before this commit.

(ns bl885-leaked-caffeinate-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ──
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; ── P1: reapable-leaked-caffeinate? exhaustively, over the full 2^5 input
;;        space - never sampled, since the domain is small enough to prove
;;        completely rather than merely reach with high probability ───────
(def bool-domain [false true])

(def p1-inputs
  (for [in-live-window-set? bool-domain
        caffeinate-dims? bool-domain
        project-scoped? bool-domain
        stale? bool-domain
        is-live-caffeinate-pid? bool-domain]
    {:in-live-window-set? in-live-window-set?
     :caffeinate-dims? caffeinate-dims?
     :project-scoped? project-scoped?
     :stale? stale?
     :is-live-caffeinate-pid? is-live-caffeinate-pid?}))

(doseq [input p1-inputs]
  (let [{:keys [in-live-window-set? caffeinate-dims? project-scoped? stale?
                is-live-caffeinate-pid?]} input
        expected (and (not in-live-window-set?)
                      caffeinate-dims?
                      project-scoped?
                      (not is-live-caffeinate-pid?)
                      stale?)
        actual (orphan-janitor-lib/reapable-leaked-caffeinate? input)]
    (when (not= expected actual)
      (report! "P1 leaked-caffeinate-all-signals-required (invariants 1+3)"
                "exhaustive" input
                (str "expected reapable=" expected " got=" actual)))))

(println (str "bl885 P1 leaked-caffeinate-all-signals-required: "
              (count p1-inputs) "/32 combinations exhaustively checked"))

;; ── P2: an unresolved cwd never reads as project-scoped for a caffeinate
;;        candidate, across many distinct project roots (invariant 2) ─────
(def project-root-pool
  ["/Users/ldecorps/projects/swarmforgevc"
   "/home/carillon/swarmforgevc"
   "/tmp/tmp.abc123"
   "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ"
   "/Users/someone/other-project"])

(defn- gen-p2-root [s]
  (gen-pick s project-root-pool))

(loop [i 0 s 4242]
  (when (< i runs)
    (let [[root s'] (gen-p2-root s)
          scoped? (orphan-janitor-lib/project-scoped-path? root "caffeinate -dims" nil)]
      (when scoped?
        (report! "P2 unresolved-cwd-fails-closed (invariant 2)" s {:root root}
                  "an undeterminable (nil) cwd was read as project-scoped"))
      (recur (inc i) s'))))

;; Positive control: this is NOT vacuously true for every cwd - a cwd
;; genuinely under the root DOES read as scoped, proving the nil case above
;; is actually exercising the fail-closed branch and not just always false.
(let [root "/Users/ldecorps/projects/swarmforgevc"
      scoped? (orphan-janitor-lib/project-scoped-path? root "caffeinate -dims" (str root "/extension"))]
  (when-not scoped?
    (report! "P2 positive-control-resolved-cwd-is-scoped" "n/a" {:root root}
              "a cwd genuinely under the project root was not read as scoped - P2's nil case would be vacuous")))

(println (str "bl885 P2 unresolved-cwd-fails-closed: " runs " runs + 1 positive control"))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
