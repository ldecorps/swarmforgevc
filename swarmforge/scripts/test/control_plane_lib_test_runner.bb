#!/usr/bin/env bb
;; TDD runner for control_plane_lib.bb (BL-958): the single home for
;; control-plane-loss classify / persist-incident / response-policy logic.
(ns control-plane-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "control_plane_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── classify ────────────────────────────────────────────────────────────────
;; The BL-958 fingerprint: a normal stop (kill_pipeline_swarm.sh) removes BOTH
;; the tmux-socket file and sessions.tsv, so "socket file present + role
;; metadata present + server not responding" is abnormal by construction.

(assert= "server responding is :up regardless of metadata"
         :up
         (control-plane-lib/classify {:socket-file-exists? true
                                      :server-responds? true
                                      :role-metadata-present? true}))
(assert= "the live 2026-08-19 shape classifies control-plane-missing"
         :control-plane-missing
         (control-plane-lib/classify {:socket-file-exists? true
                                      :server-responds? false
                                      :role-metadata-present? true}))
(assert= "no socket file at all is an ordinary stopped swarm"
         :down
         (control-plane-lib/classify {:socket-file-exists? false
                                      :server-responds? false
                                      :role-metadata-present? false}))
(assert= "socket file gone but metadata left is still :down (normal stop clears both; half-cleaned is not the loss shape)"
         :down
         (control-plane-lib/classify {:socket-file-exists? false
                                      :server-responds? false
                                      :role-metadata-present? true}))
(assert= "socket file present but metadata cleaned is :down, not a loss"
         :down
         (control-plane-lib/classify {:socket-file-exists? true
                                      :server-responds? false
                                      :role-metadata-present? false}))
(assert= "classification token is fixed by the acceptance contract"
         "control-plane-missing"
         control-plane-lib/classification-token)

;; ── incident build + record (exactly one OPEN incident per loss) ────────────

(def sample-incident
  (control-plane-lib/build-incident
   {:socket-path "/p/.swarmforge/tmux/1.sock"
    :probe-output "no server running on /p/.swarmforge/tmux/1.sock"
    :expected-sessions ["swarmforge-coder" "swarmforge-QA"]
    :observed-at "2026-08-19T18:00:00Z"
    :source "handoffd-chase"}))

(assert= "incident carries the fixed classification token"
         "control-plane-missing" (:classification sample-incident))
(assert-true "incident names socket path, probe result, expected sessions"
             (and (= "/p/.swarmforge/tmux/1.sock" (:socket-path sample-incident))
                  (str/includes? (:probe-output sample-incident) "no server running")
                  (= ["swarmforge-coder" "swarmforge-QA"] (:expected-sessions sample-incident))))
(assert= "a freshly built incident is open" "open" (:status sample-incident))

(let [{:keys [incidents recorded?]} (control-plane-lib/record-incident [] sample-incident)]
  (assert-true "first record for a loss is recorded" recorded?)
  (assert= "store holds exactly one incident" 1 (count incidents))
  (let [{re-incidents :incidents re-recorded? :recorded?}
        (control-plane-lib/record-incident incidents sample-incident)]
    (assert-true "second record for the same open loss is refused" (not re-recorded?))
    (assert= "store still holds exactly one incident" 1 (count re-incidents))))

(let [resolved (control-plane-lib/resolve-incidents [sample-incident] "2026-08-19T19:00:00Z")
      {:keys [incidents recorded?]} (control-plane-lib/record-incident resolved sample-incident)]
  (assert= "resolving stamps status and resolved-at"
           ["resolved" "2026-08-19T19:00:00Z"]
           [(:status (first resolved)) (:resolved-at (first resolved))])
  (assert-true "a NEW loss after resolution records a second incident" recorded?)
  (assert= "one resolved + one open" 2 (count incidents)))

;; ── response policy: exactly one deterministic owner action ─────────────────
;; babysitterd owns the response: operator-runtime was itself down in the live
;; incident (a possible casualty of the same shape), while pane liveness is
;; babysitterd's whole job.

(let [recover (control-plane-lib/response-policy {:incident sample-incident
                                                  :launch-scripts-present? true})]
  (assert= "recover branch owner" "babysitterd" (:owner recover))
  (assert= "recover branch action" :recover (:action recover))
  (assert-true "recover branch names a concrete command"
               (not (str/blank? (str (:command recover)))))
  (assert-true "recover branch carries the reason"
               (str/includes? (str (:reason recover)) "/p/.swarmforge/tmux/1.sock"))
  (assert= "policy is deterministic: same input, same decision"
           recover
           (control-plane-lib/response-policy {:incident sample-incident
                                               :launch-scripts-present? true})))

(let [escalate (control-plane-lib/response-policy {:incident sample-incident
                                                   :launch-scripts-present? false})]
  (assert= "escalate branch owner" "babysitterd" (:owner escalate))
  (assert= "escalate branch action" :escalate (:action escalate))
  (assert-true "escalate branch carries reason AND next action"
               (and (not (str/blank? (str (:reason escalate))))
                    (not (str/blank? (str (:next-action escalate)))))))

;; ── recovery decision for ./swarm ensure ────────────────────────────────────

(assert= "healthy control plane needs no recovery decision"
         :none
         (:action (control-plane-lib/recovery-decision
                   {:classification :up :launch-scripts-present? true})))
(assert= "loss with launch scripts on disk decides relaunch"
         :relaunch-roles
         (:action (control-plane-lib/recovery-decision
                   {:classification :control-plane-missing :launch-scripts-present? true})))
(let [halt (control-plane-lib/recovery-decision
            {:classification :control-plane-missing :launch-scripts-present? false})]
  (assert= "loss with no launch scripts decides halt" :halt (:action halt))
  (assert-true "halt carries a reason" (not (str/blank? (str (:reason halt))))))

;; ── status agents view: never per-role DOWN from stale metadata ─────────────

(def stale-rows
  [{:name "coder" :status :down :detail "session=swarmforge-coder"}
   {:name "QA" :status :down :detail "session=swarmforge-QA"}])

(let [view (control-plane-lib/status-agents-view
            {:classification :control-plane-missing
             :agent-rows stale-rows
             :socket-path "/p/.swarmforge/tmux/1.sock"})]
  (assert= "loss collapses agents to a single control-plane row" 1 (count view))
  (assert= "the row is named control-plane" "control-plane" (:name (first view)))
  (assert= "the row status carries the classification"
           :control-plane-missing (:status (first view)))
  (assert-true "the row detail names the socket"
               (str/includes? (str (:detail (first view))) "/p/.swarmforge/tmux/1.sock"))
  (assert-true "no per-role row survives"
               (not-any? #(contains? #{"coder" "QA"} (:name %)) view)))

(assert= "healthy classification passes rows through untouched"
         stale-rows
         (control-plane-lib/status-agents-view
          {:classification :up :agent-rows stale-rows :socket-path "/p/x.sock"}))

;; ── persistence round-trip over a fixture dir ───────────────────────────────

(let [dir (fs/create-temp-dir {:prefix "cpl-test-"})]
  (try
    (let [state-dir (fs/path dir ".swarmforge")
          path (control-plane-lib/incidents-file state-dir)]
      (assert= "reading a missing store is empty" [] (control-plane-lib/read-incidents path))
      (let [first-write (control-plane-lib/persist-incident! path sample-incident)]
        (assert-true "first persist records" (:recorded? first-write)))
      (let [second-write (control-plane-lib/persist-incident! path sample-incident)]
        (assert-true "second persist for the same open loss is refused"
                     (not (:recorded? second-write))))
      (assert= "store on disk holds exactly one incident"
               1 (count (control-plane-lib/read-incidents path)))
      (control-plane-lib/resolve-open-incidents! path "2026-08-19T19:00:00Z")
      (assert-true "resolve-open-incidents! closes the open incident"
                   (every? #(= "resolved" (:status %))
                           (control-plane-lib/read-incidents path)))
      ;; corrupt store degrades to empty, never throws (three-way gate posture)
      (spit (str path) "{not json")
      (assert= "corrupt store reads as empty" [] (control-plane-lib/read-incidents path)))
    (finally
      (fs/delete-tree dir))))

;; ── control-plane-facts / observe! (BL-958 cleaner pass) ─────────────────────
;; The fact map used to be hand-copied into swarm_status.bb, swarm_ensure.bb
;; and record-chase-failure-incident!. These pin the ONE definition, so a
;; consumer that stops agreeing with it fails here rather than silently
;; misclassifying a live loss. Fixture dir removed in a `finally`
;; (engineering.prompt's mkdtemp rule).

(let [dir (fs/create-temp-dir {:prefix "cp-facts-"})]
  (try
    (let [state-dir (fs/path dir ".swarmforge")]
      (fs/create-dirs state-dir)
      (assert= "an empty state dir sees neither socket file nor role metadata"
               {:socket-file-exists? false :server-responds? false :role-metadata-present? false}
               (control-plane-lib/control-plane-facts state-dir false))
      (spit (str (fs/path state-dir "tmux-socket")) "")
      (assert-true "the tmux-socket file is what socket-file-exists? reads"
                   (:socket-file-exists? (control-plane-lib/control-plane-facts state-dir false)))
      (assert-true "roles.tsv alone counts as role metadata"
                   (do (spit (str (fs/path state-dir "roles.tsv")) "coder\t0")
                       (:role-metadata-present? (control-plane-lib/control-plane-facts state-dir false))))
      (fs/delete (fs/path state-dir "roles.tsv"))
      (assert-true "sessions.tsv alone also counts as role metadata"
                   (do (spit (str (fs/path state-dir "sessions.tsv")) "coder")
                       (:role-metadata-present? (control-plane-lib/control-plane-facts state-dir false))))
      (assert-true "server-responds? is passed straight through, not re-probed"
                   (:server-responds? (control-plane-lib/control-plane-facts state-dir true)))
      ;; observe! composes probe + facts + classify. A blank socket cannot have
      ;; a server answering, so this is the loss shape with the artifacts present.
      (assert= "observe! classifies the live loss shape through the shared facts"
               :control-plane-missing
               (:classification (control-plane-lib/observe! state-dir "")))
      (assert-true "observe! returns the probe result its callers need for evidence"
                   (some? (:probe (control-plane-lib/observe! state-dir ""))))
      ;; BL-1071 × BL-1102: spawn-failed probe must not classify as missing plane.
      (with-redefs [control-plane-lib/probe-server!
                    (fn [_] {:responds? false
                             :output "Cannot run program \"tmux\""
                             :spawn-failed? true})]
        (let [obs (control-plane-lib/observe! state-dir (str (fs/path state-dir "tmux-socket")))]
          (assert= "spawn-failed observe! is :unavailable, never :control-plane-missing"
                   :unavailable (:classification obs))
          (assert-true "spawn-failed observe! carries :error for the UNAVAILABLE line"
                       (seq (str (:error obs))))))
      (with-redefs [control-plane-lib/probe-server!
                    (fn [_] {:responds? false :output "" :spawn-failed? true})]
        (assert= "blank spawn-failed output falls back to a named error"
                 "tmux spawn failed"
                 (:error (control-plane-lib/observe! state-dir (str (fs/path state-dir "tmux-socket")))))))
    (finally
      (fs/delete-tree dir))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str (count @failures) " failure(s)"))
  (System/exit 1))
(println "control_plane_lib_test_runner: ok")
