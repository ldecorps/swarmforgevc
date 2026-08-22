#!/usr/bin/env bb
;; BL-1049 property test (coder-authored, three DECLARED invariants) over the
;; provider half of harness_env_scrub_lib.bb and its shell twin.
;;
;;   Invariant 1: "The launcher process's own environment keeps every provider
;;   secret. Only the tmux SERVER's global environment is narrowed."
;;
;;   Invariant 2: "A name the running configuration needs is never removed."
;;
;;   Invariant 3: "The Babashka lib and its shell twin name the same set."
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Three states matter and none is reliably reached by drawing values:
;;
;;   Invariant 2's real content is a COLLISION: a secret that a configured
;;   backend reads. Drawing a backend set and a secret INDEPENDENTLY makes a
;;   collision rare - fourteen of the fifteen secrets miss any single-backend
;;   configuration - so a property drawn that way passes almost entirely on
;;   pairs where the claim is vacuous. Here the secret is DERIVED from the
;;   drawn backend (P2a picks it out of that backend's own needs), so every
;;   generated pair is a collision candidate by construction. The independent
;;   draw is kept as P2b, which is the non-collision half of the same claim.
;;
;;   The fail-open states - an EMPTY backend set (no conf readable) and an
;;   UNKNOWN backend name (a provider the map does not mention) - are the two
;;   the derived keep-list is most likely to get wrong, and both are rare
;;   under a uniform draw over eight known names. They are injected at a
;;   fixed rate and their reach is floored.
;;
;;   Invariant 1's subject is a real PROCESS environment, not a list, so P1b
;;   runs the actual shell function in a real bash and reads back what
;;   survived. A pure set-intersection check (P1a) cannot see a `unset` added
;;   to the wrong function; only running it can.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored:
;;   - add RESEND_API_KEY to HARNESS_ENV_SCRUB_VARS (the launcher list) ... P1a, P1b
;;   - drop the keep-list from provider-scrub-vars ....................... P2a, P3c
;;   - return the full set for an EMPTY backend set ...................... P2c
;;   - treat an unknown backend as needing nothing ....................... P2d
;;   - remove DEEPSEEK_API_KEY from the shell twin's list only ........... P3a
;;   - drop MISTRAL_API_KEY from the shell twin's `vibe)` row only ....... P3b, P3c
;;   - restore the zsh word-splitting bug (`for b in $backends`) ......... P3c (zsh arm only)

(ns bl1049-provider-env-scrub-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.set :as set]
            [clojure.string :as str]))

(def scripts-dir (fs/parent (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "harness_env_scrub_lib.bb")))
(alias 'lib 'harness-env-scrub-lib)

(def sh-path (str (fs/path scripts-dir "harness_env_scrub.sh")))
(def sh-body (slurp sh-path))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 240))
;; Properties that fork a real bash run at a lower count on purpose: each is a
;; process, and the claim is about behaviour that does not vary with volume.
(def shell-runs (or (some-> (System/getenv "PROPERTY_SHELL_RUNS") parse-long) 24))

(def failures (atom []))
(def coverage (atom {:empty-backends 0 :unknown-backend 0 :known-only 0
                     :needs-nothing 0 :needs-something 0
                     :collision-pair 0 :independent-pair 0
                     :shell-scrubbed 0 :shell-kept 0}))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(def known-backends (vec (sort (keys lib/backend-provider-vars))))
(def all-secrets (vec (sort lib/provider-secret-vars)))
;; Names no backend map mentions - a provider added to a conf before this map
;; learns about it, which is exactly the shape invariant 2 must survive.
(def unknown-backends ["qwen-next" "llama" "some-future-backend"])

;; ── the shell twin, read as data ──────────────────────────────────────────

(defn- sh-secret-names []
  (let [block (second (re-find #"(?s)HARNESS_ENV_PROVIDER_SECRET_VARS=\(\n(.*?)\n\)" sh-body))]
    (if block
      (set (remove str/blank? (map str/trim (str/split-lines block))))
      ::missing)))

(defn- sh-backend-names [backend]
  (let [m (re-find (re-pattern (str "(?m)^\\s*" backend "\\)\\s+printf '%s\\\\n'\\s*(.*?)\\s*;;\\s*$")) sh-body)]
    (if m
      (set (remove str/blank? (str/split (str/trim (second m)) #"\s+")))
      ::missing)))

;; BOTH shells, not just bash. swarmforge.sh - the live launcher - is a zsh
;; script, and zsh does not word-split an unquoted parameter, so a twin that
;; agrees with the lib under bash can still fail open under the shell that
;; actually runs it. That is not hypothetical: it is what this file's first
;; implementation did, caught only by running the real swarmforge.sh.
(def shells (filterv #(zero? (:exit (p/shell {:out :string :err :string :continue true}
                                             "sh" "-c" (str "command -v " %))))
                     ["bash" "zsh"]))

(defn- sh-scrub-list
  "What the REAL shell twin would remove for a conf declaring `backends`,
   under one shell. Runs harness_env_provider_scrub_vars the way ./swarm does."
  [shell backends tmpdir]
  (let [conf (str (fs/path tmpdir "swarmforge.conf"))]
    (spit conf (str/join "\n" (map-indexed (fn [i b] (str "window role" i " " b " wt" i)) backends)))
    (let [{:keys [out]} (p/shell {:out :string :err :string :continue true
                                  :extra-env {"SWARMFORGE_ENV_SCRUB_CONF" conf
                                              "CONFIG_FILE" "" "SWARMFORGE_CONFIG" ""
                                              "SWARMFORGE_OPENROUTER_ROLES" ""}}
                                 shell "-c"
                                 (str "source '" sh-path "'; harness_env_provider_scrub_vars"))]
      (set (remove str/blank? (str/split-lines (or out "")))))))

(def tmp-root (fs/create-temp-dir {:prefix "bl1049-property-"}))

(try
  ;; ═══ P3a/P3b: the two files name the same set, quantified over the UNION ═
  ;; Quantified over the union in BOTH directions on purpose: a name added to
  ;; one side only is the silent hole invariant 3 names, and a one-directional
  ;; check misses exactly half of them.
  (let [bb-names lib/provider-secret-vars
        sh-names (sh-secret-names)]
    (if (= ::missing sh-names)
      (report! "P3a (invariant 3: the shell twin declares a provider-secret list at all)" 0 sh-path
               "HARNESS_ENV_PROVIDER_SECRET_VARS=( ... ) not found")
      (doseq [n (sort (set/union bb-names (if (set? sh-names) sh-names #{})))]
        (when (not= (contains? bb-names n) (contains? sh-names n))
          (report! "P3a (invariant 3: a name one side scrubs, the other scrubs)" 0 n
                   (str "lib=" (contains? bb-names n) " shell=" (contains? sh-names n)))))))

  ;; The union of both sides' KEYS, so a row present in only one file is
  ;; caught from whichever side declared it.
  (doseq [b (sort (set/union (set known-backends)
                             (set (map second (re-seq #"(?m)^\s*(\w+)\)\s+printf '%s\\n'" sh-body)))))]
    (let [bb-set (get lib/backend-provider-vars b ::missing)
          sh-set (sh-backend-names b)]
      (when (not= bb-set sh-set)
        (report! "P3b (invariant 3: the backend->names map agrees on every row)" 0 b
                 (str "lib=" (pr-str bb-set) " shell=" (pr-str sh-set))))))

  ;; ═══ P1a: no provider secret is on the LAUNCHER-process scrub list ═══════
  (let [overlap (set/intersection lib/scrub-vars lib/provider-secret-vars)]
    (when (seq overlap)
      (report! "P1a (invariant 1: the launcher-process list holds no provider secret)" 0 overlap
               "the two scrubs must stay separate lists - handoffd forks from the launcher and reads RESEND_API_KEY")))
  (let [sh-launcher-block (second (re-find #"(?s)HARNESS_ENV_SCRUB_VARS=\(\n(.*?)\n\)" sh-body))
        sh-launcher (set (remove str/blank? (map str/trim (str/split-lines (or sh-launcher-block "")))))
        overlap (set/intersection sh-launcher lib/provider-secret-vars)]
    (when (seq overlap)
      (report! "P1a (invariant 1: the shell twin's launcher list holds no provider secret)" 0 overlap
               "scrub_harness_env unsets these in the launcher process itself")))

  ;; ═══ P1b: run the REAL launcher scrub and read back what survived ════════
  (loop [i 0 s 10491]
    (when (< i shell-runs)
      (let [[n s1] (gen-int s (count all-secrets))
            [off s2] (gen-int s1 (count all-secrets))
            picked (mapv #(nth all-secrets (mod (+ off %) (count all-secrets))) (range (inc n)))
            env (into {"CLAUDE_CODE_CHILD_SESSION" "marker-should-go"}
                      (map (fn [k] [k (str "bl1049-placeholder-" k)])) picked)
            {:keys [out]} (p/shell {:out :string :err :string :continue true :extra-env env}
                                   "bash" "-c"
                                   (str "source '" sh-path "'; scrub_harness_env; "
                                        "for v in " (str/join " " picked) "; do "
                                        "eval \"val=\\${$v:-MISSING}\"; "
                                        "[ \"$val\" = MISSING ] && echo \"LOST:$v\"; done; "
                                        "echo \"MARKER:${CLAUDE_CODE_CHILD_SESSION:-GONE}\""))
            lines (str/split-lines (or out ""))
            lost (filterv #(str/starts-with? % "LOST:") lines)]
        (when (seq lost)
          (report! "P1b (invariant 1: the launcher process keeps every provider secret)" s picked
                   (str "scrub_harness_env removed " (pr-str lost))))
        ;; The same run proves the launcher scrub still does its own job -
        ;; otherwise "kept everything" could be satisfied by scrubbing nothing.
        (when-not (some #(= "MARKER:GONE" %) lines)
          (report! "P1b (invariant 1's other half: the launcher scrub still removes harness markers)" s picked
                   (str "CLAUDE_CODE_CHILD_SESSION survived: " (pr-str lines))))
        (recur (inc i) s2))))

  ;; ═══ P2 + P3c: the derived keep-list, and both implementations of it ═════
  (loop [i 0 s 1049]
    (when (< i runs)
      (let [;; 0 = empty (conf unreadable), 1 = includes an unknown backend,
            ;; 2..= known only. Injected at a fixed rate: under a uniform draw
            ;; over eight known names the two fail-open shapes are rare, and
            ;; they are the ones the derived keep-list gets wrong.
            [shape s1] (gen-int s 8)
            [k s2] (gen-int s1 3)
            [off s3] (gen-int s2 (count known-backends))
            [uk s4] (gen-int s3 (count unknown-backends))
            known (mapv #(nth known-backends (mod (+ off %) (count known-backends))) (range (inc k)))
            backends (case shape
                       0 #{}
                       1 (conj (set known) (nth unknown-backends uk))
                       (set known))
            scrub (lib/provider-scrub-vars backends)
            keep (lib/provider-keep-names backends)]

        (swap! coverage update
               (cond (empty? backends) :empty-backends
                     (= 1 shape) :unknown-backend
                     :else :known-only) inc)

        ;; ── P2a (invariant 2), COLLISION BY CONSTRUCTION: the secret is
        ;; drawn from a configured backend's OWN needs, so the pair is always
        ;; a candidate. Drawing it from all fifteen independently would make
        ;; the claim vacuous on roughly fourteen draws in fifteen.
        (let [needy (filterv #(seq (get lib/backend-provider-vars % #{})) known)]
          (if (seq needy)
            (let [[bi s5] (gen-int s4 (count needy))
                  b (nth needy bi)
                  needs (vec (sort (get lib/backend-provider-vars b)))
                  [si _] (gen-int s5 (count needs))
                  secret (nth needs si)]
              (swap! coverage update :collision-pair inc)
              (swap! coverage update :needs-something inc)
              (when (contains? scrub secret)
                (report! "P2a (invariant 2: a name a configured backend reads is never removed)" s
                         {:backends backends :backend b :secret secret}
                         "a scrub that breaks a configured provider is a worse defect than the leak it fixes")))
            (swap! coverage update :needs-nothing inc)))

        ;; ── P2b (invariant 2, the non-collision half): the two sets are
        ;; disjoint for EVERY name, so nothing on the keep-list can be
        ;; removed by any route, not just the one P2a constructs.
        (let [overlap (set/intersection scrub keep)]
          (when (seq overlap)
            (report! "P2b (invariant 2: the scrub list and the keep list are disjoint)" s
                     {:backends backends} (pr-str overlap))))
        (let [[si s6] (gen-int s4 (count all-secrets))
              secret (nth all-secrets si)]
          (swap! coverage update :independent-pair inc)
          (when (and (contains? scrub secret) (contains? keep secret))
            (report! "P2b (invariant 2: an independently drawn kept name is never scrubbed)" s
                     {:backends backends :secret secret} "present in both sets"))

          ;; ── P2c (invariant 2's fail-open edge): no readable configuration
          ;; is not evidence that nothing needs a key.
          (when (and (empty? backends) (seq scrub))
            (report! "P2c (invariant 2: an unreadable configuration scrubs nothing)" s
                     {:backends backends} (pr-str scrub)))

          ;; ── P2d (invariant 2's other fail-open edge): a backend the map
          ;; does not know must cost the leak, never the credentials.
          (when (and (= 1 shape) (seq scrub))
            (report! "P2d (invariant 2: an unknown backend keeps every secret)" s
                     {:backends backends} (pr-str scrub)))

          ;; ── P2e: the scrub is never wider than the leak itself.
          (when-not (set/subset? scrub lib/provider-secret-vars)
            (report! "P2e (the scrub never names anything outside the observed leak)" s
                     {:backends backends} (pr-str (set/difference scrub lib/provider-secret-vars))))

          ;; ── P3c (invariant 3), the strongest form: the lib and the shell
          ;; twin, given the SAME configuration, must remove the SAME names.
          ;; The literal-list checks above catch a name added to one side; only
          ;; this catches the two implementations DECIDING differently.
          (when (< i shell-runs)
            (doseq [shell shells]
              (let [sh-out (sh-scrub-list shell (vec (sort backends)) (str tmp-root))]
                (swap! coverage update (if (seq sh-out) :shell-scrubbed :shell-kept) inc)
                (when (not= sh-out scrub)
                  (report! (str "P3c (invariant 3: the lib and the shell twin scrub the same names, under " shell ")") s
                           {:backends backends}
                           (str "lib-only=" (pr-str (set/difference scrub sh-out))
                                " shell-only=" (pr-str (set/difference sh-out scrub))))))))
          (recur (inc i) s6)))))

  ;; A shell missing from the host would silently halve P3c's reach, so the
  ;; floors below are stated against the shells actually found.
  (when-not (= 2 (count shells))
    (swap! failures conj (str "FAIL coverage: P3c ran against " (pr-str shells)
                              " - both bash and zsh are required, the launcher is zsh")))
  (doseq [[k floor] {:empty-backends 15 :unknown-backend 15 :known-only 120
                     :needs-something 60 :needs-nothing 20
                     :collision-pair 60 :independent-pair 200
                     :shell-scrubbed 10 :shell-kept 6}]
    (when (< (get @coverage k 0) floor)
      (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                                (get @coverage k 0) " time(s), floor " floor))))

  (finally
    (fs/delete-tree tmp-root)))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1049 provider-env-scrub properties: " runs " runs (" shell-runs " with a real shell)"
                ", coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
