'use strict';

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { computePipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));
const { syncPipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardSync'));

const FEATURE_NAME = 'the pipeline board LINKS section links every shown ticket to its current folder, most-recent-first';
const REPO_BASE_URL = 'https://github.com/ldecorps/swarmforgevc';
const T1 = Date.UTC(2026, 6, 18, 12, 0);
const T2 = Date.UTC(2026, 6, 18, 12, 1);

function quotedList(text) {
  const ids = [];
  const pattern = /"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(text))) {
    ids.push(match[1]);
  }
  return ids;
}

function ensureBoardFixture(ctx) {
  ctx.roleHeldTickets ??= {};
  ctx.paused ??= [];
  ctx.ticketMeta ??= {};
  ctx.rootIntake ??= [];
  ctx.recentlyClosed ??= [];
  ctx.activeIds ??= [];
}

function filenameFor(id, folder) {
  return folder === 'root' ? `${id}.md` : `${id}.yaml`;
}

function addShownTicket(ctx, id, folder, filename = filenameFor(id, folder)) {
  ensureBoardFixture(ctx);
  if (folder === 'active') {
    ctx.roleHeldTickets.coder = [...(ctx.roleHeldTickets.coder ?? []), id];
    ctx.activeIds.push(id);
    ctx.ticketMeta[id] = { filename, location: 'active', title: `${id} active` };
    return;
  }
  if (folder === 'paused') {
    ctx.paused.push({ id });
    ctx.ticketMeta[id] = { filename, location: 'paused', title: `${id} paused` };
    return;
  }
  if (folder === 'done') {
    ctx.recentlyClosed.push({ id, filename, title: `${id} done` });
    return;
  }
  if (folder === 'root') {
    ctx.rootIntake.push({ id, filename, title: `${id} intake` });
    return;
  }
  throw new Error(`unknown folder "${folder}"`);
}

function renderLinks(ctx) {
  ensureBoardFixture(ctx);
  ctx.board = computePipelineBoard(ctx.roleHeldTickets, ctx.paused, ctx.ticketMeta, {
    rootIntake: ctx.rootIntake,
    recentlyClosed: ctx.recentlyClosed,
    repoBaseUrl: ctx.repoBaseUrl,
    activeIds: ctx.activeIds,
  });
}

function linkFor(ctx, id) {
  const matches = ctx.board.links.filter((link) => link.id === id);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one link for ${id}, got ${matches.length}: ${JSON.stringify(ctx.board.links)}`);
  }
  return matches[0];
}

function boardDataWithLink(pathValue) {
  return {
    rows: [{ id: 'BL-540', column: 'coder', slug: 'same-body' }],
    parked: [],
    rootIntake: [],
    recentlyClosed: [],
    links: [{ id: 'BL-540', path: pathValue }],
  };
}

function fakeAdapters(ctx) {
  return {
    ensureBoardTopic: async () => ({ topicId: 900 }),
    postMessage: async (topicId, text, linksHtml) => {
      ctx.posts.push({ topicId, text, linksHtml });
      return { messageId: ctx.posts.length + 40 };
    },
    deleteMessage: async (topicId, messageId) => {
      ctx.deletes.push({ topicId, messageId });
      return true;
    },
  };
}

function registerSteps(registry) {
  registry.define(/^the board grid shows tickets (.+)$/, (ctx, rest) => {
    for (const id of quotedList(rest)) {
      addShownTicket(ctx, id, 'active');
    }
  });

  registry.define(/^a parked ticket "([^"]+)" shown on the board$/, (ctx, id) => {
    addShownTicket(ctx, id, 'paused');
  });

  registry.define(/^a recently-closed ticket "([^"]+)" shown on the board$/, (ctx, id) => {
    addShownTicket(ctx, id, 'done');
  });

  registry.define(/^a root-intake item "([^"]+)" shown on the board$/, (ctx, id) => {
    addShownTicket(ctx, id, 'root');
  });

  registry.define(/^a shown ticket "([^"]+)" whose backlog file is in the "([^"]+)" folder$/, (ctx, id, folder) => {
    addShownTicket(ctx, id, folder);
    ctx.currentShownTicketId = id;
  });

  registry.define(/^a stale duplicate of "([^"]+)" is left behind in the "([^"]+)" folder$/, (ctx, id, folder) => {
    if (folder !== 'paused') {
      throw new Error(`this scenario only defines paused stale duplicates, got "${folder}"`);
    }
    ensureBoardFixture(ctx);
    ctx.paused.push({ id });
  });

  registry.defineScoped(
    /^the pipeline board links are rendered$/,
    (ctx) => {
      renderLinks(ctx);
    },
    FEATURE_NAME
  );

  registry.define(/^every shown ticket has a link$/, (ctx) => {
    const shown = [
      ...ctx.activeIds,
      ...ctx.paused.map((item) => item.id),
      ...ctx.recentlyClosed.map((item) => item.id),
      ...ctx.rootIntake.map((item) => item.id),
    ];
    for (const id of new Set(shown)) {
      linkFor(ctx, id);
    }
  });

  registry.define(/^"([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)" and "([^"]+)" all have links$/, (ctx, ...ids) => {
    for (const id of ids) {
      linkFor(ctx, id);
    }
  });

  registry.define(/^its link path is "([^"]+)"$/, (ctx, expectedPath) => {
    const link = linkFor(ctx, ctx.currentShownTicketId);
    if (link.path !== expectedPath) {
      throw new Error(`expected ${ctx.currentShownTicketId} link path ${expectedPath}, got ${link.path}`);
    }
  });

  registry.define(/^the board was last posted with "([^"]+)" linked at "([^"]+)"$/, async (ctx, id, linkPath) => {
    ctx.posts = [];
    ctx.deletes = [];
    ctx.initialLinkId = id;
    ctx.initialData = boardDataWithLink(linkPath);
    ctx.firstResult = await syncPipelineBoard(ctx.initialData, undefined, fakeAdapters(ctx), T1, ctx.repoBaseUrl);
  });

  registry.define(/^"([^"]+)" has since moved to the "([^"]+)" folder with no other visible change to the board body$/, (ctx, id, folder) => {
    if (id !== ctx.initialLinkId) {
      throw new Error(`expected the same ticket id ${ctx.initialLinkId}, got ${id}`);
    }
    ctx.nextData = boardDataWithLink(`backlog/${folder}/${id}.yaml`);
  });

  registry.defineScoped(
    /^the board sync runs on the next tick$/,
    async (ctx) => {
      ctx.secondResult = await syncPipelineBoard(ctx.nextData, ctx.firstResult.state, fakeAdapters(ctx), T2, ctx.repoBaseUrl);
    },
    FEATURE_NAME
  );

  registry.define(/^the board is re-posted rather than skipped as unchanged$/, (ctx) => {
    if (ctx.secondResult.outcome !== 'reposted') {
      throw new Error(`expected reposted, got ${ctx.secondResult.outcome}`);
    }
  });

  registry.define(/^"([^"]+)" is now linked at "([^"]+)"$/, (ctx, id, expectedPath) => {
    const lastPost = ctx.posts[ctx.posts.length - 1];
    if (!lastPost.linksHtml.includes(`${id}:`) || !lastPost.linksHtml.includes(expectedPath)) {
      throw new Error(`expected latest linksHtml to include ${id} at ${expectedPath}, got: ${lastPost.linksHtml}`);
    }
  });
}

module.exports = { registerSteps };
