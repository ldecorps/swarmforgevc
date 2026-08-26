Feature: Telegram front desk runs headless — supervised bridge + Front Desk Bot

  Background:
    Given the front desk is launched headless with no VS Code host

  # BL-292 headless-frontdesk-01
  Scenario: a supervised process starts the bridge without a VS Code host
    Given the headless launcher runs
    When it brings up the bridge
    Then the bridge serves the front-desk routes with a provisioned control token

  # BL-292 headless-frontdesk-02
  Scenario: the Front Desk Bot launches against the bridge with matching credentials
    Given the bridge is running with its provisioned tokens
    When the launcher brings up the Front Desk Bot
    Then the bot runs against that bridge with the Telegram credentials and the bridge's tokens in its env

  # BL-292 headless-frontdesk-03
  Scenario: a crashed process restarts with bounded backoff, not forever
    Given a supervised front-desk process that has crashed
    When the supervisor reacts
    Then it restarts the process with backoff up to a bounded limit and then gives up

  # BL-292 headless-frontdesk-04
  Scenario: launching when already running does not start a second instance
    Given the front desk is already running
    When the launcher is invoked a second time
    Then no second instance is started

  # BL-292 headless-frontdesk-05
  Scenario: an inbound topic message becomes a thread and gets an in-topic reply
    Given the headless front desk is up
    When the principal posts a message in a subject topic
    Then it lands as a SUP-### thread and the Operator replies in that topic
