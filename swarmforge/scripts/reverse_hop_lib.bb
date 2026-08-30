;; BL-1299: which roles may receive a REVERSE git_handoff copy, and which
;; role is stamped terminal.
;;
;; A reverse copy carries `non-forwarding: true`, and Article 2.4 makes such
;; an inbound merge-only: "run the payload merge, then done_with_current.sh".
;; That only makes sense for a role holding its own code worktree branch.
;; The coordinator and the specifier both work in the MASTER checkout, and
;; both are forbidden to integrate (Article 1.2 - the specifier "never
;; merges, closes tickets, or integrates"; Article 4.2/1.8 - QA lands the
;; approved commit on `main`). Addressing either a merge-only inbound orders
;; it to land unapproved in-flight work on the published branch with no QA
;; gate in the path - measured on the live 2026-08-30 inbound at 398 commits
;; / 392 files.
;;
;; Master-residency is DERIVED from the roles table, never a hardcoded second
;; role name beside "coordinator" (human ruling 2026-08-30: "BL-1299
;; approved: derive master-resident from roles.tsv, not hardcode"). Adding a
;; role to the pack that works in the master checkout therefore excludes it
;; automatically, with no edit here.
;;
;; Loaded via load-file; refer as reverse-hop-lib/<name>.

(ns reverse-hop-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

;; roles.tsv column 2 is the worktree NAME. swarmforge.sh's parse_config
;; maps exactly these two values to WORKING_DIR - the master checkout itself
;; - instead of creating a dedicated worktree/branch:
;;     if [[ "$worktree" == "none" || "$worktree" == "master" ]]; then
;;       worktree_path="$WORKING_DIR"
;; and prepare_worktrees skips worktree creation on the same pair. So these
;; are the roles-table values that MEAN "this role works in the master
;; checkout". Column 3 (the absolute path) carries the same fact and is an
;; equally valid derivation; column 2 is used because it needs no path
;; normalisation to compare (a symlinked or trailing-slash root would make a
;; string path comparison silently miss, and a missed row reinstates the
;; defect).
(def master-worktree-names #{"master" "none"})

(defn row-fields
  "roles.tsv row split on tabs, keeping trailing empties."
  [line]
  (str/split line #"\t" -1))

(defn row-role
  "The seat id in column 1 of a roles.tsv row."
  [line]
  (first (row-fields line)))

(defn master-resident-row?
  "True when this roles.tsv row's worktree column says the role works in the
   master checkout. A row with no worktree column is NOT master-resident:
   a malformed row must not silently drop a real code-worktree role out of
   the pipeline order and move the terminal stamp."
  [line]
  (contains? master-worktree-names
             (str/trim (or (get (row-fields line) 1) ""))))

(defn coordinator-row?
  "True when this row's seat is the coordinator, whichever worktree it
   declares. Today provision_coordinator always registers it with worktree
   'master', so master-resident-row? already covers it; this keeps the
   pre-BL-1299 exclusion explicit so a coordinator row that ever declared a
   real worktree still stays out of the reverse-recipient set."
  [line]
  (= "coordinator" (handoff-lib/seat-stage (row-role line))))

;; roles.tsv column 9 is the reverse-hop propagation mode (register_role's
;; $9, default forward-only). An absent, blank or unrecognised value is
;; forward-only - a typo must never widen the reverse fan-out.
(def propagation-modes #{"forward-only" "back-one" "back-all"})

(defn row-propagation
  "This row's declared propagation mode, or nil when it declares none valid."
  [line]
  (let [mode (str/trim (or (get (row-fields line) 8) ""))]
    (when (contains? propagation-modes mode) mode)))

(defn propagation-for
  "role's declared propagation mode from the roles table, defaulting to
   forward-only when the role is absent or declares nothing valid."
  [lines role]
  (or (some #(when (= role (row-role %)) (row-propagation %))
            (remove str/blank? lines))
      "forward-only"))

(defn pipeline-roles
  "Seat ids from roles.tsv order that may hold a parcel in a worktree of
   their own: every row that is neither the coordinator nor master-resident.
   This is the order reverse recipients and the terminal stamp are both read
   from."
  [lines]
  (->> lines
       (remove str/blank?)
       (remove master-resident-row?)
       (remove coordinator-row?)
       (mapv row-role)))

(defn last-pipeline-role
  "The role stamped terminal on a forward git_handoff - the LAST code-worktree
   role in roles.tsv order. Excluding master-resident roles never moves this:
   they are at the front of the pipeline, never the end."
  [lines]
  (last (pipeline-roles lines)))

(defn reverse-recipients
  "Roles that receive a non-forwarding reverse copy of sender's git_handoff.
   back-one is the immediately preceding code-worktree role; back-all is
   every earlier one; anything else (forward-only, unknown, a sender absent
   from the table) is none. The 2-arity reads sender's mode from the table."
  ([lines sender] (reverse-recipients lines sender (propagation-for lines sender)))
  ([lines sender mode]
   (let [roles (pipeline-roles lines)
         idx (.indexOf roles sender)]
     (if (neg? idx)
       []
       (case mode
         "back-one" (if (pos? idx) [(nth roles (dec idx))] [])
         "back-all" (vec (take idx roles))
         [])))))

(defn roles-lines
  "roles.tsv lines under root, or [] when the table is absent."
  [root]
  (let [tsv (fs/path root ".swarmforge" "roles.tsv")]
    (if (fs/exists? tsv)
      (str/split-lines (slurp (str tsv)))
      [])))
