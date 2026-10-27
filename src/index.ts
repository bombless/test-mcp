import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

const server = new McpServer(
  { name: "test-mcp", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
    },
  },
);

type DeferredEvent = {
  id: string;
  kind: string;
  createdAt: string;
};

const deferredEvents: DeferredEvent[] = [];
let eventSequence = 0;

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 500);
  }
  return String(error).slice(0, 500);
}

server.registerTool(
  "probe_capabilities",
  {
    description:
      "Report the client capabilities negotiated during MCP initialization. Call this first; declarations are evidence, not proof that a request will succeed.",
    inputSchema: {},
  },
  async () => {
    const capabilities = server.server.getClientCapabilities();

    return textResult({
      probe: "client-capabilities",
      observedAt: new Date().toISOString(),
      capabilitiesAdvertised: capabilities ?? null,
      samplingAdvertised: Boolean(capabilities?.sampling),
      elicitationFormAdvertised: Boolean(capabilities?.elicitation?.form),
      elicitationUrlAdvertised: Boolean(capabilities?.elicitation?.url),
      note:
        "A missing capability means the client did not advertise it in initialization. A present capability must still be verified by an actual request.",
    });
  },
);

server.registerTool(
  "probe_sampling",
  {
    description:
      "During this explicit tool call, attempt one standard MCP Sampling request with a harmless fixed prompt. This tests an in-flight server-to-client model request only; it does not start a new ChatGPT turn.",
    inputSchema: {},
  },
  async () => {
    const capabilities = server.server.getClientCapabilities();

    if (!capabilities?.sampling) {
      return textResult({
        probe: "sampling",
        status: "not-advertised",
        passed: false,
        detail:
          "The connected client did not advertise MCP Sampling during initialization. No sampling request was sent.",
      });
    }

    const startedAt = new Date().toISOString();
    try {
      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "For this protocol test only, reply with exactly: SAMPLING_OK",
            },
          },
        ],
        maxTokens: 32,
      });

      const responseText =
        result.content.type === "text" ? result.content.text : undefined;

      return textResult({
        probe: "sampling",
        status: "response-received",
        passed: true,
        startedAt,
        completedAt: new Date().toISOString(),
        model: result.model,
        role: result.role,
        stopReason: result.stopReason,
        responseType: result.content.type,
        responseText,
        note:
          "This proves only that the connected client answered a Sampling request during an active tool call. It does not prove that the client can be awakened or asked to start a new turn later.",
      });
    } catch (error) {
      return textResult({
        probe: "sampling",
        status: "request-failed",
        passed: false,
        startedAt,
        completedAt: new Date().toISOString(),
        error: errorSummary(error),
        note:
          "Failure may reflect client support, policy, permissions, or transport behavior. Inspect the client/server logs before attributing the cause.",
      });
    }
  },
);

server.registerTool(
  "probe_elicitation",
  {
    description:
      "During this explicit tool call, request a harmless yes/no user confirmation through MCP Elicitation. This tests user-input elicitation, not model-turn triggering.",
    inputSchema: {},
  },
  async () => {
    const capabilities = server.server.getClientCapabilities();

    if (!capabilities?.elicitation?.form) {
      return textResult({
        probe: "elicitation",
        status: "form-not-advertised",
        passed: false,
        detail:
          "The connected client did not advertise form-based MCP Elicitation during initialization. No elicitation request was sent.",
      });
    }

    const startedAt = new Date().toISOString();
    try {
      const result = await server.server.elicitInput({
        mode: "form",
        message:
          "MCP capability test: do you approve this harmless test confirmation?",
        requestedSchema: {
          type: "object",
          properties: {
            approveTest: {
              type: "boolean",
              title: "Approve test?",
              description: "This does not change files or settings.",
            },
          },
          required: ["approveTest"],
        },
      });

      return textResult({
        probe: "elicitation",
        status: "response-received",
        passed: true,
        startedAt,
        completedAt: new Date().toISOString(),
        action: result.action,
        approveTest:
          result.action === "accept"
            ? result.content?.approveTest
            : undefined,
        note:
          "This proves only that the client handled an Elicitation request during an active tool call. It does not prove that the server can start a new model turn.",
      });
    } catch (error) {
      return textResult({
        probe: "elicitation",
        status: "request-failed",
        passed: false,
        startedAt,
        completedAt: new Date().toISOString(),
        error: errorSummary(error),
        note:
          "Failure may reflect client support, policy, permissions, or transport behavior. Inspect the client/server logs before attributing the cause.",
      });
    }
  },
);

server.registerTool(
  "record_deferred_trigger",
  {
    description:
      "Record a synthetic event to test deferred-trigger expectations. This intentionally does not send an unsolicited request to ChatGPT, because standard MCP does not provide a general server-to-client 'start a new model turn' operation.",
    inputSchema: {
      kind: z
        .enum(["repeated-error", "missing-capability", "manual-test"])
        .default("manual-test")
        .describe("Synthetic event category; do not include secrets or user content."),
    },
  },
  async ({ kind }) => {
    eventSequence += 1;
    const event: DeferredEvent = {
      id: `event-${eventSequence}`,
      kind,
      createdAt: new Date().toISOString(),
    };
    deferredEvents.push(event);

    return textResult({
      probe: "deferred-trigger",
      status: "event-recorded-only",
      passed: false,
      event,
      pendingEventCount: deferredEvents.length,
      triggerAttempted: false,
      note:
        "This is deliberately not a ChatGPT wake-up test: no standard MCP operation starts a new model turn while the client is idle. Use external orchestration or test a documented client-specific trigger separately.",
    });
  },
);

server.registerTool(
  "list_deferred_events",
  {
    description:
      "List synthetic deferred-trigger events recorded in this server process. Events are in-memory and are cleared when the process restarts.",
    inputSchema: {},
  },
  async () =>
    textResult({
      count: deferredEvents.length,
      events: deferredEvents,
      persistence: "in-memory-only",
    }),
);

const mode = process.env.MCP_TRANSPORT ?? "stdio";

if (mode === "stdio") {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else if (mode === "http") {
  // Single-session test server. Use one dedicated instance per test client.
  const port = Number(process.env.PORT ?? 3000);
  const app = createMcpExpressApp();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  app.get("/", (_req, res) => {
    res.status(200).json({
      name: "test-mcp",
      status: "ok",
      endpoint: "/mcp",
      note: "MCP Streamable HTTP test endpoint",
    });
  });

  app.all("/mcp", async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP HTTP request failed:", errorSummary(error));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.listen(port, "0.0.0.0", () => {
    console.error(`test-mcp Streamable HTTP listening on port ${port}; endpoint /mcp`);
  });
} else {
  throw new Error(`Unsupported MCP_TRANSPORT "${mode}". Use "stdio" or "http".`);
}
