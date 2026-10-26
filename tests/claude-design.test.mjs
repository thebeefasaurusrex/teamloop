import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CLAUDE_BUILDER_CAPTURE_LIMITS,
  runClaudeDesign,
  inspectClaudeDesignEvent,
  decodeClaudeBuilder,
  prepareClaudeDesignWorktreeRoot,
} from '../src/claude-builder.mjs';
import { execute } from '../src/shared.mjs';
import { tempDir } from './helpers.mjs';

async function fixture(mode = 'success', verificationFailure = false) {
  const root = await tempDir('claude-design-'),
    repository = path.join(root, 'repo');
  await fs.mkdir(repository);
  const git = async args => {
    const r = await execute('git', args, { cwd: repository });
    assert.equal(r.code, 0, r.stderr);
    return r.stdout.trim();
  };
  await git(['init']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await git(['config', 'user.name', 'Fixture']);
  await fs.writeFile(path.join(repository, 'index.html'), 'original\n');
  await git(['add', 'index.html']);
  await git(['commit', '-m', 'fixture']);
  const baseRevision = await git(['rev-parse', 'HEAD']);
  const cli = path.join(root, 'fixture-cli.mjs');
  await fs.writeFile(
    cli,
    `import fs from 'node:fs';
const args=process.argv.slice(2),mode=${JSON.stringify(mode)};
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:'approved@example.test',subscriptionType:'max'}));process.exit(0);}
if(args[args.indexOf('--model')+1]!=='claude-opus-5-5'||args[args.indexOf('--effort')+1]!=='high'||args.includes('--json-schema'))throw Error('incorrect design argv');
fs.writeFileSync('index.html','<!doctype html><html><body>candidate</body></html>');fs.writeFileSync('progress.md','Durable file progress.');
if(mode==='hardlink')fs.linkSync('index.html','../fixture-hardlink-'+process.pid);
const emit=x=>console.log(JSON.stringify(x));
if(mode==='large-metadata'||mode==='capture-overflow')emit({type:'user',message:{content:[]},tool_use_result:{originalFile:'x'.repeat((mode==='large-metadata'?9:33)*1024*1024)}});
emit({type:'system',subtype:'init',model:'claude-opus-5-5',tools:['Read','Edit','Write']});
emit({type:'assistant',message:{model:mode==='wrong-model'?'claude-sonnet-5-5':'claude-opus-5-5',content:[{type:'tool_use',name:mode==='bad-tool'?'Bash':'Write',input:{file_path:'index.html',content:'candidate'}}]}});
if(mode==='timeout'){setTimeout(()=>{},10000);}else if(mode==='failure'){process.exitCode=2;}else{
emit({type:'rate_limit_event',rate_limit_info:{isUsingOverage:false,overageStatus:'rejected'}});
emit({type:'result',subtype:'success',is_error:false,terminal_reason:'completed',permission_denials:[],modelUsage:{'claude-opus-5-5':{}},usage:{input_tokens:11},result:JSON.stringify({summary:'Saved design files.',uncertainties:[]})});}
`,
  );
  const config = {
    stateRoot: path.join(root, 'state'),
    claude: 'fixture-claude',
    claudePlanAttested: 'max-5x',
    claudeUsageCreditsOff: true,
    billingCheckedAt: new Date().toISOString(),
    claudeDesign: {
      enabled: true,
      model: 'claude-opus-5-5',
      effort: 'high',
      timeoutMs: 2700000,
      worktreeRoot: path.join(root, 'outside-state-design-worktrees'),
      allowedAccounts: ['approved@example.test'],
      allowedPlanAttestations: ['max-5x'],
      verificationExecutables: [process.execPath],
    },
    executionModes: { 'claude-bridge': { enabled: false } },
  };
  const spec = {
    schemaVersion: 1,
    id: 'design-fixture',
    repository,
    baseRevision,
    dataClass: 'synthetic',
    timeoutMs: 2700000,
    assignment: 'Design a small artifact.',
    requirements: ['Write the selected files'],
    constraints: [],
    allowedFiles: ['index.html', 'progress.md'],
    verification: [
      { command: process.execPath, args: ['-e', verificationFailure ? 'process.exit(9)' : "require('node:fs').accessSync('index.html')"], timeoutMs: 1000 },
    ],
  };
  const calls = [];
  const launch = async (command, args, options) => {
    calls.push({ command, args, timeoutMs: options.timeoutMs, cwd: options.cwd });
    if (command === 'fixture-claude')
      return execute(process.execPath, [cli, ...args], { ...options, ...(mode === 'timeout' && args[0] !== 'auth' ? { timeoutMs: 500 } : {}) });
    return execute(command, args, options);
  };
  return { root, repository, config, spec, launch, calls };
}

test('standalone design uses pinned45m file builder and never activates bridge or promotes', async () => {
  const f = await fixture();
  delete f.spec.timeoutMs;
  f.config.standardPolicyVersion = 'design-fixture-policy';
  const r = await runClaudeDesign(f.spec, f.config, { launch: f.launch });
  assert.equal(r.status, 'completed', r.error);
  assert.equal(r.effectiveMode, 'claude-design');
  assert.equal(r.promoted, false);
  assert.equal(r.timeoutMs, 2700000);
  assert.equal(r.standardPolicyVersion, 'design-fixture-policy');
  assert.equal(path.dirname(r.worktree), f.config.claudeDesign.worktreeRoot);
  assert.equal(r.worktreeRoot, await fs.realpath(f.config.claudeDesign.worktreeRoot));
  assert.ok(path.relative(f.config.stateRoot, r.worktree).startsWith('..'));
  assert.equal(await fs.readFile(path.join(f.repository, 'index.html'), 'utf8'), 'original\n');
  assert.equal(await fs.readFile(path.join(r.worktree, 'progress.md'), 'utf8'), 'Durable file progress.');
  const call = f.calls.find(c => c.args.includes('-p'));
  assert.equal(call.timeoutMs, 2700000);
  assert.notEqual(call.cwd, f.repository);
  for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-chrome', '--disable-slash-commands']) assert.ok(call.args.includes(flag));
  const denied = call.args[call.args.indexOf('--disallowedTools') + 1];
  for (const tool of ['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Agent', 'Skill', 'StructuredOutput']) assert.ok(denied.includes(tool));
  assert.ok(call.args.includes('Read(/index.html)'));
  assert.ok(call.args.includes('Edit(/progress.md)'));
  assert.ok(!call.args.includes('--json-schema'));
  assert.ok(await fs.readFile(path.join(f.config.stateRoot, 'builder-runs', r.runId, 'candidate.patch'), 'utf8'));
  await assert.rejects(fs.access(path.join(f.config.stateRoot, 'execution-mode.json')));
});

test('design disabled/default, model drift, excessive timeout and unsafe paths reject before launch', async () => {
  const f = await fixture();
  for (const d of [
    undefined,
    { ...f.config.claudeDesign, enabled: false },
    { ...f.config.claudeDesign, model: 'opus' },
    { ...f.config.claudeDesign, effort: 'medium' },
    { ...f.config.claudeDesign, timeoutMs: 3000000 },
  ])
    await assert.rejects(runClaudeDesign(f.spec, { ...f.config, claudeDesign: d }, { launch: f.launch }));
  for (const file of ['../secret.txt', '*.html', 'index.html:stream', './index.html'])
    await assert.rejects(runClaudeDesign({ ...f.spec, allowedFiles: [file] }, f.config, { launch: f.launch }));
  await assert.rejects(runClaudeDesign({ ...f.spec, timeoutMs: 2700001 }, f.config, { launch: f.launch }));
  await assert.rejects(runClaudeDesign({ ...f.spec, timeoutMs: 30000 }, f.config, { launch: f.launch }));
  assert.equal(f.calls.length, 0);
  for (const provider of [{ enabled: false }, { enabled: true, models: {} }, { enabled: true, models: { 'claude-opus-5-5': { efforts: ['medium'] } } }])
    await assert.rejects(runClaudeDesign(f.spec, { ...f.config, providers: { claude: provider } }, { launch: f.launch }));
});

for (const mode of ['timeout', 'failure', 'bad-tool', 'wrong-model'])
  test('design preserves isolated partial files on ' + mode, async () => {
    const f = await fixture(mode);
    const r = await runClaudeDesign(f.spec, f.config, { launch: f.launch });
    assert.equal(r.status, 'failed');
    assert.equal(r.partialWorktreePreserved, true);
    assert.equal(r.promoted, false);
    assert.ok(await fs.readFile(path.join(r.worktree, 'progress.md'), 'utf8'));
    assert.equal(await fs.readFile(path.join(f.repository, 'index.html'), 'utf8'), 'original\n');
    assert.equal(f.calls.filter(c => c.args.includes('-p')).length, 1);
    assert.ok(await fs.readFile(path.join(f.config.stateRoot, 'builder-runs', r.runId, 'stdout.txt'), 'utf8'));
    if (mode === 'timeout') assert.equal(r.stopReason, 'timeout');
  });

test('verification failure retains patch and worktree with failed status', async () => {
  const f = await fixture('success', true);
  const r = await runClaudeDesign(f.spec, f.config, { launch: f.launch });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /verification failed/i);
  assert.equal(r.verification[0].exitCode, 9);
  assert.equal(r.usage.input_tokens, 11);
  assert.ok(await fs.readFile(path.join(f.config.stateRoot, 'builder-runs', r.runId, 'candidate.patch'), 'utf8'));
  assert.equal(r.promoted, false);
});

test('design worktree root rejects relative/root/reparse paths; file hardlinks still fail', async () => {
  const f = await fixture('hardlink');
  for (const worktreeRoot of ['relative-folder', path.parse(f.root).root])
    await assert.rejects(prepareClaudeDesignWorktreeRoot({ claudeDesign: { worktreeRoot } }));
  const target = path.join(f.root, 'junction-target'),
    alias = path.join(f.root, 'junction-alias');
  await fs.mkdir(target);
  await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareClaudeDesignWorktreeRoot({ claudeDesign: { worktreeRoot: path.join(alias, 'child') } }), /link/);
  const r = await runClaudeDesign(f.spec, f.config, { launch: f.launch });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /link\/alias rejected/);
  assert.equal(r.partialWorktreePreserved, true);
  assert.equal((await fs.stat(path.join(r.worktree, 'index.html'))).nlink, 2);
});

test('strict design streaming guards paths, native tools, model substitutions and overage', () => {
  const root = path.resolve('selected-worktree');
  const event = (name, input) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name, input }] } });
  for (const tool of ['Bash', 'PowerShell', 'WebFetch', 'mcp__server__Read', 'Agent', 'StructuredOutput'])
    assert.throws(() => inspectClaudeDesignEvent(event(tool, {}), root, ['index.html']));
  assert.throws(() => inspectClaudeDesignEvent(event('Read', { file_path: '../secret' }), root, ['index.html']));
  assert.throws(() => inspectClaudeDesignEvent(event('Read', { file_path: 'other.html' }), root, ['index.html']));
  assert.throws(() => inspectClaudeDesignEvent({ type: 'assistant', message: { model: 'claude-haiku-5-5', content: [] } }, root, []));
  assert.throws(() => inspectClaudeDesignEvent({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: true, overageStatus: 'allowed' } }, root, []));
});

test('design terminal exact identity, early overage and small raw completion are mandatory', () => {
  const root = path.resolve('selected-worktree'),
    init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5', tools: ['Read', 'Edit', 'Write'] },
    rate = { type: 'rate_limit_event', rate_limit_info: { isUsingOverage: false, overageStatus: 'rejected' } },
    result = {
      type: 'result',
      subtype: 'success',
      terminal_reason: 'completed',
      modelUsage: { 'claude-opus-5-5': {} },
      result: JSON.stringify({ summary: 'Saved.', uncertainties: [] }),
    };
  const decode = events => decodeClaudeBuilder(events.map(e => JSON.stringify(e)).join('\n'), root, 'claude-opus-5-5', [], ['index.html'], true);
  decode([init, rate, result]);
  assert.throws(() => decode([rate, result]));
  assert.throws(() => decode([init, rate, { ...result, modelUsage: { 'claude-opus-5-5': {}, 'claude-haiku-5-5': {} } }]));
  assert.throws(() => decode([init, { ...rate, rate_limit_info: { isUsingOverage: true, overageStatus: 'allowed' } }, rate, result]));
  assert.throws(() => decode([init, rate, { ...result, result: JSON.stringify({ summary: 'x'.repeat(2049), uncertainties: [] }) }]));
  assert.throws(() => decode([init, rate, { ...result, result: '', structured_output: { summary: 'schema-only response', uncertainties: [] } }]));
});

test('actual design prompt discloses exact completion limits and raw JSON contract', async () => {
  const f = await fixture();
  const r = await runClaudeDesign(f.spec, f.config, { launch: f.launch });
  assert.equal(r.status, 'completed', r.error);
  const prompt = await fs.readFile(path.join(f.config.stateRoot, 'builder-runs', r.runId, 'prompt.txt'), 'utf8');
  for (const value of ['2048 characters', '16 strings', '512 characters', '16384 UTF-8 bytes', 'No Markdown fences']) assert.ok(prompt.includes(value), value);
  assert.equal(r.timeoutMs, 2700000);
  assert.equal(r.promoted, false);
});
test('design completion boundaries remain strict for limits and Markdown fences', () => {
  const root = path.resolve('selected-worktree'),
    init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5', tools: ['Read', 'Edit', 'Write'] },
    rate = { type: 'rate_limit_event', rate_limit_info: { isUsingOverage: false, overageStatus: 'rejected' } },
    terminal = { type: 'result', subtype: 'success', terminal_reason: 'completed', modelUsage: { 'claude-opus-5-5': {} } };
  const decode = value =>
    decodeClaudeBuilder(
      [init, rate, { ...terminal, result: typeof value === 'string' ? value : JSON.stringify(value) }].map(JSON.stringify).join('\n'),
      root,
      'claude-opus-5-5',
      [],
      ['index.html'],
      true,
    );
  decode({ summary: 'x'.repeat(2048), uncertainties: Array(16).fill('x'.repeat(512)) });
  for (const value of [
    { summary: 'x'.repeat(2049), uncertainties: [] },
    { summary: 'ok', uncertainties: Array(17).fill('x') },
    { summary: 'ok', uncertainties: ['x'.repeat(513)] },
    { summary: 'ok', uncertainties: Array(16).fill('中'.repeat(512)) },
  ])
    assert.throws(() => decode(value), /small completion limits/);
  assert.throws(() => decode('~~~json' + JSON.stringify({ summary: 'ok', uncertainties: [] }) + '~~~'));
});

test('design captures large native file metadata within a bounded32MiB stream', async () => {
  const f = await fixture('large-metadata');
  const r = await runClaudeDesign(f.spec, f.config, { launch: f.launch });
  assert.equal(r.status, 'completed', r.error);
  assert.equal(r.streamCaptureMaxBytes, CLAUDE_BUILDER_CAPTURE_LIMITS.designBytes);
  assert.ok(r.stdoutBytes > CLAUDE_BUILDER_CAPTURE_LIMITS.builderBytes);
  assert.equal(CLAUDE_BUILDER_CAPTURE_LIMITS.builderBytes, 8388608);
  assert.equal(CLAUDE_BUILDER_CAPTURE_LIMITS.designBytes, 33554432);
});

test('design still rejects oversized aggregate native stream and preserves partial work', async () => {
  const f = await fixture('capture-overflow');
  const r = await runClaudeDesign(f.spec, f.config, { launch: f.launch });
  assert.equal(r.status, 'failed');
  assert.equal(r.stopReason, 'output-limit');
  assert.equal(r.streamCaptureMaxBytes, 33554432);
  assert.ok(r.stdoutBytes <= 33554432);
  assert.equal(r.partialWorktreePreserved, true);
});
