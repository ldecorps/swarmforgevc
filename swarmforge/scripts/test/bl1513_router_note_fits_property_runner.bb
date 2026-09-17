#!/usr/bin/env bb
;; BL-1513 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests encoding both declared invariants.
;;
;;   invariant 1 - "A note route_backlog_to_coder.sh sends is delivered
;;      byte-for-byte as composed: a message over the 80-character header
;;      limit is refused with the limit and its length named and nothing
;;      is queued; the router never shortens a message.": drives the REAL
;;      script against a real fixture repo (the fake-tmux-socket trick the
;;      acceptance handler uses - a file at .swarmforge/tmux-socket, no
;;      real tmux session needed, since deliver-parcel! writes the target
;;      file before attempting the wake) across ticket-id lengths
;;      straddling the exact threshold (35 + 2*id-length <= 80, i.e.
;;      id-length <= 22) - the domain is one integer parameter with a
;;      single hard threshold, so covering every length immediately around
;;      it (21-24) plus representative far points on both sides reaches
;;      every distinct behavior class with certainty, never a hoped-for
;;      sample, without paying a real git-repo-plus-subprocess round trip
;;      per integer in a 30-wide range (BL-1541: seconds, not minutes -
;;      measured at 60 trials before narrowing to this set).
;;
;;   invariant 2 - "The routed message keeps the verb-first Work
;;      <ticket-id> form that chase_sweep_lib.bb's
;;      spec-work-ticket-id-pattern and BL-1422's completion guard parse,
;;      and notes already on record in the old Work <basename>: read file
;;      in backlog/active shape stay readable by every parser unchanged.":
;;      for every id in the same length sweep, the REAL parser
;;      (chase-sweep-lib/dispatch-trail-ticket-id) recovers the exact id
;;      from the NEW message shape, AND (independent of length) recovers
;;      it from a hand-built OLD-shape message too - the backward-
;;      compatibility half this ticket must not break.
;;
;; Non-vacuous by hand before committing: reverting
;; route_backlog_to_coder.sh's fix (MSG composed from BASENAME, cut to 80
;; instead of refused) fails invariant 1 immediately - the "fits" case no
;; longer names the id (a long basename desyncs from TICKET_ID) and the
;; "refuse" case never refuses at all (the old code always queues, cut);
;; reverted before landing.

(ns bl1513-router-note-fits-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/parent (fs/parent (fs/parent script-dir))))
(def scripts-dir (fs/path repo-root "swarmforge" "scripts"))
(def route-sh (str (fs/path scripts-dir "route_backlog_to_coder.sh")))

(load-file (str (fs/path scripts-dir "chase_sweep_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply p/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- mk-fixture! []
  (let [root (str (fs/create-temp-dir {:prefix "bl1513-property-"}))]
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (sh! root "git" "commit" "-q" "--allow-empty" "-m" "seed")
    (fs/create-dirs (fs/path root ".swarmforge"))
    (fs/create-dirs (fs/path root "backlog" "active"))
    (fs/create-dirs (fs/path root "backlog" "done"))
    (fs/create-dirs (fs/path root "swarmforge"))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n"
               "coder\tcoder\t" root "\tswarmforge-coder\tCoder\tclaude\ttask\n"))
    (spit (str (fs/path root "swarmforge" "swarmforge.conf")) "config active_backlog_max_depth 50\n")
    ;; The fake-socket trick: deliver-parcel! writes the recipient's target
    ;; file BEFORE attempting the tmux wake, so any file here is enough.
    (let [sock (fs/path root "fake.sock")]
      (spit (str sock) "")
      (spit (str (fs/path root ".swarmforge" "tmux-socket")) (str sock)))
    root))

(defn- id-of-length [prefix total-length]
  ;; prefix + "-" + digits, padded/truncated so the WHOLE id is exactly
  ;; total-length characters (never shorter than prefix + "-" + 1 digit).
  (let [head (str prefix "-")
        digits-needed (max 1 (- total-length (count head)))]
    (str head (apply str (repeat digits-needed "9")))))

(defn- route! [root ticket-id]
  (spit (str (fs/path root "backlog" "active" (str ticket-id "-fixture.yaml")))
        (str "id: " ticket-id "\ntitle: \"fixture\"\nstatus: todo\nassigned_to: coder\n"))
  (sh! root "env" (str "SWARMFORGE_SKIP_DAEMON=0") (str "SWARMFORGE_ROLE=coordinator")
       route-sh ticket-id root))

(defn- new-mailbox-message [root]
  (let [dir (fs/path root ".swarmforge" "handoffs" "inbox" "new")]
    (when (fs/exists? dir)
      (some (fn [f]
              (let [text (slurp (str f))]
                (when-let [m (re-find #"(?m)^message: (.*)$" text)]
                  (second m))))
            (fs/list-dir dir)))))

;; ── invariant 1: exhaustive length sweep, byte-exact or refused ─────────

(doseq [id-length [1 5 10 21 22 23 24 30]
        prefix ["BL" "GH"]]
  (let [root (mk-fixture!)
        ticket-id (id-of-length prefix id-length)
        expected-msg (str "Work " ticket-id ": read backlog/active/" ticket-id "-*.yaml")
        expected-len (count expected-msg)
        result (route! root ticket-id)]
    (try
      (if (<= expected-len 80)
        (do
          (when (not (zero? (:exit result)))
            (fail! (str "invariant 1: id-length=" id-length " prefix=" prefix
                        " expected a successful route (composed length " expected-len
                        "), got exit " (:exit result) ": " (:out result) (:err result))))
          (let [delivered (new-mailbox-message root)]
            (when (not= expected-msg delivered)
              (fail! (str "invariant 1: id-length=" id-length " prefix=" prefix
                          " expected the delivered message byte-exact " (pr-str expected-msg)
                          " got " (pr-str delivered))))))
        (do
          (when (zero? (:exit result))
            (fail! (str "invariant 1: id-length=" id-length " prefix=" prefix
                        " expected a refusal (composed length " expected-len " > 80), got exit 0")))
          (let [out (str (:out result) (:err result))]
            (when-not (str/includes? out "80")
              (fail! (str "invariant 1: id-length=" id-length " prefix=" prefix
                          " refusal did not name the 80-character limit: " out)))
            (when-not (str/includes? out (str expected-len))
              (fail! (str "invariant 1: id-length=" id-length " prefix=" prefix
                          " refusal did not name the composed length " expected-len ": " out))))
          (when (new-mailbox-message root)
            (fail! (str "invariant 1: id-length=" id-length " prefix=" prefix
                        " a refusal still queued a note")))))
      (finally (fs/delete-tree root)))))

;; ── invariant 2: the real parser recovers the id, new shape and old ─────

(doseq [id-length [3 10 22 23 30]
        prefix ["BL" "GH"]]
  (let [ticket-id (id-of-length prefix id-length)
        new-shape (str "Work " ticket-id ": read backlog/active/" ticket-id "-*.yaml")
        old-shape (str "Work " ticket-id "-some-old-slug: read file in backlog/active")]
    (when (not= ticket-id (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message new-shape}))
      (fail! (str "invariant 2: the new-shape message for " ticket-id
                  " did not parse back to it: " new-shape)))
    (when (not= ticket-id (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message old-shape}))
      (fail! (str "invariant 2: an old-shape message for " ticket-id
                  " no longer parses (backward compatibility broken): " old-shape)))))

(println "bl1513_router_note_fits property: 16 real-route length-sweep trials (invariant 1) + 10 parser checks x2 shapes (invariant 2)")
(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
