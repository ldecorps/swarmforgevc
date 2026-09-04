#!/usr/bin/env bb
;; BL-1390: PROPERTY runner over the three invariants the ticket YAML declares
;; (coder-authored first, per BL-654). Separate from normal verification - its
;; own command, never folded into the unit runner.
;;
;;   P1 a push happens ONLY when, after a fresh fetch, local main is strictly
;;      ahead and not behind - never while diverged, never from a role
;;      worktree, never on any branch but main.
;;   P2 the decision is TOTAL and never throws: over every combination of the
;;      four facts, including unreadable ones, it answers, and it answers "do
;;      not push" for everything that is not the one safe shape. A hook that
;;      threw would be a hook that logged nothing and left the committer
;;      wondering.
;;   P3 one push path: post-commit-decision agrees with push-decision wherever
;;      push-decision applies, so the hook and the periodic sweep can never
;;      disagree about whether a push was safe.
;;
;; Exhaustive over the interesting space rather than sampled: the facts are
;; two booleans and two small integers, so the whole grid is enumerated by
;; CONSTRUCTION and every shape is asserted to have been reached. A generator
;; drawing branch names at random would reach "main" essentially never, which
;; is the one branch that may push.

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "push_sweep_lib.bb")))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))

(def branches ["main" "coder" "swarmforge-QA" "side" ""])
(def counts (for [a [0 1 2 7] b [0 1 5]] {:ahead a :behind b}))

(def reached (atom {}))
(defn note! [k] (swap! reached update k (fnil inc 0)))

;; ── P1 + P2: the whole grid, decided ──────────────────────────────────────
(doseq [branch branches
        linked? [true false]
        {:keys [ahead behind]} counts]
  (let [facts {:branch branch :linked-worktree? linked? :ahead ahead :behind behind}
        decision (try (push-sweep-lib/post-commit-decision facts)
                      (catch Exception e (fail! (str "P2: the decision threw on " (pr-str facts) ": " (.getMessage e)))
                             :threw))
        may-push? (= decision :should-push)
        shared? (and (= branch "main") (not linked?))]
    ;; P2: it always answers, and only with an answer this hook understands.
    (when-not (contains? #{:should-push :diverged :nothing-to-push :not-shared-checkout :counts-unknown} decision)
      (fail! (str "P2: unknown decision " decision " for " (pr-str facts))))
    ;; P1: a push ONLY on the one safe shape - the shared checkout, strictly
    ;; ahead, not behind.
    (when (and may-push? (not shared?))
      (fail! (str "P1: a push was allowed off the shared checkout: " (pr-str facts))))
    (when (and may-push? (pos? behind))
      (fail! (str "P1: a push was allowed while behind: " (pr-str facts))))
    (when (and may-push? (zero? ahead))
      (fail! (str "P1: a push was allowed with nothing ahead: " (pr-str facts))))
    (when (and shared? (pos? ahead) (zero? behind) (not may-push?))
      (fail! (str "P1: the one safe shape was refused: " (pr-str facts))))
    ;; P3: wherever push-decision applies - the shared checkout with readable
    ;; counts - the two agree exactly. One push path, one rule.
    (when shared?
      (let [sweep (push-sweep-lib/push-decision {:ahead ahead :behind behind})]
        (when-not (= decision sweep)
          (fail! (str "P3: the hook and the sweep disagree on " (pr-str facts)
                      " - hook " decision ", sweep " sweep)))))
    (note! (cond (not shared?) :off-shared
                 may-push? :push
                 (pos? behind) :diverged
                 :else :nothing))))

;; ── P2: unreadable facts are answered, and answered "no push" ─────────────
(doseq [facts [{:branch "main" :linked-worktree? false :ahead nil :behind 0}
               {:branch "main" :linked-worktree? false :ahead 3 :behind nil}
               {:branch "main" :linked-worktree? false :ahead nil :behind nil}]]
  (let [decision (try (push-sweep-lib/post-commit-decision facts)
                      (catch Exception e (fail! (str "P2: threw on unreadable counts " (pr-str facts) ": " (.getMessage e)))
                             :threw))]
    (note! :unknown)
    (when (= decision :should-push)
      (fail! (str "P1/P2: unreadable counts were treated as safe to push: " (pr-str facts))))))

;; ── generator reach, asserted rather than hoped for ───────────────────────
(doseq [shape [:off-shared :push :diverged :nothing :unknown]]
  (when-not (pos? (get @reached shape 0))
    (fail! (str "never exercised the " shape " shape - the grid does not reach it"))))

(if (empty? @failures)
  (println (str "bl1390_post_commit_push_property: ALL PROPERTIES HOLD over "
                (reduce + (vals @reached)) " constructed states"))
  (do (println (str "bl1390_post_commit_push_property: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
