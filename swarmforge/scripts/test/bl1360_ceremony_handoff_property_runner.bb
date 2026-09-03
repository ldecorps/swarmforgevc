#!/usr/bin/env bb
;; BL-1360: PROPERTY tests over ceremony_handoff_lib.bb and the CLI beside it,
;; covering the three invariants the ticket YAML declares (coder-authored
;; first, per BL-654):
;;
;;   P1 send-path-integrity - every ceremony that reaches a mailbox got there
;;      through swarm_handoff.sh. Observed, not asserted about the source: a
;;      delivered copy carries the envelope headers only the tool stamps
;;      (id/from/recipient/created_at/enqueued_at), which a direct mailbox
;;      write could not produce. --dry-run reaches no mailbox at all.
;;   P2 cap-by-construction - for every ceremony and every ticket/commit, the
;;      composition either refuses or yields a SINGLE line within the cap that
;;      contains the ticket id and the commit VERBATIM. Never truncated.
;;   P3 one-definition - the recipient list and priority of a ceremony
;;      handoff-protocol.md defines agree with the lib, read by PARSING that
;;      document rather than restating its values here (BL-897: a constant
;;      mirrored across a boundary needs a test asserting both literals
;;      agree).
;;
;; Toolchain note, as ambulance_lib_property_runner.bb records: the BL-654
;; contract's "*.property.test.js / vitest.properties.config.mjs" home is a
;; TypeScript convention with no Babashka equivalent (BL-472 defers wiring
;; mutation/property tooling for .bb). This file follows the property-test
;; precedent this repo already established for .bb code - a hand-rolled
;; seeded generator (deterministic, never rand) in swarmforge/scripts/test/.
;;
;; NON-VACUITY. P2's generator must actually straddle the cap boundary, or it
;; would pass on the roomy form forever and prove nothing (BL-654's
;; generator-reach requirement). Ticket lengths are drawn to span short,
;; boundary and over-long, and the run asserts a REACHABILITY FLOOR: all three
;; outcomes - roomy form, shortened form, refusal - must each be observed, or
;; the property run itself fails.

(ns bl1360-ceremony-handoff-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-root (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(load-file (str (fs/path script-root "ceremony_handoff_lib.bb")))

(def repo-root (str (fs/parent (fs/parent (fs/canonicalize script-root)))))
(def protocol-file (str (fs/path repo-root "swarmforge" "handoff-protocol.md")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; ── seeded generator (same LCG shape as the other .bb property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def ticket-alphabet "abcdefghijklmnopqrstuvwxyz-0123456789")

(defn- gen-ticket
  "A ticket id whose LENGTH is drawn to straddle the cap boundary: short ids
   the roomy form fits, mid-length ids only the terse form fits, and ids no
   form can carry. Drawing length uniformly over a narrow range would sample
   one side of the boundary only."
  [s]
  (let [[n s'] (gen-int s 70)
        [suffix s''] (reduce (fn [[acc st] _]
                               (let [[i st'] (gen-int st (count ticket-alphabet))]
                                 [(str acc (nth ticket-alphabet i)) st']))
                             ["" s']
                             (range n))]
    [(str "BL-" (inc n) suffix) s'']))

(defn- gen-commit [s]
  (let [[n s'] (gen-int s 2)]
    ;; the two commit shapes a ceremony is ever given: the 10-char abbrev the
    ;; protocol names, and a full 40-char sha a sender may paste instead.
    [(subs "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" 0 (if (zero? n) 10 40)) s']))

;; ── P2 cap-by-construction (pure, every run) ─────────────────────────────

(def ^:private p2-outcomes (atom #{}))

(defn- check-p2! [seed ceremony ticket commit]
  (let [spec (get ceremony-handoff-lib/ceremonies ceremony)
        needs-commit? (some #{:commit} (:needs spec))
        facts (cond-> {:ceremony ceremony :ticket ticket}
                needs-commit? (assoc :commit commit))
        {:keys [message error draft]} (ceremony-handoff-lib/compose facts)
        input {:ceremony ceremony :ticket ticket :commit commit}]
    (if error
      (do (swap! p2-outcomes conj :refused)
          ;; A refusal must be a refusal: no half-composed draft rides along.
          (when draft (report! "P2" seed input "a refusal still produced a draft")))
      (do
        (swap! p2-outcomes conj (if (str/ends-with? message "- merge up") :terse :roomy))
        (when (str/includes? message "\n")
          (report! "P2" seed input (str "message is not a single line: " (pr-str message))))
        (when (> (count message) ceremony-handoff-lib/message-max-chars)
          (report! "P2" seed input (str "message is " (count message) " chars: " (pr-str message))))
        (when-not (str/includes? message ticket)
          (report! "P2" seed input (str "ticket id truncated out of: " (pr-str message))))
        (when (and needs-commit? (not (str/includes? message commit)))
          (report! "P2" seed input (str "commit truncated out of: " (pr-str message))))
        ;; the draft the CLI hands on is the message plus fixed headers, and
        ;; every one of its lines is a `field: value` header - never JSON,
        ;; never a body (Article 2.2).
        (doseq [line (str/split-lines (str/trim draft))]
          (when-not (re-matches #"^[a-z_-]+: .*$" line)
            (report! "P2" seed input (str "draft line is not a header: " (pr-str line)))))))))

;; the ceremony names are drawn from the lib itself, so a fourth ceremony
;; added later is covered without editing this runner.
(def ceremony-name-pool (ceremony-handoff-lib/ceremony-names))

(loop [i 0 s 20260903]
  (when (< i runs)
    (let [[ceremony s1] (gen-pick s ceremony-name-pool)
          [ticket s2] (gen-ticket s1)
          [commit s3] (gen-commit s2)]
      (check-p2! s ceremony ticket commit)
      (recur (inc i) s3))))

;; The reachability floor: an asserted one, not a hoped-for one.
(doseq [outcome [:roomy :terse :refused]]
  (when-not (contains? @p2-outcomes outcome)
    (swap! failures conj
           (str "FAIL P2 generator reach: outcome " outcome " was never generated in "
                runs " runs - the property cannot have exercised the cap boundary."))))

;; ── P3 one-definition, pinned by PARSING handoff-protocol.md ─────────────
;;
;; The document is the source; the lib must agree with it. Parsed rather than
;; restated: a comment saying "kept in sync" is not a gate.

(def protocol-text (slurp protocol-file))

(defn- protocol-section
  "The text of the numbered protocol step introduced by `heading`, up to the
   next numbered step."
  [heading]
  (when-let [start (str/index-of protocol-text heading)]
    (let [tail (subs protocol-text start)
          end (or (some->> (re-find #"(?s)^.*?\n\d+\. \*\*" tail) count (+ -4)) (count tail))]
      (subs tail 0 end))))

(defn- backticked [text] (map second (re-seq #"`([^`]+)`" text)))

(let [section (protocol-section "**QA → worktree roles:**")]
  (if-not section
    (swap! failures conj "FAIL P3: handoff-protocol.md no longer documents the QA merge-up broadcast; the lib's recipient list is now unpinned.")
    (let [quoted (backticked section)
          documented-list (first (filter #(and (str/includes? % ",")
                                               (not (str/includes? % " ")))
                                         quoted))
          documented-recipients (when documented-list (str/split documented-list #","))
          lib-recipients (get-in ceremony-handoff-lib/ceremonies ["merge-up" :to])
          lib-priority (get-in ceremony-handoff-lib/ceremonies ["merge-up" :priority])]
      (when-not documented-recipients
        (swap! failures conj (str "FAIL P3: no comma-separated recipient list found in the documented merge-up step: " (pr-str quoted))))
      (when (and documented-recipients (not= documented-recipients lib-recipients))
        (swap! failures conj (str "FAIL P3 merge-up recipients disagree with handoff-protocol.md\n  document: "
                                  (pr-str documented-recipients) "\n  lib:      " (pr-str lib-recipients))))
      (when-not (some #{lib-priority} quoted)
        (swap! failures conj (str "FAIL P3 merge-up priority " (pr-str lib-priority)
                                  " is not the one handoff-protocol.md states: " (pr-str quoted)))))))

(let [section (protocol-section "**QA → coordinator:**")]
  (if-not section
    (swap! failures conj "FAIL P3: handoff-protocol.md no longer documents the QA bookkeeping send; the lib's bookkeep ceremony is now unpinned.")
    (let [quoted (backticked section)
          lib (get ceremony-handoff-lib/ceremonies "bookkeep")]
      ;; the recipient is in the step's own heading, which is why the heading
      ;; is what this looks at rather than a backticked list.
      (when-not (= ["coordinator"] (:to lib))
        (swap! failures conj (str "FAIL P3 bookkeep recipients disagree with the documented 'QA → coordinator' step: " (pr-str (:to lib)))))
      (when-not (some #{(:priority lib)} quoted)
        (swap! failures conj (str "FAIL P3 bookkeep priority " (pr-str (:priority lib))
                                  " is not the one handoff-protocol.md states: " (pr-str quoted)))))))

;; And the cap itself, which the lib holds as a number and the document states
;; in prose. BL-897 again: two literals, one assertion that they agree.
(when-not (str/includes? protocol-text
                         (str "no longer than " ceremony-handoff-lib/message-max-chars " characters"))
  (swap! failures conj (str "FAIL P3: handoff-protocol.md does not state a "
                            ceremony-handoff-lib/message-max-chars
                            "-character message cap; the lib's cap is unpinned.")))

;; ── P1 send-path-integrity (fixture-backed, a smaller sample) ────────────
;;
;; Built once and reused: the claim quantifies over ceremonies and facts, not
;; over fixture shapes, and a fresh git repo per run would buy nothing but
;; minutes.

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs]
                                    (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- sh! [dir & args]
  (let [{:keys [exit err]} (apply process/sh {:dir dir :continue true} args)]
    (when-not (zero? exit)
      (throw (ex-info (str "fixture command failed: " (pr-str args) "\n" err) {})))))

(def pipeline-roles ["coder" "cleaner" "architect" "hardender" "documenter"])

(defn- build-fixture! []
  (let [root (str (fs/create-temp-dir {:prefix "bl1360-ceremony-prop-"}))]
    (swap! created-temp-dirs conj root)
    (sh! root "git" "init" "-q" "-b" "main")
    (sh! root "git" "config" "user.email" "test@test")
    (sh! root "git" "config" "user.name" "test")
    (fs/create-dirs (fs/path root ".swarmforge"))
    (spit (str (fs/path root ".swarmforge" "tmux-socket")) (str (fs/path root "fake.sock")))
    (spit (str (fs/path root "fake.sock")) "")
    ;; the sender's own outbox, plus an inbox per recipient
    (doseq [d ["outbox/tmp" "sent"]]
      (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "QA" d)))
    (doseq [role (conj pipeline-roles "coordinator" "specifier")]
      (fs/create-dirs (fs/path root ".worktrees" role ".swarmforge" "handoffs" "inbox" "new")))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str/join "\n"
                    (for [role (concat ["QA"] pipeline-roles ["coordinator" "specifier"])]
                      (str/join "\t" [role role (str (fs/path root ".worktrees" role))
                                      (str "swarmforge-" role) role "claude" "task"]))))
    (let [bin (str (fs/path root "bin"))]
      (fs/create-dirs bin)
      (spit (str (fs/path bin "tmux")) "#!/usr/bin/env bash\nexit 0\n")
      (fs/set-posix-file-permissions (str (fs/path bin "tmux")) "rwxr-xr-x"))
    root))

(defn- inbox-files [root]
  (mapcat (fn [role]
            (let [d (fs/path root ".worktrees" role ".swarmforge" "handoffs" "inbox" "new")]
              (when (fs/exists? d) (map str (fs/list-dir d)))))
          (conj pipeline-roles "coordinator" "specifier")))

(defn- clear-mailboxes! [root]
  (doseq [f (inbox-files root)] (fs/delete f))
  (let [outbox (fs/path root ".swarmforge" "handoffs" "QA" "outbox")]
    (doseq [f (when (fs/exists? outbox) (fs/list-dir outbox))]
      (when (fs/regular-file? f) (fs/delete f)))))

(defn- run-ceremony [root args]
  (apply process/sh
         {:dir root
          :continue true
          :extra-env {"PATH" (str (fs/path root "bin") ":" (System/getenv "PATH"))
                      "SWARMFORGE_ROLE" "QA"}}
         (str (fs/path script-root "ceremony_handoff.sh"))
         args))

;; The envelope headers only swarm_handoff.bb stamps. A copy that reached a
;; mailbox any other way could not carry them.
(def tool-stamped-headers ["id:" "from:" "recipient:" "created_at:" "enqueued_at:"])

(let [root (build-fixture!)
      p1-runs (or (some-> (System/getenv "PROPERTY_P1_RUNS") parse-long) 12)]
  (loop [i 0 s 913360]
    (when (< i p1-runs)
      (let [[ceremony s1] (gen-pick s ceremony-name-pool)
            [n s2] (gen-int s1 6)
            ticket (str "BL-" (+ 1000 n))
            [commit s3] (gen-commit s2)
            input {:ceremony ceremony :ticket ticket :commit commit}]
        (clear-mailboxes! root)

        ;; --dry-run reaches no mailbox, ever.
        (let [{:keys [exit out]} (run-ceremony root [ceremony "--ticket" ticket "--commit" commit "--dry-run"])]
          (when-not (zero? exit)
            (report! "P1" s input (str "--dry-run failed: " out)))
          (when (seq (inbox-files root))
            (report! "P1" s input "--dry-run delivered to a mailbox")))

        (clear-mailboxes! root)
        (let [{:keys [exit out err]} (run-ceremony root [ceremony "--ticket" ticket "--commit" commit])
              delivered (inbox-files root)]
          (if (zero? exit)
            (do
              (when (empty? delivered)
                (report! "P1" s input (str "a successful send delivered nothing\n" out err)))
              (doseq [f delivered]
                (let [content (slurp f)
                      present (set (keep #(second (re-matches #"^([a-z_-]+:) .*$" %))
                                         (str/split-lines content)))]
                  (doseq [h (conj tool-stamped-headers "message:")]
                    (when-not (contains? present h)
                      (report! "P1" s input
                               (str "delivered copy " (fs/file-name f) " lacks the tool-stamped header "
                                    h " - it did not come through swarm_handoff.sh:\n" content))))))
              ;; the specifier is never a merge-up recipient
              (when (and (= "merge-up" ceremony)
                         (some #(str/includes? (str %) "/specifier/") delivered))
                (report! "P1" s input "the specifier received a merge-up broadcast")))
            ;; A refusal is allowed - what is not allowed is a refusal that
            ;; still put something in a mailbox.
            (when (seq delivered)
              (report! "P1" s input (str "a refused send still delivered " (pr-str (map str delivered))
                                         "\n" out err)))))
        (recur (inc i) s3)))))

;; ── report ────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println (str "bl1360 ceremony handoff: ALL PROPERTIES HOLD (" runs " pure runs)")))
