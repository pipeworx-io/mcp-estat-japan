# @pipeworx/estat-japan

e-Stat (Japan) MCP — Japanese government statistics aggregator (~5000 tables across population, economy, labor, trade, prices, agriculture, environment). Free with an app ID.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

- `search_stats(query, limit?, start_position?, lang?)` — find stats tables
- `get_metadata(stats_data_id, lang?)` — dimensions + code lists for a table
- `get_data(stats_data_id, limit?, start_position?, lang?, filters?)` — observations
- `list_data_catalog(query?, limit?, start_position?, lang?)` — browse catalog

## Auth

- **Platform key:** gateway env `PLATFORM_ESTAT_KEY` (an `appId` issued by e-stat.go.jp)
- **BYO:** `?_apiKey=<appId>` after registering at https://www.e-stat.go.jp/api/

## Data source

`https://api.e-stat.go.jp/rest/3.0/app/json/` — `appId` as query param.

Default language is Japanese (`J`); pass `lang: "E"` for English where available.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "estat-japan": {
      "url": "https://gateway.pipeworx.io/estat-japan/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/estat-japan/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Estat Japan data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
