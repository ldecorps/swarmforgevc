;; ceremony_handoff_lib.bb — BL-1360: the fixed pipeline sends, composed from
;; one definition instead of retyped.
;;
;; Three handoffs carry no judgement at all. The QA merge-up broadcast has a
;; fixed recipient list, a fixed priority and a fixed message; only the ticket
;; id and the approved commit vary. The QA→coordinator bookkeeping note and the
;; specifier's spec-ready note are the same shape. Each was nonetheless
;; hand-assembled every time: the role wrote the draft by hand, re-read
;; handoff-protocol.md to confirm the recipient list and whether `to:` takes a
;; comma-separated list, and measured the message with `wc -c` against the
;; 80-character cap before daring to send. Observed 2026-09-03: one QA seat
;; spent 16m06s and 58.6k tokens doing exactly that, for two notes whose every
;; field but two was already fixed.
;;
;; The hand-counting was redundant - swarm_handoff.bb already refuses an
;; over-cap message and names the measured length - but it was not irrational:
;; an over-cap note that reaches a mailbox by any other route is renamed
;; `.dead` and silently skipped, which lost a priority-00 operator directive on
;; 2026-08-22. So the fix is to compose a message that CANNOT exceed the cap,
;; not to tell roles to stop worrying.
;;
;; This namespace is pure: it composes a draft and never sends. The CLI beside
;; it invokes `swarm_handoff.sh` with what this returns, so every send-time
;; gate still arms and the tmux wake still fires (invariant 1). There is no
;; second way into a mailbox here, and there must never be one.

(ns ceremony-handoff-lib
  (:require [clojure.string :as str]))

;; handoff-protocol.md's own cap for a `note` message.
(def message-max-chars 80)

;; The ONE definition of each ceremony's recipients and priority (invariant 3).
;; `handoff-protocol.md` documents merge-up and bookkeep; the test runner
;; PARSES that document and asserts these agree with it, rather than restating
;; the claim in a comment - a "kept in sync" note across that boundary is not a
;; gate (BL-897).
;;
;; `message-forms` are tried longest-prose first. Truncation is never an
;; option: the ticket id and the commit are the two facts the recipient acts
;; on, so a message that will not fit is shortened in its PROSE, and if even
;; the shortest form will not fit the compose fails rather than cutting either.
(def ceremonies
  {"merge-up"
   {:to ["coder" "cleaner" "architect" "hardender" "documenter"]
    :priority "00"
    :needs [:ticket :commit]
    :summary "QA's broadcast telling each worktree role to merge up to the approved commit"
    :message-forms [(fn [{:keys [ticket commit]}]
                      (str ticket " QA-approved " commit " - merge your branch up to QA's"))
                    (fn [{:keys [ticket commit]}]
                      (str ticket " QA-approved " commit " - merge up"))]}

   "bookkeep"
   {:to ["coordinator"]
    :priority "00"
    :needs [:ticket :commit]
    :summary "QA telling the coordinator to move the ticket to done and promote the next"
    :message-forms [(fn [{:keys [ticket commit]}]
                      (str ticket " QA-approved " commit " - move to done and promote next"))
                    (fn [{:keys [ticket commit]}]
                      (str ticket " QA-approved " commit " - bookkeep"))]}

   "spec-ready"
   {:to ["coordinator"]
    :priority "00"
    :needs [:ticket]
    ;; handoff-protocol.md does not define this one, so the runner pins only
    ;; the two it does. Said out loud rather than pinned to a claim the
    ;; document does not make.
    :summary "the specifier telling the coordinator a paused ticket is ready to promote"
    :message-forms [(fn [{:keys [ticket]}]
                      (str ticket " spec ready in backlog/paused - promote when a slot is free"))
                    (fn [{:keys [ticket]}]
                      (str ticket " spec ready - promote when a slot is free"))]}})

(defn parse-args
  "Pure: argv -> {:ceremony :ticket :commit :dry-run?} or {:error \"...\"}.

   Lives here rather than in the CLI beside it so the whole parse is testable
   in-process, with no argv and no process boundary (the CLI thin-wrapper
   rule). A second positional is REFUSED rather than allowed to override the
   first: the sender meant one ceremony and we cannot know which."
  [argv]
  (loop [args (vec argv) acc {}]
    (if (empty? args)
      (if (:ceremony acc) acc {:error "no ceremony named"})
      (let [[a & more] args]
        (case a
          "--ticket" (if-let [v (first more)]
                       (recur (vec (rest more)) (assoc acc :ticket v))
                       {:error "--ticket needs a value"})
          "--commit" (if-let [v (first more)]
                       (recur (vec (rest more)) (assoc acc :commit v))
                       {:error "--commit needs a value"})
          "--dry-run" (recur (vec more) (assoc acc :dry-run? true))
          (cond
            (str/starts-with? a "--") {:error (str "unknown option " a)}
            (:ceremony acc) {:error (str "more than one ceremony named: " (:ceremony acc) " and " a)}
            :else (recur (vec more) (assoc acc :ceremony a))))))))

(defn ceremony-names
  "Defined ceremony names, sorted - what an unknown name is refused against."
  []
  (vec (sort (keys ceremonies))))

(defn- missing-facts [{:keys [needs]} facts]
  (vec (sort (map name (remove #(seq (str/trim (str (get facts %)))) needs)))))

(defn compose-message
  "The longest message form that fits the cap, or nil when none does.
   Never truncates: shortening happens in the prose, and running out of prose
   is a failure rather than a cut ticket id or commit (invariant 2)."
  [ceremony facts]
  (first (filter #(<= (count %) message-max-chars)
                 (map #(% facts) (:message-forms ceremony)))))

(defn compose
  "{:draft \"...\" :to [...] :priority \"..\" :message \"...\"} for a defined
   ceremony whose facts are all present, or {:error \"...\"}.

   The draft is the `field: value` shape swarm_handoff.sh parses - never JSON,
   never a mailbox write."
  [{:keys [ceremony] :as facts}]
  (if-let [spec (get ceremonies ceremony)]
    (let [missing (missing-facts spec facts)]
      (cond
        (seq missing)
        {:error (str "ceremony '" ceremony "' needs " (str/join " and " missing)
                     "; give " (str/join " and " (map #(str "--" %) missing)))}

        :else
        (if-let [message (compose-message spec facts)]
          {:to (:to spec)
           :priority (:priority spec)
           :message message
           :draft (str "type: note\n"
                       "to: " (str/join "," (:to spec)) "\n"
                       "priority: " (:priority spec) "\n"
                       "message: " message "\n")}
          {:error (str "ceremony '" ceremony "' cannot be composed within "
                       message-max-chars " characters without truncating the ticket id"
                       " or the commit - send this one as an ordinary note")})))
    {:error (str "unknown ceremony '" ceremony "' - defined ceremonies are "
                 (str/join ", " (ceremony-names)))}))
