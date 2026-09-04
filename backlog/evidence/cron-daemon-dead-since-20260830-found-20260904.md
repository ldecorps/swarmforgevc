# The host's cron daemon has been stopped since 2026-08-30 - every scheduled swarm job silently inert

Reported by the coordinator (priority-`00` note, 2026-09-04T16:12Z: "cron
not running on host - no scheduled shift ever fires, since Aug30").
Verified by the specifier on the host:

- `service cron status` -> `cron is not running`; `pgrep -x cron` empty.
- WSL2 instance, `ps -p 1` = `init`, `systemctl is-system-running` =
  `offline`: no systemd, so nothing starts cron at boot. `/etc/wsl.conf`
  has only `[user] default=carillon` - no `[boot]` command.
- `crontab -l` holds 6 live lines (weekday 09:00 start, 17:00 bedtime,
  weekend 01:00 start / 09:00 bedtime, the BL-675 freshness watchdog every
  2 minutes, the BL-1327 descent review daily). None fires.
- `.swarmforge/daemon/freshness-check.cron.log` last written
  2026-08-30 06:52 BST - the freshness watchdog's last run, and the moment
  cron died (a WSL restart with no boot command is the ordinary cause).
- No shift start or bedtime has fired since: today's `day-shift.log`
  (08:44 BST) is the human's manual launch, and the 17:00 BST bedtime did
  not fire - the swarm is running past its shift as this is written.

What the swarm did about it: nothing. `install_swarmforge_crons.sh`,
`install_freshness_cron.sh` and `install_shift_schedule_cron.sh` check
only that a `crontab` command exists and print "Installed …" on every
`./swarm` start; no script asks whether a cron daemon is alive (grep of
`swarmforge/scripts` and `extension/src`: none), and nothing reads the
freshness cron log's age - the watchdog's own transport has no watchdog.
Five days of green "installed" lines over a dead scheduler.

Consequences already paid: the BL-675 watchdog (which restarts a dead
handoffd) has been off since 08-30; every scheduled shift boundary since
has been manual; the 2026-09-04 morning intake worried that "today's 9am
weekday start was ~40 minutes away" after restoring the crontab - it would
not have fired regardless.

## Host fix (root - the human's or the operator's, not an agent's)

    sudo service cron start

and, so it survives a WSL restart, add to `/etc/wsl.conf`:

    [boot]
    command="service cron start"

(or enable systemd there with `systemd=true` and `systemctl enable cron`).
Then confirm `pgrep -x cron` shows a pid and the freshness log resumes
within 2 minutes. On macOS launchd starts `/usr/sbin/cron` whenever a
crontab exists; this failure shape is WSL/Linux-without-systemd.

## Swarm fix: BL-1392

A cron install refuses to report success with no daemon running, naming
the host fix; the daemon-side sweep reads the freshness cron log's age and
escalates once per episode when cron stops; the check never starts cron
itself.

By specifier.
