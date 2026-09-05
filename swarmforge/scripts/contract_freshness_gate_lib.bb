;; contract_freshness_gate_lib.bb — BL-1411: refuses a git_handoff whose
;; ticket's acceptance feature file has been amended on main (or
;; origin/main) since the sender's merge-base with that ref, catching a
;; stale-contract forward at the SEND, before it can ride downstream to a
;; spec-gap bounce (BL-1370) or a duplicate-fix race (BL-1353).
;;
;; The constitution's existing remedy - a priority-00 note from the
;; specifier to whoever holds the parcel (Article "Amending An In-Flight
;; Ticket's Spec") - depends on two humans-in-the-loop being right at the
;; same moment: the specifier must know who holds the parcel, and the
;; holder must read the note before forwarding. This gate asks the
;; question mechanically instead, at the one moment a stale build can
;; still be caught before it costs a downstream bounce.
;;
;; ONLY the acceptance feature file is compared - never the ticket YAML
;; itself (that file is bookkeeping every role appends to and merges,
;; BL-1391; a YAML diff would false-block on every `notes:` append) and
;; never a second reader of the acceptance field (invariant 2: the path
;; comes from task_scope_gate_lib.bb's own declared-acceptance-path).
;;
;; FAIL-OPEN on anything it cannot read: an absent ref, an absent path on
;; that ref, or no merge-base each record :not-evaluated with a one-line
;; reason and NEVER refuse - an unreadable contract is BL-761's and
;; BL-314's failure to catch, not this gate's to guess at (invariant 3).

(ns contract-freshness-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "landed_ticket_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_scope_gate_lib.bb")))

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

(defn- ref-exists? [root ref]
  (zero? (:exit (git! root "rev-parse" "--verify" "--quiet" (str ref "^{commit}")))))

(defn- merge-base [root commit ref]
  (let [{:keys [exit out]} (git! root "merge-base" commit ref)]
    (when (zero? exit) (str/trim out))))

(defn- path-exists-on-ref? [root ref path]
  (zero? (:exit (git! root "cat-file" "-e" (str ref ":" path)))))

(defn- amending-commits [root base ref path]
  (let [{:keys [exit out]} (git! root "log" "--format=%h" (str base ".." ref) "--" path)]
    (if (zero? exit)
      (remove str/blank? (str/split-lines out))
      [])))

;; git diff --quiet's own exit convention: 0 = identical, 1 = differs, any
;; other code (>1) means the comparison itself could not be made.
(defn- path-differs? [root base ref path]
  (let [{:keys [exit]} (git! root "diff" "--quiet" base ref "--" path)]
    (case (int exit)
      0 false
      1 true
      nil)))

(defn decide-for-ref
  "Pure decision GIVEN the impure facts already gathered for one ref -
   split out so the branching (invariant 3's fail-open shape) is unit-
   testable without a real git process. facts: {:ref-exists? :base
   :path-exists-on-ref? :differs? :amending-commits}."
  [{:keys [ref ref-exists? base path-exists-on-ref? differs? amending-commits]}]
  (cond
    (not ref-exists?)
    {:action :not-evaluated :ref ref :reason (str "ref " ref " does not resolve")}

    (nil? base)
    {:action :not-evaluated :ref ref :reason (str "no merge-base with " ref)}

    (not path-exists-on-ref?)
    {:action :not-evaluated :ref ref :reason (str "the acceptance path is absent on " ref)}

    (nil? differs?)
    {:action :not-evaluated :ref ref :reason (str "the diff against " ref " could not be read")}

    differs?
    {:action :refuse :ref ref :base base :amending-commits amending-commits}

    :else
    {:action :clean :ref ref}))

(defn- gather-and-decide-for-ref [root commit path ref]
  (let [exists? (ref-exists? root ref)
        base (when exists? (merge-base root commit ref))
        on-ref? (when (and exists? base) (path-exists-on-ref? root ref path))
        differs? (when (and exists? base on-ref?) (path-differs? root base ref path))
        amending (when differs? (amending-commits root base ref path))]
    (decide-for-ref {:ref ref :ref-exists? exists? :base base
                      :path-exists-on-ref? on-ref? :differs? differs?
                      :amending-commits amending})))

(def refs-checked ["main" "origin/main"])

;; Reported to the sender only when a ref that DOES resolve still could not
;; be evaluated (an absent path, no merge-base, an unreadable diff) -
;; invariant 3's "stated in one line." A ref that simply does not exist at
;; all (origin/main in the overwhelming majority of local checkouts, which
;; carry no remote) is not surfaced: that is the ordinary case for nearly
;; every send this gate will ever see, and reporting it every time would
;; bury the rare, genuinely informative case in noise.
(defn- reportable-not-evaluated? [{:keys [action ref reason]}]
  (and (= :not-evaluated action)
       (not= reason (str "ref " ref " does not resolve"))))

(defn findings-for-git-handoff
  "The one impure entry point. Returns {:findings [...] :not-evaluated [...]
   :path ...} on a clean read (findings possibly empty), or {:warning
   \"...\"} when the ticket/path itself could not be resolved at all -
   mirroring the sibling send-time gates' own contract (never both keys)."
  [{:keys [root task-name commit]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)]
    (if-not task-ticket-id
      {:findings []}
      (let [ticket-yaml (landed-ticket-lib/active-ticket-yaml-content root task-ticket-id)]
        (if-not ticket-yaml
          {:warning (str "contract-freshness check could not run for " task-name
                         " (its ticket YAML could not be read) - send allowed, unverified")}
          (let [path (task-scope-gate-lib/declared-acceptance-path ticket-yaml)]
            (if-not path
              {:findings []}
              (let [decisions (mapv #(gather-and-decide-for-ref root commit path %) refs-checked)
                    refusals (filter #(= :refuse (:action %)) decisions)
                    not-evaluated (filter reportable-not-evaluated? decisions)]
                {:findings (mapv (fn [d] {:path path :ref (:ref d) :amending-commits (:amending-commits d)})
                                 refusals)
                 :not-evaluated (mapv (fn [d] (str task-name " " path " on " (:ref d) ": " (:reason d)))
                                       not-evaluated)
                 :path path}))))))))

(defn blocked? [{:keys [findings]}]
  (boolean (seq findings)))

(defn refusal-message
  "Mirrors the self-audit's own shape: CONTRACT_AMENDED_SINCE_BASE, then
   HANDOFF_NOT_QUEUED, then the amending commit(s), the path, and the
   remedy - naming every ref that amended, since BL-891 either can be the
   fresh one."
  [{:keys [task-name findings]}]
  (let [path (:path (first findings))
        per-ref (map (fn [{:keys [ref amending-commits]}]
                       (format "  %s amended on %s by %s" path ref (str/join ", " amending-commits)))
                     findings)]
    (str "CONTRACT_AMENDED_SINCE_BASE for " task-name "\n"
         "HANDOFF_NOT_QUEUED\n"
         (str/join "\n" per-ref) "\n"
         "Remedy: merge main (and origin/main), replay the amendment, send again.")))
