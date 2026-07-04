;; Shared helpers for the inbox-facing handoff scripts (ready_for_next_task.bb,
;; done_with_current_task.bb, ready_for_next_batch.bb, done_with_current_batch.bb).
;; Loaded via load-file, not required on a classpath, so callers do:
;;   (load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))
;; and refer to symbols as handoff-lib/foo.

(ns handoff-lib
  (:require [babashka.fs :as fs]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(defn worktree-root
  "Handoff state lives at the worktree root even when invoked from a
   subdirectory; the daemon only delivers to worktree-root inboxes (BL-056).
   Falls back to the invocation cwd outside any git worktree."
  []
  (let [result (sh/sh "git" "rev-parse" "--show-toplevel")]
    (if (zero? (:exit result))
      (str/trim (:out result))
      (System/getProperty "user.dir"))))

(defn inbox-dir []
  (fs/path (worktree-root) ".swarmforge" "handoffs" "inbox"))

(defn target-root
  "Resolves the target project's root, shared across every role's worktree,
   via git's common gitdir (stable from a linked worktree or the main
   checkout alike). Target-root-scoped state — roles.tsv, the daemon dir, and
   the BL-069 bounce-drain sentinel — lives here, distinct from the
   per-worktree handoff state under (worktree-root)."
  []
  (let [result (sh/sh "git" "rev-parse" "--git-common-dir")]
    (if (zero? (:exit result))
      (str (fs/parent (fs/absolutize (str/trim (:out result)))))
      (worktree-root))))

(defn bounce-drain-sentinel []
  (fs/path (target-root) ".swarmforge" "bounce-drain.json"))

(defn draining?
  "True while a BL-069 graceful bounce is draining the swarm: ready_for_next*
   must then refuse to dequeue NEW inbox/new items (in_process resumption is
   unaffected) so a role finishes its current handoff and goes idle instead
   of picking up more work."
  []
  (fs/exists? (bounce-drain-sentinel)))

(defn timestamp []
  (.format java.time.format.DateTimeFormatter/ISO_INSTANT
           (java.time.Instant/now)))

(defn id-timestamp []
  (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
           (java.time.ZonedDateTime/now java.time.ZoneOffset/UTC)))

(defn handoff-files [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
         (sort-by #(fs/file-name %))
         vec)
    []))

(defn batch-dirs [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/directory? %) (str/starts-with? (fs/file-name %) "batch_")))
         (sort-by #(fs/file-name %))
         vec)
    []))

(defn header-field [file field]
  (let [prefix (str field ": ")]
    (some (fn [line]
            (when (str/starts-with? line prefix)
              (subs line (count prefix))))
          (take-while (complement str/blank?) (str/split-lines (slurp (str file)))))))

(defn header-value [file field default]
  (or (header-field file field) default))

(defn body [file]
  (let [[_ body] (str/split (slurp (str file)) #"\n\n" 2)]
    (or body "")))

(defn set-header! [file field value]
  (let [lines (str/split-lines (slurp (str file)))
        prefix (str field ": ")
        tmp (fs/create-temp-file {:dir (fs/parent file) :prefix ".headers."})
        result (loop [remaining lines
                      out []
                      inserted? false
                      replaced? false]
                 (if-let [line (first remaining)]
                   (cond
                     (and (not inserted?) (str/blank? line))
                     (recur (next remaining)
                            (conj (cond-> out (not replaced?) (conj (str prefix value))) line)
                            true
                            replaced?)

                     (and (not inserted?) (str/starts-with? line prefix))
                     (recur (next remaining) (conj out (str prefix value)) inserted? true)

                     :else
                     (recur (next remaining) (conj out line) inserted? replaced?))
                   (cond-> out
                     (and (not inserted?) (not replaced?)) (conj (str prefix value)))))]
    (spit (str tmp) (str (str/join "\n" result) "\n"))
    (fs/move tmp file {:replace-existing true})))

(defn fail! [status & lines]
  (binding [*out* *err*]
    (doseq [line lines]
      (println line)))
  (System/exit status))

(defn current-role []
  (let [r (System/getenv "SWARMFORGE_ROLE")]
    (when-not (str/blank? r) r)))

(defn mine?
  "True when this handoff's recipient matches the current role. Roles that share
   a worktree (e.g. coordinator + specifier on master) share one physical inbox,
   so filter by the recipient header the daemon stamps. Untagged files and an
   unset role fall through unchanged, preserving prior behavior."
  [file]
  (let [role (current-role)
        recipient (header-field file "recipient")]
    (or (nil? role) (nil? recipient) (= recipient role))))

(defn my-handoff-files [dir]
  (vec (filter mine? (handoff-files dir))))

(defn roles-tsv-path []
  (fs/path (target-root) ".swarmforge" "roles.tsv"))

(defn idle-clear-enabled?
  "True when role-name's roles.tsv row carries the BL-089 idle-clear token
   ('on') in the 8th (optional) column. Absent column, absent row, or any
   other value means off — matches the ticket's opt-in, default-off design."
  [role-name]
  (boolean
    (when (and role-name (fs/exists? (roles-tsv-path)))
      (some (fn [line]
              (let [fields (str/split line #"\t" -1)]
                (when (= role-name (first fields))
                  (= "on" (get fields 7)))))
            (str/split-lines (slurp (str (roles-tsv-path))))))))

(defn tmux-socket []
  (str/trim (slurp (str (fs/path (target-root) ".swarmforge" "tmux-socket")))))

(defn launch-script-path [role-name]
  (str (fs/path (target-root) ".swarmforge" "launch" (str role-name ".sh"))))

(defn pane-id [socket]
  (let [result (sh/sh "tmux" "-S" socket "display-message" "-p" "#{pane_id}")]
    (str/trim (:out result))))

(defn respawn-self!
  "Respawns this role's own tmux pane at the idle boundary (BL-089), running
   the same launch script a fresh pane launch would run so the new session
   gets the full role re-bootstrap. Mirrors the coordinator's manual
   respawn-pane procedure, but self-triggered from inside the pane being
   replaced instead of from an operator pane."
  [role-name]
  (let [socket (tmux-socket)
        pane (pane-id socket)
        script (launch-script-path role-name)]
    (sh/sh "tmux" "-S" socket "respawn-pane" "-k" "-t" pane (str "zsh '" script "'"))))

(defn print-task [file]
  (let [task-name (header-field file "task")]
    (println "TASK:" (str file))
    (println "FROM:" (header-value file "from" "unknown"))
    (println "TYPE:" (header-value file "type" "unknown"))
    (println "PRIORITY:" (header-value file "priority" "50"))
    (when task-name
      (println "TASK_NAME:" task-name))
    (println "PAYLOAD:")
    (print (body file))))
