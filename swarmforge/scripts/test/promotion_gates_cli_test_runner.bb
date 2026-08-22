#!/usr/bin/env bb
;; Direct subprocess test of promotion_gates_cli.bb (BL-663) - the ONE
;; shell-callable entry point promote_and_route_next.sh and
;; route_backlog_to_coder.sh both parse with fixed delimiters
;; ("${verdict#REFUSE|}" / tab-split on locate's "<file>\t<paused|hold>" /
;; space-split on route-target's "<role> REWRITE|NOREWRITE"). The library
;; test runner (promotion_gates_lib_test_runner.bb) proves the pure decision
;; logic; this proves the CLI's own dispatch and stdout/exit-code CONTRACT -
;; the exact surface a silent format change would break without either
;; caller script noticing until it misparses at runtime. Complements, does
;; not duplicate: no gate-precedence-ordering assertions here, those live in
;; the lib runner.

(ns promotion-gates-cli-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(def cli (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_cli.bb")))

(def failures (atom []))

(defn run [& args]
  (let [r (apply p/shell {:out :string :err :string :continue true} "bb" cli args)]
    {:out (str/trim-newline (:out r)) :err (:err r) :exit (:exit r)}))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "promotion-gates-cli-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write! [root dir id content]
  (fs/create-dirs (fs/path root "backlog" dir))
  (let [f (fs/path root "backlog" dir (str id "-demo.yaml"))]
    (spit (str f) content)
    (str f)))

;; ── locate ────────────────────────────────────────────────────────────────

(let [root (mk-root)
      f (write! root "paused" "BL-1" "id: BL-1\n")
      {:keys [out exit]} (run "locate" root "BL-1")]
  (assert= "locate finds a paused ticket, tab-delimited with 'paused'" (str f "\tpaused") out)
  (assert= "locate on a found paused ticket exits 0" 0 exit))

(let [root (mk-root)
      f (write! root "hold" "BL-2" "id: BL-2\n")
      {:keys [out exit]} (run "locate" root "BL-2")]
  (assert= "locate finds a held ticket, tab-delimited with 'hold'" (str f "\thold") out)
  (assert= "locate on a found held ticket exits 0" 0 exit))

(let [root (mk-root)
      paused-f (write! root "paused" "BL-3" "id: BL-3\n")
      _ (write! root "hold" "BL-3" "id: BL-3\n")
      {:keys [out]} (run "locate" root "BL-3")]
  (assert= "when a ticket exists in both paused/ and hold/, paused/ wins" (str paused-f "\tpaused") out))

(let [root (mk-root)
      {:keys [out exit]} (run "locate" root "BL-404")]
  (assert= "locate on a missing ticket prints NOT_FOUND" "NOT_FOUND" out)
  (assert= "locate on a missing ticket exits 1" 1 exit))

;; ── evaluate ─────────────────────────────────────────────────────────────

(let [root (mk-root)
      f (write! root "paused" "BL-10" "id: BL-10\nhuman_approval: approved\n")
      {:keys [out exit]} (run "evaluate" root f "false" "5")]
  (assert= "evaluate on a compliant candidate prints ALLOW" "ALLOW" out)
  (assert= "evaluate ALLOW exits 0" 0 exit))

(let [root (mk-root)
      f (write! root "paused" "BL-11" "id: BL-11\nhuman_approval: pending\n")
      {:keys [out exit]} (run "evaluate" root f "false" "5")]
  (assert= "evaluate refuses pending human_approval, pipe-delimited gate|reason"
           "REFUSE|human_approval|human_approval is pending, not approved" out)
  (assert= "evaluate REFUSE exits 2 (distinct from the 1 used elsewhere)" 2 exit))

(let [root (mk-root)
      f (write! root "paused" "BL-12" "id: BL-12\nhuman_approval: approved\n")
      {:keys [out]} (run "evaluate" root f "false" "0")]
  (assert= "evaluate refuses at depth cap, naming active_backlog_max_depth"
           "REFUSE|active_backlog_max_depth|active count 0 >= cap 0 - no open slot" out))

(let [root (mk-root)
      f (write! root "paused" "BL-13" "id: BL-13\nhuman_approval: approved\n")
      {:keys [out]} (run "evaluate" root f "true" "5")]
  (assert= "evaluate on a held ticket refuses naming hold marker, before human_approval is even read"
           "REFUSE|hold marker|ticket is parked in backlog/hold/, never auto-promoted" out))

;; ── evaluate: BL-854 orthogonality advisory on stderr, stdout unchanged ──

(let [root (mk-root)
      _ (write! root "active" "BL-900" "id: BL-900\nepic: swarm-reliability\n")
      f (write! root "paused" "BL-14" "id: BL-14\nepic: swarm-reliability\nhuman_approval: approved\n")
      {:keys [out err exit]} (run "evaluate" root f "false" "5")]
  (assert= "an epic-colliding candidate still prints ALLOW on stdout (stdout contract unchanged)" "ALLOW" out)
  (assert= "an epic-colliding candidate still exits 0" 0 exit)
  (assert= "the advisory is on stderr, naming the colliding ticket"
           "ADVISORY|orthogonality|epic swarm-reliability is also active on BL-900\n" err))

(let [root (mk-root)
      _ (write! root "active" "BL-900" "id: BL-900\nepic: swarm-reliability\n")
      f (write! root "paused" "BL-15" "id: BL-15\nepic: bubble-control\nhuman_approval: approved\n")
      {:keys [out err]} (run "evaluate" root f "false" "5")]
  (assert= "a non-colliding candidate still prints ALLOW" "ALLOW" out)
  (assert= "a non-colliding candidate prints no advisory at all" "" err))

;; ── select ───────────────────────────────────────────────────────────────

(let [root (mk-root)
      defect (write! root "paused" "BL-20" "id: BL-20\ntype: defect\nseverity: high\npriority: 50\nhuman_approval: approved\n")
      feature (write! root "paused" "BL-19" "id: BL-19\ntype: feature\npriority: 5\nhuman_approval: approved\n")
      {:keys [out exit]} (run "select" root "5" feature defect)]
  (assert= "select picks the expedited defect over a numerically-better-priority feature" defect out)
  (assert= "select on a found winner exits 0" 0 exit))

(let [root (mk-root)
      refused (write! root "paused" "BL-21" "id: BL-21\nhuman_approval: pending\n")
      eligible (write! root "paused" "BL-22" "id: BL-22\npriority: 9\nhuman_approval: approved\n")
      {:keys [out]} (run "select" root "5" refused eligible)]
  (assert= "select drops a refused candidate and still picks the remaining eligible one" eligible out))

(let [root (mk-root)
      refused (write! root "paused" "BL-23" "id: BL-23\nhuman_approval: pending\n")
      {:keys [out exit]} (run "select" root "5" refused)]
  (assert= "select with no eligible candidate prints NONE" "NONE" out)
  (assert= "select NONE exits 1" 1 exit))

;; ── select: BL-854 prints the WINNER's advisory once, never the loser's ──

(let [root (mk-root)
      _ (write! root "active" "BL-900" "id: BL-900\nepic: swarm-reliability\n")
      colliding (write! root "paused" "BL-24" "id: BL-24\nepic: swarm-reliability\npriority: 5\nhuman_approval: approved\n")
      clean (write! root "paused" "BL-25" "id: BL-25\nepic: bubble-control\npriority: 50\nhuman_approval: approved\n")
      {:keys [out err]} (run "select" root "5" clean colliding)]
  (assert= "select still picks the epic-colliding-but-better-priority candidate" colliding out)
  (assert= "select prints that winner's advisory once, on stderr"
           "ADVISORY|orthogonality|epic swarm-reliability is also active on BL-900\n" err))

(let [root (mk-root)
      _ (write! root "active" "BL-900" "id: BL-900\nepic: swarm-reliability\n")
      clean (write! root "paused" "BL-26" "id: BL-26\nepic: bubble-control\npriority: 5\nhuman_approval: approved\n")
      colliding (write! root "paused" "BL-27" "id: BL-27\nepic: swarm-reliability\npriority: 50\nhuman_approval: approved\n")
      {:keys [out err]} (run "select" root "5" clean colliding)]
  (assert= "select picks the non-colliding, better-priority candidate" clean out)
  (assert= "the rejected colliding candidate's advisory is never printed - only the winner's" "" err))

;; ── route-target ─────────────────────────────────────────────────────────

(let [root (mk-root)
      f (write! root "active" "BL-30" "id: BL-30\nassigned_to: specifier\n")
      {:keys [out]} (run "route-target" root f)]
  (assert= "route-target for assigned_to: specifier never rewrites" "specifier NOREWRITE" out))

(let [root (mk-root)
      f (write! root "active" "BL-31" "id: BL-31\n")
      {:keys [out]} (run "route-target" root f)]
  (assert= "route-target for absent assigned_to routes to coder, rewritten" "coder REWRITE" out))

(let [root (mk-root)
      f (write! root "active" "BL-32" "id: BL-32\nassigned_to: coder\n")
      {:keys [out]} (run "route-target" root f)]
  (assert= "route-target already assigned_to: coder performs no rewrite" "coder NOREWRITE" out))

;; ── dispatch: unknown command ────────────────────────────────────────────

(let [{:keys [exit err]} (run "bogus-command")]
  (assert= "an unknown subcommand exits non-zero" 1 exit)
  (assert= "an unknown subcommand prints usage to stderr" true (str/includes? err "Usage:")))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: promotion_gates_cli.bb"))
