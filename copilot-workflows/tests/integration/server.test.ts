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

const parse = (res: { content: unknown }) =>
  JSON.parse((res.content as Array<{ text: string }>)[0]!.text);

const pollStatus = async (
  client: Client,
  runId: string,
  predicate: (status: { run: { status: string } }) => boolean,
): Promise<{ run: { status: string } }> => {
  for (let i = 0; i < 100; i++) {
    const res = await client.callTool({ name: "WorkflowStatus", arguments: { runId } });
    const status = parse(res) as { run: { status: string } };
    if (predicate(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`workflow ${runId} did not reach the expected status in time`);
};

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

  it("schedules background execution for default wait:false and completes without a second run call", async () => {
    const { client } = await link();
    const launched = await client.callTool({ name: "Workflow", arguments: { script, confirm: false } });
    expect(launched.isError).toBeFalsy();
    const parsed = parse(launched);
    expect(parsed.status).toBe("async_launched");

    const status = await pollStatus(client, parsed.runId, (s) => s.run.status === "completed");
    expect(status.run.status).toBe("completed");

    const output = await client.callTool({ name: "WorkflowOutput", arguments: { runId: parsed.runId } });
    expect(output.isError).toBeFalsy();
    expect((output.content as Array<{ text: string }>)[0]!.text).toContain("\"ok\"");
  });

  it("accepts a workflow goal and generates a script", async () => {
    const { client } = await link();
    const r = await client.callTool({
      name: "Workflow",
      arguments: { goal: "workflow: compare README and package metadata", confirm: false, wait: false },
    });
    expect(r.isError).toBeFalsy();
    const parsed = parse(r);
    expect(parsed.workflowName).toBe("compare-readme-and-package-metadata");
    expect(parsed.scriptPath).toContain("compare-readme-and-package-metadata");
    // Let the background run settle to a terminal state before teardown.
    await pollStatus(client, parsed.runId, (s) =>
      ["completed", "failed", "stopped"].includes(s.run.status),
    );
  });
});
