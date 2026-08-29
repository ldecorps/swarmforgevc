#!/usr/bin/env bb
;; BL-1276: PROPERTY tests over task_scope_gate_lib.bb's declared-path
;; exemption (acceptance: and retires: alike), covering the three invariants
;; the ticket YAML declares
;; (coder-authored first, per BL-654).
;;
;;   P1 exactness - the exemption covers ONLY the exact path string the ticket
;;      declares. Every generated case pairs the declared path with a SIBLING
;;      path of the same foreign ticket (its backlog YAML, its how-to, another
;;      of its feature files), because that pairing is where the failure lives:
;;      an exemption keyed on the foreign TICKET rather than the PATH passes
;;      any case that carries only the declared path, and fails here. The
;;      sibling is constructed from the same ticket id as the declared path -
;;      never drawn independently and hoped to collide - so every generated
;;      case is a real exactness test by construction.
;;
;;   P2 derivation - the verdict is a function of the declared path and the
;;      changed paths, and of nothing else. Encoded by drawing the task id, the
;;      foreign id and the paths freely and asserting the finding set equals
;;      the one computed directly from the declaration: there is no pair table
;;      to consult and no id relation that grants anything.
;;
;;   P3 unreadable-grants-nothing - a nil declaration (the ticket could not be
;;      read) never exempts any path, however the paths are drawn, and the
;;      refusal message SAYS the exemption could not be evaluated. Invariant 1
;;      ("never refused with an outcome its recipient has no action available
;;      to satisfy") is what that message serves: without it the refusal reads
;;      as a plain entanglement and sends the coder off to rebuild.
;;
;; Reach floors are asserted at the end of each property, never hoped for.

(ns task-scope-gate-acceptance-exemption-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "task_scope_gate_lib.bb")))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (fail! (str msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def ^:private rng (java.util.Random. 20260829))
(defn- pick [coll] (nth coll (.nextInt rng (count coll))))
(defn- rand-id [] (str "BL-" (+ 1000 (.nextInt rng 300))))

(def NUM-RUNS 300)

;; The artifact shapes ticket-id-for-path positively identifies.
(defn- feature-path [id] (str "specs/features/" id "-contract.feature"))
(defn- other-feature-path [id] (str "specs/features/" id "-second.feature"))
(defn- yaml-path [id] (str "backlog/active/" id "-thing.yaml"))
(defn- howto-path [id] (str "docs/how-to/" id "-guide.md"))
(defn- code-path [] (str "extension/src/tools/thing" (.nextInt rng 99) ".ts"))

;; ── P1: exactness ───────────────────────────────────────────────────────
(let [saw-declared (atom 0)
      saw-sibling (atom 0)
      saw-retires (atom 0)]
  (dotimes [_ NUM-RUNS]
    (let [task-id (rand-id)
          foreign-id (loop [c (rand-id)] (if (= c task-id) (recur (rand-id)) c))
          declared-via (pick [:acceptance :retires])
          declared (feature-path foreign-id)
          ;; Constructed from the SAME foreign id as the declared path, so
          ;; every case tests exactness rather than sampling for it.
          sibling (pick [(yaml-path foreign-id) (howto-path foreign-id) (other-feature-path foreign-id)])
          include-sibling? (zero? (.nextInt rng 2))
          changed (cond-> [declared] include-sibling? (conj sibling))
          ;; BL-1276's amendment: the exemption is over the ticket's DECLARED
          ;; PATHS, whichever field declared them - so the property drives the
          ;; accessor with a real ticket yaml rather than a bare path, and both
          ;; declaring fields are drawn.
          ticket-yaml (if (= declared-via :acceptance)
                        (str "id: " task-id "\nacceptance: " declared "\n")
                        (str "id: " task-id "\nretires:\n  - " declared "\nstatus: todo\n"))
          declared-set (task-scope-gate-lib/declared-exempt-paths ticket-yaml)
          findings (task-scope-gate-lib/foreign-scope-findings task-id changed declared-set)]
      (when-not (= [declared] declared-set)
        (fail! (str "P1: the accessor did not read " declared-via "'s declaration: " (pr-str declared-set))))
      (swap! saw-declared inc)
      (when (= declared-via :retires) (swap! saw-retires inc))
      (if include-sibling?
        (do (swap! saw-sibling inc)
            (assert= (str "the declared path is exempt and its sibling " sibling " is not")
                     [{:path sibling :ticket-id foreign-id}]
                     findings))
        (assert= "the declared path alone leaves nothing foreign" [] findings))))
  (when-not (> @saw-sibling 80)
    (fail! (str "P1 reach floor: sibling-bearing cases drawn only " @saw-sibling " times")))
  (when-not (> (- @saw-declared @saw-sibling) 80)
    (fail! (str "P1 reach floor: declared-only cases drawn only " (- @saw-declared @saw-sibling) " times")))
  ;; Both declaring fields must actually be drawn, or the widening is untested
  ;; on the half that motivated it (BL-1251's retirement case).
  (when-not (> @saw-retires 80)
    (fail! (str "P1 reach floor: retires:-declared cases drawn only " @saw-retires " times")))
  (when-not (> (- @saw-declared @saw-retires) 80)
    (fail! (str "P1 reach floor: acceptance:-declared cases drawn only "
                (- @saw-declared @saw-retires) " times"))))

;; ── P2: derived from the declaration, never from an id relation ─────────
(let [saw-exempt (atom 0)
      saw-foreign (atom 0)]
  (dotimes [_ NUM-RUNS]
    (let [task-id (rand-id)
          foreign-id (loop [c (rand-id)] (if (= c task-id) (recur (rand-id)) c))
          declared (pick [[(feature-path foreign-id)] [(feature-path task-id)] []])
          changed (into [(code-path)]
                        (repeatedly (inc (.nextInt rng 3))
                                    #(pick [(feature-path foreign-id) (yaml-path foreign-id)
                                            (howto-path foreign-id) (yaml-path task-id)])))
          findings (task-scope-gate-lib/foreign-scope-findings task-id changed declared)
          expected (vec (for [p changed
                              :let [id (task-scope-gate-lib/ticket-id-for-path p)]
                              :when (and id (not= id task-id) (not (contains? (set declared) p)))]
                          {:path p :ticket-id id}))]
      (if (seq findings) (swap! saw-foreign inc) (swap! saw-exempt inc))
      (assert= (str "the verdict is exactly the declaration-derived one for " (pr-str changed)
                    " declared=" (pr-str declared))
               expected findings)))
  (when-not (> @saw-foreign 100)
    (fail! (str "P2 reach floor: refusing cases drawn only " @saw-foreign " times")))
  (when-not (> @saw-exempt 20)
    (fail! (str "P2 reach floor: fully-clean cases drawn only " @saw-exempt " times"))))

;; ── P3: an unreadable declaration grants nothing, and says so ───────────
(let [saw (atom 0)]
  (dotimes [_ NUM-RUNS]
    (let [task-id (rand-id)
          foreign-id (loop [c (rand-id)] (if (= c task-id) (recur (rand-id)) c))
          changed [(feature-path foreign-id)]
          ;; An unreadable ticket yields NO declared paths at all - the
          ;; accessor is handed nil exactly as findings-for-git-handoff does.
          findings (task-scope-gate-lib/foreign-scope-findings
                    task-id changed (task-scope-gate-lib/declared-exempt-paths nil))
          message (task-scope-gate-lib/refusal-message
                   {:task-name task-id :findings findings :acceptance-unreadable? true})]
      (swap! saw inc)
      (assert= "a nil declaration exempts nothing"
               [{:path (feature-path foreign-id) :ticket-id foreign-id}] findings)
      (when-not (str/includes? message "declared-path exemption could not be evaluated")
        (fail! (str "P3: the refusal does not say the exemption was unevaluable: " message)))
      (when-not (str/includes? message task-id)
        (fail! (str "P3: the refusal does not name the task: " message)))))
  (when-not (= @saw NUM-RUNS)
    (fail! (str "P3 reach floor: only " @saw " cases ran"))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: task_scope_gate_lib.bb acceptance-exemption properties"))
