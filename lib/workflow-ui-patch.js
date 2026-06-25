"use strict";

const ANCHOR = 'jB=pie.filter(t=>t!=="mcp-apps"&&t!=="canvas-renderer")';
const PATCHED = 'jB=pie.filter(t=>t!=="mcp-apps")/* copilot-workflow-ui-patch */';
const INLINE_MARKER = "/* copilot-workflow-inline-patch */";
const INLINE_INSERT_ANCHOR = "var nXn=({noMouse:t,";
const INLINE_FOOTER_ANCHOR = '!z&&M.length!==0?r1.default.createElement(T,null,M):null)});var xa=';
const INLINE_FOOTER_PATCHED = '!z&&M.length!==0?r1.default.createElement(T,null,M):null,r1.default.createElement(__copilotWorkflowInlineFooter,{session:_}))});var xa=';
const INLINE_COMPONENT_PATTERN = /\/\* copilot-workflow-inline-patch \*\/var __copilotWorkflowInlineFooter=\(\(\)=>\{[\s\S]*?\}\)\(\);(?=var nXn=)/;
const CUSTOM_INPUT_GUARD_ANCHOR = 'let Re=De.ctrl&&(De.code==="d"||De.code==="z"&&process.platform==="win32");';
const CUSTOM_INPUT_GUARD_PATCHED = 'if(globalThis.__copilotWorkflowInlineFocused||globalThis.__copilotWorkflowInlineAvailable&&globalThis.__copilotWorkflowPromptReadyForWorkflowFocus&&De.code==="down"&&!De.ctrl&&!De.alt&&!De.super)return;let Re=De.ctrl&&(De.code==="d"||De.code==="z"&&process.platform==="win32");';
const LEGACY_CUSTOM_INPUT_GUARD_PATCHED = 'if(globalThis.__copilotWorkflowInlineFocused||globalThis.__copilotWorkflowInlineAvailable&&De.code==="down"&&!De.ctrl&&!De.alt&&!De.super)return;let Re=De.ctrl&&(De.code==="d"||De.code==="z"&&process.platform==="win32");';
const CUSTOM_INPUT_READY_ANCHOR = 'let{textTertiary:z}=Pe(),q=HZn(e,{';
const CUSTOM_INPUT_READY_PATCHED = 'let{textTertiary:z}=Pe();globalThis.__copilotWorkflowPromptReadyForWorkflowFocus=!e.text;let q=HZn(e,{';
const MAIN_TUI_GUARD_ANCHOR = 'function _i(){if(eC(Ke,"/"))';
const MAIN_TUI_GUARD_PATCHED = 'function _i(){if(globalThis.__copilotWorkflowInlineFocused)return;if(eC(Ke,"/"))';

const LEGACY_PROMPT_INPUT_ANCHOR = '},{isActive:w});let{text:H,visualLines:z,cursorLinePosition:q}=e,V=s&&w';
const LEGACY_PROMPT_INPUT_PATCHED = '},{isActive:w&&!globalThis.__copilotWorkflowInlineFocused});let{text:H,visualLines:z,cursorLinePosition:q}=e,V=s&&w&&!globalThis.__copilotWorkflowInlineFocused';
const LEGACY_MAIN_INPUT_ANCHOR = 'tn(Se,{isActive:!0});let{text:we,displayVisualLines:Ce,displayCursorLinePosition:nt';
const LEGACY_MAIN_INPUT_PATCHED = 'tn(Se,{isActive:!globalThis.__copilotWorkflowInlineFocused});let{text:we,displayVisualLines:Ce,displayCursorLinePosition:nt';
const LEGACY_SIMPLE_INPUT_ANCHOR = '},{isActive:e});let{text:c,cursorPosition:u}=n;if(!c&&t)return';
const LEGACY_SIMPLE_INPUT_PATCHED = '},{isActive:e&&!globalThis.__copilotWorkflowInlineFocused});let{text:c,cursorPosition:u}=n;if(!c&&t)return';

const ACTIVE_INLINE_COMPONENT = `${INLINE_MARKER}var __copilotWorkflowInlineFooter=(()=>{
globalThis.__copilotWorkflowInlineFocused=false;globalThis.__copilotWorkflowInlineAvailable=false;globalThis.__copilotWorkflowPromptReadyForWorkflowFocus=true;
let fs,path,os;
function node(){return fs||(fs=Tt("fs"),path=Tt("path"),os=Tt("os")),fs}
function root(){node();return process.env.COPILOT_WORKFLOWS_ROOT||path.join(os.homedir(),".copilot","workflows")}
function statusLabel(state){return{completed:"ok",done:"ok",running:"run",failed:"err",stopped:"stop",cancelled:"stop",cached:"cache",queued:"wait",preview:"new"}[state]||"wait"}
function agents(run){return(run.workflowProgress||[]).filter(entry=>entry.type==="workflow_agent")}
function phases(run){let found=(run.workflowProgress||[]).filter(entry=>entry.type==="workflow_phase"),seen=new Set(found.map(entry=>entry.title));for(let agent of agents(run)){let title=agent.phaseTitle||"Tasks";if(!seen.has(title)){found.push({type:"workflow_phase",index:found.length+1,title});seen.add(title)}}return found.length?found:[{type:"workflow_phase",index:1,title:"Tasks"}]}
function owns(run,sessionId){let owner=run.owner||{};return!!sessionId&&(owner.sessionId===sessionId||owner.copilotAgentSessionId===sessionId)||!!process.env.TMUX_PANE&&owner.tmuxPane===process.env.TMUX_PANE||!!process.env.COPILOT_LOADER_PID&&owner.loaderPid===process.env.COPILOT_LOADER_PID}
function loadRuns(sessionId){try{let n=node(),dir=path.join(root(),"runs");if(!n.existsSync(dir))return[];let files=n.readdirSync(dir).filter(file=>file.endsWith(".json")).map(file=>{let full=path.join(dir,file),mtime;try{mtime=n.statSync(full).mtimeMs}catch{return null}return{file,path:full,mtime}}).filter(Boolean).sort((a,b)=>b.mtime-a.mtime||String(b.file).localeCompare(String(a.file)));let matched=[],scanned=0;for(let file of files){scanned++;try{let run=JSON.parse(n.readFileSync(file.path,"utf8"));if(owns(run,sessionId))matched.push({...run,_file:file.file})}catch{}if(matched.length>=8||scanned>=256)break}return matched.sort((a,b)=>Date.parse(b.createdAt||b.updatedAt||0)-Date.parse(a.createdAt||a.updatedAt||0)||String(b._file).localeCompare(String(a._file))).map((run,index)=>({...run,workflowId:"WF"+(index+1)}))}catch{return[]}}
function doneCount(run){let list=agents(run);return list.filter(agent=>["done","cached"].includes(agent.state)).length+"/"+list.length}
function truncate(value,max=100){let text=String(value??"").replace(/\\s+/g," ").trim();return text.length>max?text.slice(0,max-1)+"…":text}
function workflowState(run){let list=agents(run);return list.some(agent=>agent.state==="failed")?"failed":list.length&&list.every(agent=>["done","cached"].includes(agent.state))?"done":list.some(agent=>agent.state==="running")?"running":"queued"}
function windowStart(index,total,size){let visible=Math.max(0,size-total+1);return total<visible?0:Math.min(total-visible+1,Math.max(0,index-visible))}
function statusLine(state){return state==="running"?"● Running":state==="done"||state==="cached"?"✔ Completed":statusLabel(state)+" "+String(state||"").replace(/^./,char=>char.toUpperCase())}
function contextLabel(contextWindow){if(contextWindow>=1e6){let value=contextWindow/1e6;return(Number.isInteger(value)?value:value.toFixed(1))+"M context"}return contextWindow>=1e3?Math.round(contextWindow/1e3)+"k context":contextWindow+" context"}
function duration(ms){if(!Number.isFinite(ms)||ms<=0)return"0s";let seconds=Math.floor(ms/1e3),hours=Math.floor(seconds/3600);seconds-=hours*3600;let minutes=Math.floor(seconds/60);seconds-=minutes*60;return[hours?hours+"h":"",minutes?minutes+"m":"",seconds+"s"].filter(Boolean).join(" ")}
function metrics(agent){let elapsed=agent.state==="running"&&agent.updatedAt?"idle "+duration(Date.now()-agent.updatedAt):agent.durationMs!==undefined?duration(agent.durationMs):agent.state;let tokens=agent.tokens>=1e6?(agent.tokens/1e6).toFixed(1)+"M":agent.tokens>=1e3?(agent.tokens/1e3).toFixed(1).replace(/\\.0$/,"")+"k":agent.tokens;return truncate(tokens+" tok · "+agent.toolCalls+" tool call"+(agent.toolCalls===1?"":"s")+" · "+elapsed,220)}
function promptLines(agent){let lines=String(agent.promptPreview||"").split(/\\r?\\n/);return lines.length>1?["Prompt · "+lines.length+" lines · expand",...lines.slice(0,2).map(line=>"  "+truncate(line,180)),...(lines.length>2?["  … "+(lines.length-2)+" more lines"]:[])]:["Prompt: "+(truncate(agent.promptPreview,140)||"(prompt unavailable)")]}
function activityLines(agent){let recent=agent.recentToolCalls||[];return recent.length?["Activity · last "+Math.min(3,recent.length)+" of "+agent.toolCalls+" tool call"+(agent.toolCalls===1?"":"s"),...recent.slice(-3).map(call=>"  "+call.name+(call.summary?"("+truncate(call.summary,160)+")":""))]:["Activity: "+(agent.lastToolName?agent.lastToolName+(agent.lastToolSummary?" - "+truncate(agent.lastToolSummary,120):""):agent.state)]}
function outcomeLines(agent){let outcome=agent.state==="running"?"Still running…":agent.error||agent.resultPreview||"none",lines=String(outcome).split(/\\r?\\n/);return lines.length>1?["Outcome",...lines.map(line=>line?"  "+line:"")]:["Outcome: "+truncate(outcome,160)]}
function detailLines(agent){return[statusLine(agent.state)+" · "+agent.model+" ("+contextLabel(agent.contextWindow)+")",metrics(agent),...(agent.dagTaskId?["Task id: "+agent.dagTaskId]:[]),...(agent.dependsOn?.length?["Depends on: "+agent.dependsOn.join(", ")]:[]),...promptLines(agent),...activityLines(agent),...outcomeLines(agent)]}
function icon(state){return state==="running"?"●":state==="done"||state==="cached"||state==="completed"?"✔":state==="failed"?"✖":"○"}
function pad(value,width){let text=truncate(value,width);return text+" ".repeat(Math.max(0,width-text.length))}
function table(leftTitle,rightTitle,leftRows,rightRows){let total=Math.max(96,(process.stdout.columns||120)-4),leftWidth=Math.max(24,Math.min(54,Math.floor(total*.28))),rightWidth=Math.max(48,total-leftWidth-5),rows=Math.max(leftRows.length,rightRows.length,12),out=["╭ "+pad(leftTitle,leftWidth)+"┬ "+pad(rightTitle,rightWidth)+"╮"];for(let i=0;i<rows;i++)out.push("│ "+pad(leftRows[i]||"",leftWidth)+" │ "+pad(rightRows[i]||"",rightWidth)+" │");out.push("╰"+"─".repeat(leftWidth+2)+"┴"+"─".repeat(rightWidth+2)+"╯");return out}
function phaseRows(run,phaseList,activePhaseIndex){return phaseList.map((item,index)=>{let list=agents(run).filter(agent=>(agent.phaseTitle||"Tasks")===item.title),done=list.filter(agent=>["done","cached"].includes(agent.state)).length,state=workflowState({workflowProgress:list});return(index===activePhaseIndex?"❯ ":"  ")+icon(state)+" "+item.title+" "+done+"/"+list.length})}
function taskRows(list,activeTaskIndex){return list.map((agent,index)=>(index===activeTaskIndex?"❯ ":"  ")+icon(agent.state)+" "+agent.label)}
return function __copilotWorkflowInlineFooter({session}){
let sessionId=session?.sessionId,[runs,setRuns]=r1.default.useState(()=>loadRuns(sessionId)),[focused,setFocused]=r1.default.useState(false),[view,setView]=r1.default.useState("runs"),[runIndex,setRunIndex]=r1.default.useState(0),[phaseIndex,setPhaseIndex]=r1.default.useState(0),[taskIndex,setTaskIndex]=r1.default.useState(0),[scroll,setScroll]=r1.default.useState(0),colors=Pe();
globalThis.__copilotWorkflowInlineFocused=focused===true;
globalThis.__copilotWorkflowInlineAvailable=runs.length>0;
r1.default.useEffect(()=>{let stopped=false,refresh=()=>{if(!stopped)setRuns(loadRuns(sessionId))};refresh();let timer=setInterval(refresh,3000);return()=>{stopped=true;clearInterval(timer)}},[sessionId]);
r1.default.useEffect(()=>{globalThis.__copilotWorkflowInlineFocused=focused;return()=>{globalThis.__copilotWorkflowInlineFocused=false;globalThis.__copilotWorkflowInlineAvailable=false}},[focused]);
let activeRunIndex=Math.max(0,Math.min(runIndex,runs.length-1)),run=runs[activeRunIndex],phaseList=run?phases(run):[],activePhaseIndex=Math.max(0,Math.min(phaseIndex,Math.max(0,phaseList.length-1))),phase=phaseList[activePhaseIndex],taskList=run&&phase?agents(run).filter(agent=>(agent.phaseTitle||"Tasks")===phase.title):[],activeTaskIndex=Math.max(0,Math.min(taskIndex,Math.max(0,taskList.length-1))),task=taskList[activeTaskIndex];
tn((input)=>{if(!runs.length)return;if(!focused){if(input.code==="down"&&!input.ctrl&&!input.alt&&!input.super&&globalThis.__copilotWorkflowPromptReadyForWorkflowFocus)setFocused(true);return}if(input.code==="escape"||input.ctrl&&input.code==="g"){setFocused(false);setView("runs");return}if(input.code==="right"||input.code==="return"){view==="runs"?setView("phases"):view==="phases"?setView("tasks"):view==="tasks"&&(setView("agent"),setScroll(0));return}if(input.code==="left"){view==="agent"?(setView("tasks"),setScroll(0)):view==="tasks"?setView("phases"):view==="phases"?setView("runs"):setFocused(false);return}if(view==="agent"){input.code==="down"&&setScroll(value=>Math.min(8,value+1));input.code==="up"&&setScroll(value=>Math.max(0,value-1));return}if(input.code==="down")view==="runs"?setRunIndex(value=>Math.min(runs.length-1,value+1)):view==="phases"?setPhaseIndex(value=>Math.max(0,Math.min(phaseList.length-1,value+1))):view==="tasks"&&setTaskIndex(value=>Math.min(Math.max(0,taskList.length-1),value+1));if(input.code==="up")view==="runs"?setRunIndex(value=>Math.max(0,value-1)):view==="phases"?setPhaseIndex(value=>Math.max(0,value-1)):view==="tasks"&&setTaskIndex(value=>Math.max(0,value-1))},{isActive:true});
if(!runs.length)return null;
let line=(text,key,selected)=>r1.default.createElement(T,{key,color:selected?colors.selected:colors.textSecondary,wrap:"truncate"},(selected?"> ":"  ")+text),visibleRuns=focused?5:3,start=windowStart(activeRunIndex,runs.length,visibleRuns),runRows=runs.slice(start,start+visibleRuns).map((item,index)=>line(item.workflowId+" "+statusLabel(item.status)+" "+item.workflowName+" "+doneCount(item)+" · "+item.status,item.runId,focused&&start+index===activeRunIndex)),details=[];
if(focused&&run){let raw=(text,key)=>r1.default.createElement(T,{key,color:colors.textSecondary,wrap:"truncate"},text);if(view==="phases"){let right=taskList.length?taskRows(taskList,activeTaskIndex):["(no agents yet)"];details.push(...table("Phases",phase.title+" · "+taskList.length+" agent"+(taskList.length===1?"":"s"),phaseRows(run,phaseList,activePhaseIndex),right).map((text,index)=>raw(text,"phase-table-"+index)))}else if(view==="tasks"&&task){details.push(...table(phase.title+" · "+taskList.length+" agents",task.label,taskRows(taskList,activeTaskIndex),detailLines(task).slice(0,8)).map((text,index)=>raw(text,"task-table-"+index)))}else if(view==="agent"&&task){details.push(...table(phase.title+" · "+taskList.length+" agents",task.label,taskRows(taskList,activeTaskIndex),detailLines(task).slice(scroll,scroll+8)).map((text,index)=>raw(text,"agent-table-"+index)))}}
let hint=focused?{runs:"Workflows · ↑↓ select · → phases · Esc prompt",phases:"Workflows · phases · ↑↓ select · → tasks · ← runs",tasks:"Workflows · tasks · ↑↓ select · → details · ← phases",agent:"Workflows · details · ↑↓ scroll text · ← tasks"}[view]:"↑/↓ to select · Enter to view";
return r1.default.createElement(N,{flexDirection:"column",paddingX:1,borderStyle:"single",borderLeft:false,borderRight:false,borderBottom:false,borderColor:colors.borderNeutral},r1.default.createElement(T,{color:focused?colors.brand:colors.textSecondary},hint),...runRows,...details)
}
})();`;

function patchSource(source) {
  let next = source.replace(LEGACY_CUSTOM_INPUT_GUARD_PATCHED, CUSTOM_INPUT_GUARD_ANCHOR);
  if (!next.includes(PATCHED)) {
    const count = next.split(ANCHOR).length - 1;
    if (count !== 1) {
      throw new Error(`workflow-ui-patch: expected one canvas capability anchor, found ${count}`);
    }
    next = next.replace(ANCHOR, PATCHED);
  }
  if (next.includes(INLINE_MARKER) && !next.includes(ACTIVE_INLINE_COMPONENT)) {
    next = next.replace(INLINE_COMPONENT_PATTERN, "");
  }
  if (!next.includes(INLINE_MARKER)) {
    const insertCount = next.split(INLINE_INSERT_ANCHOR).length - 1;
    if (insertCount !== 1) {
      throw new Error(`workflow-ui-patch: expected one inline footer insert anchor, found ${insertCount}`);
    }
    next = next.replace(INLINE_INSERT_ANCHOR, () => `${ACTIVE_INLINE_COMPONENT}${INLINE_INSERT_ANCHOR}`);
  }
  if (!next.includes("r1.default.createElement(__copilotWorkflowInlineFooter,{session:_})")) {
    const footerCount = next.split(INLINE_FOOTER_ANCHOR).length - 1;
    if (footerCount !== 1) {
      throw new Error(`workflow-ui-patch: expected one inline footer render anchor, found ${footerCount}`);
    }
    next = next.replace(INLINE_FOOTER_ANCHOR, () => INLINE_FOOTER_PATCHED);
  }
  if (!next.includes(CUSTOM_INPUT_GUARD_PATCHED)) {
    const inputCount = next.split(CUSTOM_INPUT_GUARD_ANCHOR).length - 1;
    if (inputCount !== 1) {
      throw new Error(`workflow-ui-patch: expected one custom input guard anchor, found ${inputCount}`);
    }
    next = next.replace(CUSTOM_INPUT_GUARD_ANCHOR, () => CUSTOM_INPUT_GUARD_PATCHED);
  }
  if (!next.includes(CUSTOM_INPUT_READY_PATCHED)) {
    const readyCount = next.split(CUSTOM_INPUT_READY_ANCHOR).length - 1;
    if (readyCount !== 1) {
      throw new Error(`workflow-ui-patch: expected one custom input ready anchor, found ${readyCount}`);
    }
    next = next.replace(CUSTOM_INPUT_READY_ANCHOR, () => CUSTOM_INPUT_READY_PATCHED);
  }
  if (!next.includes(MAIN_TUI_GUARD_PATCHED)) {
    const mainTuiCount = next.split(MAIN_TUI_GUARD_ANCHOR).length - 1;
    if (mainTuiCount !== 1) {
      throw new Error(`workflow-ui-patch: expected one main TUI guard anchor, found ${mainTuiCount}`);
    }
    next = next.replace(MAIN_TUI_GUARD_ANCHOR, () => MAIN_TUI_GUARD_PATCHED);
  }
  return next;
}

function unpatchSource(source) {
  return source
    .replace(MAIN_TUI_GUARD_PATCHED, MAIN_TUI_GUARD_ANCHOR)
    .replace(CUSTOM_INPUT_READY_PATCHED, CUSTOM_INPUT_READY_ANCHOR)
    .replace(LEGACY_CUSTOM_INPUT_GUARD_PATCHED, CUSTOM_INPUT_GUARD_ANCHOR)
    .replace(CUSTOM_INPUT_GUARD_PATCHED, CUSTOM_INPUT_GUARD_ANCHOR)
    .replace(LEGACY_PROMPT_INPUT_PATCHED, LEGACY_PROMPT_INPUT_ANCHOR)
    .replace(LEGACY_MAIN_INPUT_PATCHED, LEGACY_MAIN_INPUT_ANCHOR)
    .replace(LEGACY_SIMPLE_INPUT_PATCHED, LEGACY_SIMPLE_INPUT_ANCHOR)
    .replace(INLINE_FOOTER_PATCHED, INLINE_FOOTER_ANCHOR)
    .replace(INLINE_COMPONENT_PATTERN, "")
    .replace(PATCHED, ANCHOR);
}

module.exports = { ANCHOR, PATCHED, patchSource, unpatchSource };
