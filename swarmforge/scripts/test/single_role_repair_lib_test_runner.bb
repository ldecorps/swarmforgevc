#!/usr/bin/env bb
;; BL-1018 TDD runner for single_role_repair_lib.bb - the pure resolution a
;; single-role repair is allowed to produce.
;;
;; The incident this pins: 2026-08-21 ~08:26 UTC, an operator single-role
;; respawn of the specifier (create session, THEN respawn-pane into it) took
;; down the entire pack tmux server - socket 3752320954, handoffd with it. The
;; root mechanism never got an audit trail; BL-958's hazard class (a respawn
;; issued against a missing session can restart a half-alive tmux server) is
;; the leading hypothesis. The value of constraining the resolution does not
;; depend on that hypothesis being right.
;;
;; Every assertion here is about what the resolver RETURNS. No tmux runs.

(ns single-role-repair-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "single_role_repair_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))

(def socket "/tmp/pack.sock")
(def launch "/repo/.swarmforge/launch/specifier.sh")
(def session "swarmforge-specifier")
(def env-args ["-e" "OPENROUTER_API_KEY=k"])

(defn- resolve-for [present?]
  (single-role-repair-lib/resolve-single-role-repair
   {:socket socket :role "specifier" :session session
    :launch-script launch :env-args env-args :session-present? present?}))

;; ── scenario 01: a missing session is CREATED, never respawned into ───────
(let [{:keys [status commands]} (resolve-for false)]
  (assert= "01: a missing session resolves cleanly" :ok status)
  (assert= "01: exactly one command - the create carries the launch, so nothing follows it into a session that did not exist"
           1 (count commands))
  (assert-true "01: the one command is a new-session"
               (some #{"new-session"} (first commands)))
  (assert-true "01: the create carries the role's launch script, so the pane is not left on a bare shell"
               (some #(str/includes? (str %) launch) (first commands)))
  (assert-true "01: the create carries the provider env args a repair must not strip (BL-130)"
               (str/includes? (str/join " " (first commands)) "OPENROUTER_API_KEY=k"))
  (assert= "01: NO respawn-pane is resolved against a missing session - the BL-958 hazard"
           0 (count (filter #(some #{"respawn-pane"} %) commands))))

;; ── scenario 02: an existing session is respawned IN PLACE ────────────────
(let [{:keys [status commands]} (resolve-for true)]
  (assert= "02: a present session resolves cleanly" :ok status)
  (assert= "02: exactly one command" 1 (count commands))
  (assert-true "02: the one command is a respawn-pane"
               (some #{"respawn-pane"} (first commands)))
  (assert= "02: NO new-session is resolved for a session that already exists"
           0 (count (filter #(some #{"new-session"} %) commands))))

;; ── scenario 03: nothing can reach beyond its own target ──────────────────
(doseq [present? [false true]]
  (let [{:keys [commands]} (resolve-for present?)
        label (if present? "present" "missing")]
    (doseq [cmd commands]
      (assert-true (str "03 (" label "): every command names the pack socket explicitly - a command that inherits the default socket can reach a server nobody intended to touch")
                   (= ["tmux" "-S" socket] (take 3 cmd)))
      (assert-true (str "03 (" label "): every command names this role's own session and no other")
                   (= [session] (filter #(str/starts-with? (str %) "swarmforge-") cmd)))
      (assert= (str "03 (" label "): no command is a kill-server - the assertion that would have caught the incident")
               0 (count (filter #{"kill-server"} cmd)))
      (assert= (str "03 (" label "): no command is a kill-session")
               0 (count (filter #{"kill-session"} cmd))))))

;; ── invariant 2: resolution is TOTAL over session state ──────────────────
;; Neither branch may fall through to nil, to an empty command set, or to a
;; command missing its socket. Asserted as its own case rather than inferred
;; from the two scenarios above, because "total" is the property, not "these
;; two inputs happened to work".
(doseq [present? [false true]]
  (let [{:keys [status commands]} (resolve-for present?)]
    (assert= (str "invariant 2 (" present? "): a defined status") :ok status)
    (assert-true (str "invariant 2 (" present? "): a non-empty command set") (seq commands))
    (assert-true (str "invariant 2 (" present? "): no command omits -S <socket>")
                 (every? #(= "-S" (second %)) commands))))

;; ── refusals: a repair with nothing safe to resolve resolves to NOTHING ───
;; Not to a best-effort command with a hole in it. An untargeted or
;; default-socket command is the failure mode this whole slice exists to
;; remove, so a missing input must never produce one.
(doseq [[label bad] [["no socket" {:socket nil}]
                     ["blank socket" {:socket "   "}]
                     ["no session name" {:session nil}]
                     ["blank session name" {:session ""}]
                     ["no launch script" {:launch-script nil}]]]
  (let [{:keys [status commands]}
        (single-role-repair-lib/resolve-single-role-repair
         (merge {:socket socket :role "specifier" :session session
                 :launch-script launch :env-args env-args :session-present? false}
                bad))]
    (assert-true (str "refusal (" label "): status is a refusal, never :ok") (not= :ok status))
    (assert= (str "refusal (" label "): resolves to NO commands at all") [] (vec commands))))

;; ── scenario 04: a launch script containing an apostrophe still resolves to
;; valid shell syntax (hardening 2026-08-22) ───────────────────────────────
;; A launch-script path is filesystem-backed and cannot assume it never
;; contains an apostrophe (a macOS home directory like /Users/O'Brien/... is
;; a real shape, not a hypothetical). Wrapped in single quotes without
;; escaping, this exact string breaks: confirmed live,
;; `sh -c "echo zsh '/repo/it's/launch/r.sh'"` exits 2 ("unexpected EOF
;; looking for matching ''"). A substring check on the raw launch-script text
;; cannot see this - it still "contains" the path either way - so this
;; asserts by running the resolved argument through a REAL shell and reading
;; back what comes out, not by inspecting the string.
(let [tricky-launch "/repo/it's/launch/r.sh"
      {:keys [status commands]}
      (single-role-repair-lib/resolve-single-role-repair
       {:socket socket :role "specifier" :session session
        :launch-script tricky-launch :env-args env-args :session-present? false})]
  (assert= "04: resolves cleanly even with an apostrophe in the launch path" :ok status)
  (let [last-arg (str (last (first commands)))
        quoted (when (str/starts-with? last-arg "zsh ") (subs last-arg (count "zsh ")))
        {:keys [exit out]} (when quoted (process/sh {:continue true} "sh" "-c" (str "printf '%s' " quoted)))]
    (assert-true "04: the resolved command carries a quoted launch argument" (some? quoted))
    (assert= "04: the quoted argument is valid POSIX shell syntax (round-trips through a real shell)"
             0 exit)
    (assert= "04: the recovered path exactly matches the original launch-script - the apostrophe survived escaping intact"
             tricky-launch out)))

;; ── env args are optional, never a crash ─────────────────────────────────
(let [{:keys [status commands]}
      (single-role-repair-lib/resolve-single-role-repair
       {:socket socket :role "specifier" :session session :launch-script launch :session-present? true})]
  (assert= "absent env args resolve fine - a fixture that wires none is not a failure" :ok status)
  (assert= "still exactly one command" 1 (count commands)))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: single_role_repair_lib.bb"))
