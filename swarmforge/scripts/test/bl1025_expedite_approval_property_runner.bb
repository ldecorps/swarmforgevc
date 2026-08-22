#!/usr/bin/env bb
;; BL-1025 property tests (coder-authored, declared invariants) over the REAL
;; shared approval predicate, is_qa_ancestor.sh - never a Clojure restatement
;; of it, because the predicate IS the thing both invariants quantify over.
;;
;;   Invariant 1: "A commit that passed an expedite run's own QA hat is never
;;   reported by the babysitter's pipeline-code-on-main check as having
;;   landed outside QA."
;;
;;   Invariant 2: "A commit that did NOT pass any QA gate - expedite or live -
;;   is still reported, unchanged from today."
;;
;; The state space is small and fully enumerable, so this sweeps it
;; EXHAUSTIVELY rather than sampling: 4 commit shapes (live-QA ancestor or
;; not, subject claiming an expedite run or not) x 4 expedite-verdict states
;; (approving / bouncing / absent / unreadable) x 2 bounce states = 32 cases,
;; every one driven through a real `bash is_qa_ancestor.sh` in a real git
;; fixture. An exhaustive sweep needs no reachability floor argument: every
;; state IS reached, once, by construction.
;;
;; The expected outcome is derived from the CONSTITUTIONAL rules
;; (bounce vetoes everything; unknown is never approved; a verdict on file
;; from either gate approves; nothing else does) rather than from reading the
;; script - so agreeing with the implementation is a real result, not a
;; tautology.
;;
;; Non-vacuity proven at authoring time (2026-08-22), each break restored,
;; counts measured not estimated:
;;   - deleting the expedite-store block from is_qa_ancestor.sh -> P1 failed
;;     2 cases (the two approving, unvetoed, non-ancestor commit shapes);
;;   - relaxing the store's approving-verdict grep to match any verdict ->
;;     P2 failed 2 cases (the two bouncing, unvetoed, non-ancestor shapes);
;;   - dropping the unreadable-file guard (treating it as absent) -> 4
;;     failures, the fail-closed half.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

;; The REAL writer, so the sweep's records are the ones production writes -
;; never a hand-built JSON line that could agree with the reader while the
;; writer disagrees with both (architect bounce D1, 2026-08-22).
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def predicate (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "is_qa_ancestor.sh")))
(def failures (atom []))
(def root (str (fs/create-temp-dir {:prefix "bl1025-prop-"})))

(defn- g [& args]
  (let [{:keys [exit out err]}
        (apply process/sh {:dir root :continue true}
               "git" "-c" "user.email=t@t" "-c" "user.name=t" args)]
    (when-not (zero? exit)
      (throw (ex-info (str "git failed: " (str/join " " args) " - " err) {})))
    (str/trim (str out))))

(defn- commit! [file subject]
  (fs/create-dirs (fs/path root "specs" "pipeline" "steps"))
  (spit (str (fs/path root "specs" "pipeline" "steps" file)) (str subject "\n"))
  (g "add" "-A")
  (g "commit" "-q" "-m" subject)
  (g "rev-parse" "HEAD"))

;; ── the fixture: two lines of history, so "ancestor of swarmforge-QA" is a
;;    real property of the commit rather than something the test asserts ────
(g "init" "-q" "-b" "main")
(g "commit" "-q" "--allow-empty" "-m" "seed")
(def seed (g "rev-parse" "HEAD"))

;; The QA line - what a LIVE QA agent merging would produce.
(g "checkout" "-q" "-b" "swarmforge-QA" seed)
(def live-silent (commit! "live-silent.js" "ordinary work a live QA agent merged"))
(def live-claims (commit! "live-claims.js" "work that came from an expedite run, merged live"))

;; The offline line - what an expedite run produces: reachable from main,
;; never from swarmforge-QA.
(g "checkout" "-q" "main")
(def offline-silent (commit! "offline-silent.js" "ordinary expedite-run work"))
(def offline-claims (commit! "offline-claims.js" "BL-999: landed via an expedite run, approved by its QA hat"))

(def commit-shapes
  [{:label :offline-silent :sha offline-silent :live-qa? false :claims? false}
   {:label :offline-claims :sha offline-claims :live-qa? false :claims? true}
   {:label :live-silent    :sha live-silent    :live-qa? true  :claims? false}
   {:label :live-claims    :sha live-claims    :live-qa? true  :claims? true}])

(def expedite-states [:approving :bouncing :absent :unreadable])

(def store-dir (fs/path root ".swarmforge" "expedite-approvals"))
(def store-file (fs/path store-dir "2026-08.jsonl"))
(def bounce-dir (fs/path root ".swarmforge" "bounces"))
(def bounce-file (fs/path bounce-dir "2026-08.jsonl"))

(defn- set-expedite-store! [state sha]
  (fs/delete-tree store-dir)
  (when-not (= :absent state)
    (fs/create-dirs store-dir)
    ;; Written through the REAL writer, and cycling the REAL vocabulary, so
    ;; `forward` and `approved` ride this sweep too - the architect's D1 was
    ;; that only "pass" was ever exercised end to end (2026-08-22).
    (spit (str store-file)
          (str (json/generate-string
                (expedite-lib/qa-hat-verdict-record
                 {:stage "QA"
                  :verdict (if (= :bouncing state)
                             (first (sort (map name expedite-lib/bounce-verdicts)))
                             (nth (vec (sort (map name expedite-lib/advance-verdicts)))
                                  (mod (hash sha) (count expedite-lib/advance-verdicts))))
                  :ticket "BL-1025" :commit sha :at "2026-08-22T00:00:00Z"}))
               "\n"))
    (when (= :unreadable state)
      (fs/set-posix-file-permissions store-file "---------"))))

(defn- set-bounce-store! [bounced? sha]
  (fs/delete-tree bounce-dir)
  (when bounced?
    (fs/create-dirs bounce-dir)
    (spit (str bounce-file)
          (str "{\"at\":\"2026-08-22T00:00:00Z\",\"commit\":\"" (subs sha 0 10)
               "\",\"by\":\"QA\",\"role\":\"coder\",\"failure_class\":\"correctness\",\"ticket\":\"BL-1025\"}\n"))))

;; Derived from the constitutional rules, NOT from is_qa_ancestor.sh's text:
;;   a bounce verdict vetoes every approval route (BL-952);
;;   a store that cannot be consulted is undeterminable (invariant 3);
;;   an expedite QA-hat approval approves (BL-1025), as does live ancestry;
;;   nothing else does - and a commit's own SUBJECT is nothing (BL-972).
(defn- expected-exit [{:keys [live-qa?]} expedite-state bounced?]
  (cond
    bounced? :clean-no
    (= :unreadable expedite-state) :undeterminable
    (= :approving expedite-state) :approved
    live-qa? :approved
    :else :clean-no))

(defn- classify-exit [code]
  (case code 0 :approved 1 :clean-no :undeterminable))

(defn- run-predicate [sha]
  (:exit (process/sh {:dir root :continue true} "bash" predicate sha)))

(defn- report! [prop shape expedite-state bounced? expected actual]
  (swap! failures conj
         (str "FAIL " prop
              "\n  commit shape:  " (:label shape)
              "\n  expedite:      " expedite-state
              "\n  bounce on file:" bounced?
              "\n  expected:      " expected
              "\n  actual:        " actual)))

(def swept (atom 0))

(doseq [shape commit-shapes
        state expedite-states
        bounced? [false true]]
  (set-expedite-store! state (:sha shape))
  (set-bounce-store! bounced? (:sha shape))
  (swap! swept inc)
  (let [expected (expected-exit shape state bounced?)
        actual (classify-exit (run-predicate (:sha shape)))]
    ;; P1 - invariant 1: an expedite QA-hat approval, unvetoed, is never
    ;; reported. Stated as its own assertion rather than folded into the
    ;; table check, so a regression names the invariant it broke.
    (when (and (= :approving state) (not bounced?) (not= :approved actual))
      (report! "P1 (invariant 1: an expedite-approved commit is never reported)"
               shape state bounced? :approved actual))
    ;; P2 - invariant 2: nothing that passed no gate escapes the report.
    ;; Undeterminable counts as reported: the caller fails closed.
    (when (and (not= :approving state) (not (:live-qa? shape)) (= :approved actual))
      (report! "P2 (invariant 2: a commit no gate approved is still reported)"
               shape state bounced? "anything but :approved" actual))
    ;; And the whole table, so an unexpected outcome anywhere is caught even
    ;; when neither invariant's own clause covers it.
    (when (not= expected actual)
      (report! "P3 (the full outcome table)" shape state bounced? expected actual))))

;; Guard against a fixture that silently stopped exercising the space.
(when (not= 32 @swept)
  (swap! failures conj (str "FAIL coverage: expected an exhaustive 32-case sweep, ran " @swept)))

(fs/delete-tree root)

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1025 expedite-approval properties: " @swept " cases, exhaustive - ALL PROPERTIES HOLD")))
