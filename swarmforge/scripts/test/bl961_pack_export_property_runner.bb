#!/usr/bin/env bb
;; BL-961 property tests (coder-authored, declared invariants) over the REAL
;; launcher generation path: write_role_launch_script in swarmforge.sh,
;; driven per draw through the same zsh-source fixture harness
;; test_swarmforge_pack_export.sh uses (no live tmux).
;;
;;   Invariant 1: "For one launch, the SWARMFORGE_PACK value exported in
;;   every generated role launch script is identical and equals the basename
;;   (sans .conf) of the conf file the launcher actually loaded." The
;;   generator draws a pack name from the conf-basename alphabet (or the
;;   default swarmforge.conf case) and a role subset, generates every role's
;;   script through the real launcher, and asserts identical-across-roles
;;   AND equal-to-loaded-basename. Equality with the basename is checked
;;   against the DRAWN name - derived independently of the launcher's own
;;   derivation, so a hardcoded or stale value cannot pass.
;;
;;   Invariant 2: "The export lives in the generated .swarmforge/launch/
;;   <role>.sh file itself." Asserted per generated script by evaluating the
;;   file's own export line under `env -i /bin/sh` - an emptied environment,
;;   so nothing inherited (tmux server env, the launching shell) can supply
;;   the value the assertion sees.
;;
;; Each draw spawns a real zsh sourcing swarmforge.sh, so the default run
;; count is modest (30; PROPERTY_RUNS overrides) - every draw exercises the
;; full generation path, and the drawn-name space (length 1-12 over
;; [a-z0-9-], plus the default-conf case) has no deep rare states to reach.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - export line hardcoded to 'full-forge' in the heredoc -> failed 30/30
;;     runs (identical across roles, wrong value - the half a
;;     cross-role-only check would miss; no generated draw happens to name
;;     full-forge, so every draw caught it);
;;   - export line removed from the heredoc -> failed 30/30 runs (no line
;;     in the file, env -i yields nothing).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def swarmforge-sh (str (fs/path script-dir ".." "swarmforge.sh")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 30))
(def failures (atom []))
(def coverage (atom {:pack-conf 0 :default-conf 0 :multi-role 0}))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(def name-alphabet (vec "abcdefghijklmnopqrstuvwxyz0123456789-"))

(defn- gen-pack-name [s]
  (let [[len s1] (gen-int s 12)]
    (loop [k 0 acc [] sx s1]
      (if (> (inc len) k)
        (let [[i sy] (gen-int sx (count name-alphabet))]
          (recur (inc k) (conj acc (nth name-alphabet i)) sy))
        ;; never begin/end with '-' (not a valid conf basename shape the
        ;; launcher's --pack path would be given); collapse to "p" if empty
        [(let [n (str/replace (apply str acc) #"^-+|-+$" "")]
           (if (str/blank? n) "p" n)) sx]))))

(def all-roles ["coder" "QA" "cleaner"])

;; BL-961 hardening: `:extra-env` MERGES into the inherited environment, so
;; each draw's zsh would otherwise read this pane's own SWARMFORGE_* exports.
;; That is not hypothetical here - every live role shell exports
;; SWARMFORGE_PACK, and swarmforge.sh resolves
;; CONFIG_FILE="${SWARMFORGE_CONFIG:-.../swarmforge.conf}", so an inherited
;; SWARMFORGE_CONFIG re-points the ~1-in-4 default-conf draws at the ambient
;; conf: a false red when its basename differs, and a silent false green
;; whenever it is itself named swarmforge.conf. Clear every SWARMFORGE_* the
;; script under test reads, and set XDG_RUNTIME_DIR through the same `env`
;; call. Enumerated from `grep -o 'SWARMFORGE_[A-Z_]*' swarmforge.sh`; re-run
;; that grep when swarmforge.sh grows a new one.
(def read-swarmforge-vars
  ["SWARMFORGE_ALLOW_FULL_PACK" "SWARMFORGE_CONFIG" "SWARMFORGE_DAEMON_START_CALLER"
   "SWARMFORGE_GEMINI_API_KEY" "SWARMFORGE_MAILBOX_ONLY" "SWARMFORGE_OPENROUTER_ROLES"
   "SWARMFORGE_PACK" "SWARMFORGE_REMOTE_CONTROL" "SWARMFORGE_ROLE"
   "SWARMFORGE_ROLE_WORKTREE" "SWARMFORGE_SKIP_DAEMON" "SWARMFORGE_SKIP_FRONT_DESK"
   "SWARMFORGE_SKIP_OPERATOR" "SWARMFORGE_SKIP_SHELL_RUN_RECORD" "SWARMFORGE_TERMINAL"
   "SWARMFORGE_TERMINAL_BACKEND" "SWARMFORGE_USE_CEREBRAS" "SWARMFORGE_USE_PERPLEXITY"
   "SWARMFORGE_USE_QWEN"])

;; BL-1318: this property exercises pack export composition, not model
;; staffing - the fixture window lines pin no steward-mapped model, so
;; bypass the new staffing gate the same way SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS
;; is bypassed elsewhere, rather than teaching the fixture a real mapping.
(def clean-env-prefix
  (concat ["env"] (mapcat (fn [v] ["-u" v]) read-swarmforge-vars)
          ["XDG_RUNTIME_DIR=/tmp" "PACK_STAFFING_SKIP_GATE=1"]))

(defn- gen-case [s]
  (let [[default? s1] (gen-int s 4)          ; 1-in-4 draws the default conf
        [pack s2] (gen-pack-name s1)
        [role-mask s3] (gen-int s2 7)
        roles (let [r (keep-indexed (fn [i role] (when (bit-test (inc role-mask) i) role)) all-roles)]
                (if (seq r) (vec r) ["coder"]))]
    [{:default? (zero? default?) :pack pack :roles roles} s3]))

(def window-line
  "window %s claude %s --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low")

(def index-snippet
  "index_of_role() { local target=\"$1\" i; for (( i = 1; i <= ${#ROLES[@]}; i++ )); do [[ \"${ROLES[$i]}\" == \"$target\" ]] && { echo \"$i\"; return; }; done }")

(defn- generate! [{:keys [default? pack roles]}]
  (let [root (str (fs/canonicalize (fs/create-temp-dir {:prefix "bl961-prop-"})))]
    (try
      (fs/create-dirs (fs/path root "swarmforge" "roles"))
      (fs/create-dirs (fs/path root "swarmforge" "packs"))
      (fs/create-dirs (fs/path root ".swarmforge" "launch"))
      (fs/create-dirs (fs/path root ".swarmforge" "prompts"))
      (spit (str (fs/path root "swarmforge" "constitution.prompt")) "constitution\n")
      (doseq [role roles]
        (spit (str (fs/path root "swarmforge" "roles" (str role ".prompt"))) "role prompt\n"))
      (let [conf-lines (str/join "\n" (map #(format window-line % %) roles))
            conf-path (if default?
                        (fs/path root "swarmforge" "swarmforge.conf")
                        (fs/path root "swarmforge" "packs" (str pack ".conf")))
            expected (if default? "swarmforge" pack)
            _ (spit (str conf-path) (str conf-lines "\n"))
            source-args (if default?
                          (str "source '" swarmforge-sh "' '" root "'")
                          (str "source '" swarmforge-sh "' '" root "' --pack '" pack "'"))
            writes (str/join "; " (map #(str "write_role_launch_script \"$(index_of_role " % ")\"") roles))
            r (apply process/sh {:continue true}
                     (concat clean-env-prefix
                             ["zsh" "-c" (str source-args "; parse_config; " index-snippet "; " writes)]))]
        (if-not (zero? (:exit r))
          (str "generation failed: " (:err r))
          (let [lines (for [role roles]
                        (let [script (str (fs/path root ".swarmforge" "launch" (str role ".sh")))]
                          (if-not (fs/exists? script)
                            ::missing-script
                            (->> (str/split-lines (slurp script))
                                 (filter #(re-matches #"export SWARMFORGE_PACK='.*'" %))
                                 vec))))]
            (cond
              (some #{::missing-script} lines)
              "a role's launch script was not written"

              (some #(not= 1 (count %)) lines)
              (str "expected exactly one export line per script, got " (pr-str lines))

              ;; invariant 1: identical across roles AND equal to the drawn basename
              (not= 1 (count (set lines)))
              (str "roles disagree within one launch: " (pr-str lines))

              (not= (str "export SWARMFORGE_PACK='" expected "'") (first (first lines)))
              (str "export names the wrong pack: got " (pr-str (first (first lines)))
                   ", loaded conf basename is " expected)

              :else
              ;; invariant 2: the FILE's own line yields the value under env -i
              (let [script (str (fs/path root ".swarmforge" "launch" (str (first roles) ".sh")))
                    probe (process/sh {:continue true}
                                      "env" "-i" "/bin/sh" "-c"
                                      (str "eval \"$(grep -x \"export SWARMFORGE_PACK='.*'\" '" script "')\"; printf '%s' \"$SWARMFORGE_PACK\""))]
                (if (= expected (str/trim (:out probe)))
                  true
                  (str "env -i eval of the file's own export yielded " (pr-str (:out probe))
                       ", expected " expected)))))))
      (finally
        (fs/delete-tree root)))))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[input s'] (gen-case s)
          result (generate! input)]
      (swap! coverage #(cond-> %
                         (:default? input) (update :default-conf inc)
                         (not (:default? input)) (update :pack-conf inc)
                         (> (count (:roles input)) 1) (update :multi-role inc)))
      (when-not (true? result)
        (swap! failures conj (str "FAIL invariants over the real generation\n  input: " (pr-str input) "\n  " result)))
      (recur (inc i) s'))))

(let [{:keys [pack-conf default-conf multi-role]} @coverage]
  (doseq [[k v] {:pack-conf pack-conf :default-conf default-conf :multi-role multi-role}]
    (when (< v 3)
      (swap! failures conj (str "FAIL generator coverage: " k " reached only " v " of " runs " runs (floor 3)")))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl961 pack export properties: " runs " runs over the real launcher generation"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
