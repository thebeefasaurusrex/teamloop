import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function check(entries){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-release-check-'));
  await fs.mkdir(path.join(folder,'scripts'));
  await fs.copyFile(path.join(root,'scripts/check-release.mjs'),path.join(folder,'scripts/check-release.mjs'));
  const files=['release-files.json','scripts/check-release.mjs',...Object.keys(entries)];
  await fs.writeFile(path.join(folder,'release-files.json'),JSON.stringify(files));
  for(const [name,bytes]of Object.entries(entries)){await fs.mkdir(path.dirname(path.join(folder,name)),{recursive:true});await fs.writeFile(path.join(folder,name),bytes);}
  return spawnSync(process.execPath,[path.join(folder,'scripts/check-release.mjs')],{cwd:folder,encoding:'utf8',windowsHide:true});
}
test('release check hashes allowlisted PNG and font files without decoding binary as text',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMZkAAAAASUVORK5CYII=','base64');
  const result=await check({'brand/logo.png':png,'brand/font.ttf':Buffer.from([0,1,0,0,255]),'brand/font.woff2':Buffer.from([119,79,70,50,255])});
  assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.files,5);assert.match(report.limits,/not text screening/);
});
test('release check rejects binary files that do not match their approved type',async()=>{
  const result=await check({'brand/logo.png':Buffer.from('Not a PNG')});assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid binary header/);
});
test('release check rejects unsupported non-UTF8 files without crashing',async()=>{
  const result=await check({'brand/file.bin':Buffer.from([255,254,253])});assert.notEqual(result.status,0);assert.match(result.stderr,/Non-UTF8 file without an approved binary type/);
});
test('release check still screens text for credentials beside binary assets',async()=>{
  const result=await check({'brand/readme.md':['ghp','x'.repeat(30)].join('_')});assert.notEqual(result.status,0);assert.match(result.stderr,/Possible credential/);
});
