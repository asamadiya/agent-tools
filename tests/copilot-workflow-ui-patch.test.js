const assert = require("assert");
const { execFileSync } = require("child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");
const { patchSource, unpatchSource } = require("../lib/workflow-ui-patch");

const source = [
  'pie=["mcp-apps","canvas-renderer"],jB=pie.filter(t=>t!=="mcp-apps"&&t!=="canvas-renderer");',
  'var nXn=({noMouse:t,session:_,statusLineMessage:M})=>r1.default.createElement(x5e,{footer:r1.default.createElement(r1.default.Fragment,null,!z&&M.length!==0?r1.default.createElement(T,null,M):null)});var xa=We(lt(),1);',
  'function zZn(e,De){let{textTertiary:z}=Pe(),q=HZn(e,{});let Re=De.ctrl&&(De.code==="d"||De.code==="z"&&process.platform==="win32");return q||Re}',
  'function _i(){if(eC(Ke,"/")){B.current=A,M(0)}}',
].join("");

const patched = patchSource(source);
assert(patched.includes('jB=pie.filter(t=>t!=="mcp-apps")'));
assert(patched.includes("/* copilot-workflow-ui-patch */"));
assert(patched.includes("__copilotWorkflowInlineFooter"));
assert(patched.includes("r1.default.createElement(__copilotWorkflowInlineFooter,{session:_})"));
assert(patched.includes("owner.sessionId===sessionId"));
assert(patched.includes("owner.copilotAgentSessionId===sessionId"));
assert(patched.includes("tmuxPane===process.env.TMUX_PANE"));
assert(patched.includes("statSync"));
assert(!patched.includes("slice(0,24)"));
assert(patched.includes("if(owns(run,sessionId))matched.push"));
assert(patched.includes("scanned>=256"));
assert(patched.includes("__copilotWorkflowInlineFocused"));
assert(patched.includes("__copilotWorkflowInlineAvailable"));
assert(patched.includes("__copilotWorkflowPromptReadyForWorkflowFocus"));
assert(patched.includes('De.code==="down"'));
assert(patched.includes('globalThis.__copilotWorkflowPromptReadyForWorkflowFocus&&De.code==="down"'));
assert(!patched.includes('globalThis.__copilotWorkflowInlineAvailable&&De.code==="down"&&!De.ctrl'));
assert(patched.includes('function _i(){if(globalThis.__copilotWorkflowInlineFocused)return;'));
assert(patched.includes("process.stdout.columns"));
assert(patched.includes("Math.max(leftRows.length,rightRows.length,12)"));
assert(patched.includes("Workflows · details · ↑↓ scroll text"));
assert(patched.includes("Task id: "));
assert(patched.includes("Depends on: "));
assert(patched.includes("Prompt · "));
assert(patched.includes("Activity · last "));
assert(patched.includes("Enter to view"));
assert.strictEqual(patchSource(patched), patched);
assert.strictEqual(unpatchSource(patched), source);

const stalePatched = patched.replace("tmuxPane===process.env.TMUX_PANE", "tmuxPane==='stale'");
const upgraded = patchSource(stalePatched);
assert(upgraded.includes("tmuxPane===process.env.TMUX_PANE"));
assert(!upgraded.includes("tmuxPane==='stale'"));

const tempDir = mkdtempSync(join(tmpdir(), "cw-patch-syntax-"));
try {
  const file = join(tempDir, "app.js");
  writeFileSync(file, patched);
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("workflow-ui-patch tests passed");
