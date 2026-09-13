import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {claudeFileToolRules,cleanClaudeBuilderEnv,decodeClaudeBuilder} from '../src/claude-builder.mjs';

const root=path.join(os.tmpdir(),'synthetic-worktree');
const resultEvent=overrides=>({type:'result',subtype:'success',is_error:false,terminal_reason:'completed',permission_denials:[],usage:{server_tool_use:{web_search_requests:0,web_fetch_requests:0}},modelUsage:{'claude-sonnet-5':{},'claude-haiku-4-5-20251001':{}},structured_output:{summary:'Implemented the bounded change.',uncertainties:[]},...overrides});
const rate={type:'rate_limit_event',rate_limit_info:{status:'allowed',rateLimitType:'five_hour',overageStatus:'rejected',overageDisabledReason:'org_level_disabled',isUsingOverage:false}};
const stream=(tool,result=resultEvent(),rateEvent=rate)=>[tool?JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:tool.name,input:tool.input??{}}]}}):null,JSON.stringify(rateEvent),JSON.stringify(result)].filter(Boolean).join('\n');

test('Claude builder environment strips API and provider overrides',()=>{
  const env=cleanClaudeBuilderEnv({PATH:'safe',USERPROFILE:'test-profile',ANTHROPIC_API_KEY:'secret',CLAUDE_CODE_OAUTH_TOKEN:'secret',CLAUDE_CODE_USE_BEDROCK:'1'});
  assert.equal(env.PATH,'safe');
  assert.equal(env.ANTHROPIC_API_KEY,undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK,undefined);
  assert.equal(env.DISABLE_TELEMETRY,'1');
});

test('Claude builder emits exact current-worktree Read and Edit permission rules',()=>{
  assert.deepEqual(claudeFileToolRules(['README.md','docs/guide.md']),['Read(/README.md)','Edit(/README.md)','Read(/docs/guide.md)','Edit(/docs/guide.md)']);
});

test('Claude builder accepts only bounded file tools and requested plus approved auxiliary models',()=>{
  const decoded=decodeClaudeBuilder(stream({name:'Edit',input:{file_path:path.join(root,'README.md')}}),root,'sonnet',['claude-haiku-4-5'],['README.md']);
  assert.deepEqual(decoded.actualModels,['claude-sonnet-5','claude-haiku-4-5-20251001']);
  assert.deepEqual(decoded.tools,['Edit']);
});

test('Claude builder rejects prohibited tools, escaped paths, billing tools, denials, and model drift',()=>{
  assert.throws(()=>decodeClaudeBuilder(stream({name:'Bash'}),root,'sonnet',['claude-haiku-4-5'],['README.md']));
  assert.throws(()=>decodeClaudeBuilder(stream({name:'Read',input:{file_path:'../secret.txt'}}),root,'sonnet',['claude-haiku-4-5'],['README.md']));
  assert.throws(()=>decodeClaudeBuilder(stream({name:'Read',input:{file_path:path.join(root,'OTHER.md')}}),root,'sonnet',['claude-haiku-4-5'],['README.md']));
  assert.throws(()=>decodeClaudeBuilder(stream(null,resultEvent({usage:{server_tool_use:{web_search_requests:1}}})),root,'sonnet',['claude-haiku-4-5'],['README.md']));
  assert.throws(()=>decodeClaudeBuilder(stream(null,resultEvent({permission_denials:[{tool_name:'Bash'}]})),root,'sonnet',['claude-haiku-4-5'],['README.md']));
  assert.throws(()=>decodeClaudeBuilder(stream(null,resultEvent({modelUsage:{'claude-opus-5':{}}})),root,'sonnet',['claude-haiku-4-5'],['README.md']));
  assert.throws(()=>decodeClaudeBuilder(stream(null,resultEvent(),{type:'rate_limit_event',rate_limit_info:{overageStatus:'allowed',isUsingOverage:true}}),root,'sonnet',['claude-haiku-4-5'],['README.md']));
});
