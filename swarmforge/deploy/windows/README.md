# Windows-side boot persistence for a WSL2-hosted swarm

BL-351 (and BL-101/BL-304's `generate_systemd_units.sh`) cover the **Linux
half** of surviving a reboot: systemd units inside the distro that bring the
daemons, operator runtime and front desk back. But nothing *inside* the VM
can make Windows start the VM. When the Windows host reboots (update, power
cut, sleep), the WSL2 VM stays down until a human opens a terminal — which is
exactly what killed every recovery channel on the evening of 2026-07-13
(see `backlog/evidence/incident-20260713-quiet-swarm-postmortem.md`).

This directory is the **Windows half**. It is deliberately tiny: one
scheduled task that starts the distro at logon, plus the two host settings
that stop Windows from sabotaging a 24/7 workload.

## Prerequisites (one-time, inside WSL)

systemd must be enabled in the distro or the Linux-half units never run:

```bash
sudo tee -a /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Then from Windows: `wsl --shutdown`, reopen `wsl`, and verify with
`systemctl is-system-running` (expect `running` or `degraded`, not an error).
After that, install the Linux units per `generate_systemd_units.sh --unit=swarm`
and `--unit=operator` (BL-351 adds the front-desk unit).

## Install (PowerShell, run as the logged-in user)

```powershell
cd \\wsl$\<your-distro>\home\carillon\swarmforgevc\swarmforge\deploy\windows
# or copy the script out first; then:
powershell -ExecutionPolicy Bypass -File .\install-swarmforge-autostart.ps1 -Distro <your-distro>
```

What it does:

1. **Scheduled task `SwarmForge WSL autostart`** — at every user logon,
   runs `wsl.exe -d <distro> -- true`. Starting any command boots the WSL2
   VM; with systemd enabled, the units then bring the swarm up with no
   further Windows involvement. The task retries (3x, 1 min apart) in case
   WSL is slow after an update.
2. **Keeps the VM alive** — sets `vmIdleTimeout=-1` in `.wslconfig` so
   WSL2 does not shut the VM down when idle (Windows 11 22H2+; harmless
   elsewhere).
3. **Prints (does not change) power state** — sleep/hibernate must be
   disabled by the human because it is a policy decision:

   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```

## Limits, honestly stated

- Logon-triggered, not boot-triggered: a reboot that lands on the lock
  screen starts the VM only after logon. For true unattended boot, enable
  auto-logon (netplwiz) or convert the task to an `-AtStartup` trigger
  running as a service account — both need local admin and are left to the
  human.
- This does not (and must not) reimplement anything the Linux units do; if
  the units are missing, this task boots an empty VM and the swarm stays
  down. Install BL-351's units first.
