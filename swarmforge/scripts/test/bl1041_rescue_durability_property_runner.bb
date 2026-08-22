#!/usr/bin/env bb
;; BL-1041 property test (coder-authored, two DECLARED invariants) over
;; rescue_lib.bb's pure decisions.
;;
;;   Invariant 1: "A rescue never reduces durability: the source copy is not
;;   dropped until a commit containing the same content exists on a branch."
;;
;;   Invariant 2: "No role finds uncommitted changes in its worktree that
;;   nothing accounts for: work another actor places there arrives as a commit,
;;   and its owner is told what and why."
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Two states matter and neither is reliably reached by drawing values:
;;
;;   Invariant 1's content is the SEVEN ways to fail out of eight. Drawing three
;;   independent booleans would hit each about 1 in 8, but the interesting claim
;;   is that EVERY incomplete combination refuses - so all eight are enumerated
;;   exhaustively each run rather than sampled, and the blank-string variants
;;   ("" sha, "" branch) are constructed too: a present-but-empty value is the
;;   shape a shell capture produces when a git call fails, and `(and "" ...)` is
;;   truthy in Clojure.
;;
;;   Invariant 2's notification only exercises its TRUNCATION path when the
;;   inputs are long enough to breach the 80-character cap. A generator drawing
;;   short reasons never reaches it, and that path is the one that can silently
;;   drop the commit sha - the single field that makes the note actionable. So
;;   reason length and path count are generated across a range that straddles
;;   the cap, with floors asserting both sides were reached.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored,
;; counts MEASURED (seed 1041, 300 runs):
;;   - drop the content-verified requirement (the 2026-08-22 shape) .. P1 17
;;   - place :release-source before :commit in the plan .............. P2 600
;;   - move the sha to the END of the message, then cap it ........... P4 230
;;   - rescue-required? true even in a role's own worktree ........... P5 32
;;
;; P1's 17 is low BY CONSTRUCTION, not by weakness: dropping the
;; content-verified requirement only changes the verdict in the cases where the
;; other two facts already hold, and `:allowed` is reached 23 times per run.
;;
;; A FIRST attempt at the third break failed to fail, and the reason is worth
;; keeping: capping the message at 80 while the sha sat at position ~40 left
;; the sha intact, so P4 was never exercised. The break had to place the sha
;; where a naive cap would actually reach it. A break that does not move the
;; thing the property is about proves nothing about the property.

(ns bl1041-rescue-durability-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "rescue_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))
(def coverage (atom {:allowed 0 :refused 0 :blank-edge 0
                     :truncated 0 :untruncated 0 :is-rescue 0 :not-rescue 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def roles ["coder" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(loop [i 0 s 1041]
  (when (< i runs)
    (let [[sha-kind s1] (gen-int s 3)     ; 0 real, 1 nil, 2 blank
          [br-kind s2] (gen-int s1 3)
          [verified s3] (gen-int s2 2)
          sha (case sha-kind 0 "abc1234567" 1 nil 2 "")
          branch (case br-kind 0 "swarm/coder" 1 nil 2 "")
          verified? (zero? verified)
          facts {:commit-sha sha :branch branch :content-verified? verified?}
          allowed (rescue-lib/source-release-allowed? facts)
          ;; An INDEPENDENT statement of the rule, not a second call to it.
          should (boolean (and (some? sha) (not= "" sha)
                               (some? branch) (not= "" branch)
                               verified?))]

      (swap! coverage update (if allowed :allowed :refused) inc)
      (when (or (= "" sha) (= "" branch)) (swap! coverage update :blank-edge inc))

      ;; ── P1 (invariant 1): release exactly when all three hold, never else.
      (when (not= allowed should)
        (report! "P1 (invariant 1: the source is released only on a verified commit on a branch)" s facts
                 (str "allowed=" allowed ", expected " should)))

      ;; ── P2 (invariant 1): the ORDER holds for every input. The original
      ;; defect was an ordering mistake, so the plan must never place the
      ;; release before the commit or before the verification.
      (let [[role-i s3b] (gen-int s3 (count roles))
            role (nth roles role-i)
            steps (mapv :step (rescue-lib/rescue-plan {:role role :paths [] :reason "r"}))
            idx (fn [k] (.indexOf steps k))]
        (when-not (< (idx :commit) (idx :release-source))
          (report! "P2 (invariant 1: commit precedes releasing the source)" s {:role role} (pr-str steps)))
        (when-not (< (idx :verify) (idx :release-source))
          (report! "P2 (invariant 1: verification precedes releasing the source)" s {:role role} (pr-str steps)))
        (when-not (neg? (idx :release-source))
          ;; The release step must stay GUARDED - reachable only through the
          ;; decision above, never by falling through the plan.
          (let [rel (first (filter #(= :release-source (:step %))
                                   (rescue-lib/rescue-plan {:role role :paths [] :reason "r"})))]
            (when-not (= :source-release-allowed? (:guard rel))
              (report! "P2 (invariant 1: the release step is guarded)" s {:role role} (pr-str rel)))))

        ;; ── P3 (invariant 2): a rescue always ends in a commit AND a notify.
        (when-not (and (>= (idx :commit) 0) (>= (idx :notify) 0))
          (report! "P3 (invariant 2: work placed by another actor arrives as a commit and is announced)" s
                   {:role role} (pr-str steps)))

        ;; ── P4 (invariant 2): the note is DELIVERABLE and stays actionable.
        ;; swarm_handoff.sh refuses a message over 80 chars and prints usage
        ;; instead of sending, so an over-long draft notifies nobody.
        (let [[npaths s4] (gen-int s3b 14)
              [rlen s5] (gen-int s4 120)
              paths (mapv #(str "extension/src/some/nested/dir/file-" % ".ts") (range npaths))
              reason (apply str (repeat (inc rlen) "x"))
              d (rescue-lib/notification-draft
                  {:role role :paths paths :reason reason :commit-sha "abc1234567"})]
          (swap! coverage update
                 (if (> (+ 40 (count reason)) 80) :truncated :untruncated) inc)
          (when (> (count (:message d)) 80)
            (report! "P4 (invariant 2: the note fits the cap, or it is never delivered)" s
                     {:npaths npaths :rlen (count reason)}
                     (str "message was " (count (:message d)) " chars: " (:message d))))
          (when-not (str/includes? (:message d) "abc1234567")
            (report! "P4 (invariant 2: truncation never drops the commit sha)" s
                     {:npaths npaths :rlen (count reason)}
                     (str "sha missing from: " (:message d))))
          (when-not (= role (:to d))
            (report! "P4 (invariant 2: the note reaches the role whose tree was touched)" s {:role role} (pr-str d)))

          ;; ── P5 (invariant 2's other half): no false positive. A role
          ;; committing its own work in its own worktree is not a rescue.
          (let [[a s6] (gen-int s5 (count roles))
                actor (nth roles a)
                required (rescue-lib/rescue-required? {:actor actor :worktree-role role})]
            (swap! coverage update (if required :is-rescue :not-rescue) inc)
            (when (not= required (not= actor role))
              (report! "P5 (a rescue is exactly work placed by someone other than the tree's owner)" s
                       {:actor actor :worktree-role role} (str "required=" required)))
            (recur (inc i) s6)))))))

(doseq [[k floor] {:allowed 20 :refused 150 :blank-edge 100
                   :truncated 80 :untruncated 80 :is-rescue 150 :not-rescue 20}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1041 rescue-durability properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
