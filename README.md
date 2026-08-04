# @pipeworx/estat-japan

e-Stat (Japan) MCP — Japanese government statistics aggregator (~5000 tables across population, economy, labor, trade, prices, agriculture, environment). Free with an app ID.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Estat Japan data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
