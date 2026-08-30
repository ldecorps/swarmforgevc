'use strict';

// BL-1235 architect D1: the live turn loop, which the first build of this
// ticket left unwritten - so the seat decided correctly and was unreachable,
// and posting in the topic did nothing at all.
//
// Every edge is injected, so the whole loop runs in-process with no ollama, no
// Telegram and no network. What is asserted is what reaches the topic and in
// what order, because that is the only thing the person who posted can see.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  readQwenLocalTopicId,
  readLocalEndpoint,
  completeWithLocalModel,
  runLocalSeatTurn,
} = require('../out/tools/localQwenSeatLive');
const { DEFAULT_LOCAL_SEAT_MODEL_ID, LOCAL_SEAT_SLOW_TURN_NOTICE } = require('../out/tools/localQwenSeat');

const SEAT_TOPIC = 41004;
const CURSOR_TOPIC = 8435;
const ENDPOINT = 'http://127.0.0.1:11434';

const healthy = () => ({
  probe: { endpointStatus: 'healthy', endpointUrl: ENDPOINT },
  catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
});

function turn(over = {}) {
  const posted = [];
  return runLocalSeatTurn({
    targetPath: '/nowhere',
    topicId: SEAT_TOPIC,
    seatTopicId: SEAT_TOPIC,
    text: 'what is 2 + 2?',
    post: async (topicId, message) => posted.push({ topicId, message }),
    readEndpoint: async () => healthy(),
    complete: async () => 'four',
    modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
    ...over,
  }).then((outcome) => ({ outcome, posted: over.posted ?? posted }));
}

describe('BL-1235 the seat resolves its topic from the shared map', () => {
  it('reads the binding the operator writes', () => {
    const root = mkTmpDir('bl1235-live-');
    try {
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json'),
        JSON.stringify({ 8435: 'CURSOR_REMOTE', 11810: 'BUBBLE', 41004: 'QWEN_LOCAL' })
      );
      assert.equal(readQwenLocalTopicId(root), SEAT_TOPIC);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('owns no topic when nobody has bound one, rather than throwing', () => {
    const root = mkTmpDir('bl1235-live-');
    try {
      assert.equal(readQwenLocalTopicId(root), undefined);
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json'), 'not json{');
      assert.equal(readQwenLocalTopicId(root), undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('BL-1235 one live turn', () => {
  it('acknowledges FIRST, then posts the completion', async () => {
    const { outcome, posted } = await turn();

    assert.equal(outcome.kind, 'answer');
    assert.equal(posted.length, 2);
    // The order is the point: a measured turn on this host took 3m19s, and
    // without a first word the topic looks dead for minutes.
    assert.match(posted[0].message, new RegExp(DEFAULT_LOCAL_SEAT_MODEL_ID));
    assert.ok(posted[0].message.includes(LOCAL_SEAT_SLOW_TURN_NOTICE));
    assert.equal(posted[1].message, 'four');
    for (const p of posted) {
      assert.equal(p.topicId, SEAT_TOPIC, 'the seat replied outside its own topic');
    }
  });

  it('hands the inbound text to the model', async () => {
    let sawPrompt;
    await turn({ complete: async (_m, prompt) => { sawPrompt = prompt; return 'ok'; } });
    assert.equal(sawPrompt, 'what is 2 + 2?');
  });

  it('says so rather than posting an empty reply', async () => {
    const { posted } = await turn({ complete: async () => '   ' });
    assert.match(posted[1].message, /empty reply/);
  });

  it('posts NOTHING at all on another topic', async () => {
    const { outcome, posted } = await turn({ topicId: CURSOR_TOPIC });

    assert.equal(outcome.kind, 'not-mine');
    assert.deepEqual(posted, [], "the seat spoke on cursor's topic");
  });

  it('posts the endpoint own reason when it is down, and never acknowledges', async () => {
    const { outcome, posted } = await turn({
      readEndpoint: async () => ({
        probe: { endpointStatus: 'missing', endpointUrl: ENDPOINT, reason: 'connect ECONNREFUSED 127.0.0.1:11434' },
        catalogue: [],
      }),
    });

    assert.equal(outcome.kind, 'refuse');
    assert.equal(posted.length, 1, 'a refusal should not be preceded by an acknowledgement');
    assert.match(posted[0].message, /ECONNREFUSED/);
    assert.match(posted[0].message, /No other seat has been asked/);
  });

  it('turns a completion that throws into a visible refusal in the same topic', async () => {
    const { outcome, posted } = await turn({
      complete: async () => {
        throw new Error('model runner exited mid-generation');
      },
    });

    assert.equal(outcome.kind, 'refuse');
    // The acknowledgement went out first, then the failure - the turn fails
    // visibly where the person who asked is looking.
    assert.equal(posted.length, 2);
    assert.match(posted[1].message, /model runner exited mid-generation/);
    assert.equal(posted[1].topicId, SEAT_TOPIC);
  });
});

describe('BL-1235 the endpoint reading', () => {
  const okResponse = (body) => ({ ok: true, status: 200, text: async () => body });

  it('reports the catalogue the endpoint holds', async () => {
    const reading = await readLocalEndpoint(ENDPOINT, async () =>
      okResponse(JSON.stringify({ models: [{ name: 'qwen3:14b' }, { name: 'qwen2.5-coder:7b-instruct' }] }))
    );

    assert.equal(reading.probe.endpointStatus, 'healthy');
    assert.deepEqual(reading.catalogue, ['qwen3:14b', 'qwen2.5-coder:7b-instruct']);
  });

  it('reports a non-answering endpoint as missing, carrying the error text', async () => {
    const reading = await readLocalEndpoint(ENDPOINT, async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    });

    assert.equal(reading.probe.endpointStatus, 'missing');
    assert.match(reading.probe.reason, /ECONNREFUSED/);
  });

  it('reports a bad status as unhealthy, and never as a bare code', async () => {
    const reading = await readLocalEndpoint(ENDPOINT, async () => ({
      ok: false,
      status: 503,
      text: async () => 'server busy',
    }));

    assert.equal(reading.probe.endpointStatus, 'unhealthy');
    assert.match(reading.probe.reason, /503/);
    assert.match(reading.probe.reason, /server busy/, 'the reason is a bare status code');
  });

  it('truncates an oversized error body rather than posting it whole', async () => {
    const huge = 'x'.repeat(5000);
    const reading = await readLocalEndpoint(ENDPOINT, async () => ({
      ok: false,
      status: 500,
      text: async () => huge,
    }));

    assert.equal(reading.probe.endpointStatus, 'unhealthy');
    // The reason is the fixed prefix plus AT MOST 200 chars of body - an
    // untruncated 5000-char body would otherwise ride straight into the
    // Telegram topic on every failing probe.
    assert.ok(
      reading.probe.reason.length < huge.length,
      `an oversized error body was not truncated: ${reading.probe.reason.length} chars`
    );
    assert.match(reading.probe.reason, new RegExp(`x{200}(?!x)`));
  });
});

describe('BL-1235 the completion call', () => {
  it('asks the endpoint for a non-streaming completion and returns the text', async () => {
    let sawUrl;
    let sawBody;
    const reply = await completeWithLocalModel('qwen3:14b', 'hello', ENDPOINT, async (url, init) => {
      sawUrl = url;
      sawBody = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ response: ' hi ' }) };
    });

    assert.equal(sawUrl, `${ENDPOINT}/api/generate`);
    assert.deepEqual(sawBody, { model: 'qwen3:14b', prompt: 'hello', stream: false });
    assert.equal(reply, 'hi');
  });

  it('throws with the endpoint own words on a bad status', async () => {
    await assert.rejects(
      () =>
        completeWithLocalModel('qwen3:14b', 'hello', ENDPOINT, async () => ({
          ok: false,
          status: 404,
          text: async () => 'model "qwen3:14b" not found',
        })),
      /model "qwen3:14b" not found/
    );
  });

  it('truncates an oversized failure body in the thrown message too', async () => {
    const huge = 'y'.repeat(5000);
    await assert.rejects(
      () =>
        completeWithLocalModel('qwen3:14b', 'hello', ENDPOINT, async () => ({
          ok: false,
          status: 500,
          text: async () => huge,
        })),
      (err) => {
        assert.ok(err.message.length < huge.length, `the thrown message was not truncated: ${err.message.length} chars`);
        assert.match(err.message, /y{200}(?!y)/);
        return true;
      }
    );
  });
});
