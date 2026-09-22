import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {resolveModel} from './config.mjs';

const PLAN_SCHEMA_VERSION=1;
const EVENT_SCHEMA_VERSION=1;
const idPattern=/^[a-z0-9][a-z0-9-]{0,63}$/;
const terminalStatuses=new Set(['completed','failed','canceled']);

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const assertKeys=(value,allowed,label)=>{
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) throw Error(`Invalid ${label} properties`);
};
const atomicJson=async(file,value)=>{
  const temporary=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  await fs.rename(temporary,file);
};

function validateGraph(stages) {
  const byId=new Map(stages.map(stage=>[stage.id,stage]));
  for(const stage of stages) for(const dependency of stage.dependsOn) if(!byId.has(dependency)) throw Error(`Unknown dependency ${dependency} for stage ${stage.id}`);
  const visiting=new Set(),visited=new Set();
  const visit=id=>{
    if(visiting.has(id)) throw Error('Execution plan contains a dependency cycle');
    if(visited.has(id)) return;
    visiting.add(id);
    for(const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);visited.add(id);
  };
  for(const stage of stages) visit(stage.id);
}

export async function resolveExecutionPlan(plan,planFile,config,{modelResolver=resolveModel}={}) {
  assertKeys(plan,['schemaVersion','taskId','policyVersion','maxConcurrency','stages'],'execution plan');
  if(plan.schemaVersion!==PLAN_SCHEMA_VERSION) throw Error(`Execution plan requires schemaVersion ${PLAN_SCHEMA_VERSION}`);
  if(!idPattern.test(plan.taskId??'')) throw Error('Invalid execution-plan taskId');
  if(typeof plan.policyVersion!=='string' || !plan.policyVersion.trim()) throw Error('Execution plan requires policyVersion');
  const maxConcurrency=plan.maxConcurrency??2;
  if(!Number.isSafeInteger(maxConcurrency) || maxConcurrency<1 || maxConcurrency>3) throw Error('Execution-plan maxConcurrency must be from 1 to 3');
  if(!Array.isArray(plan.stages) || !plan.stages.length || plan.stages.length>16) throw Error('Execution plan requires 1-16 stages');
  const ids=new Set();
  const planDir=path.dirname(path.resolve(planFile));
  const stages=[];
  for(const raw of plan.stages) {
    assertKeys(raw,['id','type','description','dependsOn','failureMode','packet','provider','model','effort'],'execution-plan stage');
    if(!idPattern.test(raw.id??'') || ids.has(raw.id)) throw Error('Execution-plan stage IDs must be unique lowercase identifiers');
    ids.add(raw.id);
    if(raw.type!=='review') throw Error('Execution-plan stages support only the typed review action');
    if(raw.description!==undefined && (typeof raw.description!=='string' || !raw.description.trim())) throw Error(`Invalid description for stage ${raw.id}`);
    const dependsOn=raw.dependsOn??[];
    if(!Array.isArray(dependsOn) || new Set(dependsOn).size!==dependsOn.length || dependsOn.some(id=>!idPattern.test(id))) throw Error(`Invalid dependencies for stage ${raw.id}`);
    const failureMode=raw.failureMode??'required';
    if(!['required','advisory'].includes(failureMode)) throw Error(`Invalid failureMode for stage ${raw.id}`);
    if(typeof raw.packet!=='string' || !raw.packet.trim() || raw.packet.includes('\0')) throw Error(`Invalid packet path for stage ${raw.id}`);
    if(typeof raw.provider!=='string' || !/^[a-z][a-z0-9-]{0,31}$/.test(raw.provider)) throw Error(`Invalid provider for stage ${raw.id}`);
    if(typeof raw.model!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(raw.model)) throw Error(`Invalid model for stage ${raw.id}`);
    const effort=raw.effort??'default';
    modelResolver(config,raw.provider,raw.model,effort);
    const packetFile=path.resolve(planDir,raw.packet);
    const stat=await fs.stat(packetFile);
    if(!stat.isFile()) throw Error(`Packet is not a regular file for stage ${raw.id}`);
    stages.push({id:raw.id,type:'review',description:raw.description??'',dependsOn,failureMode,packetFile,provider:raw.provider,model:raw.model,effort});
  }
  validateGraph(stages);
  return {schemaVersion:PLAN_SCHEMA_VERSION,taskId:plan.taskId,policyVersion:plan.policyVersion,maxConcurrency,stages};
}

export async function loadExecutionPlan(planFile,config,options) {
  return resolveExecutionPlan(await readJson(planFile),planFile,config,options);
}

export function describeExecutionPlan(plan) {
  return {
    schemaVersion:plan.schemaVersion,
    taskId:plan.taskId,
    policyVersion:plan.policyVersion,
    maxConcurrency:plan.maxConcurrency,
    stages:plan.stages.map(stage=>({...stage}))
  };
}

const dotEscape=value=>String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n');
export function executionPlanGraph(plan) {
  const lines=['digraph TeamLoopPlan {','  rankdir=LR;'];
  for(const stage of plan.stages) {
    const label=[stage.id,stage.description,`${stage.provider}/${stage.model}`,stage.failureMode].filter(Boolean).join('\n');
    lines.push(`  "${dotEscape(stage.id)}" [label="${dotEscape(label)}"];`);
  }
  for(const stage of plan.stages) for(const dependency of stage.dependsOn) lines.push(`  "${dotEscape(dependency)}" -> "${dotEscape(stage.id)}";`);
  lines.push('}');
  return lines.join('\n')+'\n';
}

function publicStageState(state) {
  const value={id:state.id,status:state.status,failureMode:state.failureMode,provider:state.provider,model:state.model};
  for(const key of ['startedAt','finishedAt','workerRunId','packetHash','verdict','failureClass','error','reason']) if(state[key]!=null) value[key]=state[key];
  return value;
}

function eventWriter(file,output,base) {
  let pending=Promise.resolve();
  return event=>{
    const value={schemaVersion:EVENT_SCHEMA_VERSION,timestamp:new Date().toISOString(),...base,...event};
    const line=JSON.stringify(value)+'\n';
    pending=pending.then(async()=>{await fs.appendFile(file,line,'utf8');if(output) output.write(line);});
    return pending;
  };
}

export async function runExecutionPlan(plan,config,runWorker,{output=process.stdout,sanitizeError=value=>String(value),planSource='inline'}={}) {
  if(typeof runWorker!=='function') throw Error('Execution plan requires a worker runner');
  const planRunId=randomUUID();
  const started=Date.now();
  const startedAt=new Date(started).toISOString();
  const planHash=hash(plan);
  const runDir=path.join(path.resolve(config.stateRoot),'plan-runs',planRunId);
  await fs.mkdir(runDir,{recursive:true});
  await atomicJson(path.join(runDir,'plan.json'),{planHash,source:planSource,plan:describeExecutionPlan(plan)});
  const states=new Map(plan.stages.map(stage=>[stage.id,{id:stage.id,status:'waiting',failureMode:stage.failureMode,provider:stage.provider,model:stage.model}]));
  const status={schemaVersion:1,planRunId,taskId:plan.taskId,policyVersion:plan.policyVersion,planHash,startedAt,status:'running',leadDecisionRequired:true,stages:[...states.values()].map(publicStageState)};
  const statusFile=path.join(runDir,'status.json');
  await atomicJson(statusFile,status);
  const emit=eventWriter(path.join(runDir,'events.ndjson'),output,{planRunId,taskId:plan.taskId});
  const byId=new Map(plan.stages.map(stage=>[stage.id,stage]));
  const active=new Map(),activeProviders=new Set();
  const persist=async()=>{status.stages=plan.stages.map(stage=>publicStageState(states.get(stage.id)));await atomicJson(statusFile,status);};
  const cancelBlocked=async()=>{
    let changed=false,passChanged;
    do {
      passChanged=false;
      for(const stage of plan.stages) {
        const state=states.get(stage.id);
        if(state.status!=='waiting') continue;
        const blocked=stage.dependsOn.some(id=>{
          const dependencyState=states.get(id),dependency=byId.get(id);
          return dependencyState.status==='canceled' || (dependencyState.status==='failed' && dependency.failureMode==='required');
        });
        if(!blocked) continue;
        state.status='canceled';state.reason='required-dependency-failed';state.finishedAt=new Date().toISOString();changed=true;passChanged=true;
        await emit({event:'stage_finished',stageId:stage.id,status:'canceled',reason:state.reason});
      }
    } while(passChanged);
    if(changed) await persist();
  };
  const launch=async stage=>{
    const state=states.get(stage.id);
    state.status='running';state.startedAt=new Date().toISOString();activeProviders.add(stage.provider);
    await emit({event:'stage_started',stageId:stage.id,provider:stage.provider,model:stage.model,effort:stage.effort,failureMode:stage.failureMode});
    await persist();
    const work=(async()=>{
      try {
        const record=await runWorker(stage.packetFile,stage.provider,stage.model,config,stage.effort);
        return {stage,record,status:record.status==='completed'?'completed':'failed'};
      } catch(error) {
        return {stage,status:'failed',record:{error:sanitizeError(error.message),failureClass:'runner-or-unknown'}};
      }
    })();
    active.set(stage.id,work);
  };
  try {
    await emit({event:'run_started',policyVersion:plan.policyVersion,planHash,maxConcurrency:plan.maxConcurrency,stageCount:plan.stages.length});
    while(true) {
      await cancelBlocked();
      let launched=false;
      for(const stage of plan.stages) {
        if(active.size>=plan.maxConcurrency) break;
        const state=states.get(stage.id);
        if(state.status!=='waiting' || activeProviders.has(stage.provider)) continue;
        const ready=stage.dependsOn.every(id=>{
          const dependencyState=states.get(id),dependency=byId.get(id);
          return dependencyState.status==='completed' || (dependencyState.status==='failed' && dependency.failureMode==='advisory');
        });
        if(!ready) continue;
        await launch(stage);launched=true;
      }
      if(!active.size) {
        if(plan.stages.every(stage=>terminalStatuses.has(states.get(stage.id).status))) break;
        if(!launched) throw Error('Execution plan scheduler reached an unresolved state');
      }
      if(!active.size) continue;
      const result=await Promise.race([...active.entries()].map(async([id,promise])=>({id,result:await promise})));
      active.delete(result.id);activeProviders.delete(result.result.stage.provider);
      const state=states.get(result.id),record=result.result.record;
      state.status=result.result.status;state.finishedAt=new Date().toISOString();
      if(record.runId) state.workerRunId=record.runId;
      if(record.packetHash) state.packetHash=record.packetHash;
      if(record.verdict) state.verdict=record.verdict;
      if(record.failureClass) state.failureClass=record.failureClass;
      if(record.error) state.error=sanitizeError(record.error);
      await emit({event:'stage_finished',stageId:state.id,status:state.status,workerRunId:state.workerRunId,packetHash:state.packetHash,verdict:state.verdict,failureClass:state.failureClass,error:state.error});
      await persist();
    }
    const requiredFailure=plan.stages.some(stage=>stage.failureMode==='required' && ['failed','canceled'].includes(states.get(stage.id).status));
    const anyFailure=plan.stages.some(stage=>['failed','canceled'].includes(states.get(stage.id).status));
    status.status=requiredFailure?'failed':anyFailure?'completed_with_failures':'completed';
    status.elapsedMs=Date.now()-started;status.finishedAt=new Date().toISOString();status.stages=plan.stages.map(stage=>publicStageState(states.get(stage.id)));
    await atomicJson(statusFile,status);
    await emit({event:'run_finished',status:status.status,elapsedMs:status.elapsedMs,leadDecisionRequired:true,stages:status.stages.map(stage=>({id:stage.id,status:stage.status,workerRunId:stage.workerRunId??null}))});
    return status;
  } catch(error) {
    const message=sanitizeError(error?.message??error);
    for(const stage of plan.stages) {
      const state=states.get(stage.id);
      if(state.status==='waiting') {state.status='canceled';state.reason='plan-runner-failed';state.finishedAt=new Date().toISOString();}
    }
    status.status='failed';status.failureClass='plan-runner';status.error=message;status.elapsedMs=Date.now()-started;status.finishedAt=new Date().toISOString();status.stages=plan.stages.map(stage=>publicStageState(states.get(stage.id)));
    try {await atomicJson(statusFile,status);} catch {}
    try {await emit({event:'run_finished',status:'failed',failureClass:status.failureClass,error:message,elapsedMs:status.elapsedMs,leadDecisionRequired:true,stages:status.stages.map(stage=>({id:stage.id,status:stage.status,workerRunId:stage.workerRunId??null}))});} catch {}
    throw error;
  }
}

export async function executionPlanStatuses(config,planRunId) {
  const root=path.join(path.resolve(config.stateRoot),'plan-runs');
  if(planRunId) {
    if(!/^[a-f0-9-]{36}$/.test(planRunId)) throw Error('Invalid plan run ID');
    return [await readJson(path.join(root,planRunId,'status.json'))];
  }
  let entries=[];
  try {entries=await fs.readdir(root);} catch(error) {if(error.code!=='ENOENT') throw error;}
  const records=[];
  for(const id of entries) {
    try {records.push(await readJson(path.join(root,id,'status.json')));}
    catch(error) {
      if(error.code==='ENOENT') records.push({planRunId:id,status:'incomplete-record',note:'No plan status was published. No evidence was deleted.'});
      else if(error instanceof SyntaxError) records.push({planRunId:id,status:'corrupt-record',note:'Reconcile retained plan evidence before another dispatch. No evidence was changed.'});
      else throw error;
    }
  }
  return records;
}
