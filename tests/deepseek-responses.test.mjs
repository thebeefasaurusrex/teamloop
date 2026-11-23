import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { validateConfig } from '../src/config.mjs';
import { buildDeepSeekRequest, invokeDeepSeek } from '../src/deepseek-responses.mjs';
import { assertImageTransport, decode, loadImages, outputSchema, prepare, run } from '../src/team-loop.mjs';
import { tempDir } from './helpers.mjs';

const model = 'deepseek-flash';
const packetHash = 'fixture-hash';
const schema = outputSchema('review', packetHash);
const prompt = 'Review this screenshot.';
const review = { packetHash, verdict: 'approve', summary: 'Checked the supplied evidence.', findings: [], uncertainties: [] };
const image = { mediaType: 'image/png', data: 'AQID' };

test('keeps text-only request shape and adds inline image blocks in order with default detail', () => {
  const text = buildDeepSeekRequest({ model, prompt, schema });
  assert.deepEqual(text.input, [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }]);
  const multimodal = buildDeepSeekRequest({ model, prompt, schema, images: [image, { mediaType: 'image/webp', data: 'BAUG' }], effort: 'high' });
  assert.deepEqual(multimodal.input[0].content, [
    { type: 'input_text', text: prompt },
    { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
    { type: 'input_image', image_url: 'data:image/webp;base64,BAUG' },
  ]);
  assert.deepEqual(multimodal.reasoning, { effort: 'high' });
  assert.equal(multimodal.store, false);
  assert.equal(multimodal.stream, true);
  assert.equal(Object.hasOwn(multimodal, 'tools'), false);
  assert.equal(multimodal.text.format.schema, schema);
  assert.throws(() => buildDeepSeekRequest({ model: 'alternate', prompt, schema }), /Unsupported DeepSeek model/);
});

test('DeepSeek requires explicit activation, API consent, selected safe evidence, and an image source', async () => {
  const root = await tempDir('teamloop-deepseek-');
  const config = {
    schemaVersion: 1,
    stateRoot: path.join(root, 'state'),
    blockedLiterals: [],
    limits: { maxTaskTimeoutMs: 180000, maxRunsPerProviderPacket: 1 },
    providers: { deepseek: { enabled: true, models: { [model]: { efforts: ['high'], imageInput: true } } } },
  };
  assert.throws(() => validateConfig(config), /deepseekEnabled/);
  config.deepseekEnabled = true;
  assert.throws(() => validateConfig(config), /allowApiSpend/);
  config.allowApiSpend = true;
  await fs.writeFile(path.join(root, 'brief.md'), 'Synthetic evidence.');
  const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
  await fs.writeFile(path.join(root, 'picture.png'), pngBytes);
  const spec = {
    id: 'deepseek-packet',
    root,
    files: ['brief.md'],
    images: ['picture.png'],
    dataClass: 'synthetic',
    assignment: 'Review supplied evidence.',
    requirements: [],
    constraints: [],
    decisions: [],
  };
  await assert.rejects(prepare({ ...spec, imageProvenance: { 'picture.png': 'private' } }, config), /imageProvenance/);
  const unlabeled = await prepare(spec, config);
  await assert.rejects(run(unlabeled, 'deepseek', model, config, 'high'), /imageProvenance/);
  const imageProvenance = { 'picture.png': 'synthetic' };
  const labeled = await prepare({ ...spec, imageProvenance }, config);
  const packet = JSON.parse(await fs.readFile(labeled, 'utf8'));
  assert.deepEqual(packet.payload.imageProvenance, imageProvenance);
  assert.doesNotThrow(() => assertImageTransport('deepseek', packet));
  assert.deepEqual(await loadImages(packet), [{ mediaType: 'image/png', data: pngBytes.toString('base64') }]);
  const privatePacket = await prepare({ ...spec, dataClass: 'private', imageProvenance }, config);
  await assert.rejects(run(privatePacket, 'deepseek', model, config, 'high'), /public or synthetic/);
  const artifact = await prepare({ ...spec, kind: 'artifact', imageProvenance }, config);
  await assert.rejects(run(artifact, 'deepseek', model, config, 'high'), /only supports review packets/);
  packet.payload.images[0].sizeBytes = 20649372;
  assert.doesNotThrow(() => assertImageTransport('deepseek', packet));
  packet.payload.images[0].sizeBytes++;
  assert.throws(() => assertImageTransport('deepseek', packet), /20,649,372/);
  packet.payload.images = Array.from({ length: 9 }, () => ({ path: 'picture.png', sizeBytes: 1 }));
  assert.throws(() => assertImageTransport('deepseek', packet), /8 images/);
  assert.doesNotThrow(() => assertImageTransport('deepseek', { payload: { images: [] } }));
  const previousPacket = JSON.parse(await fs.readFile(unlabeled, 'utf8'));
  assert.doesNotThrow(() => assertImageTransport('nvidia', previousPacket));
});

test('streams one request to the fixed endpoint, binds terminal identity, and rejects bad output without retries', async () => {
  const root = await tempDir('teamloop-deepseek-key-');
  const keyFile = path.join(root, 'fixture.key');
  await fs.writeFile(keyFile, 'sk-' + 'fixture'.repeat(4) + '\n');
  const terminal = {
    status: 'completed',
    model,
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(review) }] }],
  };
  const event = payload => 'event: ' + payload.type + '\r\ndata: ' + JSON.stringify(payload) + '\r\n\r\n';
  const completed = response => event({ type: 'response.completed', response });
  let requests = 0;
  const respond = body => async (url, request) => {
    requests++;
    assert.equal(url, 'https://api.deepseek.com/responses');
    assert.equal(request.redirect, 'error');
    assert.equal(request.method, 'POST');
    assert.equal(typeof request.headers.Authorization, 'string');
    const sent = JSON.parse(request.body);
    assert.equal(sent.model, model);
    assert.equal(sent.store, false);
    assert.equal(sent.input[0].content[1].image_url, 'data:image/png;base64,AQID');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(body);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 29));
          controller.enqueue(bytes.slice(29));
          controller.close();
        },
      }),
    );
  };
  const invoke = body => invokeDeepSeek({ keyFile, model, prompt, schema, images: [image], fetchImpl: respond(body) });
  const result = await invoke(completed(terminal));
  assert.deepEqual(decode('deepseek', JSON.stringify(result), packetHash, model).review, review);
  await assert.rejects(invoke(completed({ ...terminal, model: 'different' })), /model identity/);
  await assert.rejects(invoke(event({ type: 'response.output_item.added', item: { type: 'function_call' } }) + completed(terminal)), /unsupported output/);
  await assert.rejects(invoke('data: [bad-input]\n\n' + completed(terminal)), /invalid JSON stream event/);
  assert.throws(() => decode('deepseek', JSON.stringify({ ...result, response: '{} plus {}' }), packetHash, model), /single JSON object/);
  assert.throws(() => decode('deepseek', JSON.stringify({ ...result, response: '{"packetHash":"wrong"}' }), packetHash, model), /mismatched/);
  assert.equal(requests, 4);
});
