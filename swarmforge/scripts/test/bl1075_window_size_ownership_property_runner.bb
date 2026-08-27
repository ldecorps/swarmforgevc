#!/usr/bin/env bb
;; BL-1075 property test (coder-authored, THREE declared invariants).
;;
;;   Invariant 1: the swarm never applies or documents a tmux option as a
;;   mitigation when a component of the same product unconditionally overrides
;;   it at a narrower scope.
;;   Invariant 2: dropping an inert knob never drops a live one - every option
;;   the hardening step applied before is still applied afterwards on every
;;   path that applied it, shell and Babashka alike.
;;   Invariant 3: tile sizing survives - for every role window the panel
;;   manages, the rows the panel asked for are the rows in force after the
;;   change.
;;
;; AGAINST A REAL TMUX SERVER, NOT THE CALL SITES. The ticket is explicit:
;; "confirm against a live server, not by reading the call sites", because the
;; whole defect is a scope rule that is invisible in the source - both writers
;; look correct, and the window option simply beats the server global. So every
;; case here starts a throwaway tmux server on its own private socket, runs the
;; REAL hardening (the shell function sourced out of swarmforge.sh, and
;; control_plane_lib's harden-server!), and then READS the server back.
;;
;; The mechanism is asserted too, not assumed: P1 measures that a window
;; resized the way the panel resizes it answers `manual` while the global
;; still answers `largest`. If a future tmux changed that rule, this file
;; should fail rather than quietly keep enforcing a decision whose premise
;; had gone.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Two states a naive generator would essentially never produce:
;;
;;   (a) A WINDOW SIZED DIFFERENTLY FROM ITS SIBLINGS. Invariant 3 is about
;;       PER-ROLE rows - a selected tile is taller than the rest (BL-040/043/
;;       051) - so a generator that gave every window the same height could
;;       not tell "the rows survived" from "every window ended up the same".
;;       Differing heights within one server are floored.
;;   (b) THE DEFAULT 80x24. A window left at the headless default is the one
;;       shape where "the rows are unchanged" is true for the wrong reason,
;;       so it is drawn deliberately and floored.
;;
;; ONE generator threaded across every draw and every run, never a fresh LCG
;; seeded per run: a per-run reseed returns a near-constant first draw for a
;; small modulus, which met every floor while pinning one position in two
;; separate runners this week (engineering-detailed.prompt records both).
;; The distribution is checked directly at the bottom of this file.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break reverted:
;;   - the shell hardening setting `-g window-size largest` again ....... P1
;;   - harden-server! setting it again .................................. P1
;;   - the shell hardening dropping `focus-events off` .................. P2
;;   - harden-server! dropping it ....................................... P2
;;
;; THE P2 CHECK WAS VACUOUS WHEN FIRST WRITTEN, and running those two breaks
;; is what showed it: `focus-events` is `off` BY DEFAULT on a fresh tmux
;; server, so "it is off after hardening" passed with the hardening deleted.
;; The fixture now turns it ON before hardening runs, so `off` afterwards can
;; only have come from the code under test.
;;   - hardening resizing a window (standing in for a knob that DID
;;     reach the tiles) ................................................. P3

(ns bl1075-window-size-ownership-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/parent (fs/canonicalize *file*))))
(def swarmforge-sh (str (fs/path script-dir "swarmforge.sh")))
(def control-plane-lib (str (fs/path script-dir "control_plane_lib.bb")))
(def repo-root (str (fs/parent (fs/parent script-dir))))
(def how-to (str (fs/path repo-root "docs" "how-to" "BL-tmux-wsl-segfault-upgrade.md")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 12))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def rng
  (let [state (atom 1075)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(def roles ["coder" "cleaner" "architect" "hardender" "documenter" "QA"])

;; The headless default, and the shape where "the rows are unchanged" is true
;; for the wrong reason.
(def default-rows 24)
(def row-choices [24 30 40 60 80 120])

;; BL-948: a SHORT base, never the system temp root. On macOS - a target OS
;; for this repo - os.tmpdir()/java.io.tmpdir resolves under
;; /var/folders/<hash>/<hash>/T/, and a socket path beneath that overruns
;; swarm_socket_lib.bb's 100-char guard, so a fixture would die on the refusal
;; instead of on what it asserts.
(def temp-root (fs/create-temp-dir {:dir "/tmp" :prefix "bl1075-"}))

;; Sockets this file has started a server on. BL-458: a tmux server DETACHES
;; and outlives the runner, so every one is killed by socket path on the throw
;; and signal paths too, not only when the loop reaches its own kill-server.
;; BL-971: the fixture root goes with it, on every exit path.
(def started-sockets (atom #{}))
(.addShutdownHook
 (Runtime/getRuntime)
 (Thread. (fn []
            (doseq [s @started-sockets]
              (try (process/sh {:out :string :err :string :continue true} "tmux" "-S" s "kill-server")
                   (catch Exception _ nil)))
            (fs/delete-tree temp-root))))

(defn tmux! [socket & args]
  (apply process/sh {:out :string :err :string :continue true} "tmux" "-S" (str socket) args))

(defn tmux-out [socket & args]
  (str/trim (str (:out (apply tmux! socket args)))))

;; What the panel does, in the order paneTailer.applyPaneSettings does it:
;; the server global, then a per-role resize-window. The resize is what arms
;; `manual` in the WINDOW options, which is the whole point.
(defn tile-like-the-panel! [socket sizes]
  (tmux! socket "set-option" "-g" "window-size" "manual")
  (doseq [[session rows] sizes]
    (tmux! socket "resize-window" "-t" session "-x" "200" "-y" (str rows))))

(defn window-rows [socket session]
  (tmux-out socket "display-message" "-p" "-t" session "#{window_height}"))

(defn start-server! [dir sizes]
  (let [socket (str (fs/path dir "p.sock"))]
    (swap! started-sockets conj socket)
    (doseq [[session _] sizes]
      (tmux! socket "new-session" "-d" "-s" session "sleep 300"))
    ;; focus-events is `off` BY DEFAULT on a fresh tmux server, so asserting
    ;; "it is off after hardening" proves nothing on its own - it passes with
    ;; the hardening deleted. Measured, and caught by running that exact
    ;; break. Turning it ON first is what makes the assertion discriminating:
    ;; afterwards, `off` can only have come from the hardening.
    (tmux! socket "set-option" "-g" "focus-events" "on")
    (tile-like-the-panel! socket sizes)
    socket))

(defn harden-via-shell! [socket]
  (process/sh {:out :string :err :string :continue true}
              "zsh" "-f" "-c"
              (str "source '" swarmforge-sh "' '" repo-root "' >/dev/null 2>&1 || true\n"
                   "TMUX_SOCKET='" socket "'\n"
                   "harden_tmux_server\n"
                   "echo HARDENED")))

(defn harden-via-bb! [socket]
  (process/sh {:out :string :err :string :continue true}
              "bb" "-e" (str "(load-file \"" control-plane-lib "\") "
                             "(control-plane-lib/harden-server! \"" socket "\") "
                             "(println \"HARDENED\")")))

;; ── the mechanism itself, measured rather than assumed ───────────────────

(let [dir (str (fs/path temp-root "mechanism"))
      _ (fs/create-dirs dir)
      socket (str (fs/path dir "p.sock"))]
  (swap! started-sockets conj socket)
  (tmux! socket "new-session" "-d" "-s" "probe" "sleep 300")
  (tmux! socket "set-option" "-g" "window-size" "largest")
  (check! "premise: before any resize, the window inherits the server global"
          (str/blank? (tmux-out socket "show-options" "-w" "-v" "-t" "probe" "window-size")))
  (tmux! socket "resize-window" "-t" "probe" "-x" "200" "-y" "60")
  (check! "premise: resize-window arms `manual` in the WINDOW options (tmux(1))"
          (= "manual" (tmux-out socket "show-options" "-w" "-v" "-t" "probe" "window-size")))
  (check! "premise: and the server global is untouched, so the two disagree by construction"
          (= "largest" (tmux-out socket "show-options" "-gv" "window-size")))
  (bump! :mechanism-measured)
  (tmux! socket "kill-server"))

;; ── P1/P2/P3 over generated servers ──────────────────────────────────────

(doseq [run-index (range runs)]
  (let [dir (str (fs/path temp-root (str "run-" run-index)))
        _ (fs/create-dirs dir)
        role-count (+ 2 (rng 3))
        chosen (take role-count (drop (rng 3) roles))
        ;; One window in five is left at the headless default.
        sizes (vec (for [r chosen]
                     [(str "swarmforge-" r)
                      (if (zero? (rng 5)) default-rows (row-choices (rng (count row-choices))))]))
        socket (start-server! dir sizes)
        before (into {} (for [[s _] sizes] [s (window-rows socket s)]))
        path (if (even? run-index) :shell :bb)
        where (str "run " run-index " " (name path) " " (pr-str sizes))]

    (when (> (count (set (map second sizes))) 1) (bump! :mixed-heights))
    (when (some #(= default-rows (second %)) sizes) (bump! :default-rows))
    (bump! (keyword (str "path-" (name path))))

    (let [{:keys [out err]} (if (= :shell path) (harden-via-shell! socket) (harden-via-bb! socket))]
      (check! (str where ": the hardening did not complete: " out err)
              (str/includes? (str out err) "HARDENED")))

    ;; Invariant 2: the live knob is still applied, on this path. The fixture
    ;; set focus-events ON above precisely so this cannot pass by default.
    (check! (str where ": focus-events is not off after hardening")
            (= "off" (tmux-out socket "show-options" "-gv" "focus-events")))

    ;; Invariant 1: no window-size mitigation applied at server scope. The
    ;; panel already set `manual` there itself, so the check is that hardening
    ;; did not put `largest` back - the value only the hardening ever wrote.
    (check! (str where ": hardening applied a server-scope window-size the panel overrides")
            (not= "largest" (tmux-out socket "show-options" "-gv" "window-size")))

    ;; Invariant 3: every window still has the rows the panel asked for.
    (doseq [[session rows] sizes]
      (check! (str where ": " session " asked for " rows " rows, has " (window-rows socket session))
              (= (str rows) (window-rows socket session)))
      (check! (str where ": " session " lost the rows it had before hardening")
              (= (get before session) (window-rows socket session))))

    (tmux! socket "kill-server")))

;; ── invariant 1's "documents" half ───────────────────────────────────────

(let [text (slurp how-to)
      ;; Sentences, not lines: the doc is hard-wrapped, so "as a soft\nmitigation"
      ;; spans two lines and a line-based match would miss it. Scoped to the
      ;; SOFT-MITIGATION list the scenario names - prose elsewhere in the file
      ;; is free to explain why the option was dropped, and this file's own
      ;; reason for existing would be unwriteable otherwise.
      sentences (->> (str/split (str/replace text #"\s+" " ") #"(?<=\.) ")
                     (map str/trim))
      mitigation-claims (filter #(and (re-find #"(?i)soft mitigation" %)
                                      (re-find #"window-size" %))
                                sentences)]
  (bump! :doc-read)
  (check! (str "the how-to still offers a window-size option as a mitigation: " (pr-str mitigation-claims))
          (empty? mitigation-claims))
  ;; And the sentence that survives must still say what DOES carry the load.
  (check! "the how-to no longer says the version upgrade is what protects the host"
          (re-find #"(?i)version upgrade" text)))

;; ── reach, asserted rather than hoped for ────────────────────────────────

(defn floor! [k min-count]
  (let [seen (get @reached k 0)]
    (when (< seen min-count)
      (fail! (str "generator reach: " k " was produced " seen " times, needed >= " min-count
                  ". A property that never reaches a state proves nothing about it.")))))

(floor! :mechanism-measured 1)
(floor! :mixed-heights 4)
(floor! :default-rows 3)
(floor! :path-shell 4)
(floor! :path-bb 4)
(floor! :doc-read 1)

(if (empty? @failures)
  (println (str "bl1075_window_size_ownership_property (BL-1075): ALL " runs " SERVERS PASSED " (pr-str @reached)))
  (do (println (str "bl1075_window_size_ownership_property (BL-1075): " (count @failures) " FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
