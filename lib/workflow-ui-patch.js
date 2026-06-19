"use strict";

const ANCHOR = 'jB=pie.filter(t=>t!=="mcp-apps"&&t!=="canvas-renderer")';
const PATCHED = 'jB=pie.filter(t=>t!=="mcp-apps")/* copilot-workflow-ui-patch */';

function patchSource(source) {
  if (source.includes(PATCHED)) return source;
  const count = source.split(ANCHOR).length - 1;
  if (count !== 1) {
    throw new Error(`workflow-ui-patch: expected one canvas capability anchor, found ${count}`);
  }
  return source.replace(ANCHOR, PATCHED);
}

function unpatchSource(source) {
  return source.replace(PATCHED, ANCHOR);
}

module.exports = { ANCHOR, PATCHED, patchSource, unpatchSource };
