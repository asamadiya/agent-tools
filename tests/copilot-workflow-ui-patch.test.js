const assert = require("assert");
const { patchSource, unpatchSource } = require("../lib/workflow-ui-patch");

const source = 'pie=["mcp-apps","canvas-renderer"],jB=pie.filter(t=>t!=="mcp-apps"&&t!=="canvas-renderer");';

const patched = patchSource(source);
assert(patched.includes('jB=pie.filter(t=>t!=="mcp-apps")'));
assert(patched.includes("/* copilot-workflow-ui-patch */"));
assert.strictEqual(patchSource(patched), patched);
assert.strictEqual(unpatchSource(patched), source);

console.log("workflow-ui-patch tests passed");
