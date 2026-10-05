'use strict';

const pilot = require('../../../extension/out/tools/telegramCursorBridgePilot');

const FEATURE = 'Cursor /pilot posts Telegram status on ticket, hat, and bounce';

function registerSteps(registry) {
  registry.defineScoped(/^the pilot expeditor prompt composer is available$/, (ctx) => {
    if (typeof pilot.composePilotExpeditorPrompt !== 'function') {
      throw new Error('expected composePilotExpeditorPrompt to be available');
    }
  }, FEATURE);

  registry.defineScoped(/^the pilot start message is formatted for "([^"]+)"$/, (ctx, ticket) => {
    ctx.ticket = ticket;
    ctx.message = pilot.formatPilotStartMessage(ticket);
  }, FEATURE);

  registry.defineScoped(/^the pilot start message names the ticket$/, (ctx) => {
    if (!ctx.message.includes(ctx.ticket)) {
      throw new Error(`expected start message to name ${ctx.ticket}: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the pilot start message names the offline Cursor-as-expeditor mode$/, (ctx) => {
    if (!ctx.message.includes('no claude -p / expedite_cli')) {
      throw new Error(`expected start message to name offline mode: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the pilot start message promises progress posts and .update$/, (ctx) => {
    if (!ctx.message.includes('Progress posts and /update')) {
      throw new Error(`expected start message to promise progress posts: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a pilot ticket-change status is formatted for "([^"]+)" with object "([^"]+)"$/, (ctx, ticket, object) => {
    ctx.ticket = ticket;
    ctx.object = object;
    ctx.message = pilot.formatPilotTicketChangeStatus(ticket, object);
  }, FEATURE);

  registry.defineScoped(/^a pilot hat-change status is formatted for role "([^"]+)" with job "([^"]+)"$/, (ctx, role, job) => {
    ctx.role = role;
    ctx.job = job;
    ctx.message = pilot.formatPilotHatChangeStatus(role, job);
  }, FEATURE);

  registry.defineScoped(/^a pilot bounce-back status is formatted toward "([^"]+)" with reason "([^"]+)"$/, (ctx, role, reason) => {
    ctx.role = role;
    ctx.reason = reason;
    ctx.message = pilot.formatPilotBounceBackStatus(role, reason);
  }, FEATURE);

  registry.defineScoped(/^the formatted status includes "([^"]+)" and "([^"]+)"$/, (ctx, a, b) => {
    if (!ctx.message.includes(a) || !ctx.message.includes(b)) {
      throw new Error(`expected status to include ${a} and ${b}: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the ticket-change status names the ticket and the object$/, (ctx) => {
    if (!ctx.message.includes(ctx.ticket) || !ctx.message.includes(ctx.object)) {
      throw new Error(`expected ticket-change status to name ${ctx.ticket} and ${ctx.object}: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the hat-change status names the role and the job$/, (ctx) => {
    if (!ctx.message.includes(ctx.role) || !ctx.message.includes(ctx.job)) {
      throw new Error(`expected hat-change status to name ${ctx.role} and ${ctx.job}: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the bounce-back status names the target role and the reason$/, (ctx) => {
    if (!ctx.message.includes(ctx.role) || !ctx.message.includes(ctx.reason)) {
      throw new Error(`expected bounce-back status to name ${ctx.role} and ${ctx.reason}: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the ticket-change status still names the offline Cursor-as-expeditor mode$/, (ctx) => {
    if (!ctx.message.includes('no claude -p / expedite_cli')) {
      throw new Error(`expected ticket-change status to name offline mode: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the hat-change status still names the offline Cursor-as-expeditor mode$/, (ctx) => {
    if (!ctx.message.includes('no claude -p / expedite_cli')) {
      throw new Error(`expected hat-change status to name offline mode: ${ctx.message}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the bounce-back status still names the offline Cursor-as-expeditor mode$/, (ctx) => {
    if (!ctx.message.includes('no claude -p / expedite_cli')) {
      throw new Error(`expected bounce-back status to name offline mode: ${ctx.message}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
