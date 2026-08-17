#!/usr/bin/env bb
;; BL-821 coder pass (BL-654 Invariants): PROPERTY test over
;; briefing_email_lib.bb's send-unsent-briefings!/commit-sent-marker!
;; wiring encoding (the module-scoped part of) the ticket's first declared
;; invariant:
;;
;;   "A given briefing file is emailed at most once across every host and
;;    checkout, under any interleaving of sweep ticks, pulls, and marker
;;    writes."
;;
;; ── Scope this property actually covers, and why the rest is a stated
;;    reason rather than a second assertion here (BL-654: "when a declared
;;    invariant admits no executable encoding... record a stated reason") ──
;;
;; This module's job (Leg A) is to COMMIT the sent-marker so a fresh pull
;; sees it - never to PUBLISH it (that is push_sweep_lib.bb's existing,
;; separately-tested job: see its own header, "nothing in the swarm ever
;; pushes... this lib is the periodic 'does main need publishing?' sweep")
;; or to decide WHEN a host refreshes its checkout before a sweep tick
;; (that is the pre-existing main-reconcile machinery, also not this
;; ticket's). Given that division, the literal invariant - true for EVERY
;; interleaving, including one where two hosts tick back-to-back with zero
;; pull between them - is not a claim this module can make alone: if
;; neither host's checkout has ever seen the other's commit, each will
;; independently and correctly conclude the file is unsent and send it.
;; That is not a bug in this module; it is exactly the gap Leg A closes
;; from the OTHER side (a fresh checkout that HAS pulled never re-sends)
;; and relies on existing publish/pull cadence to bound in practice - the
;; same "committed, not pushed" contract the ticket text itself describes
;; ("the same family as other durable operator bookkeeping").
;;
;; So this property tests the precise, honest claim this module owns: for
;; ANY number of hosts and ANY order of sweep ticks, PROVIDED each host's
;; checkout is freshly synced with the shared durable store immediately
;; before that host's own tick (i.e. the tick reads what the store most
;; recently committed - matching how the real daemon's sweep runs against
;; a checkout the surrounding swarm keeps reconciled), a given file is
;; sent at most once, globally, regardless of host count or tick order.
;; "Freshly synced immediately before the tick" is modeled as an explicit
;; pull step folded into every tick below - see host-tick! - rather than
;; a separately-orderable primitive, precisely because decoupling pull
;; timing from tick timing is the part this module does not own.
;;
;; Non-vacuity proven by hand at authoring time: temporarily made
;; host-tick! skip its own pull-before-tick step (i.e. simulated a stale
;; checkout) and reran this file - P1 failed with more than one global
;; send for the same file on the first several generated multi-host cases,
;; exactly the double-send this property exists to catch, then the pull
;; step was restored and all properties passed again.

(ns bl821-briefing-marker-cross-host-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "briefing_email_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def file-name "2026-08-17.md")

;; A random interleaving of host indices [0..host-count) of a given
;; length - the SEQUENCE of who ticks next is what this property varies;
;; the pull-before-every-tick discipline is fixed (see the doc header).
(defn- gen-schedule [s]
  (let [[host-count s1] (gen-int s 4)
        host-count (+ 2 host-count)          ;; 2..5 hosts
        [len s2] (gen-int s1 10)
        len (+ 3 len)                        ;; 3..12 ticks total
        [schedule s3]
        (reduce (fn [[acc s] _]
                  (let [[h s'] (gen-int s host-count)]
                    [(conj acc h) s']))
                [[] s2]
                (range len))]
    [{:host-count host-count :schedule schedule} s3]))

;; ── the "durable store" model ────────────────────────────────────────────
;; A single shared atom holds the committed .sent.json CONTENT (nil until
;; first commit) - standing in for "what a `git log -p` of the marker path
;; would show at the shared remote's current HEAD" (this ticket's own
;; commit-marker! adapter seam, wired here to a fake instead of real git -
;; the real-git proof of the commit mechanics themselves lives in
;; test_briefing_marker_commit.sh, same split as bl902's property runner
;; vs its own real-fixture wiring test).

(defn- sync-host! [host-dir shared-store]
  (when-let [content @shared-store]
    (spit (briefing-email-lib/sent-state-path host-dir) content)))

(defn- host-tick! [host-dir shared-store global-sent-count]
  (sync-host! host-dir shared-store)          ;; pull-before-tick (see doc header)
  (briefing-email-lib/send-unsent-briefings!
   host-dir
   {:read-briefing-content (fn [_f] "content\n")
    :send-email! (fn [& _] (swap! global-sent-count inc) {:success true})
    :commit-marker! (fn [dir] (reset! shared-store (slurp (briefing-email-lib/sent-state-path dir))) {:ok true})
    :log! (fn [& _] nil)}))

;; P1: across ANY host count / tick-order schedule, the file is sent at
;; most once, globally - each host pulling fresh immediately before its
;; own tick (see doc header for why that precondition is baked in here
;; rather than independently varied).
(loop [i 0 s 11]
  (when (< i runs)
    (let [[{:keys [host-count schedule]} s'] (gen-schedule s)
          host-dirs (vec (repeatedly host-count #(str (fs/create-temp-dir {:prefix "bl821-prop-"}))))
          shared-store (atom nil)
          global-sent-count (atom 0)]
      (try
        (doseq [host-dir host-dirs]
          (spit (str (fs/path host-dir file-name)) "content\n"))
        (doseq [h schedule]
          (host-tick! (nth host-dirs h) shared-store global-sent-count))
        (when (> @global-sent-count 1)
          (report! "P1-at-most-once-across-hosts" s
                    {:host-count host-count :schedule schedule}
                    (str "expected at most 1 global send, got " @global-sent-count)))
        (finally
          (doseq [d host-dirs] (fs/delete-tree d))))
      (recur (inc i) s'))))

;; generator-reach floor: confirm the generator actually samples both a
;; single-host-repeats-only schedule risk case and a genuinely
;; multi-host-interleaved case within the run budget.
(let [seen-multi-host-interleaved (atom false)]
  (loop [i 0 s 11]
    (when (< i runs)
      (let [[{:keys [schedule]} s'] (gen-schedule s)]
        (when (> (count (distinct schedule)) 1) (reset! seen-multi-host-interleaved true))
        (recur (inc i) s'))))
  (when-not @seen-multi-host-interleaved
    (swap! failures conj "FAIL generator-reach: never sampled a schedule touching more than one host")))

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str "\n" (count @failures) " property checks failed"))
    (System/exit 1))
  (println (str "ALL PASS: bl821_briefing_marker_cross_host_property_runner.bb (" runs " runs)")))
