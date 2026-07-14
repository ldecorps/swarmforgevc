Feature: The front desk comes back after a reboot, like every other daemon

# BL-351 (BL-336 findings G1/G2): the bridge and the Telegram front-desk bot - the human's entire
# phone and Telegram surface - are running right now only because someone launched them by hand.
# There is no systemd unit for them, so a reboot takes the human's only channel to the swarm with
# it, silently. handoffd, its supervisor, and operator_runtime all already survive a reboot; the
# front desk is the one that does not. Verified live: no swarmforge unit is installed on this box
# at all, and the unit generator has no front-desk branch.
#
# "Generated" and "installed" are deliberately distinct throughout: a generated-but-uninstalled
# unit is exactly as dark as no unit at all, which is what this box proves today.

Background:
  Given a host where the swarm's daemons are installed to start on boot

# BL-351 front-desk-survives-reboot-01
Scenario: The front desk is among the services installed to start on boot
  When the swarm's boot services are generated
  Then a front-desk service is generated alongside the others

# BL-351 front-desk-survives-reboot-02
Scenario: The front desk comes back up after a reboot
  Given the front desk is running
  When the host reboots
  Then the front desk is running again

# BL-351 front-desk-survives-reboot-03
Scenario: The human's phone and Telegram surface answers again after a reboot
  Given the host has rebooted
  When the human sends a message to the front desk
  Then the front desk receives it

# BL-351 front-desk-survives-reboot-04
Scenario: A front desk that dies is restarted without a human
  Given the front desk is running
  When the front desk process dies
  Then the front desk is running again

# BL-351 front-desk-survives-reboot-05
Scenario: Installing the boot services does not start a second front desk
  Given the front desk is running
  When the swarm's boot services are installed
  Then exactly one front desk is running
