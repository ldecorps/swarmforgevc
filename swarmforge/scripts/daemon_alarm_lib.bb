;; BL-144: daemon-death alarm decision/rendering logic, kept pure and
;; reachable without live tmux/process/network (constitution testability
;; boundary) - only the thin adapters handoffd_supervisor.bb injects here
;; touch the filesystem, a real clock, or the network.
(ns daemon-alarm-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(defn parse-conf
  "Parses `config <key> <value>` lines from swarmforge.conf content into a
   plain key->value string map. Blank/comment/unrelated lines are ignored."
  [content]
  (into {}
        (for [line (str/split-lines (or content ""))
              :let [line (str/trim line)]
              :when (str/starts-with? line "config ")
              :let [[_ k v] (re-matches #"config\s+(\S+)\s+(.*)" line)]
              :when k]
          [k (str/trim v)])))

(defn format-failure-log
  "Renders the daemon-death failure report as plain text: death timestamp,
   reason, prior restart history/last incident, a per-role inbox/outbox
   snapshot at time of death, and the daemon's own trailing log lines."
  [{:keys [died-at reason log-tail restart-history last-incident role-counts]}]
  (str/join
   "\n"
   (concat
    ["SwarmForge daemon failure report"
     (str "died_at: " died-at)
     (str "reason: " (name reason))
     (str "restart_history: " (pr-str restart-history))
     (str "last_incident: " (pr-str last-incident))
     ""
     "per-role inbox/outbox snapshot at time of death:"]
    (for [{:keys [role inbox-new outbox]} role-counts]
      (str "  " role ": inbox/new=" inbox-new " outbox=" outbox))
    [""
     "last daemon log lines:"]
    log-tail)))

(defn build-alarm-email
  "Plain-text alarm email content: names the failure log path and the
   recovery command per BL-144's acceptance (daemon-death-alarm-02)."
  [{:keys [failure-log-path ensure-command]}]
  {:subject "SwarmForge: daemon died, swarm halted"
   :text (str "The handoffd daemon died. No auto-restart was attempted - "
              "the swarm has been stopped so a human can look at it.\n\n"
              "Failure log: " failure-log-path "\n"
              "After fixing the daemon, run: " ensure-command "\n")})

;; BL-286: our own {:filename :content-id :base64} attachment descriptor
;; (matching build-diagram-section's shape) -> Resend's own attachment
;; field names ({:filename :content :content_id}, RFC-2392 inline
;; reference - setting content_id is what lets HTML reference it via
;; cid:<content_id>).
(defn- resend-attachment [{:keys [filename content-id base64]}]
  {:filename filename :content base64 :content_id content-id})

(defn default-post!
  "Real Resend POST, isolated behind an injectable seam so tests never touch
   the network (mirrors extension/src/notify/resendClient.ts's PostFn).
   BL-260: an optional :html key is included in the JSON body when present -
   Resend sends a multipart/alternative email (html + text parts) itself
   when both fields are given, so no MIME boundary handling is needed here.
   BL-286: an optional, non-empty :attachments seq (our own descriptor
   shape) is translated to Resend's own attachment shape and included -
   absent/empty attachments means no :attachments key at all, the exact
   prior body."
  [api-key {:keys [to from subject text html attachments]}]
  (let [http (requiring-resolve 'babashka.http-client/post)
        json-generate (requiring-resolve 'cheshire.core/generate-string)
        body (cond-> {:from from :to [to] :subject subject :text text}
               html (assoc :html html)
               (seq attachments) (assoc :attachments (mapv resend-attachment attachments)))]
    (try
      (let [res (http "https://api.resend.com/emails"
                       {:headers {"Authorization" (str "Bearer " api-key)
                                  "Content-Type" "application/json"}
                        :body (json-generate body)
                        :throw false})]
        {:success (<= 200 (:status res) 299) :status (:status res)})
      (catch Exception e
        {:success false :error (.getMessage e)}))))

(defn send-alarm-email!
  "Sends the alarm email, or reports why it could not. BL-215: the two off
   states are distinguished so a caller can tell them apart - no recipient
   is an intentional, quiet no-op (like BL-073's own pattern); a recipient
   present but no API key is a real misconfiguration the caller should
   escalate loudly via warn-missing-key-if-needed! below.

   BL-260: the 7-arg form threads an optional html body through to post-fn!
   (nil when the caller has none, e.g. BL-144's plain-text-only death alarm)
   - the existing 5-/6-arg forms are unchanged and still delegate with no
   html, so every pre-BL-260 caller/test keeps its exact prior behavior.

   BL-286: the 8-arg form additionally threads an optional attachments seq
   (our own {:filename :content-id :base64} shape) - the 7-arg form now
   delegates to it with attachments nil, which cond-> below skips entirely
   (no :attachments key), so every pre-BL-286 caller/test keeps its exact
   prior behavior too."
  ([api-key to from subject text] (send-alarm-email! api-key to from subject text default-post!))
  ([api-key to from subject text post-fn!] (send-alarm-email! api-key to from subject text nil post-fn!))
  ([api-key to from subject text html post-fn!] (send-alarm-email! api-key to from subject text html nil post-fn!))
  ([api-key to from subject text html attachments post-fn!]
   (cond
     (str/blank? to)
     {:success false :reason :disabled :error "email not configured (notify_email_to unset)"}

     (str/blank? api-key)
     {:success false :reason :missing-api-key :error "email not configured (missing RESEND_API_KEY)"}

     :else
     (post-fn! api-key (cond-> {:to to :from from :subject subject :text text}
                          html (assoc :html html)
                          (seq attachments) (assoc :attachments attachments))))))

;; BL-215: a recipient-configured-but-keyless daemon must warn loudly instead
;; of silently no-oping (the defect: send-alarm-email!'s old single failure
;; shape made "email intentionally off" and "real misconfiguration"
;; indistinguishable, and the supervisor caller just swallowed the result).
;; Lives in this shared library, not the caller, so BOTH the BL-144 alarm and
;; a future BL-214 briefing send get the warning for free through the same
;; send-configured-alarm-email!-shaped wrapper.

(defn warn-missing-key-if-needed!
  "Given a send-alarm-email! result, logs a loud one-time warning naming
   RESEND_API_KEY when :reason is :missing-api-key and no such warning has
   been logged yet (already-warned?! false) - never logs the key value
   itself (there is none to log: the whole point is that it's absent). A
   no-op for a quiet :disabled no-op, a real send attempt, or a repeat call
   once already warned (do not spam every poll/sweep)."
  [{:keys [reason]} {:keys [already-warned?! log-warning! mark-warned!]}]
  (when (and (= reason :missing-api-key) (not (already-warned?!)))
    (log-warning!
     (str "notify_email_to is configured but RESEND_API_KEY is missing from the daemon's "
          "environment - alarm/briefing email cannot send. Export RESEND_API_KEY in the "
          "daemon's launch environment."))
    (mark-warned!)))

;; BL-214: the one shared "read conf, send, warn if misconfigured" wrapper -
;; every caller (BL-144's alarm, BL-214's briefing sweep) was independently
;; re-deriving the exact same to/from/api-key-from-conf steps and either
;; wiring warn-missing-key-if-needed! or (easy to miss) forgetting to. One
;; function here means a new caller gets the loud warning by construction
;; instead of by remembering to copy it.
;; BL-326: the fail-safe that must live in the SEND PATH, not in every test
;; author's memory. A per-invocation `env -u RESEND_API_KEY` convention
;; already existed (BL-215's own case guarded itself) and still mailed the
;; human 136 real times, because ONE test file's daemon-killing cases never
;; got the memo - a 1-in-7 miss rate with a real-world blast radius is not a
;; control. This predicate is the automatic, no-cooperation-required signal:
;; every test fixture in this codebase creates its throwaway project root
;; via `mktemp -d`, which always lands under the system temp directory - a
;; real swarm's project root never does. Checked at the ONE place every
;; alarm/briefing email already funnels through (send-configured-email!
;; below), so a new test file gets the guard for free, by construction,
;; the same way BL-214 already made warn-missing-key-if-needed! automatic
;; for a new caller instead of copy-pasted.
(defn test-fixture-root?
  "True when project-root resolves under the system temp directory (honors
   $TMPDIR, falling back to the JVM's own java.io.tmpdir the way `mktemp`
   does) - the tell every one of this suite's throwaway daemon fixtures
   shares, confirmed on the real incident's own mail body (the /tmp/tmp.*
   root was the giveaway). Never throws: an unresolvable/relative path is
   treated as project-root's own raw string, not a crash."
  [project-root]
  (let [tmp-dir (or (System/getenv "TMPDIR") (System/getProperty "java.io.tmpdir") "/tmp")
        canonical-tmp (try (str (fs/canonicalize tmp-dir)) (catch Exception _ tmp-dir))
        canonical-root (try (str (fs/canonicalize project-root)) (catch Exception _ (str project-root)))]
    (str/starts-with? canonical-root canonical-tmp)))

;; BL-326: intercepts ONLY the actual network POST, never the decision path
;; above it - a test-fixture root with a configured recipient but a MISSING
;; key must still fall through send-alarm-email!'s existing :missing-api-key
;; branch and still warn loudly (BL-215/BL-326 scenario 04 both depend on
;; this staying true for exactly the fixtures that exercise it); only the
;; branch that would otherwise reach a REAL post-fn! call (both to and
;; api-key present) is redirected here instead of default-post!.
(defn- suppressed-post! [_api-key _msg]
  {:success false :reason :test-fixture-suppressed :error "email suppressed: project root is a throwaway test/temp directory"})

(defn send-configured-email!
  "Reads notify_email_to/notify_email_from from conf-file (parse-conf) and
   RESEND_API_KEY from the process env, sends via send-alarm-email!, then
   runs warn-missing-key-if-needed! with warn-adapters (shape:
   {:already-warned?! :log-warning! :mark-warned!}, typically a per-process
   atom so repeated calls across a long-lived daemon warn only once).

   BL-260: the 6-arg form threads an optional html body through; the
   existing 5-arg form (BL-144's death alarm) is unchanged, delegating with
   no html.

   BL-286: the 7-arg form additionally threads an optional attachments seq;
   the 6-arg form now delegates to it with attachments nil, so every
   pre-BL-286 caller/test keeps its exact prior behavior too.

   BL-326: project-root is now a REQUIRED first argument (every existing
   caller already has it in scope - handoffd_supervisor.bb/handoffd.bb both
   def it top-level) so the test-fixture-root? fail-safe applies to every
   current AND future caller by construction, never opt-in. A test-fixture
   root swaps in suppressed-post! in place of default-post! - the
   :disabled/:missing-api-key decisions in send-alarm-email! are UNCHANGED
   (still computed from the real to/api-key), so a configured-but-keyless
   test fixture still warns loudly exactly as before; only a call that
   would otherwise reach the real network (both to and api-key present) is
   redirected, returning :reason :test-fixture-suppressed (distinct from
   :disabled and :missing-api-key) instead of ever touching the network."
  ([project-root conf-file subject text warn-adapters]
   (send-configured-email! project-root conf-file subject text nil warn-adapters))
  ([project-root conf-file subject text html warn-adapters]
   (send-configured-email! project-root conf-file subject text html nil warn-adapters))
  ([project-root conf-file subject text html attachments warn-adapters]
   (let [conf (parse-conf (when (fs/exists? conf-file) (slurp (str conf-file))))
         to (get conf "notify_email_to")
         from (or (get conf "notify_email_from") "onboarding@resend.dev")
         api-key (System/getenv "RESEND_API_KEY")
         post-fn! (if (test-fixture-root? project-root) suppressed-post! default-post!)
         result (send-alarm-email! api-key to from subject text html attachments post-fn!)]
     (warn-missing-key-if-needed! result warn-adapters)
     result)))

(defn alarm-and-halt!
  "Orchestrates the whole daemon-death response through injected adapters -
   testable with fakes for every side effect (BL-144 non-behavioral gate: no
   real timers, no real process kills, no real network in unit tests). Robust
   to a messy death (nil/partial status, empty log tail, no role counts):
   every adapter call is given already-defaulted inputs."
  [{:keys [reason status now-iso! log-tail! role-counts! write-failure-log! send-email! halt-swarm! write-status!]}]
  (let [died-at (now-iso!)
        log-tail (or (log-tail!) [])
        role-counts (or (role-counts!) [])
        content (format-failure-log {:died-at died-at
                                      :reason reason
                                      :log-tail log-tail
                                      :restart-history (:restart_history status)
                                      :last-incident (:last_incident status)
                                      :role-counts role-counts})
        failure-log-path (write-failure-log! content)
        {:keys [subject text]} (build-alarm-email {:failure-log-path failure-log-path
                                                     :ensure-command "./swarm ensure"})
        email-result (send-email! subject text)]
    (halt-swarm!)
    (write-status! (assoc status
                          :state "halted"
                          :last_incident {:reason (name reason)
                                          :at died-at
                                          :detail "daemon died; alarm sent and swarm halted (no auto-restart)"}
                          :failure_log failure-log-path
                          :alarm_email (:success email-result)))
    {:failure-log-path failure-log-path :email-result email-result}))
