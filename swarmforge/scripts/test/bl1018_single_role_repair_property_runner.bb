#!/usr/bin/env bb
;; BL-1018 property tests (coder-authored, declared invariants) over the pure
;; resolver in single_role_repair_lib.bb.
;;
;;   Invariant 1: "A single-role repair resolves to commands that name exactly
;;   one target session on the pack's own socket: no resolved command can
;;   affect another role's session, and none is ever a kill-server or a
;;   kill-session."
;;
;;   Invariant 2: "Resolution is total over session state: for both a present
;;   and a missing session the resolver returns a defined, safe command set -
;;   it never falls through to a default-socket or untargeted command."
;;
;; P1 asserts invariant 1 over every generated input: the socket prefix is
;; exact, the ONLY session-shaped token in each command is this role's own,
;; and neither kill verb appears anywhere.
;;
;; The sibling-session generator is the part that matters. A session name is
;; not drawn independently from the one under repair - it is DERIVED from it
;; (`<session>2`, `<session>-old`, and the bare role name), because the
;; failure this invariant guards is a repair reaching a session whose name
;; merely resembles its target. Independent draws would collide essentially
;; never and the property would pass while blind to exactly its own subject.
;;
;; P2 asserts invariant 2 over both session states: :ok, a non-empty command
;; set, and no command missing its `-S <socket>`. Refusals are generated too
;; (blank socket/session/launch), where the total-ness demanded is the other
;; kind: a DEFINED refusal and NO commands, never a half-built one.
;;
;; Non-vacuity proven at authoring time (2026-08-22), each break restored,
;; counts MEASURED not estimated (seed 20260822, 400 runs):
;;   - dropping "-S" from tmux-cmd -> 234 P-failures (every non-refusal draw,
;;     on both P1's target check and P2's socket check);
;;   - resolving a missing session to create-then-respawn (the incident's own
;;     shape) -> 123 P3 failures, exactly the missing-session draws;
;;   - letting a refusal return the command it would have built -> 65 P2
;;     failures, the refusal half.
;;
;; Hardening 2026-08-22: the original P3 launch-carried check was a bare
;; substring match, which cannot see a broken shell escape - a launch-script
;; containing an apostrophe (the :quoted-launch generator case) no longer
;; appears as a literal substring once correctly escaped, and unescaped it
;; still "contained" the substring while producing invalid shell syntax
;; (confirmed live: `sh -c "echo zsh '<path-with-apostrophe>'"` exits 2,
;; "unexpected EOF looking for matching ''"). The coverage counter was
;; incrementing on every quoted-launch draw while nothing asserted the
;; result was actually valid shell. Replaced with a real `sh -c` round-trip
;; (launch-arg/shell-round-trips? below); confirmed this newly written check
;; itself fails against the pre-fix resolver (28/400 failures at this seed)
;; and passes once single_role_repair_lib.bb escapes embedded quotes via
;; shell-quote-single.

(ns bl1018-single-role-repair-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "single_role_repair_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {:missing 0 :present 0 :no-env 0 :with-env 0 :refusal 0 :quoted-launch 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(zero? i) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth coll i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def roles ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA" "coder@sonnet2"])
(def sockets ["/tmp/pack.sock" "/private/var/folders/x y/T/s.sock" "/tmp/3752320954"])
(def launches ["/repo/.swarmforge/launch/r.sh" "/repo/a b/launch/r.sh" "/repo/it's/launch/r.sh"])

(defn- gen-case [s]
  (let [[role s1] (gen-pick s roles)
        [socket s2] (gen-pick s1 sockets)
        [launch s3] (gen-pick s2 launches)
        [present? s4] (gen-bool s3)
        [with-env? s5] (gen-bool s4)
        ;; ~1 in 8 draws is a refusal case, so the refusal half of invariant 2
        ;; is exercised by the same sweep rather than by a separate one.
        [refusal s6] (gen-int s5 8)
        session (str "swarmforge-" role)]
    [{:role role :socket socket :launch-script launch :session session
      :session-present? present?
      :env-args (when with-env? ["-e" "OPENROUTER_API_KEY=k" "-e" "GEMINI_API_KEY=g"])
      ;; DERIVED from the session under repair, never drawn independently:
      ;; every sibling here is a name a prefix/glob bug would conflate with it.
      :siblings [(str session "2") (str session "-old") role]
      :refusal (case refusal 0 :socket 1 :session 2 :launch nil)}
     s6]))

(defn- resolve-case [{:keys [socket session launch-script env-args session-present? refusal]}]
  (single-role-repair-lib/resolve-single-role-repair
   {:socket (if (= :socket refusal) "  " socket)
    :session (if (= :session refusal) "" session)
    :launch-script (if (= :launch refusal) nil launch-script)
    :env-args env-args
    :session-present? session-present?}))

(defn- session-shaped-tokens [cmd]
  (filterv #(str/starts-with? (str %) "swarmforge-") cmd))

;; The resolver always emits exactly one trailing argument shaped
;; "zsh <shell-quoted-launch-script>". A raw substring check for the
;; launch-script text CANNOT survive the escaping a quote-containing path
;; legitimately requires (a launch-script with an apostrophe no longer
;; appears as a literal substring once correctly escaped) - so the only
;; assertion that actually proves the launch survives is running the quoted
;; argument through a REAL shell and checking what comes back out.
(defn- launch-arg [cmd]
  (let [last-arg (str (last cmd))]
    (when (str/starts-with? last-arg "zsh ")
      (subs last-arg (count "zsh ")))))

(defn- shell-round-trips? [quoted-arg expected]
  (let [{:keys [exit out]} (process/sh {:continue true} "sh" "-c" (str "printf '%s' " quoted-arg))]
    (and (zero? exit) (= expected out))))

(loop [i 0 s 20260822]
  (when (< i runs)
    (let [[c s'] (gen-case s)
          {:keys [status commands]} (resolve-case c)]
      (if (:refusal c)
        (do
          (swap! coverage update :refusal inc)
          ;; Invariant 2, refusal half: a DEFINED outcome and NO commands -
          ;; never a half-built command with a hole where the socket goes.
          (when (= :ok status)
            (report! "P2 (invariant 2: a refusal is defined, never :ok)" s c (str "status " status)))
          (when (seq commands)
            (report! "P2 (invariant 2: a refusal resolves to NO commands)" s c (pr-str commands))))
        (do
          (swap! coverage update (if (:session-present? c) :present :missing) inc)
          (swap! coverage update (if (:env-args c) :with-env :no-env) inc)
          (when (str/includes? (:launch-script c) "'") (swap! coverage update :quoted-launch inc))

          ;; ── P2: invariant 2 - total, defined, socket-bearing ───────────
          (when (not= :ok status)
            (report! "P2 (invariant 2: resolution is total over session state)" s c (str "status " status)))
          (when-not (seq commands)
            (report! "P2 (invariant 2: a defined command set, never empty)" s c "no commands"))
          (doseq [cmd commands]
            (when-not (= ["tmux" "-S" (:socket c)] (vec (take 3 cmd)))
              (report! "P2 (invariant 2: never a default-socket command)" s c (pr-str cmd))))

          ;; ── P1: invariant 1 - exactly one target, never a kill verb ─────
          (doseq [cmd commands]
            (when-not (= [(:session c)] (session-shaped-tokens cmd))
              (report! "P1 (invariant 1: exactly one session named, this role's own)" s c (pr-str cmd)))
            (doseq [sib (:siblings c)]
              (when (some #(= (str sib) (str %)) cmd)
                (report! "P1 (invariant 1: no command may name another role's session)" s c
                         (str "names sibling " sib " in " (pr-str cmd)))))
            (when (some #{"kill-server"} cmd)
              (report! "P1 (invariant 1: never a kill-server)" s c (pr-str cmd)))
            (when (some #{"kill-session"} cmd)
              (report! "P1 (invariant 1: never a kill-session)" s c (pr-str cmd))))

          ;; ── P3: the branch shapes the two scenarios pin ─────────────────
          (if (:session-present? c)
            (do
              (when (some #(some #{"new-session"} %) commands)
                (report! "P3 (a session that exists is never created again)" s c (pr-str commands)))
              (when-not (some #(some #{"respawn-pane"} %) commands)
                (report! "P3 (a present session is respawned in place)" s c (pr-str commands))))
            (do
              ;; The incident's own shape: create, then respawn into it.
              (when (some #(some #{"respawn-pane"} %) commands)
                (report! "P3 (a missing session is never respawned into - BL-958)" s c (pr-str commands)))
              (when-not (some #(some #{"new-session"} %) commands)
                (report! "P3 (a missing session is created)" s c (pr-str commands)))
              (when-not (some (fn [cmd]
                                 (when-let [q (launch-arg cmd)]
                                   (shell-round-trips? q (:launch-script c))))
                               commands)
                (report! "P3 (the create carries the launch script AND it survives a real shell round-trip - a raw substring match cannot see a broken escape)" s c (pr-str commands)))))))
      (recur (inc i) s'))))

;; Reachability floor, asserted rather than hoped for: a generator that
;; stopped producing one of these shapes would let its property pass blind.
;; `quoted-launch` is here because a launch path containing an apostrophe is
;; the one input that can break the shell quoting the resolver builds.
(doseq [[k floor] {:missing 100 :present 100 :no-env 100 :with-env 100 :refusal 30 :quoted-launch 30}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1018 single-role-repair properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
