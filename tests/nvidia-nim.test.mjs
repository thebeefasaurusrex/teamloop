import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {invokeNvidia,nvidiaIdentity,readNvidiaKey,requestOptions} from '../src/nvidia-nim.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'team-loop-nvidia-'));
const keyFile=path.join(temp,'key.txt');
const fixture=['nvapi','fixture_token_1234567890'].join('-');
await fs.writeFile(keyFile,fixture);

test('NVIDIA key stays file-backed and identity exposes only a fingerprint',async()=>{
  assert.equal(await readNvidiaKey(keyFile),fixture);
  const identity=await nvidiaIdentity({nvidiaKeyFile:keyFile});
  assert.match(identity,/^nvapi-sha256:[a-f0-9]{16}$/);
  assert.equal(identity.includes(fixture),false);
});

test('NVIDIA adapter rejects malformed keys, model identifiers and request overrides before fetch',async()=>{
  const malformed=path.join(temp,'bad.txt');
  await fs.writeFile(malformed,'not-a-key');
  await assert.rejects(readNvidiaKey(malformed),/format/);
  await assert.rejects(invokeNvidia({keyFile,model:'invalid model',prompt:'test'}),/Unsupported NVIDIA model/);
  assert.throws(()=>requestOptions({tools:[{}]}),/Unsupported/);
  assert.throws(()=>requestOptions({max_tokens:50000}),/Invalid/);
  assert.equal(requestOptions({max_tokens:1000}).max_tokens,1000);
});
