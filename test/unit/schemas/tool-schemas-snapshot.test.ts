import { describe, it, expect, beforeAll } from "vitest";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { setupTestContext } from "../../helpers/setup.js";
import { setupToolHandlers, setWriteToolsEnabled } from "../../../src/mcp/register-tools.js";

// Pins every tool's published JSON schema exactly as MCP clients receive it from
// tools/list. Any change to a schema or to the zod-to-json converter (e.g. a zod
// major upgrade) shows up here as a reviewable diff instead of silently changing
// what the model sees.
async function listTools(): Promise<Array<{ name: string; inputSchema: unknown }>> {
  let handler: ((req: unknown) => Promise<{ tools: Array<{ name: string; inputSchema: unknown }> }>) | undefined;
  const fakeServer = {
    setRequestHandler(schema: unknown, fn: typeof handler) {
      if (schema === ListToolsRequestSchema) handler = fn;
    },
  };
  setupToolHandlers(fakeServer as never);
  if (!handler) throw new Error("tools/list handler was not registered");
  const { tools } = await handler({ method: "tools/list", params: {} });
  return tools;
}

describe("published tool schemas", () => {
  beforeAll(async () => {
    await setupTestContext();
    setWriteToolsEnabled(true);
  });

  it("match the committed snapshot", async () => {
    const tools = await listTools();
    const byName = Object.fromEntries(
      [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => [t.name, t.inputSchema]),
    );
    await expect(JSON.stringify(byName, null, 2) + "\n").toMatchFileSnapshot(
      "./__snapshots__/tool-schemas.json",
    );
  });
});
