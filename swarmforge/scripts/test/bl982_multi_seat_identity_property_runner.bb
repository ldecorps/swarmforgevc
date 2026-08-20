#!/usr/bin/env bb
;; BL-982 declared invariants, coder-first (BL-654). Generative sweep over
;; random pack confs driving the REAL swarmforge.sh (sourced, BL-089
;; pattern - parse_config + write_roles_file + real artifact generation)
;; and the REAL swarm_handoff.bb delivery path.
;;
;;   Invariant 1 (keyspace non-leak): nothing seat-derived reaches a
;;     prompt-file lookup (compose metadata's role == the STAGE for every
;;     seat; the composed artifact FILES stay seat-keyed), and nothing
;;     stage-derived names a session (sessions = swarmforge-<seat-id>,
;;     roles.tsv col1 = seat id, launch scripts = launch/<seat-id>.sh).
;;     The parcel-address half is invariant 3's delivery assertion: a
;;     stage-addressed send resolves the stage-named seat's mailbox and no
;;     other.
;;   Invariant 2 (single-seat byte-identity): for confs with NO @-seat,
;;     roles.tsv from THIS worktree's script is byte-identical (modulo the
;;     absolute fixture root) to the PRE-CHANGE script, pinned by blob sha
;;     2edd9a17ba9d40709c0f436d12395b638563c0ca (REAL-vs-REAL oracle, the
;;     BL-978 pattern).
;;   Invariant 3 (second seat inert): a REAL swarm_handoff.bb send
;;     addressed to the stage lands in the bare seat's inbox/new and the
;;     @-seat's mailbox tree stays EMPTY; the @-seat's own mailbox
;;     resolution (mailbox_dir.bb) points at its own worktree, distinct
;;     from the bare seat's.
;;
;; Generator reach floors (absolute, never scaled): single-seat confs >= 5,
;; multi-seat confs >= 8, a 3-seat stage >= 3, compose-checked draws >= 6,
;; delivery-checked draws >= 5.
;;
;; Non-vacuity (staged-first restore, run 2026-08-20, recorded in the
;; parcel commit):
;;   - inv-1 break: write_agent_instruction_file's compose arg reverted to
;;     the seat id -> compose fails/mis-keys for @-seats, the metadata
;;     role==stage assertion goes RED on the first compose-checked
;;     multi-seat draw.
;;   - inv-2 break: an unconditional extra roles.tsv column -> byte-identity
;;     RED on every single-seat draw.
;;   - inv-3 break: the generator's bare row withheld (delivery fixture
;;     declares only the @-seat) -> the bare-seat-delivery assertion goes
;;     RED, proving the assertion consumes the real delivery outcome.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))
(def repo-root (str (fs/parent (fs/parent scripts-dir))))
(def swarmforge-sh (str (fs/path scripts-dir "swarmforge.sh")))
(def pre-blob "2edd9a17ba9d40709c0f436d12395b638563c0ca")

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 24))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-nth* [xs] (nth xs (.nextInt rng (count xs))))
(defn rand-int* [n] (.nextInt rng n))

(def fixture-root (str (fs/create-temp-dir {:prefix "bl982-prop-"})))
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? fixture-root) (fs/delete-tree fixture-root)))))

(def failures (atom []))
(def coverage (atom {:single 0 :multi 0 :triple 0 :composed 0 :delivered 0}))

(defn sh [opts & args]
  (apply process/sh (merge {:continue true} opts) args))

(defn mk-conf-root!
  "A fresh conf fixture root under the runner's own temp tree."
  [i]
  (let [root (str (fs/path fixture-root (str "draw-" i)))]
    (fs/create-dirs (fs/path root "swarmforge" "roles"))
    (fs/create-dirs (fs/path root ".swarmforge" "launch"))
    (fs/create-dirs (fs/path root ".swarmforge" "prompts"))
    (spit (str (fs/path root "swarmforge" "constitution.prompt")) "c\n")
    ;; Stage prompts come from the REAL repo roles dir at compose time; the
    ;; fixture's own role prompt files satisfy the parse-time existence
    ;; check only, so use real stage names for composed draws.
    (doseq [r ["coordinator" "specifier" "coder" "cleaner" "architect"]]
      (spit (str (fs/path root "swarmforge" "roles" (str r ".prompt"))) (str r "\n")))
    root))

(defn gen-pack
  "Random pack: master specifier + 1-3 pipeline stages, each with 1-3 seats.
   Returns {:lines [..] :stages {stage [seat-ids...]} :models {seat model}}."
  []
  (let [stage-pool ["coder" "cleaner" "architect"]
        n-stages (inc (rand-int* 3))
        stages (vec (take n-stages (distinct (repeatedly #(rand-nth* stage-pool)))))
        models ["claude-sonnet-5" "claude-fable-5" "claude-opus-5" "claude-haiku-4-5-20251001"]
        seatify (fn [stage]
                  (let [n (inc (rand-int* 3))
                        extras (map #(str stage "@s" % (rand-int* 90)) (range 1 n))]
                    (vec (cons stage (distinct extras)))))
        seat-map (into {} (map (fn [s] [s (seatify s)]) stages))
        seat-model (into {} (for [[_ seats] seat-map, seat seats]
                              [seat (rand-nth* models)]))
        lines (concat
               [(str "window specifier claude master --model " (rand-nth* models))]
               (for [[stage seats] seat-map
                     seat seats]
                 (str "window " seat " claude wt-" (str/replace seat "@" "-")
                      " --model " (get seat-model seat))))]
    {:lines (vec lines) :stages seat-map :models seat-model}))

(defn write-conf! [root lines]
  (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
        (str (str/join "\n" lines) "\n")))

(defn run-parse [root sh-file]
  (sh {:extra-env {"XDG_RUNTIME_DIR" "/tmp"}}
      "zsh" "-c" (format "source '%s' '%s'; parse_config; write_roles_file" sh-file root)))

(defn roles-tsv [root]
  (let [f (fs/path root ".swarmforge" "roles.tsv")]
    (when (fs/exists? f) (slurp (str f)))))

(defn fail! [msg] (swap! failures conj msg))

(defn check-identity-derivations!
  "Invariant 1's roles.tsv half: col1 = seat id, session seat-derived."
  [draw root pack]
  (let [rows (->> (roles-tsv root) str/split-lines (remove str/blank?)
                  (map #(str/split % #"\t")))]
    (doseq [[_ seats] (:stages pack), seat seats]
      (let [row (first (filter #(= (first %) seat) rows))]
        (if-not row
          (fail! (str "draw " draw ": seat " seat " has no roles.tsv row"))
          (when-not (= (nth row 3) (str "swarmforge-" seat))
            (fail! (str "draw " draw ": seat " seat " session not seat-derived: " (nth row 3)))))))))

(defn check-compose!
  "Invariant 1's prompt half over one multi-seat stage: metadata role ==
   stage for BOTH seats, artifact files seat-keyed."
  [draw root pack]
  (let [[stage seats] (first (filter (fn [[_ s]] (> (count s) 1)) (:stages pack)))
        [bare extra] [(first seats) (second seats)]
        res (sh {:extra-env {"XDG_RUNTIME_DIR" "/tmp"}}
                "zsh" "-c"
                (format "source '%s' '%s'; parse_config; generate_dormant_role_launch_artifacts $(( ${ROLE_INDEX[%s]} + 1 )); generate_dormant_role_launch_artifacts $(( ${ROLE_INDEX[%s]} + 1 ))"
                        swarmforge-sh root bare extra))]
    (if-not (zero? (:exit res))
      (fail! (str "draw " draw ": artifact generation failed: " (:err res)))
      (doseq [seat [bare extra]]
        (let [meta-f (fs/path root ".swarmforge" "prompts" (str seat ".md.metadata.json"))
              launch-f (fs/path root ".swarmforge" "launch" (str seat ".sh"))]
          (cond
            (not (fs/exists? launch-f))
            (fail! (str "draw " draw ": seat " seat " launch script not seat-keyed"))
            (not (fs/exists? meta-f))
            (fail! (str "draw " draw ": seat " seat " compose metadata missing"))
            :else
            (let [meta (slurp (str meta-f))
                  md-f (fs/path root ".swarmforge" "prompts" (str seat ".md"))
                  md (if (fs/exists? md-f) (slurp (str md-f)) "")]
              (when-not (str/includes? meta (str "\"role\":\"" stage "\""))
                (fail! (str "draw " draw ": seat " seat " composed as non-stage role: " meta)))
              (when-not (str/includes? meta (str "\"model\":\"" (get (:models pack) seat) "\""))
                (fail! (str "draw " draw ": seat " seat " lost its own model: " meta)))
              ;; The composed TEXT itself is the stage's role prompt - the
              ;; metadata alone proved blind to a mis-keyed main compose
              ;; call (found by this runner's own break 1).
              (when-not (str/includes? md (str "You are the " stage))
                (fail! (str "draw " draw ": seat " seat " composed .md is not the stage's role prompt ("
                            (count md) " bytes)"))))))))))

(defn check-byte-identity!
  "Invariant 2: single-seat conf, current vs pre-change blob, normalized."
  [draw pack i]
  (let [root-a (mk-conf-root! (str i "-cur"))
        root-b (mk-conf-root! (str i "-pre"))
        pre-dir (str (fs/path fixture-root (str "pre-sh-" i)))]
    (fs/create-dirs pre-dir)
    (doseq [entry (fs/list-dir scripts-dir)]
      (let [nm (fs/file-name entry)]
        (when-not (= nm "swarmforge.sh")
          (fs/create-sym-link (fs/path pre-dir nm) entry))))
    (let [blob (:out (sh {:dir repo-root :out :string} "git" "cat-file" "blob" pre-blob))]
      (spit (str (fs/path pre-dir "swarmforge.sh")) blob))
    (write-conf! root-a (:lines pack))
    (write-conf! root-b (:lines pack))
    (let [ra (run-parse root-a swarmforge-sh)
          rb (run-parse root-b (str (fs/path pre-dir "swarmforge.sh")))]
      (if (or (not (zero? (:exit ra))) (not (zero? (:exit rb))))
        (fail! (str "draw " draw ": single-seat parse failed cur=" (:exit ra) " pre=" (:exit rb) " " (:err ra) (:err rb)))
        (let [norm (fn [root] (str/replace (or (roles-tsv root) "") root "ROOT"))]
          (when-not (= (norm root-a) (norm root-b))
            (fail! (str "draw " draw ": single-seat roles.tsv diverged from pre-change script:\nCUR:\n"
                        (norm root-a) "\nPRE:\n" (norm root-b)))))))))

(defn check-delivery!
  "Invariant 3: real swarm_handoff.bb send to the stage lands ONLY in the
   bare seat's inbox; the @-seat's mailbox tree stays empty and resolves
   distinctly. `withhold-bare?` is the documented non-vacuity break hook."
  [draw pack i & {:keys [withhold-bare?] :or {withhold-bare? false}}]
  (let [[stage seats] (first (filter (fn [[_ s]] (> (count s) 1)) (:stages pack)))
        extra (second seats)
        root (str (fs/path fixture-root (str "deliver-" i)))]
    (fs/create-dirs root)
    (doseq [d ["backlog/active" ".swarmforge" "specifier" stage (str/replace extra "@" "-") "bin"]]
      (fs/create-dirs (fs/path root d)))
    (sh {:dir root} "git" "init" "-q" ".")
    (spit (str (fs/path root "backlog" "active" "FIXTURE.yaml")) "id: FIXTURE\n")
    (let [row (fn [role wt] (str role "\t" wt "-wt\t" (fs/path root wt) "\tswarmforge-" role "\t" role "\tclaude\ttask"))
          rows (concat [(row "specifier" "specifier")]
                       (when-not withhold-bare? [(row stage stage)])
                       [(row extra (str/replace extra "@" "-"))
                        (str "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask")])]
      (spit (str (fs/path root ".swarmforge" "roles.tsv")) (str (str/join "\n" rows) "\n")))
    (spit (str (fs/path root "fake.sock")) "")
    (spit (str (fs/path root ".swarmforge" "tmux-socket")) (str root "/fake.sock"))
    (spit (str (fs/path root "bin" "tmux"))
          "#!/usr/bin/env bash\ncase \"$*\" in *list-panes*) echo ok ;; esac\nexit 0\n")
    (sh {} "chmod" "+x" (str (fs/path root "bin" "tmux")))
    (sh {:dir root} "git" "add" "-A")
    (sh {:dir root} "git" "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "seed")
    (let [commit (str/trim (:out (sh {:dir root :out :string} "git" "rev-parse" "--short=10" "HEAD")))
          draft (str (fs/path root "specifier" "draft.txt"))]
      (spit draft (str "type: git_handoff\nto: " stage "\npriority: 50\ntask: BL-42\ncommit: " commit "\n"))
      (sh {:dir (str (fs/path root "specifier"))
           :extra-env {"SWARMFORGE_ROLE" "specifier"
                       "PATH" (str (fs/path root "bin") ":" (System/getenv "PATH"))}}
          "bb" (str (fs/path scripts-dir "swarm_handoff.bb")) draft)
      (let [bare-inbox (fs/path root stage ".swarmforge" "handoffs" "inbox" "new")
            extra-tree (fs/path root (str/replace extra "@" "-") ".swarmforge" "handoffs")
            bare-delivered? (and (fs/exists? bare-inbox)
                                 (seq (filter #(str/ends-with? (str %) ".handoff") (fs/list-dir bare-inbox))))
            extra-files (when (fs/exists? extra-tree)
                          (filter #(str/ends-with? (str %) ".handoff") (file-seq (fs/file extra-tree))))]
        (when-not bare-delivered?
          (fail! (str "draw " draw ": stage-addressed parcel did not land in the bare seat's inbox")))
        (when (seq extra-files)
          (fail! (str "draw " draw ": the @-seat received parcel(s): " (mapv str extra-files))))
        ;; The @-seat's own mailbox resolution is distinct from the bare seat's.
        (let [mb (fn [role] (str/trim (:out (sh {:out :string} "bb" (str (fs/path scripts-dir "mailbox_dir.bb")) root role "new"))))
              bare-mb (when-not withhold-bare? (mb stage))
              extra-mb (mb extra)]
          (when (and bare-mb (= bare-mb extra-mb))
            (fail! (str "draw " draw ": seat mailbox resolution collided with the stage's: " extra-mb))))))))

;; ── the sweep ────────────────────────────────────────────────────────────
(dotimes [i runs]
  (let [pack (gen-pack)
        multi? (some (fn [[_ s]] (> (count s) 1)) (:stages pack))
        triple? (some (fn [[_ s]] (= 3 (count s))) (:stages pack))]
    (if multi?
      (do (swap! coverage update :multi inc)
          (when triple? (swap! coverage update :triple inc))
          (let [root (mk-conf-root! i)]
            (write-conf! root (:lines pack))
            (let [res (run-parse root swarmforge-sh)]
              (if-not (zero? (:exit res))
                (fail! (str "draw " i ": multi-seat pack failed to parse: " (:err res)))
                (do (check-identity-derivations! i root pack)
                    (when (< (:composed @coverage) 8)
                      (swap! coverage update :composed inc)
                      (check-compose! i root pack))
                    (when (< (:delivered @coverage) 6)
                      (swap! coverage update :delivered inc)
                      (check-delivery! i pack i)))))))
      (do (swap! coverage update :single inc)
          (check-byte-identity! i pack i)))))

;; Reach floors - absolute, never scaled.
(doseq [[k floor] {:single 5 :multi 8 :triple 3 :composed 6 :delivered 5}]
  (when (< (get @coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k) " of " runs " (floor " floor ")"))))

(println (str "  generator coverage: " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl982 multi-seat identity properties: " runs " draws over the real parser, composer and delivery path"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
