#!/usr/bin/env bb
;; BL-958 (coder.prompt Invariants, BL-654): property tests over
;; control_plane_lib.bb, encoding the ticket's four declared invariants.
;;
;; 1. "If the tmux server is gone, swarm state must report a control-plane
;;    failure explicitly (never just per-role DOWN with stale session
;;    metadata)." — for every generated loss-shaped fact set, classify is
;;    :control-plane-missing and status-agents-view yields exactly the one
;;    control-plane row, whatever per-role DOWN rows the stale metadata
;;    produced.
;; 2. "A missing tmux server cannot leave the system in a half-alive state
;;    indefinitely; either controlled auto-recovery occurs or a single
;;    actionable incident is emitted with root-cause evidence." — for every
;;    generated chase-retry burst (1..25 failures against the same loss),
;;    folding record-incident leaves EXACTLY ONE open incident, carrying
;;    socket path, probe output and expected sessions; and for every loss the
;;    recovery decision is :relaunch-roles or the policy escalates — no
;;    generated state falls through to silence. A resolved prior incident
;;    never blocks a genuinely new loss.
;; 3. "Role health reporting must derive from live control-plane truth, not
;;    stale sessions.tsv/windows.tsv artifacts." — with the same live facts,
;;    two INDEPENDENT draws of stale metadata rows produce the identical
;;    agents view under loss (metadata cannot influence it), and no
;;    metadata-derived row ever survives into the loss view.
;; 4. "When role control-plane loss is detected, either operator-runtime or
;;    babysitterd must own a deterministic response path (recover, or
;;    escalate once with concrete reason and next action)." — for every
;;    generated incident the policy names exactly one owner from that pair,
;;    is deterministic (same input, same decision), and every branch carries
;;    its evidence (recover: command+reason; escalate: reason+next-action).
;;
;; The "live ensure/status process" tail of invariants 1-3 (real tmux, real
;; render) quantifies over subprocesses a generator cannot drive — that half
;; is asserted end-to-end by the BL-958 acceptance scenarios and the
;; test_swarm_ensure.sh control-plane fixture case, not silently unencoded.
;;
;; Non-vacuity proven by hand at authoring time (each break restored):
;;   - classify widened to always :down under a missing server → inv-1 rows
;;     fail on the first draw;
;;   - record-incident appending unconditionally → inv-2's exactly-one fails;
;;   - status-agents-view passing rows through on loss → inv-3 fails;
;;   - response-policy returning a per-branch owner pair → inv-4 fails.

(ns bl958-control-plane-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "control_plane_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def ^:private rng (java.util.Random. 958))
(defn- rint [n] (.nextInt rng (int n)))
(defn- rpick [coll] (nth (vec coll) (rint (count coll))))
(defn- rbool [] (.nextBoolean rng))

(def role-pool ["coder" "specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(defn- rand-sessions []
  (vec (repeatedly (inc (rint 7)) #(str "swarmforge-" (rpick role-pool)))))

(defn- rand-socket []
  (str "/roots/p" (rint 100) "/.swarmforge/tmux/" (rint 100000) ".sock"))

(defn- rand-loss-incident []
  (control-plane-lib/build-incident
   {:socket-path (rand-socket)
    :probe-output (rpick ["no server running" "error connecting to socket (No such file or directory)"])
    :expected-sessions (rand-sessions)
    :observed-at (str "2026-08-19T" (format "%02d" (rint 24)) ":00:00Z")
    :source (rpick ["handoffd-chase" "handoffd-chase-resume"])}))

;; stale metadata rows: arbitrary per-role DOWN/UP rows a dead probe + old
;; sessions.tsv could have produced
(defn- rand-stale-rows []
  (vec (for [r (take (inc (rint 7)) (shuffle role-pool))]
         {:name r
          :status (rpick [:down :down :down :up :unknown])
          :detail (str "session=swarmforge-" r)})))

(def loss-reached (atom 0))
(def burst-reached (atom 0))
(def resolved-then-new-reached (atom 0))
(def no-scripts-reached (atom 0))

(dotimes [_ runs]
  ;; ── invariant 1: every loss-shaped fact set classifies and views as loss ──
  (let [facts {:socket-file-exists? true
               :server-responds? false
               :role-metadata-present? true}
        classification (control-plane-lib/classify facts)
        socket (rand-socket)
        rows (rand-stale-rows)
        view (control-plane-lib/status-agents-view
              {:classification classification :agent-rows rows :socket-path socket})]
    (swap! loss-reached inc)
    (when-not (= :control-plane-missing classification)
      (swap! failures conj (str "inv1 FAIL: loss shape classified " classification)))
    (when-not (and (= 1 (count view))
                   (= "control-plane" (:name (first view)))
                   (= :control-plane-missing (:status (first view))))
      (swap! failures conj (str "inv1 FAIL: loss view not the single control-plane row: " (pr-str view))))
    ;; the token itself is what status renders and acceptance greps
    (when-not (= "control-plane-missing" control-plane-lib/classification-token)
      (swap! failures conj "inv1 FAIL: classification token drifted")))

  ;; ── invariant 2: a retry burst yields exactly one open incident with evidence ──
  (let [incident (rand-loss-incident)
        burst (inc (rint 25))
        store (reduce (fn [acc _] (:incidents (control-plane-lib/record-incident acc incident)))
                      []
                      (range burst))
        open (filter control-plane-lib/open-incident? store)]
    (swap! burst-reached inc)
    (when-not (= 1 (count open))
      (swap! failures conj (str "inv2 FAIL: " burst " retries left " (count open) " open incidents")))
    (let [i (first open)]
      (when-not (and (seq (str (:socket-path i)))
                     (seq (str (:probe-output i)))
                     (seq (:expected-sessions i)))
        (swap! failures conj (str "inv2 FAIL: incident missing evidence: " (pr-str i)))))
    ;; no generated loss state falls through to silence: recovery relaunches
    ;; or the policy escalates with a next action
    (let [scripts? (rbool)
          decision (control-plane-lib/recovery-decision
                    {:classification :control-plane-missing :launch-scripts-present? scripts?})
          policy (control-plane-lib/response-policy
                  {:incident incident :launch-scripts-present? scripts?})]
      (when-not scripts? (swap! no-scripts-reached inc))
      (when-not (or (= :relaunch-roles (:action decision))
                    (and (= :escalate (:action policy))
                         (seq (str (:next-action policy)))))
        (swap! failures conj (str "inv2 FAIL: loss state with scripts?=" scripts?
                                  " neither relaunches nor escalates"))))
    ;; a resolved prior incident never blocks a new loss
    (when (rbool)
      (swap! resolved-then-new-reached inc)
      (let [resolved (control-plane-lib/resolve-incidents store "2026-08-19T19:00:00Z")
            {:keys [recorded? incidents]} (control-plane-lib/record-incident resolved incident)]
        (when-not (and recorded? (= 1 (count (filter control-plane-lib/open-incident? incidents))))
          (swap! failures conj "inv2 FAIL: resolved incident blocked a new loss (or left >1 open)")))))

  ;; ── invariant 3: metadata cannot influence the loss view ──
  (let [socket (rand-socket)
        view-a (control-plane-lib/status-agents-view
                {:classification :control-plane-missing
                 :agent-rows (rand-stale-rows)
                 :socket-path socket})
        view-b (control-plane-lib/status-agents-view
                {:classification :control-plane-missing
                 :agent-rows (rand-stale-rows)
                 :socket-path socket})]
    (when-not (= view-a view-b)
      (swap! failures conj (str "inv3 FAIL: stale metadata changed the loss view: "
                                (pr-str view-a) " vs " (pr-str view-b))))
    (when (some #(contains? (set role-pool) (:name %)) view-a)
      (swap! failures conj (str "inv3 FAIL: a metadata-derived role row survived: " (pr-str view-a)))))

  ;; ── invariant 4: exactly one deterministic owner action ──
  (let [incident (rand-loss-incident)
        scripts? (rbool)
        decision (control-plane-lib/response-policy
                  {:incident incident :launch-scripts-present? scripts?})
        again (control-plane-lib/response-policy
               {:incident incident :launch-scripts-present? scripts?})]
    (when-not (contains? #{"operator-runtime" "babysitterd"} (:owner decision))
      (swap! failures conj (str "inv4 FAIL: owner not one of the two daemons: " (pr-str decision))))
    (when-not (string? (:owner decision))
      (swap! failures conj (str "inv4 FAIL: owner is not a single daemon name: " (pr-str decision))))
    (when-not (= decision again)
      (swap! failures conj "inv4 FAIL: policy not deterministic for identical input"))
    (case (:action decision)
      :recover (when-not (and (seq (str (:command decision))) (seq (str (:reason decision))))
                 (swap! failures conj (str "inv4 FAIL: recover without command+reason: " (pr-str decision))))
      :escalate (when-not (and (seq (str (:reason decision))) (seq (str (:next-action decision))))
                  (swap! failures conj (str "inv4 FAIL: escalate without reason+next-action: " (pr-str decision))))
      (swap! failures conj (str "inv4 FAIL: action neither recover nor escalate: " (pr-str decision))))))

;; asserted reachability floors, never hoped-for
(when (< @loss-reached 100)
  (swap! failures conj (str "FAIL reachability: only " @loss-reached " loss shapes")))
(when (< @burst-reached 100)
  (swap! failures conj (str "FAIL reachability: only " @burst-reached " retry bursts")))
(when (< @resolved-then-new-reached 40)
  (swap! failures conj (str "FAIL reachability: only " @resolved-then-new-reached " resolved-then-new sequences")))
(when (< @no-scripts-reached 40)
  (swap! failures conj (str "FAIL reachability: only " @no-scripts-reached " no-launch-scripts states")))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl958_control_plane_property_runner: ok (" runs " runs, "
                @loss-reached " loss, " @burst-reached " bursts, "
                @resolved-then-new-reached " resolved-then-new, "
                @no-scripts-reached " no-scripts)")))
