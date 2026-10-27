# test-mcp — ChatGPT MCP capability probe

A minimal, isolated MCP server for testing whether the *connected client* supports server-initiated Sampling and Elicitation, and for documenting the boundary between MCP requests and starting a new ChatGPT turn.

## What this can prove

- `probe_capabilities`: reports the client capability declarations received during MCP initialization.
- `probe_sampling`: from inside an explicit tool call, sends a standard MCP Sampling request. Success means the connected client answered that request with model output.
- `probe_elicitation`: from inside an explicit tool call, requests a harmless yes/no confirmation using MCP Elicitation.
- `record_deferred_trigger`: records a synthetic event only. It deliberately does **not** pretend that an MCP server can wake ChatGPT or start a new model turn.

A successful Sampling test proves only an in-flight server-to-client model request. It does not prove the client can start a new turn after the tool call or after the user leaves.

## Requirements

- Node.js 20+
- An MCP client that can connect to a local stdio MCP server
- The client should be configured to launch this package using `npm start` (or `npm run dev` during development)

## Run

```bash
npm install
npm run build
npm start
```

Example MCP client configuration:

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

Adapt the configuration to the MCP client you are actually testing. Do not assume that a successful connection means Sampling or Elicitation is supported.

## Test procedure

1. Connect this server to the target ChatGPT MCP integration.
2. Ask ChatGPT to call `probe_capabilities`. Save the reported capabilities and server logs.
3. Ask ChatGPT to call `probe_sampling`. Expected result if supported: the tool returns the client/model's response. If not supported, the tool reports the exact error category without logging prompt contents.
4. Ask ChatGPT to call `probe_elicitation`. If supported, the client should present the confirmation interaction and return an accept/decline/cancel result.
5. After the tool call finishes, do not send another user message. Check whether any documented client mechanism causes a new model turn. This server does not implement such a mechanism because ordinary MCP tool servers have no standard unsolicited "start a new ChatGPT turn" request.
6. Repeat with the conversation idle. Distinguish a UI notification, a persisted event, or a tool-list change from an actual new model turn.

## Interpretation

| Result | Meaning |
|---|---|
| Sampling capability absent | Client did not advertise Sampling in initialization; do not assume it is supported |
| Sampling advertised and succeeds | In-flight Sampling works for this client and configuration |
| Elicitation succeeds | The client can request user input during a tool call |
| Event is recorded but no new turn starts | Event persistence is not model triggering |
| No new turn without a user message | No tested/available trigger was demonstrated; use a separate authorized background model runner or wait for the next user turn |

A capability declaration is necessary evidence but not sufficient: run the request and verify the actual response. Errors can also result from client policy, permissions, or transport timeouts, so retain the error category and logs.

## Privacy and safety

This probe sends only a fixed, non-sensitive prompt. It does not read local files, collect conversation contents, or forward user data to a third party. The synthetic deferred event is in-memory only.

## Protocol references

- [MCP TypeScript SDK capabilities](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/capabilities.md)
- [MCP Sampling specification](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
- [MCP Elicitation specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
