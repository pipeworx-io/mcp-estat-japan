# @pipeworx/estat-japan

e-Stat (Japan) MCP — Japanese government statistics aggregator (~5000 tables across population, economy, labor, trade, prices, agriculture, environment). Free with an app ID.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `search_stats(query, limit?, start_position?, lang?)` — find stats tables
- `get_metadata(stats_data_id, lang?)` — dimensions + code lists for a table
- `get_data(stats_data_id, limit?, start_position?, lang?, filters?)` — observations
- `list_data_catalog(query?, limit?, start_position?, lang?, data_type?, survey_years?, stats_code?, stats_field?)` — browse catalog

## Auth

- **Platform key:** gateway env `PLATFORM_ESTAT_KEY` (an `appId` issued by e-stat.go.jp)
- **BYO:** `?_apiKey=<appId>` after registering at https://www.e-stat.go.jp/api/

## Data source

`https://api.e-stat.go.jp/rest/3.0/app/json/` — `appId` as query param.

Default language is Japanese (`J`); pass `lang: "E"` for English where available.

## Timeouts

e-Stat is slow and sets no timeout of its own. Measured 2026-08-27: `/getStatsList`
takes ~26s uncached, and `/getDataCatalog` ran past the gateway's 75s request deadline
at page sizes 1, 5 and 20 alike — page size is not what makes it slow.

Each request therefore carries its own budget — 55s (about 20s under the gateway's
own 75s deadline), and 35s for `list_data_catalog`, which is the endpoint that does
not finish at all rather than one that finishes late. Exceeding the budget returns a
soft failure rather than hanging:

```json
{ "found": false, "reason": "upstream_timeout", "endpoint": "...", "timeout_ms": 35000,
  "hint": "... use search_stats ..." }
```

`limit` defaults to 20 on `list_data_catalog` (100 on `get_data`, 20 on `search_stats`),
so a bare call is already bounded — page size was never what made the catalog slow.
The catalog accepts e-Stat's own narrowing params (`query`, `data_type`, `stats_code`,
`survey_years`); during the 2026-08-27 stall none of them shortened it, so treat them
as filters rather than as a fix. `search_stats` searches the same tables and answered
in seconds throughout.

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

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/search_stats \
  -H 'Content-Type: application/json' \
  -d '{"query":"失業率"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/search_stats`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-estat-japan` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/estat-japan/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "estat-japan": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-estat-japan"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

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
