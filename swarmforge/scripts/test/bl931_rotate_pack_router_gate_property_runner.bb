#!/usr/bin/env bb
;; BL-931 (BL-654 Invariants): PROPERTY tests over the pack-router gate,
;; encoding the ticket's three declared invariants:
;;
;;   P1 one-resolution (invariant 1): "Whether a pack is a rotation router
;;      is resolved ONE way, shared by every gate that asks (swarm-identity
;;      rotation key, else the persisted active pack conf, else the default
;;      conf). No pack may ever read as router for one gate and non-router
;;      for another." Generates arbitrary identity-text/conf-path/conf-text
;;      combinations and asserts mono-router-lib/resolve-rotation-router-mode?
;;      agrees with an independently hand-rolled ORACLE implementing that
;;      exact stated precedence - not the same code path, a second
;;      description of the same contract, so a precedence-order bug in the
;;      real implementation shows up as disagreement rather than passing by
;;      construction.
;;
;;   P2 result-map-always (invariant 2): "rotate-resident-to! never throws
;;      and never exits the process. Every outcome, refusal included, is a
;;      result map the caller reads." Generates arbitrary target-role
;;      strings against arbitrary fixture states (router or not, roles.tsv
;;      present or not, launch script present or not) and asserts the real
;;      function never throws and always returns a map carrying a boolean
;;      :ok key.
;;
;;   P3 gate-is-conservative (invariant 3): "The change may only turn
;;      proceed into refuse, and only when the pack is not a rotation
;;      router." Generates arbitrary ROUTER-pack fixtures (any of the three
;;      resolution branches) and asserts the pack gate itself never fires
;;      for them - the returned reason, when refused, is never
;;      "not-a-rotation-router". (The complementary "downstream success is
;;      unchanged" half is a process/IO fact about a real tmux respawn, not
;;      a property of pure resolution logic - covered instead by
;;      test_rotate_pack_router_gate.sh scenarios 02/02b/05, which rotate a
;;      real fixture and assert the exact same respawn-pane call the
;;      pre-gate code would have made. Same split BL-926's own property
;;      runner documents for its own third invariant.)
;;
;; Generator-reach: conf/identity text is built from the SAME vocabulary the
;; real parsers match (`config rotation router`, `rotation\trouter` TSV
;; lines) rather than free-form strings, so every generated "router" case is
;; a genuine router conf/identity by construction, never diluted by strings
;; the parser would reject before the property is even exercised.
;;
;; Non-vacuity proven by hand at authoring time (all restored before this
;; commit):
;;   - P1 failed immediately when resolve-rotation-router-mode?'s conf-path
;;     fallback was reordered to try the DEFAULT conf before the
;;     identity-recorded path (the oracle's precedence stayed correct, the
;;     mutant's did not, on any case where the two confs disagreed).
;;   - P2 failed when rotate-resident-to!'s outer try/catch was removed -
;;     a fixture with an unreadable roles.tsv (a directory in its place)
;;     threw straight through instead of returning {:ok false :reason ...}.
;;   - P3 failed when the gate check was moved to run only when
;;     roles.tsv was ALSO present (a plausible-looking refactor) - a
;;     genuinely router-pack fixture with no roles.tsv yet (a legitimate
;;     early-boot state) started returning "not-a-rotation-router" even
;;     though the pack itself was a router pack.

(ns bl931-rotate-pack-router-gate-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(zero? n) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 41]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-bl931-prop-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── P1: resolve-rotation-router-mode? matches an independently stated oracle ──

(defn- oracle-router? [{:keys [identity-router? identity-names-alt-conf? alt-conf-router? default-conf-router?]}]
  (cond
    identity-router? true
    (and identity-names-alt-conf? alt-conf-router?) true
    identity-names-alt-conf? false ;; identity names an alt conf, and THAT conf decides - default is never consulted
    default-conf-router? true
    :else false))

(defn- gen-p1-scenario [s]
  (let [[identity-router? s1] (gen-bool s)
        [identity-names-alt-conf? s2] (gen-bool s1)
        [alt-conf-router? s3] (gen-bool s2)
        [default-conf-router? s4] (gen-bool s3)
        [identity-present? s5] (gen-bool s4)]
    [{:identity-router? identity-router?
      :identity-names-alt-conf? identity-names-alt-conf?
      :alt-conf-router? alt-conf-router?
      :default-conf-router? default-conf-router?
      ;; when identity-router?/identity-names-alt-conf? are both false, an
      ;; ABSENT identity file and a PRESENT-but-silent one must agree
      ;; (invariant 1's "falls through" case either way) - covered by
      ;; toggling identity-present? independently in that sub-case.
      :identity-present? (or identity-router? identity-names-alt-conf? identity-present?)}
     s5]))

(check-all "P1 one-resolution: resolve-rotation-router-mode? matches the stated precedence oracle"
  gen-p1-scenario
  (fn [{:keys [identity-router? identity-names-alt-conf? alt-conf-router? default-conf-router? identity-present?] :as scenario}]
    (let [root (mk-tmp-dir)
          state-dir (fs/path root ".swarmforge")
          default-conf (str (fs/path root "swarmforge" "swarmforge.conf"))
          alt-conf (str (fs/path root "swarmforge" "packs" "alt.conf"))]
      (fs/create-dirs state-dir)
      (fs/create-dirs (fs/path root "swarmforge" "packs"))
      (spit default-conf (if default-conf-router? "config rotation router\n" "window coder claude coder\n"))
      (spit alt-conf (if alt-conf-router? "config rotation router\n" "window coder claude coder\n"))
      (when identity-present?
        (spit (str (fs/path state-dir "swarm-identity"))
              (str (when identity-router? "rotation\trouter\n")
                   (when identity-names-alt-conf? (str "active_backlog_max_depth_conf_path\t" alt-conf "\n")))))
      (let [expected (oracle-router? scenario)
            actual (mono-router-lib/resolve-rotation-router-mode? (str state-dir) default-conf)]
        (if (= expected actual)
          true
          (str "expected " expected " got " actual))))))

;; ── P2: rotate-resident-to! never throws, always a result map ────────────

(def role-name-pool ["coder" "cleaner" "architect" "hardender" "documenter" "QA" "" "unknown-role"])

(defn- gen-p2-scenario [s]
  (let [[role s1] (gen-pick s role-name-pool)
        [router? s2] (gen-bool s1)
        [has-roles-tsv? s3] (gen-bool s2)
        [has-launch-script? s4] (gen-bool s3)
        [has-tmux-socket? s5] (gen-bool s4)]
    [{:role role :router? router? :has-roles-tsv? has-roles-tsv? :has-launch-script? has-launch-script? :has-tmux-socket? has-tmux-socket?} s5]))

;; A scenario with router?/has-roles-tsv?/has-launch-script?/has-tmux-socket?
;; ALL true reaches wait-for-delivery! (a real 30s poll when the target
;; role's inbox is empty) - unrelated to what P2 tests (never throws), and
;; expensive across 300 runs. A dummy parcel is always seeded for the drawn
;; role's own worktree whenever roles.tsv is written, so any run that DOES
;; reach that poll returns immediately - same seeding idiom the real
;; fixture shell tests already use for this exact reason.
(check-all "P2 result-map-always: rotate-resident-to! never throws, always returns a map with a boolean :ok"
  gen-p2-scenario
  (fn [{:keys [role router? has-roles-tsv? has-launch-script? has-tmux-socket?]}]
    (let [root (mk-tmp-dir)
          role-wt (fs/path root "role-wt")]
      (fs/create-dirs (fs/path root ".swarmforge" "launch"))
      (when router?
        (fs/create-dirs (fs/path root "swarmforge"))
        (spit (str (fs/path root "swarmforge" "swarmforge.conf")) "config rotation router\n"))
      (when has-roles-tsv?
        (fs/create-dirs (fs/path role-wt ".swarmforge" "handoffs" "inbox" "new"))
        (spit (str (fs/path role-wt ".swarmforge" "handoffs" "inbox" "new" "00_seed.handoff"))
              "id: seed\nfrom: x\nto: y\npriority: 50\ntype: note\nmessage: seed\n")
        (spit (str (fs/path root ".swarmforge" "roles.tsv"))
              (str "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n"
                   role "\trole-wt\t" role-wt "\tswarmforge-" role "\t" role "\tclaude\ttask\n")))
      (when has-launch-script?
        (spit (str (fs/path root ".swarmforge" "launch" (str role ".sh"))) "#!/bin/sh\nexit 0\n"))
      (when has-tmux-socket?
        (spit (str (fs/path root ".swarmforge" "tmux-socket")) (str (fs/path root "fake.sock"))))
      (handoff-lib/set-project-root! root)
      (try
        (let [result (handoff-lib/rotate-resident-to! role)]
          (cond
            (not (map? result)) (str "expected a map, got: " (pr-str result))
            (not (contains? result :ok)) (str "expected an :ok key, got: " (pr-str result))
            (not (boolean? (:ok result))) (str "expected :ok to be a boolean, got: " (pr-str (:ok result)))
            :else true))
        (catch Throwable t
          (str "rotate-resident-to! THREW instead of returning a result map: " (.getMessage t)))))))

;; ── P3: the gate never fires on a genuine router pack ─────────────────────

(defn- gen-p3-router-scenario [s]
  (let [[role s1] (gen-pick s role-name-pool)
        [branch s2] (gen-int s1 3)]
    [{:role role :branch (nth [:default-conf :identity-flag :identity-alt-conf] branch)} s2]))

(check-all "P3 gate-is-conservative: a genuine router pack never gets the not-a-rotation-router refusal"
  gen-p3-router-scenario
  (fn [{:keys [role branch]}]
    (let [root (mk-tmp-dir)]
      (fs/create-dirs (fs/path root ".swarmforge"))
      (case branch
        :default-conf
        (do (fs/create-dirs (fs/path root "swarmforge"))
            (spit (str (fs/path root "swarmforge" "swarmforge.conf")) "config rotation router\n"))
        :identity-flag
        (spit (str (fs/path root ".swarmforge" "swarm-identity")) "rotation\trouter\n")
        :identity-alt-conf
        (let [alt-conf (str (fs/path root "swarmforge" "packs" "alt.conf"))]
          (fs/create-dirs (fs/path root "swarmforge" "packs"))
          (spit alt-conf "config rotation router\n")
          (spit (str (fs/path root ".swarmforge" "swarm-identity"))
                (str "active_backlog_max_depth_conf_path\t" alt-conf "\n"))))
      (handoff-lib/set-project-root! root)
      (let [result (handoff-lib/rotate-resident-to! role)]
        (if (= "not-a-rotation-router" (:reason result))
          (str "the pack gate fired on a genuine router pack (branch " branch "): " (pr-str result))
          true)))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl931 rotate pack-router gate properties: " runs " runs each (P1/P2/P3)"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
