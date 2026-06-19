import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { buildServer } from "../../src/server.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-server-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const script = `
export const meta = { name: 'server-demo', description: 'Server demo' }
return await agent('hello', { label: 'hello' })
`;

const link = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({
    root,
    backend: new StubAgentBackend([{ text: "ok", tokens: 1, toolCalls: 1 }]),
  });
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
};

describe("workflow MCP server", () => {
  it("exposes workflow tools", async () => {
    const { client } = await link();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "Workflow",
      "WorkflowInspect",
      "WorkflowList",
      "WorkflowOutput",
      "WorkflowSave",
      "WorkflowStatus",
      "WorkflowStop",
    ].sort());
  });

  it("runs a workflow and reads status/output", async () => {
    const { client } = await link();
    const run = await client.callTool({ name: "Workflow", arguments: { script, confirm: false, wait: true } });
    expect(run.isError).toBeFalsy();
    const parsed = JSON.parse((run.content as Array<{ text: string }>)[0]!.text);
    expect(parsed.status).toBe("completed");

    const status = await client.callTool({ name: "WorkflowStatus", arguments: { runId: parsed.runId } });
    expect(status.isError).toBeFalsy();
    expect((status.content as Array<{ text: string }>)[0]!.text).toContain("server-demo");

    const output = await client.callTool({ name: "WorkflowOutput", arguments: { runId: parsed.runId } });
    expect(output.isError).toBeFalsy();
    expect((output.content as Array<{ text: string }>)[0]!.text).toContain("\"ok\"");
  });

  it("emits progress notifications", async () => {
    const { client } = await link();
    const events: Array<{ progress: number; message?: string }> = [];
    await client.callTool(
      { name: "Workflow", arguments: { script, confirm: false, wait: true } },
      undefined,
      { onprogress: (p: { progress: number; message?: string }) => events.push(p) },
    );
    expect(events.some((e) => e.message?.includes("workflow"))).toBe(true);
  });

  it("saves and lists workflows without running them", async () => {
    const { client } = await link();
    const saved = await client.callTool({ name: "WorkflowSave", arguments: { script } });
    expect(saved.isError).toBeFalsy();
    const savedParsed = JSON.parse((saved.content as Array<{ text: string }>)[0]!.text);
    expect(savedParsed.saved).toBe(true);
    expect(savedParsed.status).toBe("queued");

    const listed = await client.callTool({ name: "WorkflowList", arguments: { workflowName: "server-demo" } });
    expect(listed.isError).toBeFalsy();
    const listParsed = JSON.parse((listed.content as Array<{ text: string }>)[0]!.text);
    expect(listParsed.runs).toHaveLength(1);
    expect(listParsed.runs[0].workflowName).toBe("server-demo");
  });
});
