#!/usr/bin/env bb
;; BL-1428 acceptance driver: drives the REAL standing_red_register_cli.bb
;; (via its own lib, never re-implemented) and the REAL
;; check_standing_red_register.sh over real fixture roots - never a
;; reimplementation of either.
;;
;; Usage: bl1428StandingRedRegisterCli.bb <mode> [args...]
;;   report                              scenario 01: build a fixture root
;;                                       (allowlist + ledger + register +
;;                                       backlog with open/closed tickets)
;;                                       and run the real CLI against it.
;;   guard <ticket-shape>                scenario 02: stage a register row
;;                                       naming a ticket in the given shape
;;                                       and run the real guard.
;;                                       ticket-shape: paused | active | done | none
;;   guard-pre-existing                  scenario 03: a closed-ticket row
;;                                       already on HEAD, then an unrelated
;;                                       staged change - the guard must not
;;                                       re-judge the pre-existing row.
;;   live-register                       scenario 04: reads THIS repo's own
;;                                       backlog/standing-reds.tsv and looks
;;                                       every named ticket up under
;;                                       backlog/paused and backlog/active.
;;
;; Prints one JSON line whose shape depends on mode (see each branch).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/canonicalize (fs/path script-dir ".." ".." ".." "..")))
(def register-cli (str (fs/path repo-root "swarmforge" "scripts" "standing_red_register_cli.bb")))
(def guard-sh (str (fs/path repo-root "swarmforge" "scripts" "check_standing_red_register.sh")))

(def FIXTURE-PREFIX "bl1428-acceptance-")

(defn- sweep-fixtures! []
  (doseq [d (fs/list-dir (fs/temp-dir))
          :when (str/starts-with? (fs/file-name d) FIXTURE-PREFIX)]
    (try (fs/delete-tree d) (catch Exception _ nil))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- g! [dir & args] (apply sh! dir "git" args))

(defn- write! [path content]
  (fs/create-dirs (fs/parent path))
  (spit (str path) content))

;; ── scenario 01: the register CLI's own report ──────────────────────────

(defn- run-report []
  (sweep-fixtures!)
  (let [root (str (fs/create-temp-dir {:prefix FIXTURE-PREFIX}))]
    (try
      (write! (fs/path root "backlog" "paused" "BL-9001-open-paused.yaml") "id: BL-9001\nstatus: todo\n")
      (write! (fs/path root "backlog" "active" "BL-9002-open-active.yaml") "id: BL-9002\nstatus: todo\n")
      (write! (fs/path root "backlog" "done" "M8" "BL-9003-closed.yaml") "id: BL-9003\nstatus: done\n")
      (write! (fs/path root "swarmforge" "scripts" "property_suite_standing_allowlist.tsv")
              (str "file\tdisposition\trationale\n"
                   "test/bl9001Owned.property.test.js\tallowlist\towner BL-9001, see register\n"
                   "test/bl9099Orphan.property.test.js\tallowlist\tno register row for this one\n"))
      (write! (fs/path root "backlog" "standing-reds.tsv")
              (str "# header\n"
                   "property\textension/test/bl9001Owned.property.test.js\tBL-9001\t2026-09-01\towned by an open paused ticket\n"
                   "unit\textension/test/bl9002.test.js\tBL-9002\t2026-09-01\towned by an open active ticket\n"
                   "unit\textension/test/bl9003.test.js\tBL-9003\t2026-08-01\towned by a CLOSED ticket - unowned\n"))
      (write! (fs/path root "backlog" "hardening-debt-ledger.yaml")
              (str "- parcel: BL-9002\n"
                   "  gate: mutation\n"
                   "  file_set: a.ts\n"
                   "  reason: test fixture\n"
                   "  load: \"1\"\n"
                   "  detected_at: 2026-09-01\n"))
      (let [res (sh! root "bb" register-cli root)]
        (println (:out res)))
      (finally (fs/delete-tree root)))))

;; ── scenarios 02/03: the guard against a real repo ──────────────────────

(defn- init-repo! [root]
  (g! root "init" "-q" "-b" "main")
  (g! root "config" "user.email" "t@t")
  (g! root "config" "user.name" "t")
  (g! root "config" "commit.gpgsign" "false"))

(defn- commit! [root path content message]
  (write! (fs/path root path) content)
  (g! root "add" "-A")
  (g! root "commit" "-q" "-m" message))

(defn- run-guard [ticket-shape]
  (sweep-fixtures!)
  (let [root (str (fs/create-temp-dir {:prefix FIXTURE-PREFIX}))]
    (try
      (init-repo! root)
      (case ticket-shape
        "paused" (write! (fs/path root "backlog" "paused" "BL-9001-x.yaml") "id: BL-9001\nstatus: todo\n")
        "active" (write! (fs/path root "backlog" "active" "BL-9001-x.yaml") "id: BL-9001\nstatus: todo\n")
        "done" (write! (fs/path root "backlog" "done" "M8" "BL-9001-x.yaml") "id: BL-9001\nstatus: done\n")
        "none" nil)
      (write! (fs/path root "backlog" "standing-reds.tsv") "# header\n")
      (write! (fs/path root "swarmforge" "scripts" "property_suite_standing_allowlist.tsv") "file\tdisposition\trationale\n")
      (write! (fs/path root "backlog" "hardening-debt-ledger.yaml") "# ledger\n")
      (g! root "add" "-A")
      (g! root "commit" "-q" "-m" "base")
      (let [ticket (if (= ticket-shape "none") "" "BL-9001")]
        (spit (str (fs/path root "backlog" "standing-reds.tsv"))
              (str "# header\n"
                   "unit\textension/test/newred.test.js\t" ticket "\t2026-09-05\tnew red\n")))
      (g! root "add" "-A")
      (let [res (sh! root "bash" guard-sh)]
        (println (json/generate-string {:exit (:exit res) :err (:err res) :out (:out res)})))
      (finally (fs/delete-tree root)))))

(defn- run-guard-pre-existing []
  (sweep-fixtures!)
  (let [root (str (fs/create-temp-dir {:prefix FIXTURE-PREFIX}))]
    (try
      (init-repo! root)
      (write! (fs/path root "backlog" "done" "M8" "BL-9003-x.yaml") "id: BL-9003\nstatus: done\n")
      (write! (fs/path root "swarmforge" "scripts" "property_suite_standing_allowlist.tsv") "file\tdisposition\trationale\n")
      (write! (fs/path root "backlog" "hardening-debt-ledger.yaml") "# ledger\n")
      ;; The register ALREADY names a closed ticket, committed earlier -
      ;; exactly the "pre-existing" shape scenario 03 describes.
      (commit! root "backlog/standing-reds.tsv"
               "# header\nunit\textension/test/stale.test.js\tBL-9003\t2026-08-01\talready stale before this commit\n"
               "base with a pre-existing stale row")
      ;; The commit under test touches something else entirely.
      (write! (fs/path root "README-unrelated.md") "unrelated change\n")
      (g! root "add" "-A")
      (let [res (sh! root "bash" guard-sh)]
        (println (json/generate-string {:exit (:exit res) :err (:err res) :out (:out res)})))
      (finally (fs/delete-tree root)))))

;; ── scenario 04: the live register, read-only ───────────────────────────

(defn- glob-first [dir pattern]
  (when (fs/exists? dir) (first (fs/glob dir pattern))))

(defn- run-live-register []
  (let [text (slurp (str (fs/path repo-root "backlog" "standing-reds.tsv")))
        rows (->> (str/split-lines text)
                  (remove #(or (str/blank? %) (str/starts-with? (str/trim %) "#")))
                  (map #(str/split % #"\t" -1)))
        results (for [cols rows
                      :let [ticket (nth cols 2 nil)]
                      :when ticket]
                  (let [found? (boolean (or (glob-first (fs/path repo-root "backlog" "paused") (str ticket "*.yaml"))
                                             (glob-first (fs/path repo-root "backlog" "active") (str ticket "*.yaml"))))]
                    {:ticket ticket :found found?}))]
    (println (json/generate-string {:results (vec results)
                                     :allFound (every? :found results)
                                     :count (count results)}))))

(let [[mode & rest-args] *command-line-args*]
  (case mode
    "report" (run-report)
    "guard" (run-guard (first rest-args))
    "guard-pre-existing" (run-guard-pre-existing)
    "live-register" (run-live-register)
    (do (binding [*out* *err*]
          (println "usage: bl1428StandingRedRegisterCli.bb <report|guard <shape>|guard-pre-existing|live-register>"))
        (System/exit 2))))
