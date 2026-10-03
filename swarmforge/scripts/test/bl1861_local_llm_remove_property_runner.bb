#!/usr/bin/env bb
;; BL-1861 property test (coder-authored, THREE declared invariants, BL-654).
;;
;;   Invariant 1: remove never takes out a bare seat (no @, the coordinator
;;   included) - when any local-model seat is one, it refuses and changes
;;   nothing.
;;   Invariant 2: remove never deletes/moves a parcel, worktree, branch or
;;   mailbox, never stops the model server, and never unloads a model that
;;   no removed seat names.
;;   Invariant 3: a seat that is not local-model keeps its roster rows and
;;   its tmux session through remove.
;;
;; WHY THE GENERATORS REACH WHAT THEY QUANTIFY OVER (BL-654 failure shape):
;; invariant 1's generator draws roster shapes with and without a bare
;; local-model seat, bumping a counter for each, so the refusal branch is
;; provably exercised, not merely possible. Invariant 2's "never unloads an
;; unnamed model" draws foreign model names FROM the same pool the owned
;; model is drawn from (never an independent draw), so a bug that unloads
;; by position rather than by name is a collision candidate by construction.
;; Invariant 3's survivor seats are drawn with the SAME id shapes (bare and
;; @-suffixed) the removed seats use, so a mutant that keys survival off
;; "has no @" rather than "is not local-model" is caught.
;;
;; Non-vacuity proven at authoring: flipping local-model-seat-ids' column
;; index (reads the display-name column instead) fails invariant 1's reach
;; check outright (no local-model seat is ever found); deleting the
;; (remove str/blank? ...) + distinct endpoint filter and unloading every
;; /api/ps entry instead of models-for-seats' own set fails invariant 2's
;; foreign-model check; reusing filter-out-seat-rows with the WRONG column
;; index for a survivor's row fails invariant 3's roster-row check.

(ns bl1861-local-llm-remove-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (str (fs/parent test-dir)))
(def cli (str (fs/path scripts-dir "local_llm_cli.bb")))
(load-file (str (fs/path scripts-dir "local_llm_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 20))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def rng
  (let [state (atom 1861)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(defn run-remove! [root]
  (process/sh "bb" cli "remove" root))

(defn write-roles! [root rows]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str (str/join "\n" (map #(str/join "\t" %) rows)) "\n")))

(defn roles-text [root] (slurp (str (fs/path root ".swarmforge" "roles.tsv"))))

(defn roster-row [text seat-id]
  (some #(when (= seat-id (first %)) %)
        (map #(str/split % #"\t") (remove str/blank? (str/split-lines text)))))

;; ── Invariant 1: a bare local-model seat refuses, changing nothing ───────
;; Generator: random seat ids (some bare, some @-suffixed), a random subset
;; marked local-model, with roughly half the runs forced to carry a bare
;; local-model seat and half forced never to - both branches are reached
;; and counted.

(def id-shapes ["coder" "coder@2" "coder@iq3" "coordinator" "architect" "architect@3"])

(dotimes [i runs]
  (let [root (str (fs/create-temp-dir {:prefix "bl1861-inv1-"}))
        force-bare? (even? i)
        n (+ 2 (rng 3))
        chosen (vec (take n (repeatedly #(nth id-shapes (rng (count id-shapes))))))
        chosen (distinct chosen)
        local-ids (vec (take (max 1 (rng (count chosen))) (shuffle chosen)))
        ;; force-bare?: guarantee at least one local id is bare (no @);
        ;; otherwise guarantee every local id carries an @-suffix seat.
        local-ids (if force-bare?
                    (mapv #(first (str/split % #"@")) local-ids)
                    (mapv #(if (str/includes? % "@") % (str % "@x")) local-ids))
        rows (mapv (fn [id]
                     [id "wt" (str root "/wt-" id) (str "swarmforge-" id) id
                      (if (some #{id} local-ids) "local-model" "claude")
                      "task" "off" "forward-only"])
                   (distinct (into local-ids chosen)))]
    (try
      (write-roles! root rows)
      (let [before (roles-text root)
            {:keys [exit out err]} (run-remove! root)
            after (roles-text root)
            has-bare-local (some local-llm-lib/bare-seat? local-ids)]
        (if has-bare-local
          (do (bump! :inv1-bare-reached)
              (check! (str "invariant 1: a bare local-model seat must refuse (exit non-zero), got " exit " out=" out err)
                      (not (zero? exit)))
              (check! "invariant 1: a refused remove must change no roster row"
                      (= before after)))
          (do (bump! :inv1-no-bare-reached)
              (check! (str "invariant 1: no bare local-model seat must succeed cleanly, got " exit " out=" out err)
                      (zero? exit))
              (check! (str "invariant 1: a no-bare remove must never print the bare-seat refusal, got out=" out err)
                      (not (str/includes? out "LOCAL_LLM_REFUSED"))))))
      (finally (fs/delete-tree root)))))

(check! "invariant 1 generator never reached a bare-local-model roster"
        (pos? (get @reached :inv1-bare-reached 0)))
(check! "invariant 1 generator never reached a no-bare roster"
        (pos? (get @reached :inv1-no-bare-reached 0)))

;; ── Shared stub Ollama server (invariant 2) - started ONCE, reused across
;; every iteration with a UNIQUE model name per iteration so runs never
;; collide. ──────────────────────────────────────────────────────────────

(def stub-port (+ 25000 (rng 5000)))
(def stub-js-path (str (fs/path test-dir "bl1861_prop_stub_ollama.js")))
(spit stub-js-path
      "const http = require('http');
const port = Number(process.env.FAKE_PORT);
const loaded = new Set();
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/api/ps' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [...loaded].map((name) => ({ name, size: 1, size_vram: 1 })) }));
      return;
    }
    if (req.url === '/api/load' && req.method === 'POST') {
      loaded.add(JSON.parse(body).model);
      res.writeHead(200); res.end('{}');
      return;
    }
    if (req.url === '/api/generate' && req.method === 'POST') {
      let model; try { model = JSON.parse(body).model; } catch (e) {}
      if (model) loaded.delete(model);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ done: true }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});
server.listen(port, '127.0.0.1');
")

(def stub-proc
  (process/process ["node" stub-js-path]
                    {:extra-env {"FAKE_PORT" (str stub-port)}
                     :out :inherit :err :inherit}))
(Thread/sleep 400)

(defn curl-json [args]
  (let [{:keys [exit out]} (apply process/sh "curl" "-sS" "-m" "5" args)]
    (when (zero? exit) (json/parse-string out true))))

(defn load-model! [model]
  (process/sh "curl" "-sS" "-m" "5" "-X" "POST" (str "http://127.0.0.1:" stub-port "/api/load")
              "-d" (json/generate-string {:model model})))

;; ── Invariant 2: never deletes/moves a parcel/worktree/branch/mailbox,
;; never stops the model server, never unloads an unnamed model ──────────

(def model-pool ["model-a:latest" "model-b:latest" "model-c:latest" "model-d:latest" "model-e:latest"])

(dotimes [i runs]
  (let [root (str (fs/create-temp-dir {:prefix "bl1861-inv2-"}))
        wt (str (fs/path root "wt-coder@2"))
        owned-model (str (nth model-pool (rng (count model-pool))) "-i" i)
        ;; foreign models drawn from the SAME per-iteration pool shape as
        ;; owned-model (just a different index suffix) - a collision
        ;; candidate by construction, never an unrelated independent draw.
        foreign-models (vec (distinct (for [m (take 2 (shuffle model-pool))] (str m "-i" i "-foreign"))))]
    (try
      (fs/create-dirs (fs/path wt ".swarmforge" "handoffs" "inbox" "new"))
      (fs/create-dirs (fs/path wt ".swarmforge" "handoffs" "inbox" "in_process"))
      (fs/create-dirs (fs/path root ".swarmforge" "launch"))
      (let [parcel-content (str "id: p" i "\nfrom: architect\nto: coder\npriority: 00\ntype: git_handoff\ntask: BL-" (+ 9000 i) "\ncommit: " (format "%010d" i) "\n")
            parcel-path (fs/path wt ".swarmforge" "handoffs" "inbox" "new" (str "50_prop_" i ".handoff"))
            other-file-path (fs/path wt "some-other-file.txt")
            other-content (str "unrelated worktree content " i "\n")]
        (spit (str parcel-path) parcel-content)
        (spit (str other-file-path) other-content)
        (spit (str (fs/path root ".swarmforge" "launch" "coder@2.sh"))
              (str "#!/usr/bin/env zsh\nexport OPENAI_BASE_URL='http://127.0.0.1:" stub-port "/v1'\nqwen --model '" owned-model "' -y -i hi\n"))
        (write-roles! root [["coder@2" "wt" wt "swarmforge-coder@2" "Coder2" "local-model" "task" "off" "forward-only"]])
        (load-model! owned-model)
        (doseq [fm foreign-models] (load-model! fm))
        (bump! :inv2-reached)
        (let [{:keys [exit out err]} (run-remove! root)
              ps-after (curl-json [(str "http://127.0.0.1:" stub-port "/api/ps")])
              loaded-after (set (map :name (:models ps-after)))]
          (check! (str "invariant 2: a clean remove exits 0, got " exit " out=" out err) (zero? exit))
          (check! "invariant 2: the owned model is gone"
                  (not (contains? loaded-after owned-model)))
          (doseq [fm foreign-models]
            (bump! :inv2-foreign-checked)
            (check! (str "invariant 2: a model no removed seat names (" fm ") must never be unloaded")
                    (contains? loaded-after fm)))
          (check! "invariant 2: the server itself is still answering (never stopped)"
                  (some? ps-after))
          (check! "invariant 2: the removed seat's parcel file survives byte-identical"
                  (= parcel-content (slurp (str parcel-path))))
          (check! "invariant 2: an unrelated worktree file survives byte-identical, never moved or deleted"
                  (and (fs/exists? other-file-path) (= other-content (slurp (str other-file-path)))))
          (check! "invariant 2: the removed seat's worktree itself still exists"
                  (fs/exists? wt))))
      (finally (fs/delete-tree root)))))

(check! "invariant 2 generator never reached a clean removal"
        (pos? (get @reached :inv2-reached 0)))
(check! "invariant 2 generator never checked a foreign (unnamed) model"
        (pos? (get @reached :inv2-foreign-checked 0)))

(try (process/destroy stub-proc) (catch Exception _ nil))
(fs/delete-if-exists stub-js-path)

;; ── Invariant 3: a non-local-model seat keeps its roster row and its tmux
;; session through remove - a REAL private tmux server proves the session
;; half, started ONCE and reused with unique session names per iteration. ─

(def tmux-root (str (fs/create-temp-dir {:prefix "bl1861-inv3-tmux-"})))
(def tmux-sock (str (fs/path tmux-root "private.sock")))

(dotimes [i runs]
  (let [root (str (fs/create-temp-dir {:prefix "bl1861-inv3-"}))
        removed-id (str "coder@" i)
        ;; survivor id shape alternates bare/@-suffixed, same pool invariant
        ;; 1 draws from - a mutant keying survival off "no @" rather than
        ;; "not local-model" is caught when the survivor itself carries @.
        survivor-id (if (even? i) (str "architect" ) (str "architect@" i))
        removed-session (str "swarmforge-prop3-removed-" i)
        survivor-session (str "swarmforge-prop3-survivor-" i)]
    (try
      (fs/create-dirs (fs/path root ".swarmforge"))
      (spit (str (fs/path root ".swarmforge" "tmux-socket")) tmux-sock)
      (process/sh "tmux" "-S" tmux-sock "new-session" "-d" "-s" removed-session "-n" "agent")
      (process/sh "tmux" "-S" tmux-sock "new-session" "-d" "-s" survivor-session "-n" "agent")
      (write-roles! root
                    [[removed-id "wt" (str root "/wt-removed") removed-session "R" "local-model" "task" "off" "forward-only"]
                     [survivor-id "wt" (str root "/wt-survivor") survivor-session "S" "claude" "task" "off" "forward-only"]])
      (bump! :inv3-reached)
      (let [before-row (roster-row (roles-text root) survivor-id)
            {:keys [exit out err]} (run-remove! root)
            after-row (roster-row (roles-text root) survivor-id)
            survivor-alive? (zero? (:exit (process/sh "tmux" "-S" tmux-sock "has-session" "-t" survivor-session)))
            removed-alive? (zero? (:exit (process/sh "tmux" "-S" tmux-sock "has-session" "-t" removed-session)))]
        (check! (str "invariant 3: a clean remove exits 0, got " exit " out=" out err) (zero? exit))
        (check! "invariant 3: the survivor's own roster row is byte-identical before and after"
                (= before-row after-row))
        (check! "invariant 3: the survivor's tmux session is still alive"
                survivor-alive?)
        (check! "invariant 3: the removed seat's own tmux session is gone (proves the mechanism actually ran)"
                (not removed-alive?)))
      (finally
        (process/sh "tmux" "-S" tmux-sock "kill-session" "-t" removed-session)
        (process/sh "tmux" "-S" tmux-sock "kill-session" "-t" survivor-session)
        (fs/delete-tree root)))))

(check! "invariant 3 generator never reached a survivor/removed pair"
        (pos? (get @reached :inv3-reached 0)))

(process/sh "tmux" "-S" tmux-sock "kill-server")
(fs/delete-tree tmux-root)

(when (seq @failures)
  (doseq [f @failures] (println f))
  (println (count @failures) "FAILURES")
  (System/exit 1))

(println "ALL PROPERTIES HELD"
         "inv1-bare=" (get @reached :inv1-bare-reached 0)
         "inv1-no-bare=" (get @reached :inv1-no-bare-reached 0)
         "inv2-runs=" (get @reached :inv2-reached 0)
         "inv2-foreign-checks=" (get @reached :inv2-foreign-checked 0)
         "inv3-runs=" (get @reached :inv3-reached 0))
