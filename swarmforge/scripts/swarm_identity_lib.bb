;; BL-090: multi-swarm foundations, first slice. Shared helpers for reading
;; this swarm's identity (normalized by swarmforge.sh's
;; write_swarm_identity_file into .swarmforge/swarm-identity, not
;; re-parsed from swarmforge.conf here) and a ticket file's `swarm:`
;; assignment field, so any script/role tooling can answer "is this ticket
;; mine?" without re-implementing the parsing. Also hosts launch-pack
;; downgrade guards (mono-router → accidental full pack).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "swarm_identity_lib.bb")))
;; and referred to as swarm-identity-lib/foo.

(ns swarm-identity-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def default-swarm-name "primary")
(def default-swarm-mode "autonomous")

(defn identity-file [project-root]
  (fs/path project-root ".swarmforge" "swarm-identity"))

(defn read-swarm-identity
  "This swarm's identity as a map with string keys matching
   swarmforge.sh's swarm-identity file (swarm_name, swarm_mode,
   swarm_mode_primary). Defaults to the primary/autonomous single-swarm
   identity when the file is absent - every pre-BL-090 swarm."
  [project-root]
  (let [file (identity-file project-root)]
    (if (fs/exists? file)
      (merge
        {"swarm_name" default-swarm-name "swarm_mode" default-swarm-mode}
        (into {}
              (for [line (str/split-lines (slurp (str file)))
                    :when (not (str/blank? line))
                    :let [[k v] (str/split line #"\t" 2)]]
                [k (or v "")])))
      {"swarm_name" default-swarm-name "swarm_mode" default-swarm-mode})))

(defn own-swarm-name [project-root]
  (get (read-swarm-identity project-root) "swarm_name" default-swarm-name))

(defn ticket-swarm-field
  "The ticket YAML file's top-level `swarm:` value, or nil when absent (an
   absent field means the primary swarm, per BL-090's backward-compat
   design - callers should compare against `default-swarm-name`, not nil,
   when deciding ownership)."
  [ticket-file]
  (some (fn [line]
          (when-let [[_ v] (re-matches #"swarm:\s*(.*)" line)]
            (not-empty (str/trim v))))
        (str/split-lines (slurp (str ticket-file)))))

(defn ticket-swarm
  "The swarm a ticket is assigned to: its explicit `swarm:` field, or the
   default primary swarm name when the field is absent."
  [ticket-file]
  (or (ticket-swarm-field ticket-file) default-swarm-name))

(defn belongs-to-own-swarm?
  "True when ticket-file is assigned to THIS swarm (by name)."
  [project-root ticket-file]
  (= (ticket-swarm ticket-file) (own-swarm-name project-root)))

;; ── Launch-pack downgrade guard (mono-router → accidental full pack) ────────

(defn read-identity
  "Parse swarm-identity TSV into a keyword-keyed map. Missing file → {}."
  [identity-path]
  (if (and identity-path (fs/exists? identity-path))
    (into {}
          (for [line (remove str/blank? (str/split-lines (slurp (str identity-path))))
                :let [[k v] (str/split line #"\t" 2)]
                :when (and k v)]
            [(keyword k) v]))
    {}))

(defn conf-rotation-mode
  "Returns \"router\", \"sequential\", or nil when the conf has no rotation directive."
  [conf-path]
  (when (and conf-path (fs/exists? conf-path))
    (some (fn [line]
            (when-let [[_ mode] (re-find #"^\s*config\s+rotation\s+(router|sequential)\s*$" line)]
              mode))
          (str/split-lines (slurp (str conf-path))))))

(defn pack-name-from-conf-path [conf-path]
  (when (and conf-path (not (str/blank? conf-path)))
    (str/replace (fs/file-name (fs/path conf-path)) #"\.conf$" "")))

(defn default-swarmforge-conf-path
  [project-root]
  (str (fs/path project-root "swarmforge" "swarmforge.conf")))

(defn explicit-launch-config?
  "True when the operator named a pack/config (not an implicit default).
   SWARMFORGE_CONFIG pointing at the tracked default swarmforge.conf does
   NOT count — that is the same accidental downgrade as omitting the env."
  [{:keys [project-root swarmforge-pack swarmforge-config explicit-pack-cli?]}]
  (let [default-conf (when project-root (default-swarmforge-conf-path project-root))
        config-explicit?
        (and (not (str/blank? swarmforge-config))
             (not (and default-conf
                       (= (str (fs/canonicalize (fs/path swarmforge-config)))
                          (str (fs/canonicalize (fs/path default-conf)))))))]
    (boolean (or (not (str/blank? swarmforge-pack))
                 config-explicit?
                 explicit-pack-cli?))))

(defn mono-router-project?
  "True when this project has previously run (or is marked) as rotation-router."
  [project-root identity]
  (let [id (or identity {})
        rotation (:rotation id)
        launch-pack (:launch_pack id)
        prev-conf (:active_backlog_max_depth_conf_path id)
        marker (fs/path project-root ".swarmforge" "mono-router-active-role")]
    (or (= rotation "router")
        (= rotation "sequential")
        (fs/exists? marker)
        (when launch-pack (str/includes? (str launch-pack) "mono-router"))
        (conf-rotation-mode prev-conf))))

(defn suggested-pack-name
  [project-root identity]
  (let [id (or identity {})]
    (or (not-empty (str/trim (or (:launch_pack id) "")))
        (let [from-conf (pack-name-from-conf-path (:active_backlog_max_depth_conf_path id))]
          (when (and from-conf (str/includes? from-conf "mono-router"))
            from-conf))
        (when (fs/exists? (fs/path project-root "swarmforge/packs/openrouter-anthropic-mono-router.conf"))
          "openrouter-anthropic-mono-router")
        (when (fs/exists? (fs/path project-root "swarmforge/packs/perplexity-mono-router.conf"))
          "perplexity-mono-router")
        "openrouter-anthropic-mono-router")))

(defn accidental-full-pack-downgrade?
  "When non-nil, a bare ./swarm launch would downgrade mono-router → full pack."
  [{:keys [project-root config-path allow-full-pack?
           swarmforge-pack swarmforge-config explicit-pack-cli?]}]
  (when-not (= "1" (str allow-full-pack?))
    (when-not (explicit-launch-config? {:project-root project-root
                                        :swarmforge-pack swarmforge-pack
                                        :swarmforge-config swarmforge-config
                                        :explicit-pack-cli? explicit-pack-cli?})
      (let [identity (read-identity (str (identity-file project-root)))]
        (when (mono-router-project? project-root identity)
          (when-not (conf-rotation-mode config-path)
            {:suggested-pack (suggested-pack-name project-root identity)
             :previous-rotation (or (:rotation identity)
                                    (conf-rotation-mode (:active_backlog_max_depth_conf_path identity)))}))))))

(defn format-guard-message
  [{:keys [suggested-pack previous-rotation]}]
  (str "Refusing bare ./swarm launch — this project runs as a mono-router pack"
       (when previous-rotation (str " (rotation " previous-rotation ")"))
       ".\n"
       "The implicit config would start ALL standing role panes (~8x cost).\n\n"
       "Recover with:\n"
       "  ./start-swarm-anthropic.sh\n"
       "  # or:\n"
       "  ./swarm . --pack " suggested-pack "\n\n"
       "To intentionally launch a different/full pack, pass --pack NAME explicitly\n"
       "or set SWARMFORGE_ALLOW_FULL_PACK=1."))
