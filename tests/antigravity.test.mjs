import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkGeminiSettings,enforceGeminiSettings,geminiEnv,guardGeminiEvent,decodeGemini,ensureGeminiAgent,reviewerAgent,designerAgent,geminiInvocation,resolveUserHome} from '../src/antigravity.mjs';
import {execute,cleanEnv,decode} from '../src/team-loop.mjs';
const model='example-model-medium';
const init={event:'init',init:{model,agent:'team-loop-reviewer',permission_mode:'strict',tools:['view_file']}};
const user={event:'step_update',step_update:{step_type:'user_input',state:'DONE'}};
const review={packetHash:'abc',verdict:'approve',summary:'Reviewed supplied evidence.',findings:[],uncertainties:[]};
const result={event:'result',result:{status:'SUCCESS',num_turns:1,response:JSON.stringify(review),usage:{input_tokens:3}}};
const lines=events=>events.map(JSON.stringify).join('\n');
test('Antigravity requires privacy, billing, and deny rules',()=>{
  const settings={enableTelemetry:false,toolPermission:'strict',permissions:{deny:['read_file(*)','write_file(*)','read_url(*)','execute_url(*)','command(*)','unsandboxed(*)','mcp(*)']}};
  checkGeminiSettings(settings);
  for(const change of [{useG1Credits:true},{enableTelemetry:true},{modelProvider:'gemini'},{allowNonWorkspaceAccess:true},{permissions:{deny:[]}}]) assert.throws(()=>checkGeminiSettings({...settings,...change}));
});
test('Antigravity sparse persistence is repaired without overriding unsafe explicit values',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'team-loop-agy-settings-'));
  const antigravityHome=path.join(home,'.gemini','antigravity-cli');
  await fs.mkdir(antigravityHome,{recursive:true});
  const file=path.join(antigravityHome,'settings.json');
  const base={toolPermission:'strict',permissions:{deny:['read_file(*)','write_file(*)','read_url(*)','execute_url(*)','command(*)','unsandboxed(*)','mcp(*)']}};
  await fs.writeFile(file,JSON.stringify(base));
  assert.equal((await enforceGeminiSettings({antigravityHome})).enableTelemetry,false);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).enableTelemetry,false);
  await fs.writeFile(file,JSON.stringify({...base,enableTelemetry:true}));
  await assert.rejects(enforceGeminiSettings({antigravityHome}),/unsafe/);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).enableTelemetry,true);
});
test('Antigravity selects file-backed personal login mode without exporting a token',()=>{
  const config={antigravityHome:'C:/Users/example/.gemini/antigravity-cli'};
  assert.deepEqual(geminiEnv({PATH:'test',USERPROFILE:'C:/Users/example'},config),{PATH:'test',USERPROFILE:'C:/Users/example',HOME:path.resolve('C:/Users/example'),SSH_CONNECTION:'127.0.0.1 49152 127.0.0.1 22'});
  assert.throws(()=>resolveUserHome({antigravityHome:'C:/wrong/.gemini/antigravity-cli'},{USERPROFILE:'C:/Users/example'}),/personal OS account home/);
});
test('reviewer installs at the documented global agent location and verifies exact content',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'team-loop-agy-home-'));
  const config={antigravityHome:path.join(home,'.gemini','antigravity-cli')};
  await assert.rejects(ensureGeminiAgent(config,{USERPROFILE:home}),/ENOENT/);
  const files=await ensureGeminiAgent(config,{USERPROFILE:home},true);
  assert.deepEqual(files,[path.join(home,'.gemini','config','agents','team-loop-reviewer','agent.md'),path.join(home,'.gemini','config','agents','team-loop-designer','agent.md')]);
  assert.equal(await fs.readFile(files[0],'utf8'),reviewerAgent);
  assert.equal(await fs.readFile(files[1],'utf8'),designerAgent);
  await fs.writeFile(files[0],'Existing user agent');
  await assert.rejects(ensureGeminiAgent(config,{USERPROFILE:home},true),/did not verify/);
  assert.equal(await fs.readFile(files[0],'utf8'),'Existing user agent');
});
test('artifact invocation selects and guards the dedicated designer agent',async()=>{
  const config={antigravity:'agy',antigravityHome:'C:/Users/example/.gemini/antigravity-cli'};
  const schema={type:'object',properties:{packetHash:{const:'abc'}}};
  const call=await geminiInvocation(config,'C:/run',model,'prompt',{USERPROFILE:'C:/Users/example'},'team-loop-designer',720000,schema,'medium');
  assert.equal(call.args[call.args.indexOf('--agent')+1],'team-loop-designer');
  assert.equal(call.args[call.args.indexOf('--print-timeout')+1],'715s');
  assert.equal(call.args[call.args.indexOf('--effort')+1],'medium');
  assert.deepEqual(JSON.parse(call.args[call.args.indexOf('--json-schema')+1]),schema);
  assert.doesNotThrow(()=>guardGeminiEvent({...init,init:{...init.init,agent:'team-loop-designer'}},model,'team-loop-designer'));
  assert.throws(()=>guardGeminiEvent(init,model,'team-loop-designer'));
});
test('invocation watches its dedicated log and rejects discovery fallback',async()=>{
  const config={antigravity:'agy',antigravityHome:'C:/Users/example/.gemini/antigravity-cli'};
  const call=await geminiInvocation(config,'C:/run',model,'prompt',{PATH:'test',USERPROFILE:'C:/Users/example'});
  assert.ok(call.args.includes('--log-file'));
  assert.doesNotThrow(()=>call.checkWatchText('Agent "team-loop-reviewer" loaded'));
  assert.throws(()=>call.checkWatchText('Agent "team-loop-reviewer" not found, falling back to default'),/failed closed/);
  assert.throws(()=>call.checkWatchText('applyUserSettings: inherited useG1Credits=true from shared config'),/paid-credit/);
  assert.doesNotThrow(()=>call.checkWatchText('Failed to resolve GeminiDir ".gemini", falling back to default'));
});
test('Antigravity requires matching model, agent, and restrictive permission mode',()=>{
  for(const change of [{model:'other'},{agent:'default'},{permission_mode:'always-proceed'}]) assert.throws(()=>guardGeminiEvent({...init,init:{...init.init,...change}},model));
});
test('Antigravity successful-looking tool-using responses are rejected',()=>{
  const tool={event:'step_update',step_update:{step_type:'tool',tool_name:'view_file',state:'ERROR'}};
  assert.throws(()=>decodeGemini(lines([init,user,tool,result]),model),/policy violation/);
});
test('Antigravity structured finish protocol accepts streamed prefixes and terminal metadata',()=>{
  const finish={event:'step_update',step_update:{step_type:'finish',state:'DONE'}};
  const finishTool={event:'step_update',step_update:{step_index:2,step_type:'tool',tool_name:'finish',tool_info:{name:'finish',parameters:review},state:'DONE'}};
  assert.doesNotThrow(()=>decodeGemini(lines([init,user,finish,result]),model));
  assert.doesNotThrow(()=>decodeGemini(lines([init,user,finishTool,result]),model));
  const concatenated={...result,result:{...result.result,response:`${JSON.stringify(review)}\n${JSON.stringify(review)}`}};
  assert.equal(decodeGemini(lines([init,user,finishTool,concatenated]),model).completionSource,'finish-tool');
  const fullArtifact={packetHash:'abc',artifact:{filename:'test.html',mediaType:'text/html',content:'<!doctype html><html><body>complete</body></html>'},rationale:'Complete.',uncertainties:[]};
  const partialArtifact={...fullArtifact,artifact:{...fullArtifact.artifact,content:'<!doctype html><html><body>comp…'}};
  const artifactTool={...finishTool,step_update:{...finishTool.step_update,tool_info:{name:'finish',parameters:partialArtifact}}};
  const artifactResult={...result,result:{...result.result,response:JSON.stringify({...fullArtifact,toolAction:'Completing artifact',toolSummary:'Artifact'})}};
  assert.deepEqual(JSON.parse(decodeGemini(lines([init,user,artifactTool,artifactResult]),model).envelope.response),fullArtifact);
  const conflicting={...artifactTool,step_update:{...artifactTool.step_update,tool_info:{name:'finish',parameters:{...partialArtifact,artifact:{...partialArtifact.artifact,content:'different'}}}}};
  assert.throws(()=>decodeGemini(lines([init,user,conflicting,artifactResult]),model),/conflicts/);
  assert.throws(()=>decodeGemini(lines([init,user,{...finishTool,step_update:{...finishTool.step_update,tool_name:'view_file'}},result]),model),/policy violation/);
});
test('Antigravity model failures are distinguishable from policy failures',()=>{
  const failedStep={event:'step_update',step_update:{step_type:'agent_response',state:'ERROR'}};
  const errorStep={event:'step_update',step_update:{step_type:'error_message',state:'DONE'}};
  assert.throws(()=>decodeGemini(lines([init,user,failedStep,result]),model),/model\/provider step failed/);
  assert.throws(()=>decodeGemini(lines([init,user,errorStep,result]),model),/model\/provider emitted an error step/);
  assert.throws(()=>decodeGemini(lines([init,user,{...result,result:{...result.result,status:'ERROR',error:'backend unavailable'}}]),model),/model\/provider did not complete/);
});
test('Antigravity nonterminal, duplicate, failed, or unbounded-turn responses reject',()=>{
  for(const status of ['ERROR','CANCELED','INTERRUPTED','INVALID','WAITING','RUNNING']) assert.throws(()=>decodeGemini(lines([init,user,{...result,result:{...result.result,status}}]),model));
  for(const events of [[init],[result],[init,init,result],[init,result,result]]) assert.throws(()=>decodeGemini(lines(events),model));
  const syntheticInput={event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'user_input',duration_seconds:'0.00'}};
  assert.doesNotThrow(()=>decodeGemini(lines([init,user,syntheticInput,{...result,result:{...result.result,num_turns:2}}]),model));
  assert.throws(()=>decodeGemini(lines([init,user,{...syntheticInput,step_update:{...syntheticInput.step_update,duration_seconds:'0.01'}},{...result,result:{...result.result,num_turns:2}}]),model));
  assert.throws(()=>decodeGemini(lines([init,user,{...result,result:{...result.result,num_turns:2}}]),model));
  assert.throws(()=>decodeGemini(lines([init,user,{...result,result:{...result.result,num_turns:4}}]),model));
});
test('Antigravity completed packet review decodes and validates the packet hash',()=>{
  assert.equal(decode('gemini',lines([init,user,result]),'abc',model).actualModel,model);
  assert.throws(()=>decode('gemini',lines([init,user,result]),'wrong',model));
});
test('live stdout guard terminates the owned mock worker on prohibited activity',async()=>{
  const result=await execute(process.execPath,['-e','console.log(JSON.stringify({event:"step_update",step_update:{step_type:"tool"}}));setInterval(()=>{},1000)'],{env:cleanEnv(),timeoutMs:3000,onStdoutLine:line=>guardGeminiEvent(JSON.parse(line),model)});
  assert.equal(result.stopped,'worker-policy-violation');
});
test('live stdout guard classifies provider error steps without inventing tool activity',async()=>{
  const result=await execute(process.execPath,['-e','console.log(JSON.stringify({event:"step_update",step_update:{step_type:"error_message",state:"DONE"}}));setInterval(()=>{},1000)'],{env:cleanEnv(),timeoutMs:3000,onStdoutLine:line=>guardGeminiEvent(JSON.parse(line),model)});
  assert.equal(result.stopped,'worker-provider-error');
  assert.match(result.policyError,/model\/provider emitted an error step/);
});
test('live log guard terminates the owned mock worker on discovery fallback',async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'team-loop-agy-log-'));
  const logFile=path.join(temporary,'agy.log');
  const script=`require('node:fs').writeFileSync(${JSON.stringify(logFile)},'Agent "team-loop-reviewer" not found, falling back to default');setInterval(()=>{},1000)`;
  const result=await execute(process.execPath,['-e',script],{env:cleanEnv(),timeoutMs:3000,watchFile:logFile,checkWatchText:text=>{if(/Agent "team-loop-reviewer" not found, falling back to default/.test(text)) throw Error('discovery failed');}});
  assert.equal(result.stopped,'worker-policy-violation');
  assert.equal(result.policyError,'discovery failed');
});
