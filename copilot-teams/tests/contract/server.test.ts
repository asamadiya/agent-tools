import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/server.js";

const STUB = resolve(__dirname, "../integration/fixtures/stub-copilot");

const EXPECTED_TOOLS = [
  "Agent",
  "SendMessage",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "TaskStop",
  "TaskCreate",
  "TaskUpdate",
  "TeamCreate",
  "TeamDelete",
  "Status",
  "Attach",
  "WhoOwns",
  "GetTranscript",
  "PaneJoin",
  "PaneBreak",
  "PaneFocus",
  "PaneResize",
  "PaneSwap",
  "SendToTeam",
  "Restart",
  "Pause",
  "Resume",
  "GC",
] as const;

let dir: string;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-contract-"));
  statePath = join(dir, "state.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const link = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ binary: STUB, statePath });
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
};

describe("MCP server contract", () => {
  it("exposes the full agent-teams tool set", async () => {
    const { client } = await link();
    const out = await client.listTools();
    const names = out.tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("each tool has a non-empty description and inputSchema", async () => {
    const { client } = await link();
    const out = await client.listTools();
    for (const t of out.tools) {
      expect(t.description?.length).toBeGreaterThan(10);
      expect(t.inputSchema).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("Agent rejects malformed input with isError", async () => {
    const { client } = await link();
    const r = await client.callTool({
      name: "Agent",
      arguments: { description: "" }, // missing prompt, empty description
    });
    expect(r.isError).toBe(true);
  });

  it("TaskCreate happy path returns a task record", async () => {
    const { client } = await link();
    const r = await client.callTool({
      name: "TaskCreate",
      arguments: { content: "do a thing", status: "todo" },
    });
    expect(r.isError).toBeFalsy();
    const arr = r.content as Array<{ type: string; text: string }>;
    const text = arr[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("todo");
    expect(parsed.description).toBe("do a thing");
  });

  it("TeamCreate then TeamDelete (empty) round-trips", async () => {
    const { client } = await link();
    await client.callTool({ name: "TeamCreate", arguments: { name: "alpha" } });
    const del = await client.callTool({
      name: "TeamDelete",
      arguments: { name: "alpha" },
    });
    const arr = del.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(arr[0]?.text ?? "{}");
    expect(parsed.deleted).toBe(true);
  });

  it("Agent foreground end-to-end via stub copilot", async () => {
    const { client } = await link();
    const r = await client.callTool({
      name: "Agent",
      arguments: {
        description: "smoke",
        prompt: "say HELLO_CONTRACT",
        run_in_background: false,
      },
    });
    expect(r.isError).toBeFalsy();
    const arr = r.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(arr[0]?.text ?? "{}");
    expect(parsed.status).toBe("exited");
    expect(parsed.output).toContain("HELLO_CONTRACT");
  });

  it("Agent emits progress notifications when client provides onprogress", async () => {
    const { client } = await link();
    const events: Array<{ progress: number; message?: string }> = [];
    const r = await client.callTool(
      {
        name: "Agent",
        arguments: {
          description: "progress-smoke",
          prompt: "say PROG_OK",
          run_in_background: false,
        },
      },
      undefined,
      {
        onprogress: (p: { progress: number; message?: string }) =>
          events.push({ progress: p.progress, ...(p.message ? { message: p.message } : {}) }),
      },
    );
    expect(r.isError).toBeFalsy();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.message?.includes("task recorded"))).toBe(true);
  });
});
