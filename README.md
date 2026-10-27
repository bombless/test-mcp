# test-mcp — ChatGPT MCP capability probe

A minimal, isolated MCP server for testing whether the *connected client* supports server-initiated Sampling and Elicitation, and for documenting the boundary between MCP requests and starting a new ChatGPT turn.

## What this can prove

- `probe_capabilities`: reports the client capability declarations received during MCP initialization.
- `probe_sampling`: from inside an explicit tool call, sends a standard MCP Sampling request. Success means the connected client answered that request with model output.
- `probe_elicitation`: from inside an explicit tool call, requests a harmless yes/no confirmation using MCP Elicitation.
- `record_deferred_trigger`: records a synthetic event only. It deliberately does **not** pretend that an MCP server can wake ChatGPT or start a new model turn.
- `list_deferred_events`: lists synthetic events recorded in the current process.

A successful Sampling test proves only an in-flight server-to-client model request. It does not prove the client can start a new turn after the tool call or after the user leaves.

## Requirements

- Node.js 20+
- An MCP client that can connect to stdio, or a publicly reachable HTTPS deployment for remote ChatGPT connector testing

## Run locally with stdio

```bash
npm install
npm run build
npm start
```

Example for an MCP client that supports local stdio servers:

```json
{
  "mcpServers": {
    "test-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/test-mcp/dist/index.js"]
    }
  }
}
```

## Run as a remote MCP server for ChatGPT

ChatGPT custom MCP connectors generally need a reachable remote endpoint, not a local stdio process. Run the Streamable HTTP mode on a host or a secure development tunnel that provides an HTTPS URL:

```bash
npm install
npm run build
npm run start:http
```

The server listens on port `3000` by default. Configure your host to expose:

- Health check: `GET /`
- MCP endpoint: `https://YOUR-HOST/mcp`

Set `PORT` if the hosting platform provides a different port. Do not expose this test endpoint with private or production data. The HTTP implementation is intentionally a **single-session test server**; use one dedicated instance per test client.

In ChatGPT, add the deployed HTTPS MCP endpoint through the available custom connector / developer-mode flow for your account. The exact UI and availability depend on your ChatGPT workspace and plan. This repository does not configure the connector on your behalf.

## Test procedure

1. Deploy the HTTP mode to a reachable HTTPS endpoint and connect it as an MCP server in the ChatGPT client you want to test. Confirm the connector can list the probe tools.
2. Ask ChatGPT to call `probe_capabilities`. Save the reported capabilities and server logs.
3. Ask ChatGPT to call `probe_sampling`. Expected result if supported: the tool returns the client/model's response. If not supported, it reports that Sampling was not advertised or the request failed.
4. Ask ChatGPT to call `probe_elicitation`. If supported, the client should present the confirmation interaction and return an accept/decline/cancel result.
5. Call `record_deferred_trigger`, then let the tool call finish without sending another user message. Observe whether any documented client mechanism actually starts a new model turn.
6. Repeat while the conversation is idle. Distinguish a UI notification, a persisted event, or a tool-list change from an actual new model turn.

## Interpretation

| Result | Meaning |
|---|---|
| Sampling capability absent | Client did not advertise Sampling in initialization; do not assume it is supported |
| Sampling advertised and succeeds | In-flight Sampling works for this client and configuration |
| Elicitation succeeds | The client can request user input during a tool call |
| Event is recorded but no new turn starts | Event persistence is not model triggering |
| No new turn without a user message | No tested/available trigger was demonstrated; use a separate authorized background model runner or wait for the next user turn |

A capability declaration is necessary evidence but not sufficient: run the request and verify the actual response. Errors can also result from client policy, permissions, or transport behavior, so retain the error category and logs.

## Privacy and safety

This probe sends only a fixed, non-sensitive prompt. It does not read local files, collect conversation contents, or forward user data to a third party. The synthetic deferred event is in-memory only.

## Protocol references

- [MCP TypeScript SDK capabilities](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/capabilities.md)
- [MCP Streamable HTTP server example](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/simpleStreamableHttp.ts)
- [MCP Sampling specification](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
- [MCP Elicitation specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
