#!/usr/bin/env bb
;; BL-1069 property test (coder-authored, THREE declared invariants) over the
;; landed tmux hotfix.
;;
;;   Invariant 1: a version judgement about the control plane is read from the
;;   live server on the swarm socket, never from whatever `tmux -V` finds on
;;   PATH. The swarm never reports as healthy a plane running a binary it did
;;   not measure.
;;   Invariant 2: preferring a tmux binary never lowers the version the swarm
;;   would otherwise have used.
;;   Invariant 3: a stability knob the running tmux rejects never fails an
;;   ensure, a launch, or a plane restore.
;;
;; WHY PROPERTIES AND NOT MORE FIXTURES. All three quantify over "every
;; version pairing this host could present". The shell suite pins the five
;; rows the feature names; what only a generator covers is the pairing nobody
;; wrote down - and the two that matter most are near misses, not extremes.
;;
;; Every case drives the REAL functions out of swarmforge.sh under `zsh -f`
;; (no rc files: ~/.zshenv on this host re-exports real provider credentials
;; over fixture values, and a launcher probe leaked a live key that way on
;; 2026-08-22). The tmux they call is a `#!/bin/sh` fake on PATH answering the
;; version the case is about; no real tmux server is ever started, and nothing
;; here prints an environment dump.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Three states a naive generator would essentially never produce:
;;
;;   (a) THE INCIDENT PAIRING. A client that is ALREADY fine in front of a
;;       server that is not is the exact state the crash loop lives in, and
;;       the state in which the landed client-side check was silent. Drawing
;;       client and server independently from a wide range makes it rare, so
;;       the pairs are drawn from an explicit version set and the
;;       client-newer-than-server shape carries its own floor.
;;   (b) A DOWNGRADE CANDIDATE. Invariant 2 can only fail when the local build
;;       is OLDER than the one already on PATH. Drawn independently that is
;;       half the cases in principle and far fewer once "absent" and "none"
;;       rows are in the mix, so it is floored explicitly.
;;   (c) THE NEAR MISSES that a plausible-but-wrong comparison gets wrong:
;;       3.7 against 3.7b (a lettered release is LATER, not older), and 3.10
;;       against 3.9 (numeric, where a lexical compare says the opposite).
;;       Both are in the version set by construction, and both are floored.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break applied,
;; run, and reverted:
;;   - warn_if_tmux_too_old reading `tmux -V` (the landed behaviour) ... P1
;;   - prefer_local_tmux_bin prepending unconditionally (ditto) ........ P2
;;   - tmux_version_key comparing raw strings instead of padded fields .. P1/P2 (3.10 vs 3.9)
;;   - harden_tmux_server dropping its `|| true` ....................... P3
;;   - harden-server! propagating a non-zero set-option exit ........... P3
;;
;; ONE THING THE BREAKS DISPROVED, recorded rather than quietly dropped.
;; Review goal 3 asks whether `:continue true` is the real seam on the bb
;; side. It is NOT: removing it from harden-server! changes nothing, because
;; `babashka.process/sh` does not throw on a non-zero exit with or without it
;; (checked directly - `(p/sh "sh" "-c" "exit 3")` returns {:exit 3};
;; `p/shell` is the one that throws). Invariant 3 holds on that path because
;; of the runner it uses, not because of that flag, so the break above is the
;; one that actually bites: a harden-server! that PROPAGATED the failure. The
;; shell side is different - there `|| true` is the real seam, and dropping
;; it fails P3 immediately.

(ns bl1069-tmux-version-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (fs/parent test-dir))
(def repo-root (str (fs/parent (fs/parent scripts-dir))))
(def swarmforge-sh (str (fs/path scripts-dir "swarmforge.sh")))
(def control-plane-lib (str (fs/path scripts-dir "control_plane_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(defn make-rng [seed]
  (let [state (atom seed)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

;; The set is small and deliberate rather than wide: every entry is either a
;; version this incident actually involved or a near miss that a
;; plausible-but-wrong comparison gets wrong.
(def versions ["3.4" "3.6" "3.7" "3.7b" "3.9" "3.10" "4.0"])
(def safe-floor "3.7")

;; The oracle, computed here rather than read back from the code under test:
;; padded numeric fields, then the letter suffix.
(defn version-key [v]
  (let [[_ major minor suffix] (re-find #"^(\d+)\.(\d+)([a-z]*)$" (str v))]
    (when major
      (format "%03d.%03d.%s" (parse-long major) (parse-long minor) (or suffix "")))))

(defn version-lt? [a b]
  (let [ka (version-key a) kb (version-key b)]
    (and ka kb (neg? (compare ka kb)))))

(def temp-root (fs/create-temp-dir {:prefix "bl1069-property-"}))
;; BL-971: removed on EVERY exit path, not only when the last assertion passes.
(.addShutdownHook (Runtime/getRuntime) (Thread. #(fs/delete-tree temp-root)))

(defn write-exec! [path content]
  (fs/create-dirs (fs/parent path))
  (spit (str path) content)
  (fs/set-posix-file-permissions (str path) "rwxr-xr-x"))

;; `#!/bin/sh` by absolute path and shell builtins only - the preference cases
;; narrow PATH to almost nothing, and a fake needing `env` or `bash` found on
;; PATH would fail for a reason the property is not about.
(defn fake-tmux [client server]
  (str "#!/bin/sh\n"
       "if [ \"${1:-}\" = \"-V\" ]; then\n"
       "  echo \"tmux " client "\"\n"
       "  exit 0\n"
       "fi\n"
       "if [ \"${3:-}\" = \"display-message\" ]; then\n"
       (if (= "none" server) "  exit 1\n" (str "  echo \"" server "\"\n  exit 0\n"))
       "fi\n"
       "exit 0\n"))

(defn rejecting-tmux [rejected]
  (str "#!/bin/sh\n"
       "for arg in \"$@\"; do\n"
       "  case \"$arg\" in\n"
       (if (seq rejected) (str "    " (str/join "|" rejected) ")\n      exit 1\n      ;;\n") "")
       "  esac\n"
       "done\n"
       "exit 0\n"))

(defn zsh-sourced [snippet env]
  (let [result (process/sh {:out :string :err :string
                            :env (merge (into {} (System/getenv)) env)}
                           "zsh" "-f" "-c"
                           (str "source '" swarmforge-sh "' '" repo-root "' >/dev/null 2>&1 || true\n" snippet))]
    (str (:out result) (:err result))))

;; ── P1: the verdict is the SERVER's, and a client can never rescue it ─────

;; ONE generator per loop, advanced across every run - NOT a fresh one
;; seeded per run index. A fresh LCG seeded `base + i*stride` returns a
;; near-constant FIRST draw for a small modulus (this is what BL-1057's and
;; BL-991's own property runners hit and fixed this same day): `client`
;; here is the very first draw of this loop's rng, so a per-run reseed
;; would pin it near-constant across all 40 runs even though the aggregate
;; warned/silent floors still pass - exactly the kind of per-position gap
;; an aggregate floor cannot see.
(def rng-p1 (make-rng 4409))

(doseq [run-index (range runs)]
  (let [rng rng-p1
        client (versions (rng (count versions)))
        server (if (zero? (rng 5)) "none" (versions (rng (count versions))))
        root (str (fs/path temp-root (str "p1-" run-index)))
        bin (str (fs/path root "bin"))
        _ (write-exec! (fs/path bin "tmux") (fake-tmux client server))
        output (zsh-sourced "warn_if_tmux_too_old '/fake/swarm/socket'"
                            {"PATH" (str bin ":" (System/getenv "PATH"))})
        warned? (str/includes? output "WARN")
        measured (if (= "none" server) client server)
        expected-warn? (version-lt? measured safe-floor)
        where (str "run " run-index " client=" client " server=" server)]

    (when (and (not= "none" server) (version-lt? server safe-floor) (not (version-lt? client safe-floor)))
      (bump! :incident-pairing))
    (when (= "none" server) (bump! (keyword (str "no-server-client-" client))))
    (when (and (= "3.7b" measured)) (bump! :near-miss-letter))
    (when (contains? #{"3.10" "3.9"} measured) (bump! :near-miss-numeric))
    (bump! (if warned? :warned :silent))

    (check! (str where ": expected " (if expected-warn? "a warning" "silence")
                 " for the measured version " measured ", got " (if warned? "a warning" "silence"))
            (= expected-warn? warned?))

    ;; The invariant's own words: never reported as healthy on the strength of
    ;; a binary it did not measure. With a server answering, the client cannot
    ;; buy silence.
    (when (and (not= "none" server) (version-lt? server safe-floor))
      (check! (str where ": a below-floor SERVER was silent behind a client of " client)
              warned?)
      (check! (str where ": the warning does not say which side it measured")
              (str/includes? output "the control-plane server"))
      (check! (str where ": the warning does not quote the SERVER version it measured")
              (str/includes? output (str "tmux " server ",")))
      ;; Only meaningful when the two differ - with client = server the one
      ;; string is both, and asserting its absence would fail a correct run.
      (when (not= client server)
        (check! (str where ": the warning quotes " client ", the client it did not measure")
                (not (str/includes? output (str "tmux " client ","))))))))

;; ── P2: preferring never lowers the version in use ───────────────────────

;; Same fix, same reason - one generator advanced across this loop's own 40
;; runs, not reseeded per run index.
(def rng-p2 (make-rng 8821))

(doseq [run-index (range runs)]
  (let [rng rng-p2
        local (if (zero? (rng 6)) "absent" (versions (rng (count versions))))
        on-path (if (zero? (rng 6)) "none" (versions (rng (count versions))))
        root (str (fs/path temp-root (str "p2-" run-index)))
        home (str (fs/path root "home"))
        path-bin (str (fs/path root "path-bin"))
        sandbox (str (fs/path root "sandbox-bin"))
        local-tmux (str (fs/path home ".local" "bin" "tmux"))
        path-tmux (str (fs/path path-bin "tmux"))
        where (str "run " run-index " local=" local " path=" on-path)]
    (fs/create-dirs sandbox)
    (fs/create-dirs path-bin)
    (fs/create-sym-link (fs/path sandbox "sed") (str/trim (:out (process/sh {:out :string} "sh" "-c" "command -v sed"))))
    (when-not (= "absent" local) (write-exec! local-tmux (fake-tmux local "none")))
    (when-not (= "none" on-path) (write-exec! path-tmux (fake-tmux on-path "none")))

    (when (and (not= "absent" local) (not= "none" on-path) (version-lt? local on-path))
      (bump! :downgrade-candidate))

    (let [resolved (str/trim (zsh-sourced (str "PATH='" path-bin ":" sandbox "'\n"
                                               "prefer_local_tmux_bin\n"
                                               "command -v tmux 2>/dev/null || echo NONE")
                                          {"HOME" home}))
          chosen-version (cond
                           (= resolved local-tmux) local
                           (= resolved path-tmux) on-path
                           :else "none")]
      (bump! (keyword (str "chose-" (cond (= resolved local-tmux) "local"
                                          (= resolved path-tmux) "path"
                                          :else "none"))))
      ;; The invariant, stated exactly: whatever the swarm ends up launching
      ;; with is never OLDER than what it would have used without preferring.
      (when (not= "none" on-path)
        (check! (str where ": preferring lowered the version in use to " chosen-version)
                (not (version-lt? chosen-version on-path))))
      ;; And it does not throw away a genuine upgrade either - a preference
      ;; that never preferred anything would satisfy the line above trivially.
      (when (and (not= "absent" local) (version-lt? on-path local))
        (check! (str where ": a genuine upgrade at ~/.local/bin was not preferred (resolved " resolved ")")
                (= resolved local-tmux))))))

;; ── P3: a rejected stability knob never fails the caller ─────────────────

(def option-sets [[] ["focus-events"] ["window-size"] ["focus-events" "window-size"]])

(doseq [run-index (range (count option-sets))]
  (let [rejected (option-sets run-index)
        root (str (fs/path temp-root (str "p3-" run-index)))
        bin (str (fs/path root "bin"))
        where (str "rejecting " (if (seq rejected) (str/join "+" rejected) "nothing"))]
    (write-exec! (fs/path bin "tmux") (rejecting-tmux rejected))
    (bump! :harden-case)

    (let [shell-out (zsh-sourced (str "set -e\nTMUX_SOCKET='/fake/swarm/socket'\nharden_tmux_server\necho SURVIVED")
                                 {"PATH" (str bin ":" (System/getenv "PATH"))})]
      (check! (str where ": the launcher's hardening aborted its caller: " shell-out)
              (str/includes? shell-out "SURVIVED")))

    (let [result (process/sh {:out :string :err :string
                              :continue true
                              :env (assoc (into {} (System/getenv))
                                          "PATH" (str bin ":" (System/getenv "PATH")))}
                             "bb" "-e"
                             (str "(load-file \"" control-plane-lib "\") "
                                  "(control-plane-lib/harden-server! \"/fake/swarm/socket\") "
                                  "(println \"SURVIVED\")"))]
      (check! (str where ": control_plane_lib's hardening failed the ensure: "
                   (:out result) (:err result))
              (and (zero? (:exit result)) (str/includes? (str (:out result)) "SURVIVED"))))))

;; ── reach, asserted rather than hoped for ────────────────────────────────

(defn floor! [k min-count]
  (let [seen (get @reached k 0)]
    (when (< seen min-count)
      (fail! (str "generator reach: " k " was produced " seen " times, needed >= " min-count
                  ". A property that never reaches a state proves nothing about it.")))))

(floor! :incident-pairing 3)
(floor! :near-miss-letter 3)
(floor! :near-miss-numeric 3)
(floor! :warned 8)
(floor! :silent 8)
(floor! :downgrade-candidate 5)
(floor! :chose-local 5)
(floor! :chose-path 5)
(floor! :harden-case 4)

(if (empty? @failures)
  (println (str "bl1069_tmux_version_property (BL-1069): ALL " runs " RUNS PASSED " (pr-str @reached)))
  (do (println (str "bl1069_tmux_version_property (BL-1069): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
