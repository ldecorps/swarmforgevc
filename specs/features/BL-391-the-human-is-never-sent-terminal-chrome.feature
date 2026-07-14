Feature: The human is never sent raw terminal output

# BL-391: the human's literal request — "Can you make these messages more readable?" — was him
# reacting to being sent this, as the first NeedsApproval message on BL-359:
#
#   NeedsApproval: BL-359 - \e[38;5;246m❯ \e[39m \e[38;5;244m─── ⏵⏵ bypass permissions on...
#
# That is raw ANSI colour codes and terminal chrome scraped straight from an agent's tmux pane and
# posted to Telegram, where it renders as line noise. A pane capture is a TERMINAL rendering, not a
# message: it carries escape sequences, box-drawing, spinners and status furniture. Whatever is shown
# to the human must be sanitised of that chrome before it is sent or written into a topic record.

Background:
  Given the swarm has something to tell the human

# BL-391 the-human-is-never-sent-terminal-chrome-01
Scenario: Terminal escape codes are stripped before the human sees them
  Given the message was scraped from an agent's terminal
  When the swarm sends it to the human
  Then the human is sent no terminal escape codes

# BL-391 the-human-is-never-sent-terminal-chrome-02
Scenario: The message still says what it meant to say
  Given the message was scraped from an agent's terminal
  When the swarm sends it to the human
  Then the human is sent the readable text that was inside it

# BL-391 the-human-is-never-sent-terminal-chrome-03
Scenario: The record kept for a ticket is readable too
  Given the message was scraped from an agent's terminal
  When the swarm records it against the ticket
  Then the recorded message carries no terminal escape codes

# BL-391 the-human-is-never-sent-terminal-chrome-04
Scenario: A message that was never terminal output is left alone
  Given the message was written as plain prose
  When the swarm sends it to the human
  Then the human is sent that message unchanged
