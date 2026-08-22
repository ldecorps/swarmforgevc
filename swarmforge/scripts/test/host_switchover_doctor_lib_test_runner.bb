#!/usr/bin/env bb
;; BL-1057: TDD runner for host_switchover_doctor_lib.bb's pure decision
;; logic - setting extraction from real (comment-carrying) VS Code settings
;; text, root comparison, per-row verdicts, aggregation and report text. No
;; real filesystem and no real $HOME: every case injects its own io map and
;; its own env map, so a fixture can never depend on the machine running it.
;;
;; The one thing deliberately NOT simulated with chmod is an unreadable file
;; (engineering.prompt forbids chmod-for-failure-simulation): a read that
;; cannot happen arrives here as an injected {:ok? false} read result, and
;; the acceptance lane produces a REAL one by making the path a directory.

(ns host-switchover-doctor-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "host_switchover_doctor_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))


;; ── extract-setting: real VS Code settings text, not textbook JSON ─────────

(assert= "extracts a setting's value"
         "/home/carillon/swarmforgevc"
         (host-switchover-doctor-lib/extract-setting
          "{\n  \"swarmforge.targetPath\": \"/home/carillon/swarmforgevc\"\n}\n"
          "swarmforge.targetPath"))

(assert= "a settings file carrying // comments and a trailing comma still yields its value"
         "/home/carillon/swarmforgevc"
         (host-switchover-doctor-lib/extract-setting
          (str "{\n"
               "  \"swarmforge.targetPath\": \"/home/carillon/swarmforgevc\",\n"
               "//  \"window.zoomLevel\": 1,\n"
               "}\n")
          "swarmforge.targetPath"))

(assert= "a COMMENTED-OUT setting is not a setting - it points at nothing"
         nil
         (host-switchover-doctor-lib/extract-setting
          "{\n//  \"swarmforge.targetPath\": \"/Users/ldecorps/projects/swarmforgevc\"\n}\n"
          "swarmforge.targetPath"))

(assert= "a setting the file does not carry at all is nil, never the empty string"
         nil
         (host-switchover-doctor-lib/extract-setting "{\n  \"git.autofetch\": true\n}\n" "swarmforge.targetPath"))

(assert= "another key whose name merely ends the same way is not matched"
         nil
         (host-switchover-doctor-lib/extract-setting
          "{\n  \"other.swarmforge.targetPathX\": \"/somewhere\"\n}\n"
          "swarmforge.targetPath"))

(assert= "extra whitespace around the colon does not hide the value"
         "/x"
         (host-switchover-doctor-lib/extract-setting "{ \"swarmforge.targetPath\"   :    \"/x\" }" "swarmforge.targetPath"))

;; ── normalize-root ────────────────────────────────────────────────────────

(assert= "a trailing slash never makes two identical roots compare unequal"
         (host-switchover-doctor-lib/normalize-root "/home/carillon/swarmforgevc")
         (host-switchover-doctor-lib/normalize-root "/home/carillon/swarmforgevc/"))

(assert= "surrounding whitespace is trimmed - a registry file ends in a newline"
         (host-switchover-doctor-lib/normalize-root "/home/carillon/swarmforgevc")
         (host-switchover-doctor-lib/normalize-root "  /home/carillon/swarmforgevc\n"))


;; ── main-checkout-root: a per-role worktree is not a separate forge ───────

(assert= "a checkout whose .git is a directory IS the main checkout"
         "/home/carillon/swarmforgevc"
         (host-switchover-doctor-lib/main-checkout-root "/home/carillon/swarmforgevc" nil))

(assert= "a per-role worktree resolves to the main checkout it hangs off"
         "/home/carillon/swarmforgevc"
         (host-switchover-doctor-lib/main-checkout-root
          "/home/carillon/swarmforgevc/.worktrees/coder"
          "gitdir: /home/carillon/swarmforgevc/.git/worktrees/coder\n"))

(assert= "a submodule-style gitdir that is not a worktree falls back to the checkout given"
         "/some/checkout"
         (host-switchover-doctor-lib/main-checkout-root "/some/checkout" "gitdir: /elsewhere/.git/modules/thing\n"))

(assert= "unrecognised .git content never sends the doctor somewhere invented"
         "/some/checkout"
         (host-switchover-doctor-lib/main-checkout-root "/some/checkout" "not a gitdir line"))

;; ── matches-pattern?: the one glob the inventory needs ────────────────────

(assert-true "*.json matches a tunnel credentials file"
             (host-switchover-doctor-lib/matches-pattern? "*.json" "abc-123.json"))
(assert-true "*.json does not match the certificate sitting beside it"
             (not (host-switchover-doctor-lib/matches-pattern? "*.json" "cert.pem")))
(assert-true "the match is anchored - a name merely CONTAINING .json is not a match"
             (not (host-switchover-doctor-lib/matches-pattern? "*.json" "abc.json.bak")))
(assert-true "a literal pattern with no star matches only itself"
             (and (host-switchover-doctor-lib/matches-pattern? "cert.pem" "cert.pem")
                  (not (host-switchover-doctor-lib/matches-pattern? "cert.pem" "certxpem"))))
(assert-true "the dot in a pattern is a literal dot, never any-character"
             (not (host-switchover-doctor-lib/matches-pattern? "*.json" "abcXjson")))

;; ── context: every $HOME-rooted base is injectable ─────────────────────────

(let [ctx (host-switchover-doctor-lib/context
           {:repo-root "/repo" :env {"HOME" "/fake/home"}})]
  (assert= "the tunnel registry defaults under the INJECTED home, never the real one"
           "/fake/home/.swarmforge/tunnels" (:tunnel-registry-dir ctx))
  (assert= "the cloudflared dir defaults under the injected home too"
           "/fake/home/.cloudflared" (:cloudflared-dir ctx)))

(let [ctx (host-switchover-doctor-lib/context
           {:repo-root "/repo"
            :env {"HOME" "/fake/home"
                  "SWARMFORGE_TUNNEL_REGISTRY_DIR" "/seam/tunnels"
                  "SWARMFORGE_CLOUDFLARED_DIR" "/seam/cloudflared"}})]
  (assert= "the tunnel registry env seam wins over home" "/seam/tunnels" (:tunnel-registry-dir ctx))
  (assert= "the cloudflared env seam wins over home" "/seam/cloudflared" (:cloudflared-dir ctx)))

(assert-true "a setting holding the repo root itself describes this checkout"
             (host-switchover-doctor-lib/describes-root? "/repo" "/repo"))
(assert-true "a setting holding a pack file INSIDE the checkout describes it too"
             (host-switchover-doctor-lib/describes-root? "/repo/swarmforge/packs/full-forge.conf" "/repo"))
(assert-true "a setting holding the old host's path does not"
             (not (host-switchover-doctor-lib/describes-root? "/Users/ldecorps/projects/swarmforgevc" "/repo")))
(assert-true "a SIBLING checkout sharing a name prefix is not inside this one"
             (not (host-switchover-doctor-lib/describes-root? "/repo-old/thing.conf" "/repo")))

;; ── verdict-for: one row, one verdict ─────────────────────────────────────

(def settings-row
  {:id "extension/.vscode/settings.json" :base :repo :rel "extension/.vscode/settings.json"
   :check :settings :keys ["swarmforge.targetPath"] :required? false :remediation "fix it"})

(defn verdict-of [row gathered]
  (:verdict (host-switchover-doctor-lib/verdict-for row "/repo" gathered)))

(assert= "a settings file naming THIS repo root is OK"
         :ok (verdict-of settings-row {:exists? true :read {:ok? true :content "{\"swarmforge.targetPath\": \"/repo\"}"}}))

(assert= "a settings file naming ANOTHER repo root is STALE"
         :stale (verdict-of settings-row {:exists? true :read {:ok? true :content "{\"swarmforge.targetPath\": \"/Users/ldecorps/projects/swarmforgevc\"}"}}))

(assert= "a settings file that cannot be read is BLOCKED, never assumed OK"
         :blocked (verdict-of settings-row {:exists? true :read {:ok? false :error "Is a directory"}}))

(assert= "an OPTIONAL settings file that is absent pins nothing, so it is OK"
         :ok (verdict-of settings-row {:exists? false}))

(assert= "a settings file present but carrying no host-pinned key at all is OK"
         :ok (verdict-of settings-row {:exists? true :read {:ok? true :content "{\"git.autofetch\": true}"}}))

(let [finding (host-switchover-doctor-lib/verdict-for
               settings-row "/repo"
               {:exists? true :read {:ok? true :content "{\"swarmforge.targetPath\": \"/Users/ldecorps/projects/swarmforgevc\"}"}})]
  (assert-true "a STALE finding quotes the stale value it actually found"
               (str/includes? (:found finding) "/Users/ldecorps/projects/swarmforgevc"))
  (assert-true "a STALE finding names the key at fault, not just the file"
               (str/includes? (:found finding) "swarmforge.targetPath")))

(def two-key-row (assoc settings-row :keys ["swarmforge.targetPath" "swarmforge.configPath"]))

(assert= "a row with two keys, one stale and one fine, reports ONE verdict and it is the worse one"
         :stale
         (verdict-of two-key-row
                     {:exists? true
                      :read {:ok? true :content "{\"swarmforge.targetPath\": \"/repo\", \"swarmforge.configPath\": \"/Users/ldecorps/old\"}"}}))

(def required-text-row
  {:id "~/.swarmforge/tunnels/operator-root" :base :tunnel-registry :rel "operator-root"
   :check :root-text :required? true :remediation "see the runbook"})

(assert= "a required root-text registration that is absent is MISSING"
         :missing (verdict-of required-text-row {:exists? false}))
(assert= "a root-text registration naming this root is OK"
         :ok (verdict-of required-text-row {:exists? true :read {:ok? true :content "/repo\n"}}))
(assert= "a root-text registration naming another root is STALE"
         :stale (verdict-of required-text-row {:exists? true :read {:ok? true :content "/Users/ldecorps/projects/swarmforgevc\n"}}))
(assert= "a root-text registration that cannot be read is BLOCKED"
         :blocked (verdict-of required-text-row {:exists? true :read {:ok? false :error "denied"}}))

(def present-row
  {:id "~/.cloudflared/cert.pem" :base :cloudflared :rel "cert.pem"
   :check :present :required? true :remediation "see the runbook"})

(assert= "a required file that exists and reads is OK"
         :ok (verdict-of present-row {:exists? true :read {:ok? true :content "cert"}}))
(assert= "a required file that is absent is MISSING" :missing (verdict-of present-row {:exists? false}))
(assert= "a required file that is present but UNREADABLE is BLOCKED, never OK on the strength of a directory entry"
         :blocked (verdict-of present-row {:exists? true :read {:ok? false :error "Is a directory"}}))

(def glob-row
  {:id "~/.cloudflared/<tunnel-id>.json" :base :cloudflared :rel "" :pattern "*.json"
   :check :present-any :required? true :remediation "see the runbook"})

(assert= "a credentials directory holding a matching file is OK"
         :ok (verdict-of glob-row {:exists? true :entries {:ok? true :names ["abc-123.json" "cert.pem"]}}))
(assert= "a credentials directory holding no matching file is MISSING"
         :missing (verdict-of glob-row {:exists? true :entries {:ok? true :names ["cert.pem"]}}))
(assert= "a credentials directory that cannot be listed is BLOCKED, never MISSING"
         :blocked (verdict-of glob-row {:exists? true :entries {:ok? false}}))
(assert= "an absent credentials directory is MISSING"
         :missing (verdict-of glob-row {:exists? false}))

;; ── invariant 3, at the unit level: every non-OK finding is actionable ─────

(doseq [[row gathered] [[settings-row {:exists? true :read {:ok? true :content "{\"swarmforge.targetPath\": \"/elsewhere\"}"}}]
                        [settings-row {:exists? true :read {:ok? false :error "denied"}}]
                        [required-text-row {:exists? false}]
                        [glob-row {:exists? true :entries {:ok? false}}]]]
  (let [finding (host-switchover-doctor-lib/verdict-for row "/repo" gathered)]
    (when (not= :ok (:verdict finding))
      (assert-true (str "a non-OK finding names its concrete path: " (:id row) " " (:verdict finding))
                   (not (str/blank? (:path finding))))
      (assert-true (str "a non-OK finding names a remediation: " (:id row) " " (:verdict finding))
                   (not (str/blank? (:remediation finding)))))))

;; ── the declared inventory is data, and the report covers all of it ────────

(assert-true "the default inventory is non-empty data"
             (seq host-switchover-doctor-lib/default-inventory))

(assert= "every declared row has a unique id"
         (count host-switchover-doctor-lib/default-inventory)
         (count (set (map :id host-switchover-doctor-lib/default-inventory))))

(assert-true "every declared row carries a remediation before anything runs"
             (every? #(not (str/blank? (:remediation %))) host-switchover-doctor-lib/default-inventory))

(assert-true "the feature file's named locations are all in the declared inventory"
             (every? (set (map :id host-switchover-doctor-lib/default-inventory))
                     ["extension/.vscode/settings.json"
                      "~/.swarmforge/tunnels/operator-root"
                      "~/.cloudflared/config.yml"]))

;; ── run-doctor over an injected filesystem ────────────────────────────────

(defn fake-io
  "files: {abs-path content-or-:unreadable}, dirs: {abs-path [names]-or-:unlistable}"
  [files dirs]
  {:exists?* (fn [p] (or (contains? files p) (contains? dirs p)))
   :read-file* (fn [p] (let [v (get files p)]
                         (if (= v :unreadable) {:ok? false :error "simulated"} {:ok? true :content v})))
   :list-dir* (fn [p] (let [v (get dirs p)]
                        (if (= v :unlistable) {:ok? false} {:ok? true :names v})))})

(defn run-with [files dirs & [inventory]]
  (host-switchover-doctor-lib/run-doctor
   (merge {:repo-root "/repo"
           :env {"HOME" "/fake/home"}
           :inventory (or inventory host-switchover-doctor-lib/default-inventory)}
          (fake-io files dirs))))

(let [result (run-with {} {})]
  (assert= "every declared location appears in the report exactly once"
           (count host-switchover-doctor-lib/default-inventory) (count (:findings result)))
  (assert= "and no location is reported twice"
           (count (:findings result)) (count (set (map :id (:findings result)))))
  (assert-true "every finding carries exactly one verdict from the declared set"
               (every? #(contains? #{:ok :stale :missing :blocked} (:verdict %)) (:findings result))))

(let [everything-good (run-with {"/repo/.vscode/settings.json" "{\"swarmforge.targetPath\": \"/repo\", \"swarmforge.configPath\": \"/repo\"}"
                                 "/repo/extension/.vscode/settings.json" "{\"swarmforge.targetPath\": \"/repo\"}"
                                 "/fake/home/.swarmforge/tunnels/operator-root" "/repo\n"
                                 "/fake/home/.cloudflared/cert.pem" "cert"
                                 "/fake/home/.cloudflared/config.yml" "tunnel: x"
                                 "/repo/.swarmforge/operator/named-tunnel.env" "NAME=bubble"}
                                {"/fake/home/.cloudflared" ["cert.pem" "config.yml" "abc-123.json"]})]
  (assert= "a fully migrated host reports every location OK"
           #{:ok} (set (map :verdict (:findings everything-good))))
  (assert= "and exits 0" 0 (host-switchover-doctor-lib/exit-code everything-good)))

(let [one-stale (run-with {"/repo/extension/.vscode/settings.json" "{\"swarmforge.targetPath\": \"/Users/ldecorps/projects/swarmforgevc\"}"}
                          {})]
  (assert= "a host with anything not OK exits 1" 1 (host-switchover-doctor-lib/exit-code one-stale))
  (assert= "the stale location is reported STALE"
           :stale (:verdict (first (filter #(= "extension/.vscode/settings.json" (:id %)) (:findings one-stale))))))

;; ── the report a human reads ──────────────────────────────────────────────

(let [result (run-with {"/repo/extension/.vscode/settings.json" "{\"swarmforge.targetPath\": \"/Users/ldecorps/projects/swarmforgevc\"}"} {})
      report (host-switchover-doctor-lib/format-report result)]
  (assert-true "the report names every declared location"
               (every? #(str/includes? report (:id %)) host-switchover-doctor-lib/default-inventory))
  (assert-true "the report carries the stale value the reader has to change"
               (str/includes? report "/Users/ldecorps/projects/swarmforgevc"))
  (assert-true "the report points an absent tunnel registration at the runbook"
               (str/includes? report "docs/how-to/named-tunnel-bubble-musicalsifu.md"))
  (assert-true "every verdict word appears against its own location line"
               (and (str/includes? report "STALE") (str/includes? report "MISSING"))))

(if (empty? @failures)
  (println "host_switchover_doctor_lib (BL-1057): ALL TESTS PASSED")
  (do (println (str "host_switchover_doctor_lib (BL-1057): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
