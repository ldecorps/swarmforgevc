;; BL-1057: the host switchover doctor. One command a human runs right after
;; moving the swarm to a new machine or path; it walks a declared inventory of
;; HOST-PINNED locations - the config that lives outside the tracked repo, or
;; outside any daemon's own restart path - and says which of them still
;; describe the machine you left.
;;
;; Why it exists: this swarm moved from a Mac to WSL2 on 2026-08-22. The
;; daemons and tmux sessions came up fine. Two locations did not, and nothing
;; anywhere said so - the extension dev workspace still targeted
;; /Users/ldecorps/projects/swarmforgevc, and the Cloudflare named tunnel was
;; never registered on the new host, which served a live Error 1033 to a real
;; user. Both were found by hand, the second only because a user-facing
;; surface broke.
;;
;; Three declared invariants (BL-654; coder-authored property tests in
;; test/bl1057_host_switchover_doctor_property_runner.bb):
;;
;;   1. THE DOCTOR NEVER WRITES. Not a slice boundary a later repair pass may
;;      relax - a durable property. A diagnostic you can safely run on a
;;      half-migrated host is worth more than one that might rewrite config
;;      while the move is still in progress, so repair belongs to a SEPARATE
;;      command and never to a --fix flag on this one. Made true by
;;      construction: the only IO this namespace performs goes through the
;;      three read seams below (`exists?*`, `read-file*`, `list-dir*`), and
;;      there is no write seam to inject.
;;   2. EVERY DECLARED CHECK APPEARS EXACTLY ONCE WITH EXACTLY ONE VERDICT.
;;      A check whose target cannot be read reports :blocked - never omitted
;;      from the report, never assumed :ok. `run-doctor` maps over the
;;      inventory, so the report and the inventory are the same length by
;;      construction; and where one row has several things to look at (a
;;      settings file with two keys), `worst` collapses them to the single
;;      most serious verdict rather than emitting two entries.
;;   3. A NON-OK FINDING NAMES BOTH THE PLACE AND THE FIX. Every row carries
;;      its own `:remediation` as DATA, and `verdict-for` always fills in the
;;      concrete resolved `:path`, so a finding the reader cannot act on is
;;      not constructible.
;;
;; The inventory is DATA, in one place: adding a sixth location later is a
;; one-row change, not a new code path.
;;
;; Every $HOME-rooted base is an env seam (SWARMFORGE_TUNNEL_REGISTRY_DIR, the
;; one tunnel_ownership_lib.sh already established, and
;; SWARMFORGE_CLOUDFLARED_DIR), and the repo root is injected rather than
;; derived, so the suite never reads the real $HOME and never depends on where
;; it happens to be run from.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "host_switchover_doctor_lib.bb")))
;; and referred to as host-switchover-doctor-lib/foo.

(ns host-switchover-doctor-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def named-tunnel-runbook "docs/how-to/named-tunnel-bubble-musicalsifu.md")

;; Registering the named tunnel is a deliberate HUMAN action - an interactive
;; browser login plus a considered registration of this host as the tunnel
;; operator root. The doctor tells you to do it; it never does it for you.
(def ^:private tunnel-remediation
  (str "register this host's named tunnel - see " named-tunnel-runbook
       " (interactive: it needs a browser login and a deliberate human step)"))

(defn ^:private settings-remediation [file-label]
  (str "open " file-label " and point its swarmforge.* path settings at this repo root"))

(def default-inventory
  "The declared inventory of host-pinned locations, as DATA.

   :base       which root the path hangs off - :repo, or one of the two
               $HOME-rooted, env-seamed directories.
   :check      :settings (a VS Code settings file whose swarmforge.* keys must
               name this repo root), :root-text (a one-line file holding a repo
               root), :present (must exist AND be readable - a config
               file the forge cannot open is not a working registration),
               :present-any (a directory holding at least one entry matching
               :pattern).
   :required?  whether ABSENCE is a finding. A settings file that does not
               exist, or that carries no swarmforge.* key at all, pins nothing
               to the old host and so is not a casualty of the move; an absent
               tunnel registration is exactly the casualty this exists to find."
  [{:id ".vscode/settings.json"
    :base :repo :rel ".vscode/settings.json"
    :check :settings :keys ["swarmforge.targetPath" "swarmforge.configPath"]
    :required? false
    :remediation (settings-remediation ".vscode/settings.json")}
   {:id "extension/.vscode/settings.json"
    :base :repo :rel "extension/.vscode/settings.json"
    :check :settings :keys ["swarmforge.targetPath"]
    :required? false
    :remediation (settings-remediation "extension/.vscode/settings.json")}
   {:id "~/.swarmforge/tunnels/operator-root"
    :base :tunnel-registry :rel "operator-root"
    :check :root-text
    :required? true
    :remediation tunnel-remediation}
   {:id "~/.cloudflared/cert.pem"
    :base :cloudflared :rel "cert.pem"
    :check :present
    :required? true
    :remediation tunnel-remediation}
   {:id "~/.cloudflared/config.yml"
    :base :cloudflared :rel "config.yml"
    :check :present
    :required? true
    :remediation tunnel-remediation}
   {:id "~/.cloudflared/<tunnel-id>.json"
    :base :cloudflared :rel "" :pattern "*.json"
    :check :present-any
    :required? true
    :remediation tunnel-remediation}
   {:id ".swarmforge/operator/named-tunnel.env"
    :base :repo :rel ".swarmforge/operator/named-tunnel.env"
    :check :present
    :required? true
    :remediation tunnel-remediation}])

;; ── pure text ─────────────────────────────────────────────────────────────

(defn normalize-root
  "Two spellings of the same root must never compare unequal. Trims
   surrounding whitespace (a registry file ends in a newline) and any
   trailing slashes."
  [value]
  (let [trimmed (str/trim (or value ""))]
    (if (= trimmed "/")
      trimmed
      (str/replace trimmed #"/+$" ""))))

(defn extract-setting
  "The value of one setting in a VS Code settings file, or nil.

   Deliberately a targeted text scan rather than a JSON parse: real settings
   files are JSONC - they carry `//` comments and trailing commas, and this
   repo's own extension/.vscode/settings.json carries both. A JSON parser
   would report the file unreadable and the doctor would say BLOCKED about a
   perfectly healthy file.

   A COMMENTED-OUT setting is not a setting: a line whose trimmed text starts
   with `//` points at nothing, and reading one as live config would report a
   stale path the forge does not actually use."
  [content setting-key]
  (let [pattern (re-pattern (str "\"" (java.util.regex.Pattern/quote setting-key) "\"\\s*:\\s*\"([^\"]*)\""))]
    (some (fn [line]
            (when-not (str/starts-with? (str/trim line) "//")
              (second (re-find pattern line))))
          (str/split-lines (or content "")))))

(defn matches-pattern?
  "A deliberately tiny glob: `*` matches any run of characters and everything
   else is literal. The inventory only ever needs `*.json` for the tunnel
   credentials file, and a full glob engine would be more surface than that
   one row justifies. Pure, so the credentials check is testable without a
   directory."
  [pattern name]
  (let [parts (str/split (or pattern "") #"\*" -1)
        regex (re-pattern (str/join ".*" (map #(java.util.regex.Pattern/quote %) parts)))]
    (boolean (re-matches regex (or name "")))))

(defn main-checkout-root
  "The root of the MAIN checkout, given the root of the checkout this command
   is running from and the content of its `.git` entry (nil when `.git` is a
   directory, i.e. this already IS the main checkout).

   A per-role git WORKTREE is not a separate forge. The host-pinned config
   this doctor walks - editor settings, the tunnel operator-root registry -
   names the forge's own root, so a run from .worktrees/coder must check the
   same root a run from the master checkout would; otherwise every role's
   worktree reports two false STALEs.

   Pure text, and no git subprocess: this has to run on a half-migrated host
   with as little as possible working. A worktree's `.git` file holds
   `gitdir: <root>/.git/worktrees/<name>`, so the main root is everything
   before that `/.git/`.

   Anything unrecognised falls back to the checkout root it was given - a
   doctor that guessed wildly about where it is would be worse than one that
   reports the directory it was actually pointed at."
  [checkout-root git-entry-content]
  (let [named (some-> git-entry-content str/trim (as-> c (second (re-find #"^gitdir:\s*(.+)$" c))))
        marker "/.git/worktrees/"]
    (if (and named (str/includes? named marker))
      (subs named 0 (str/index-of named marker))
      checkout-root)))

;; ── verdicts ──────────────────────────────────────────────────────────────

(def verdict-severity
  "The ONE verdict a row reports when it has several things to look at.
   :blocked outranks everything because it is the only verdict that means
   'this was not actually checked' - masking it behind a cleaner sibling is
   the failure invariant 2 exists to forbid. :stale outranks :missing because
   a stale value is actively pointing at the machine you left, while an absent
   one is merely not there yet."
  {:ok 0 :missing 1 :stale 2 :blocked 3})

(defn worst [verdicts]
  (or (last (sort-by verdict-severity (seq verdicts))) :ok))

(defn ^:private finding [row path verdict found]
  {:id (:id row)
   :path path
   :verdict verdict
   :found found
   :remediation (:remediation row)})

(defn describes-root?
  "Whether a configured path still describes THIS checkout - it either IS the
   repo root or lives under it.

   Not plain equality: only `swarmforge.targetPath` holds the root itself.
   `swarmforge.configPath` names a pack file INSIDE the checkout
   (…/swarmforge/packs/full-forge.conf), so an equality check would report a
   perfectly healthy setting as STALE forever - which it did, against this
   repo's own .vscode/settings.json, before this function existed.

   The separator in the prefix test is load-bearing: without it a sibling
   checkout at /home/carillon/swarmforgevc-old would read as living inside
   /home/carillon/swarmforgevc."
  [value repo-root]
  (let [value (normalize-root value)
        root (normalize-root repo-root)]
    (or (= value root)
        (str/starts-with? value (str root "/")))))

(defn ^:private settings-verdict [row repo-root path content]
  (let [seen (for [k (:keys row)
                   :let [value (extract-setting content k)]
                   :when (some? value)]
               [k value])
        stale (remove (fn [[_ value]] (describes-root? value repo-root)) seen)]
    (if (seq stale)
      (finding row path :stale
               (str/join "; " (map (fn [[k value]] (str k " = \"" value "\"")) stale)))
      ;; No swarmforge.* key at all, or every one of them naming this root:
      ;; either way nothing here still points at the old host.
      (finding row path :ok
               (if (seq seen)
                 (str/join "; " (map (fn [[k value]] (str k " = \"" value "\"")) seen))
                 "no swarmforge.* path setting present")))))

(defn ^:private absent-verdict [row path]
  (if (:required? row)
    (finding row path :missing "absent")
    (finding row path :ok "absent, and nothing here is pinned to a host")))

(defn verdict-for
  "PURE. One inventory row plus what was gathered about it -> one finding with
   exactly one verdict. Never touches the filesystem: `gathered` is what the
   read seams already returned, so every case (including a read that could not
   happen) is reachable without simulating one on a real disk."
  [row repo-root gathered]
  ;; The row's own id is a concrete location name in its own right
  ;; ("~/.cloudflared/config.yml"), so a finding without a resolved absolute
  ;; path still names WHERE - invariant 3's "names the concrete location at
  ;; fault" is then not constructible-blank rather than merely always filled
  ;; in by the one caller that happens to resolve a path first.
  (let [path (or (:path gathered) (:id row))]
    (cond
      (not (:exists? gathered)) (absent-verdict row path)


      (= :present-any (:check row))
      (let [entries (:entries gathered)]
        (cond
          (not (:ok? entries)) (finding row path :blocked "the directory could not be listed")
          (some #(matches-pattern? (:pattern row) %) (:names entries))
          (finding row path :ok (str "present: "
                                     (str/join ", " (filter #(matches-pattern? (:pattern row) %)
                                                            (:names entries)))))
          :else (finding row path :missing (str "no " (:pattern row) " in this directory"))))

      :else
      (let [read (:read gathered)]
        (cond
          ;; Present but unreadable is NOT present enough. A cert or a
          ;; config.yml the forge cannot open is exactly "the check could not
          ;; be run", and reporting it OK on the strength of a directory entry
          ;; is the "never assumed OK" half of invariant 2.
          (not (:ok? read)) (finding row path :blocked (str "could not be read: " (:error read)))
          (= :present (:check row)) (finding row path :ok "present and readable")
          (= :settings (:check row)) (settings-verdict row repo-root path (:content read))
          (= (normalize-root (:content read)) (normalize-root repo-root))
          (finding row path :ok (str "names this repo root: " (normalize-root repo-root)))
          :else (finding row path :stale (str "names \"" (normalize-root (:content read)) "\"")))))))

;; ── context: where each base actually lives on this host ──────────────────

(defn context
  "Resolves the repo root and both $HOME-rooted bases from injected values.
   `:env` is a plain map, never read from the process here, so a test's
   fixture can never depend on the real $HOME."
  [{:keys [repo-root env]}]
  (let [env (or env {})
        home (or (get env "HOME") "")]
    {:repo-root (normalize-root repo-root)
     :tunnel-registry-dir (or (get env "SWARMFORGE_TUNNEL_REGISTRY_DIR")
                              (str (fs/path home ".swarmforge" "tunnels")))
     :cloudflared-dir (or (get env "SWARMFORGE_CLOUDFLARED_DIR")
                          (str (fs/path home ".cloudflared")))}))

(defn resolve-path [ctx row]
  (let [base (case (:base row)
               :repo (:repo-root ctx)
               :tunnel-registry (:tunnel-registry-dir ctx)
               :cloudflared (:cloudflared-dir ctx))]
    (if (str/blank? (:rel row)) base (str (fs/path base (:rel row))))))

;; ── the read seams, and the run ───────────────────────────────────────────

(defn default-exists? [path] (fs/exists? path))

(defn default-read-file [path]
  (try {:ok? true :content (slurp path)}
       (catch Exception e {:ok? false :error (.getMessage e)})))

(defn default-list-dir [path]
  (try {:ok? true :names (mapv fs/file-name (fs/list-dir path))}
       (catch Exception e {:ok? false :error (.getMessage e)})))

(defn ^:private gather [row path {:keys [exists?* read-file* list-dir*]}]
  (let [exists? (exists?* path)]
    (cond-> {:path path :exists? exists?}
      (and exists? (= :present-any (:check row))) (assoc :entries (list-dir* path))
      (and exists? (contains? #{:settings :root-text :present} (:check row))) (assoc :read (read-file* path)))))

(defn run-doctor
  "Walks the declared inventory and returns {:repo-root .. :findings [..]}.
   One finding per row, in inventory order - the report and the inventory are
   the same length by construction (invariant 2)."
  [{:keys [inventory] :as opts}]
  (let [ctx (context opts)
        inventory (or inventory default-inventory)
        io {:exists?* (or (:exists?* opts) default-exists?)
            :read-file* (or (:read-file* opts) default-read-file)
            :list-dir* (or (:list-dir* opts) default-list-dir)}]
    {:repo-root (:repo-root ctx)
     :findings (mapv (fn [row]
                       (let [path (resolve-path ctx row)]
                         (verdict-for row (:repo-root ctx) (gather row path io))))
                     inventory)}))

(defn exit-code
  "Non-zero if ANY location is not OK - including one that could not be
   checked. 'The doctor could not tell' and 'this host is fine' are opposite
   answers, and collapsing them is how a half-migrated host reads as healthy."
  [result]
  (if (every? #(= :ok (:verdict %)) (:findings result)) 0 1))

(defn format-report [result]
  (let [lines (for [f (:findings result)
                    :let [verdict (str/upper-case (name (:verdict f)))]
                    line (concat [(format "  %-8s %s" verdict (:id f))
                                  (str "           at:   " (:path f))
                                  (str "           found: " (:found f))]
                                 (when-not (= :ok (:verdict f))
                                   [(str "           fix:   " (:remediation f))]))]
                line)
        needing (remove #(= :ok (:verdict %)) (:findings result))]
    (str/join "\n"
              (concat [(str "HOST SWITCHOVER DOCTOR - repo root: " (:repo-root result))
                       ""]
                      lines
                      [""
                       (if (empty? needing)
                         (format "All %d host-pinned locations describe this host." (count (:findings result)))
                         (format "%d of %d host-pinned locations need attention."
                                 (count needing) (count (:findings result))))]))))
