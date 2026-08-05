#!/usr/bin/env bb
;; babysitter_check.bb — thin I/O gatherer + CLI for babysitterd (BL-611).
;;
;; Ports the deterministic prototype (.swarmforge/operator/babysitter_check.sh,
;; untracked) into the repo: this file does ALL the tmux/ps/find/meminfo/file
;; gathering, builds a snapshot, hands it to babysitterd_sweep_lib/assemble-
;; findings (pure, unit-tested separately), prints the findings, and — with
;; --nudge — sends eligible findings to the coordinator via
;; babysitter_nudge_lib/nudge-resident! (never raw tmux send-keys).
;;
;; Usage:
;;   bb babysitter_check.bb <project-root> [--nudge]
;;
;; Invoked as `babysitter_check.sh <project-root> [--nudge]` (the pinned CLI
;; name — see swarmforge/scripts/babysitter_check.sh, a one-line exec shim).
;;
;; State (BL-611: distinct from the retired hawk's .swarmforge/babysitter/, so
;; stale hawk state is never mistaken for daemon state):
;;   .swarmforge/babysitterd/pane-hash-<role>   last 3 stable content hashes
;;   .swarmforge/babysitterd/streak             swarm-starved idle-sweep streak
;;   .swarmforge/babysitterd/nudge-dedup.json    {finding-key -> last-nudged-ms}
;;
;; Exit 0 always — a monitor, never a gate.

(ns babysitter-check
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "babysitterd_sweep_lib.bb")))
(load-file (str (fs/path script-dir "babysitter_assess_lib.bb")))
(load-file (str (fs/path script-dir "babysitter_nudge_lib.bb")))
(load-file (str (fs/path script-dir "mono_router_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: babysitter_check.bb <project-root> [--nudge]"))
  (System/exit 1))

(def args (vec *command-line-args*))
(def project-root
  (or (first (remove #(str/starts-with? % "-") args)) (usage)))
(def nudge? (boolean (some #{"--nudge"} args)))

(def state-dir (fs/path project-root ".swarmforge"))
(def babysitterd-dir (fs/path state-dir "babysitterd"))
(def streak-file (fs/path babysitterd-dir "streak"))
(def dedup-file (fs/path babysitterd-dir "nudge-dedup.json"))

(def stuck-min 30)
(def heartbeat-max-secs 300)
(def mem-floor-mb 1500)
(def nudge-cooldown-ms (* 30 60 1000))
(def rotate-grace-min 10)
(def pending-max-age-min 120)

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso [] (str (java.time.Instant/now)))

(defn sh! [& args]
  (apply process/sh {:continue true} args))

;; ── tmux socket + roles ──────────────────────────────────────────────────

(defn read-tmux-socket []
  (let [f (fs/path state-dir "tmux-socket")]
    (when (fs/exists? f)
      (let [s (str/trim (slurp (str f)))]
        (when (fs/exists? s) s)))))

(defn parse-roles-tsv []
  (let [f (fs/path state-dir "roles.tsv")]
    (if (fs/exists? f)
      (->> (str/split-lines (slurp (str f)))
           (remove str/blank?)
           (map (fn [line]
                  (let [cols (str/split line #"\t" -1)]
                    {:role (get cols 0) :session (get cols 3)})))
           (remove #(str/blank? (:session %)))
           vec)
      [])))

;; ── BL-804: mono-router topology awareness ──────────────────────────────
;; Same resolution as handoffd.bb's rotation-router-mode? (~line 1353):
;; swarm-identity rotation key, else the identity-recorded active pack conf,
;; else the tracked default swarmforge/swarmforge.conf — via mono_router_lib
;; (rotation-router-from-identity?, conf-rotation-router?), never a second
;; parser of identity/conf text (invariant 2). script-dir is this file's OWN
;; location (mirrors handoffd.bb's conf-file), not project-root — a launch-
;; time --pack/SWARMFORGE_CONFIG override is still honored via the identity-
;; recorded conf path, same as handoffd.

(def default-conf-file (str (fs/path script-dir ".." "swarmforge.conf")))

(defn rotation-router-mode? []
  (let [identity-path (fs/path state-dir "swarm-identity")
        identity-text (when (fs/exists? identity-path) (slurp (str identity-path)))
        conf-path (or (get (mono-router-lib/parse-identity-map (or identity-text ""))
                           "active_backlog_max_depth_conf_path")
                      default-conf-file)
        conf-text (when (and conf-path (fs/exists? conf-path))
                    (slurp conf-path))]
    (boolean
     (or (mono-router-lib/rotation-router-from-identity? identity-text)
         (mono-router-lib/conf-rotation-router? conf-text)))))

(defn should-stand-role?
  "Whether `role` (a roles.tsv role name) is expected to have a standing tmux
   session. Under rotation router, derived purely from topology
   (mono-router-lib/should-have-standing-session? — resident + coordinator
   only, invariant 1: never a hardcoded per-role list). Outside router mode
   every role is expected to stand, unchanged from pre-BL-804 behavior
   (scenario 05)."
  [rotation-router? ordered-roles role]
  (if rotation-router?
    (mono-router-lib/should-have-standing-session? ordered-roles role)
    true))

(defn pane-exists? [socket session]
  (and socket (zero? (:exit (sh! "tmux" "-S" socket "has-session" "-t" session)))))

(defn pane-pid [socket session]
  (when (and socket (pane-exists? socket session))
    (let [r (sh! "tmux" "-S" socket "list-panes" "-t" (str session ":0.0") "-F" "#{pane_pid}")]
      (when (zero? (:exit r))
        (parse-long (str/trim (first (str/split-lines (:out r)))))))))

;; BL-802: `ps --ppid` is GNU-only (BSD/macOS ps rejects it outright). A
;; single `ps -eo pid=,ppid=,args=` snapshot works on both dialects — filter
;; by ppid in-process instead of asking ps to filter. One snapshot covers
;; every role's pane (see ps-snapshot below), so this only ever parses text,
;; never shells out itself.
(def ^:private ps-line-pattern #"^\s*(\d+)\s+(\d+)\s+(.*)$")

(defn ps-snapshot []
  (let [r (sh! "ps" "-eo" "pid=,ppid=,args=")]
    (when (zero? (:exit r)) (:out r))))

(defn claude-process-line [pane-pid ps-output]
  (when (and pane-pid ps-output)
    (->> (str/split-lines ps-output)
         (keep (fn [line]
                 (when-let [[_ _pid ppid args] (re-find ps-line-pattern line)]
                   (when (= (str pane-pid) ppid) args))))
         (filter #(str/includes? % "claude "))
         first)))

(defn capture-pane [socket session]
  (when (and socket (pane-exists? socket session))
    (:out (sh! "tmux" "-S" socket "capture-pane" "-p" "-S" "-40" "-t" (str session ":0.0")))))

(def menu-pattern #"Do you want|Do you trust|❯ 1\.|\(y/n\)|Enter to confirm|to select")

(defn strip-spinner [text]
  (->> (str/split-lines (str text))
       (remove #(re-find #"✻|✽|✶|✳|·|tokens|for [0-9]+m?[0-9]*s" %))
       (str/join "\n")))

(defn sha1-hex [s]
  (let [d (java.security.MessageDigest/getInstance "SHA-1")]
    (->> (.digest d (.getBytes (str s) "UTF-8"))
         (map #(format "%02x" %))
         (apply str))))

(defn read-hash-history [role]
  (let [f (fs/path babysitterd-dir (str "pane-hash-" role))]
    (if (fs/exists? f)
      (vec (remove str/blank? (str/split-lines (slurp (str f)))))
      [])))

(defn append-hash-history! [role stable-hash]
  (fs/create-dirs babysitterd-dir)
  (let [f (fs/path babysitterd-dir (str "pane-hash-" role))
        history (conj (read-hash-history role) stable-hash)
        trimmed (vec (take-last 3 history))]
    (spit (str f) (str (str/join "\n" trimmed) "\n"))
    trimmed))

(defn gather-role [socket ps-output {:keys [role session]}]
  (let [exists? (pane-exists? socket session)
        pid (when exists? (pane-pid socket session))
        ;; A pane whose pid we need but whose ps snapshot failed to gather at
        ;; all is a tooling failure, not evidence the claude process is gone.
        gather-failed? (boolean (and pid (nil? ps-output)))
        claude-line (claude-process-line pid ps-output)
        has-claude? (boolean claude-line)
        has-rc? (boolean (and claude-line (str/includes? claude-line "--remote-control")))
        pane-text (or (capture-pane socket session) "")
        menu? (boolean (re-find menu-pattern pane-text))
        busy? (babysitterd-sweep-lib/classify-pane-busy? pane-text)
        stable-hash (sha1-hex (strip-spinner pane-text))
        history (append-hash-history! role stable-hash)]
    {:role role :pane-exists? exists? :has-claude-process? has-claude?
     :process-gather-failed? gather-failed?
     :has-remote-control? has-rc? :menu-blocked? menu? :busy? busy?
     :hash-history history :pane-text pane-text}))

;; ── handoffd / dead-letters / stuck parcels ──────────────────────────────

(defn proc-alive? [pattern]
  (zero? (:exit (sh! "pgrep" "-f" pattern))))

(defn file-age-secs [path]
  (when (fs/exists? path)
    (let [mtime-ms (fs/file-time->millis (fs/last-modified-time path))]
      (quot (- (now-ms) mtime-ms) 1000))))

(defn file-age-min [path]
  (when-let [secs (file-age-secs path)] (quot secs 60)))

(defn count-failed-box []
  (let [d (fs/path state-dir "handoffs" "failed")]
    (if (fs/directory? d) (count (fs/list-dir d)) 0)))

(defn worktree-mailbox-dirs []
  (let [wt (fs/path project-root ".worktrees")]
    (if (fs/directory? wt)
      (->> (fs/list-dir wt)
           (map #(fs/path % ".swarmforge" "handoffs"))
           (filter fs/directory?)
           vec)
      [])))

(defn all-mailbox-dirs []
  (into [(fs/path state-dir "handoffs")] (worktree-mailbox-dirs)))

(defn glob-handoffs [rel-glob]
  (mapcat (fn [mailbox]
            (try (map str (fs/glob mailbox rel-glob)) (catch Exception _ [])))
          (all-mailbox-dirs)))

(defn stuck-parcels []
  (->> (glob-handoffs "inbox/in_process/*.handoff")
       (keep (fn [p]
               (when-let [age-min (file-age-min p)]
                 (when (> age-min stuck-min)
                   {:name (fs/file-name p) :age-min age-min}))))
       vec))

(defn pending-claims []
  (->> (glob-handoffs "inbox/new/*.handoff")
       (keep (fn [p]
               (when-let [age-min (file-age-min p)]
                 {:abandoned? false :age-min age-min})))
       vec))

;; ── in-process claims for check 10, owner-busy? aware (6d-10) ────────────

(defn owning-role-for-path [path]
  (let [m (re-find #"\.worktrees/([^/]+)/\.swarmforge/handoffs" (str path))]
    (when m (second m))))

(defn in-process-claims [busy-by-role]
  (->> (glob-handoffs "inbox/in_process/*.handoff")
       (keep (fn [p]
               (when-let [age-min (file-age-min p)]
                 (let [role (owning-role-for-path p)]
                   {:age-min age-min
                    :owner-busy? (boolean (get busy-by-role role false))}))))
       vec))

;; ── memory floor ──────────────────────────────────────────────────────────
;; BL-802: /proc/meminfo is Linux-only. Try it first (BABYSITTER_MEMINFO_PATH
;; overrides it — the existing hermetic test seam, unchanged), then fall back
;; to macOS's vm_stat. nil only when neither facility yields a reading —
;; available-mem-mb's nil-means-truly-unavailable contract is unchanged.

(defn meminfo-path []
  (or (System/getenv "BABYSITTER_MEMINFO_PATH") "/proc/meminfo"))

(defn read-proc-meminfo-mb []
  (let [meminfo (try (slurp (meminfo-path)) (catch Exception _ ""))
        m (re-find #"MemAvailable:\s+(\d+)" meminfo)]
    (when m (quot (parse-long (second m)) 1024))))

(def ^:private vm-stat-page-size-pattern #"page size of (\d+) bytes")

(defn- vm-stat-count [text label]
  (some-> (re-find (re-pattern (str (java.util.regex.Pattern/quote label) ":\\s+(\\d+)\\.")) text)
          second parse-long))

(defn parse-vm-stat-available-mb [text]
  (when-let [page-size (some-> (re-find vm-stat-page-size-pattern text) second parse-long)]
    (let [free (vm-stat-count text "Pages free")
          inactive (vm-stat-count text "Pages inactive")
          speculative (vm-stat-count text "Pages speculative")]
      (when (and free inactive speculative)
        (quot (* page-size (+ free inactive speculative)) (* 1024 1024))))))

(defn read-vm-stat-mb []
  (let [r (sh! "vm_stat")]
    (when (zero? (:exit r)) (parse-vm-stat-available-mb (:out r)))))

(defn available-mem-mb []
  (or (read-proc-meminfo-mb) (read-vm-stat-mb)))

;; ── pause + rotate-note gathering ─────────────────────────────────────────

(defn read-pause []
  (let [f (fs/path state-dir "operator" "control-pause.json")]
    (if (fs/exists? f)
      (let [obj (try (json/parse-string (slurp (str f)) true) (catch Exception _ nil))]
        {:active? (boolean (:active obj)) :until-ms (:untilMs obj)})
      {:active? false :until-ms nil})))

(defn active-role-marker-mtime-ms []
  (let [f (fs/path state-dir "mono-router-active-role")]
    (when (fs/exists? f) (fs/file-time->millis (fs/last-modified-time f)))))

(defn active-role-marker []
  (let [f (fs/path state-dir "mono-router-active-role")]
    (when (fs/exists? f) (str/trim (slurp (str f))))))

(def rotate-pattern #"rotate_to_role\.sh ([A-Za-z]+)|[Rr]otate to ([A-Za-z]+)")

(defn newest-rotate-note []
  (let [now (now-ms)
        four-hours-ms (* 4 60 60 1000)
        candidates (concat (glob-handoffs "inbox/completed/*.handoff")
                           (glob-handoffs "inbox/done/*.handoff"))]
    (->> candidates
         (keep (fn [p]
                 (let [mtime-ms (fs/file-time->millis (fs/last-modified-time p))]
                   (when (<= (- now mtime-ms) four-hours-ms)
                     (let [content (try (slurp p) (catch Exception _ ""))
                           m (re-find rotate-pattern content)]
                       (when m
                         {:path p :mtime-ms mtime-ms
                          :target (or (nth m 1 nil) (nth m 2 nil))}))))))
         (sort-by :mtime-ms >)
         first)))

(defn gather-rotate-note []
  (when-let [{:keys [path mtime-ms target]} (newest-rotate-note)]
    (let [active-role-file-mtime (active-role-marker-mtime-ms)]
      {:note-name (fs/file-name path)
       :note-target target
       :note-age-min (quot (- (now-ms) mtime-ms) 60000)
       :grace-min rotate-grace-min
       :note-mtime-ms mtime-ms
       :active-role-file-mtime-ms (or active-role-file-mtime 0)
       :active-role (or (active-role-marker) "")})))

;; ── nudge-dedup persisted state ───────────────────────────────────────────

(defn read-dedup-state []
  (if (fs/exists? dedup-file)
    (try (json/parse-string (slurp (str dedup-file)) true) (catch Exception _ {}))
    {}))

(defn write-dedup-state! [m]
  (fs/create-dirs babysitterd-dir)
  (spit (str dedup-file) (json/generate-string m)))

(defn read-streak []
  (if (fs/exists? streak-file)
    (or (parse-long (str/trim (slurp (str streak-file)))) 0)
    0))

(defn write-streak! [n]
  (fs/create-dirs babysitterd-dir)
  (spit (str streak-file) (str n "\n")))

;; ── main ──────────────────────────────────────────────────────────────────

(defn -main []
  (let [socket (read-tmux-socket)
        role-rows (parse-roles-tsv)
        ps-output (ps-snapshot)
        roles (mapv (partial gather-role socket ps-output) role-rows)
        busy-by-role (into {} (map (juxt :role :busy?) roles))
        any-pane-busy? (boolean (some :busy? roles))
        pause (read-pause)
        claim-risks (try (babysitter-assess-lib/scan-claim-risks project-root)
                          (catch Exception _ []))
        ;; BL-804: resolve topology ONCE per sweep, then stamp each role's
        ;; :should-stand? — the sweep lib's check-live-session only ever sees
        ;; the resolved boolean, never a role name, so suppression can never
        ;; be hardcoded per role (invariant 1).
        rotation-router? (rotation-router-mode?)
        ordered-roles (mapv :role role-rows)
        roles (mapv #(assoc % :should-stand?
                             (should-stand-role? rotation-router? ordered-roles (:role %)))
                    roles)
        snapshot
        {:now-ms (now-ms)
         :roles (mapv #(dissoc % :pane-text) roles)
         :handoffd-alive? (proc-alive? "handoffd\\.bb")
         :handoffd-supervisor-alive? (proc-alive? "handoffd_supervisor\\.bb")
         :handoffd-log-age-secs (file-age-secs (fs/path state-dir "daemon" "handoffd.log"))
         :handoffd-max-age-secs heartbeat-max-secs
         :failed-count (count-failed-box)
         :stuck-parcels (stuck-parcels)
         ;; BL-802: nil (truly unavailable) flows through unmasked — no
         ;; fabricated default that would silently suppress a real low-memory
         ;; finding. check-memory-floor reports UNAVAILABLE on nil.
         :available-mb (available-mem-mb)
         :mem-floor-mb mem-floor-mb
         :claim-risks claim-risks
         :rotate-note (gather-rotate-note)
         :pause pause
         :active-ticket-count (count (fs/glob (fs/path project-root "backlog" "active") "*.yaml"))
         :any-pane-busy? any-pane-busy?
         :prev-streak (read-streak)
         :pending-claims (pending-claims)
         :in-process-claims (in-process-claims busy-by-role)
         :pending-max-age-min pending-max-age-min}
        {:keys [findings new-streak]} (babysitterd-sweep-lib/assemble-findings snapshot)
        ts (now-iso)]
    (write-streak! new-streak)
    (if (empty? findings)
      (println (str ts " OK all checks green"))
      (doseq [f findings]
        (println (babysitterd-sweep-lib/format-finding-line f ts))))
    (when nudge?
      (when (seq findings)
        (let [dedup-state (read-dedup-state)
              {:keys [to-nudge new-dedup-state]}
              (babysitterd-sweep-lib/decide-nudges findings
                                                   {:last-nudged-ms-by-key dedup-state
                                                    :now-ms (now-ms)
                                                    :cooldown-ms nudge-cooldown-ms})]
          (when (seq to-nudge)
            (let [message (babysitterd-sweep-lib/format-nudge-message to-nudge)
                  result (babysitter-nudge-lib/nudge-resident! project-root "coordinator" message)]
              (case (:status result)
                :nudged (do (write-dedup-state! new-dedup-state)
                            (println (str ts " NUDGED coordinator: " (count to-nudge) " finding(s)")))
                :skip-busy (println (str ts " NUDGE-SKIP coordinator busy — " (:detail result)))
                :no-target (println (str ts " NUDGE-SKIP " (:detail result)))
                (println (str ts " NUDGE-FAILED " (:detail result)))))))))
    (System/exit 0)))

(-main)
