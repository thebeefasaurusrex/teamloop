import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepare,run} from '../src/team-loop.mjs';
import {executionPlanGraph,resolveExecutionPlan,runExecutionPlan} from '../src/execution-plan.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function planFixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-plan-'));
  const packet=path.join(root,'packet.json');
  await fs.writeFile(packet,'{}');
  const config={schemaVersion:1,stateRoot:path.join(root,'state'),blockedLiterals:[],limits:{maxTaskTimeoutMs:180000,maxRunsPerProviderPacket:1},providers:{mock:{enabled:true,models:{fixture:{efforts:['default'],imageInput:false}}}}};
  const planFile=path.join(root,'plan.json');
  const plan={schemaVersion:1,taskId:'plan-test',policyVersion:'test-1',maxConcurrency:2,stages:[
    {id:'first-review',type:'review',packet:'packet.json',provider:'mock',model:'fixture'},
    {id:'second-review',type:'review',dependsOn:['first-review'],failureMode:'advisory',packet:'packet.json',provider:'mock',model:'fixture'}
  ]};
  await fs.writeFile(planFile,JSON.stringify(plan));
  return {root,config,plan,planFile};
}

test('execution plan resolves typed stages and produces a deterministic graph',async()=>{
  const {config,plan,planFile}=await planFixture();
  const resolved=await resolveExecutionPlan(plan,planFile,config);
  assert.equal(resolved.maxConcurrency,2);
  assert.equal(resolved.stages[0].failureMode,'required');
  assert.equal(resolved.stages[1].packetFile,path.join(path.dirname(planFile),'packet.json'));
  assert.equal(executionPlanGraph(resolved),'digraph TeamLoopPlan {\n  rankdir=LR;\n  "first-review" [label="first-review\\nmock/fixture\\nrequired"];\n  "second-review" [label="second-review\\nmock/fixture\\nadvisory"];\n  "first-review" -> "second-review";\n}\n');
});

test('execution plan rejects shell-shaped stages, cycles, missing dependencies and unsafe concurrency',async()=>{
  const {config,plan,planFile}=await planFixture();
  await assert.rejects(resolveExecutionPlan({...plan,stages:[{...plan.stages[0],command:'echo nope'}]},planFile,config),/properties/);
  await assert.rejects(resolveExecutionPlan({...plan,maxConcurrency:4},planFile,config),/1 to 3/);
  await assert.rejects(resolveExecutionPlan({...plan,stages:[{...plan.stages[0],dependsOn:['missing']}]},planFile,config),/Unknown dependency/);
  const cycle={...plan,stages:[{...plan.stages[0],dependsOn:['second-review']},{...plan.stages[1],dependsOn:['first-review']}]};
  await assert.rejects(resolveExecutionPlan(cycle,planFile,config),/cycle/);
});

test('scheduler respects dependencies, concurrency and one active stage per provider',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-plan-scheduler-'));
  const config={stateRoot:path.join(root,'state')};
  const packet=path.join(root,'packet.json');await fs.writeFile(packet,'{}');
  const plan={schemaVersion:1,taskId:'scheduler-test',policyVersion:'test-1',maxConcurrency:3,stages:[
    {id:'alpha-one',type:'review',description:'',dependsOn:[],failureMode:'required',packetFile:packet,provider:'alpha',model:'one',effort:'default'},
    {id:'beta-one',type:'review',description:'',dependsOn:[],failureMode:'required',packetFile:packet,provider:'beta',model:'one',effort:'default'},
    {id:'alpha-two',type:'review',description:'',dependsOn:[],failureMode:'required',packetFile:packet,provider:'alpha',model:'two',effort:'default'},
    {id:'join',type:'review',description:'',dependsOn:['alpha-one','beta-one','alpha-two'],failureMode:'required',packetFile:packet,provider:'gamma',model:'one',effort:'default'}
  ]};
  let active=0,maxActive=0;const activeProviders=new Set(),order=[];
  const worker=async(_packet,provider,model)=>{
    assert.equal(activeProviders.has(provider),false,'same provider ran concurrently');
    activeProviders.add(provider);active++;maxActive=Math.max(maxActive,active);order.push('start:'+provider+'/'+model);
    await new Promise(resolve=>setTimeout(resolve,provider==='beta'?10:20));
    active--;activeProviders.delete(provider);order.push('finish:'+provider+'/'+model);
    return {runId:crypto.randomUUID(),status:'completed',packetHash:'hash-'+model,verdict:'approve'};
  };
  let output='';
  const result=await runExecutionPlan(plan,config,worker,{output:{write:value=>{output+=value;}}});
  assert.equal(result.status,'completed');assert.equal(maxActive,2);
  assert.ok(order.indexOf('start:alpha/two')>order.indexOf('finish:alpha/one'));
  assert.ok(order.indexOf('start:gamma/one')>order.indexOf('finish:alpha/two'));
  const events=output.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events[0].event,'run_started');assert.equal(events.at(-1).event,'run_finished');
  assert.ok(events.every(event=>event.schemaVersion===1 && event.planRunId===result.planRunId));
  const retained=await fs.readFile(path.join(config.stateRoot,'plan-runs',result.planRunId,'events.ndjson'),'utf8');
  assert.equal(retained,output);
});

test('required failure cancels dependents while advisory failure remains visible and permits them',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-plan-failures-'));
  const packet=path.join(root,'packet.json');await fs.writeFile(packet,'{}');
  const baseStage={type:'review',description:'',packetFile:packet,model:'one',effort:'default'};
  const worker=async(_packet,provider)=>provider.startsWith('fail')?{status:'failed',failureClass:'fixture',error:'fixture failure'}:{runId:crypto.randomUUID(),status:'completed',packetHash:'hash',verdict:'approve'};
  const required={schemaVersion:1,taskId:'required-failure',policyVersion:'test-1',maxConcurrency:2,stages:[
    {...baseStage,id:'required',dependsOn:[],failureMode:'required',provider:'fail-required'},
    {...baseStage,id:'dependent',dependsOn:['required'],failureMode:'required',provider:'downstream'}
  ]};
  const requiredResult=await runExecutionPlan(required,{stateRoot:path.join(root,'required')},worker,{output:null});
  assert.equal(requiredResult.status,'failed');
  assert.deepEqual(requiredResult.stages.map(stage=>stage.status),['failed','canceled']);
  const advisory={schemaVersion:1,taskId:'advisory-failure',policyVersion:'test-1',maxConcurrency:2,stages:[
    {...baseStage,id:'advisory',dependsOn:[],failureMode:'advisory',provider:'fail-advisory'},
    {...baseStage,id:'dependent',dependsOn:['advisory'],failureMode:'required',provider:'downstream'}
  ]};
  const advisoryResult=await runExecutionPlan(advisory,{stateRoot:path.join(root,'advisory')},worker,{output:null});
  assert.equal(advisoryResult.status,'completed_with_failures');
  assert.deepEqual(advisoryResult.stages.map(stage=>stage.status),['failed','completed']);
});

test('required failure cancels transitive dependents regardless of declaration order',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-plan-transitive-'));
  const packet=path.join(root,'packet.json');await fs.writeFile(packet,'{}');
  const base={type:'review',description:'',packetFile:packet,model:'one',effort:'default',failureMode:'required'};
  const plan={schemaVersion:1,taskId:'transitive-failure',policyVersion:'test-1',maxConcurrency:2,stages:[
    {...base,id:'leaf',dependsOn:['middle'],provider:'leaf-provider'},
    {...base,id:'middle',dependsOn:['root'],provider:'middle-provider'},
    {...base,id:'root',dependsOn:[],provider:'fail-root'}
  ]};
  const invoked=[];
  const result=await runExecutionPlan(plan,{stateRoot:path.join(root,'state')},async(_packet,provider)=>{
    invoked.push(provider);
    return provider==='fail-root'?{status:'failed',failureClass:'fixture',error:'fixture failure'}:{status:'completed'};
  },{output:null});
  assert.equal(result.status,'failed');
  assert.deepEqual(result.stages.map(stage=>stage.status),['canceled','canceled','failed']);
  assert.deepEqual(invoked,['fail-root']);
});

test('unexpected scheduler failure records a terminal plan status and event',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-plan-recovery-'));
  const packet=path.join(root,'packet.json');await fs.writeFile(packet,'{}');
  const plan={schemaVersion:1,taskId:'scheduler-recovery',policyVersion:'test-1',maxConcurrency:1,stages:[
    {id:'broken',type:'review',description:'',dependsOn:['missing'],failureMode:'required',packetFile:packet,provider:'fixture',model:'one',effort:'default'}
  ]};
  await assert.rejects(runExecutionPlan(plan,{stateRoot:path.join(root,'state')},async()=>({status:'completed'}),{output:null}),/status/);
  const [planRunId]=await fs.readdir(path.join(root,'state','plan-runs'));
  const status=JSON.parse(await fs.readFile(path.join(root,'state','plan-runs',planRunId,'status.json'),'utf8'));
  assert.equal(status.status,'failed');assert.equal(status.failureClass,'plan-runner');assert.ok(status.finishedAt);
  const events=(await fs.readFile(path.join(root,'state','plan-runs',planRunId,'events.ndjson'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events.at(-1).event,'run_finished');assert.equal(events.at(-1).status,'failed');
});

test('mock plan runs end to end through the existing bounded worker runner',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-plan-integration-'));
  await fs.writeFile(path.join(root,'brief.md'),'Synthetic plan evidence.');
  const config={schemaVersion:1,stateRoot:path.join(root,'state'),blockedLiterals:[],limits:{maxTaskTimeoutMs:180000,maxRunsPerProviderPacket:1},providers:{mock:{enabled:true,models:{fixture:{efforts:['default'],imageInput:false}}}}};
  const packet=await prepare({id:'plan-integration',root,assignment:'Review the supplied fixture',requirements:['R1'],constraints:[],decisions:[],files:['brief.md'],dataClass:'synthetic'},config);
  const plan={schemaVersion:1,taskId:'plan-integration',policyVersion:'test-1',maxConcurrency:1,stages:[{id:'mock-review',type:'review',description:'',dependsOn:[],failureMode:'required',packetFile:packet,provider:'mock',model:'fixture',effort:'default'}]};
  let output='';
  const result=await runExecutionPlan(plan,config,run,{output:{write:value=>{output+=value;}}});
  assert.equal(result.status,'completed');assert.equal(result.stages[0].verdict,'blocked');
  assert.doesNotMatch(output,/Synthetic plan evidence|TASK ENVELOPE|no-account/);
});

test('plan CLI validates, shows, graphs and emits an NDJSON mock run',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'teamloop-plan-cli-'));
  await fs.writeFile(path.join(root,'brief.md'),'Synthetic CLI plan evidence.');
  const config={schemaVersion:1,stateRoot:path.join(root,'state'),blockedLiterals:[],limits:{maxTaskTimeoutMs:180000,maxRunsPerProviderPacket:1},providers:{mock:{enabled:true,models:{fixture:{efforts:['default'],imageInput:false}}}}};
  const configFile=path.join(root,'config.json');await fs.writeFile(configFile,JSON.stringify(config));
  const packet=await prepare({id:'plan-cli',root,assignment:'Review the CLI fixture',requirements:['R1'],constraints:[],decisions:[],files:['brief.md'],dataClass:'synthetic'},config);
  const planFile=path.join(root,'plan.json');
  await fs.writeFile(planFile,JSON.stringify({schemaVersion:1,taskId:'plan-cli',policyVersion:'test-1',maxConcurrency:1,stages:[{id:'mock-review',type:'review',packet,provider:'mock',model:'fixture'}]}));
  const cli=(...args)=>spawnSync(process.execPath,[path.join(repo,'src/team-loop.mjs'),'plan',...args,configFile],{cwd:repo,encoding:'utf8',windowsHide:true});
  const validated=cli('validate',planFile);assert.equal(validated.status,0,validated.stderr);assert.equal(JSON.parse(validated.stdout).valid,true);
  const shown=cli('show',planFile);assert.equal(shown.status,0,shown.stderr);assert.equal(JSON.parse(shown.stdout).stages[0].packetFile,packet);
  const graph=cli('graph',planFile);assert.equal(graph.status,0,graph.stderr);assert.match(graph.stdout,/mock-review/);
  const ran=cli('run',planFile);assert.equal(ran.status,0,ran.stderr);
  const events=ran.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.equal(events[0].event,'run_started');assert.equal(events.at(-1).status,'completed');
});
