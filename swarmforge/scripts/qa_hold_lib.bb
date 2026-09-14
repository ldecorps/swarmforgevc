;; qa_hold_lib.bb — BL-1566: an Article 4.2 hold is a durable record, not an
;; evidence-file sentence. QA opens one when it withholds approval on a red
;; with no open ticket (a hold names the parcel commit and the reds); the
;; standing-red register is the ONLY thing that releases it (every red the
;; hold names must have a register row whose ticket sits in backlog/paused/
;; or backlog/active/ — a done/ ticket owns nothing, an unnamed red is
;; unowned); and a released hold refuses to let a NOTE complete until QA
;; closes it with an outcome (a git_handoff inbound — the withheld parcel
;; itself, parked so a rotation resident can move on — is never blocked;
;; that is Article 4.2's own parking exception).
;;
;; The DECISIONS below (release?, status-lines, blocks-completion?) take
;; already-parsed data and do no I/O of their own — no per-red parsing of
;; note text anywhere (the ticket's own FIRM constraint). The small file-
;; reading layer under "shared reading" is the ONE place every caller
;; (ready_for_next_task.bb, done_with_current_task.bb, qa_hold_cli.bb)
;; reads the hold store, the register and the open-ticket set, so the three
;; never grow three independent readers of the same three sources.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "qa_hold_lib.bb")))
;; and referred to as qa-hold-lib/foo.

(ns qa-hold-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "standing_red_register_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))

;; ── pure decisions ──────────────────────────────────────────────────────

(defn red-owner
  "The ticket id a standing-red register row names for red, or nil when no
   row in register-rows (standing-red-register-lib/parse-register-rows'
   output) carries that file — lane is never consulted, a hold's red is
   matched by path alone across every lane."
  [register-rows red]
  (some (fn [r] (when (= red (:file r)) (:ticket r))) register-rows))

(defn release?
  "True only when hold's reds are non-empty and EVERY one has a register
   row whose owner sits in open-ticket-ids (the basenames under
   backlog/paused/ and backlog/active/ — a done/ ticket owns nothing, and a
   red with no register row at all is unowned). A hold naming no reds is
   never released — there is nothing for the register to have released."
  [{:keys [reds]} register-rows open-ticket-ids]
  (boolean
   (and (seq reds)
        (every? (fn [red]
                  (let [owner (red-owner register-rows red)]
                    (and owner (contains? open-ticket-ids owner))))
                reds))))

(defn- hold-lines
  [{:keys [task commit reds]} register-rows]
  (mapv (fn [red]
          (str "HOLD " task " " commit " red=" red
               " owner=" (or (red-owner register-rows red) "none")))
        reds))

(defn hold-status-lines
  "One hold -> its status lines: one `HOLD <task> <commit> red=<path>
   owner=<id|none>` line per red, in the hold's own red order — the ticket's
   own qa_e2e_procedure names both a HOLD line and a RELEASED line as
   status's output for a released hold, so the per-red detail is never
   dropped once released. When released, a `RELEASED <task> <commit>` line
   is prepended (not appended): the ticket's own acceptance scenario 05
   requires it to be the very FIRST line ready_for_next prints on a QA
   turn — the one line every wake actually needs to act on, ahead of the
   per-red detail. Still open: no RELEASED line at all."
  [hold register-rows open-ticket-ids]
  (let [{:keys [task commit]} hold
        lines (hold-lines hold register-rows)]
    (if (release? hold register-rows open-ticket-ids)
      (into [(str "RELEASED " task " " commit)] lines)
      lines)))

(defn status-lines
  "Every hold's status lines, concatenated in hold order — what `status`
   prints and what a QA turn with a non-empty store prints first."
  [holds register-rows open-ticket-ids]
  (vec (mapcat #(hold-status-lines % register-rows open-ticket-ids) holds)))

(defn released-holds
  [holds register-rows open-ticket-ids]
  (filterv #(release? % register-rows open-ticket-ids) holds))

(defn blocks-completion?
  "Article 4.2's parking exception, as a decision table: only a QA note
   inbound can be refused, and only while at least one hold is released.
   A git_handoff inbound (the withheld parcel QA completes so the rotation
   resident can move on) is never blocked, regardless of hold state —
   completing the parcel IS the parking, not a resume."
  [{:keys [role inbound-type holds register-rows open-ticket-ids]}]
  (boolean
   (and (= "QA" role)
        (= "note" inbound-type)
        (seq (released-holds holds register-rows open-ticket-ids)))))

;; ── shared reading layer (I/O; no decisions live here) ───────────────────

(defn holds-dir [root] (fs/path root ".swarmforge" "qa-holds"))
(defn closed-dir [root] (fs/path (holds-dir root) "closed"))
(defn hold-file [root task] (fs/path (holds-dir root) (str task ".json")))
(defn closed-hold-file [root task] (fs/path (closed-dir root) (str task ".json")))

(defn- read-json-file [f]
  (when (fs/exists? f)
    (json/parse-string (slurp (str f)) true)))

(defn read-holds
  "Every open (not yet closed) hold record under root's qa-holds store —
   {:task :commit :reds :evidence} maps. The closed/ subdirectory is never
   listed here: a closed hold no longer blocks anything and no live caller
   needs it (qa_hold_cli.bb's own close command reads it directly by path)."
  [root]
  (let [dir (holds-dir root)]
    (if (fs/exists? dir)
      (->> (fs/list-dir dir)
           (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".json")))
           (keep read-json-file)
           vec)
      [])))

(defn register-rows-for
  [root]
  (standing-red-register-lib/parse-register-rows
   (let [p (fs/path root "backlog" "standing-reds.tsv")]
     (when (fs/exists? p) (slurp (str p))))))

(defn- ticket-ids-in-dir [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir)
         (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".yaml")))
         (keep #(pipeline-stage-lib/extract-ticket-id (fs/file-name %)))
         set)
    #{}))

(defn open-ticket-ids-for
  "Ticket ids with a YAML file directly under backlog/paused/ or
   backlog/active/ at root — a done/ ticket (nested by milestone) owns
   nothing, so done/ is deliberately never read here."
  [root]
  (into (ticket-ids-in-dir (fs/path root "backlog" "paused"))
        (ticket-ids-in-dir (fs/path root "backlog" "active"))))
