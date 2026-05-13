interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * e-Stat (Japan) MCP — government statistics
 *
 * API: https://www.e-stat.go.jp/api/api-info/e-stat-manual3-0
 * Auth: appId query param. Register at https://www.e-stat.go.jp/api/
 *
 * Endpoints used:
 * - /getStatsList       — search stats tables
 * - /getMetaInfo        — dimensions/code lists
 * - /getStatsData       — observations
 * - /getDataCatalog     — high-level catalog (datasets + table groups)
 */


const BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_stats',
    description:
      'Search e-Stat statistical tables. Returns IDs and names for tables matching the query. Use the IDs with get_data / get_metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text (Japanese or English)' },
        limit: { type: 'number', description: '1-100000 (default 20)' },
        start_position: { type: 'number', description: '1-based row offset (default 1)' },
        lang: { type: 'string', description: 'J (Japanese, default) | E (English)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_metadata',
    description: 'Fetch dimensions and code lists for a stats table.',
    inputSchema: {
      type: 'object',
      properties: {
        stats_data_id: { type: 'string', description: 'Table ID (statsDataId)' },
        lang: { type: 'string', description: 'J | E' },
      },
      required: ['stats_data_id'],
    },
  },
  {
    name: 'get_data',
    description: 'Fetch observations from a stats table. Optionally filter by dimension codes.',
    inputSchema: {
      type: 'object',
      properties: {
        stats_data_id: { type: 'string', description: 'Table ID (statsDataId)' },
        limit: { type: 'number', description: '1-100000 (default 100)' },
        start_position: { type: 'number', description: '1-based row offset' },
        lang: { type: 'string', description: 'J | E' },
        filters: {
          type: 'object',
          description: 'Dimension code filters as { "cdCat01":"A03503", "cdTime":"2023" }',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['stats_data_id'],
    },
  },
  {
    name: 'list_data_catalog',
    description: 'Browse the high-level data catalog (table groupings).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional free-text filter' },
        limit: { type: 'number', description: '1-100 (default 20)' },
        start_position: { type: 'number', description: '1-based offset' },
        lang: { type: 'string', description: 'J | E' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error(
      'e-Stat requires an appId. Contact the operator about platform credentials, or BYO via ?_apiKey=<appId> after registering at https://www.e-stat.go.jp/api/.',
    );
  }
  const lang = (args.lang as string | undefined)?.toUpperCase();
  switch (name) {
    case 'search_stats':
      return searchStats(apiKey, args, lang);
    case 'get_metadata':
      return getMetadata(apiKey, args, lang);
    case 'get_data':
      return getData(apiKey, args, lang);
    case 'list_data_catalog':
      return listCatalog(apiKey, args, lang);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function searchStats(appId: string, args: Record<string, unknown>, lang?: string) {
  const params = new URLSearchParams({
    appId,
    searchWord: reqStr(args, 'query', '"population"'),
    limit: String(Math.min(100000, Math.max(1, (args.limit as number) ?? 20))),
    startPosition: String(Math.max(1, (args.start_position as number) ?? 1)),
  });
  if (lang) params.set('lang', lang);
  return estatGet('/getStatsList', params);
}

async function getMetadata(appId: string, args: Record<string, unknown>, lang?: string) {
  const params = new URLSearchParams({
    appId,
    statsDataId: reqStr(args, 'stats_data_id', '"0003411634"'),
  });
  if (lang) params.set('lang', lang);
  return estatGet('/getMetaInfo', params);
}

async function getData(appId: string, args: Record<string, unknown>, lang?: string) {
  const params = new URLSearchParams({
    appId,
    statsDataId: reqStr(args, 'stats_data_id', '"0003411634"'),
    limit: String(Math.min(100000, Math.max(1, (args.limit as number) ?? 100))),
    startPosition: String(Math.max(1, (args.start_position as number) ?? 1)),
  });
  if (lang) params.set('lang', lang);
  if (args.filters && typeof args.filters === 'object') {
    for (const [k, v] of Object.entries(args.filters as Record<string, unknown>)) {
      params.set(k, String(v));
    }
  }
  return estatGet('/getStatsData', params);
}

async function listCatalog(appId: string, args: Record<string, unknown>, lang?: string) {
  const params = new URLSearchParams({
    appId,
    limit: String(Math.min(100, Math.max(1, (args.limit as number) ?? 20))),
    startPosition: String(Math.max(1, (args.start_position as number) ?? 1)),
  });
  if (args.query) params.set('searchWord', String(args.query));
  if (lang) params.set('lang', lang);
  return estatGet('/getDataCatalog', params);
}

async function estatGet(path: string, params: URLSearchParams) {
  const url = `${BASE}${path}?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('e-Stat: rate-limit (HTTP 429)');
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`e-Stat error: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  // e-Stat embeds status codes inside the payload — propagate as errors
  const root = (data as { GET_STATS_LIST?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } }; GET_STATS_DATA?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } }; GET_META_INFO?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } }; GET_DATA_CATALOG?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } } });
  const env = root.GET_STATS_LIST ?? root.GET_STATS_DATA ?? root.GET_META_INFO ?? root.GET_DATA_CATALOG;
  if (env?.RESULT?.STATUS && env.RESULT.STATUS !== 0) {
    throw new Error(`e-Stat status ${env.RESULT.STATUS}: ${env.RESULT.ERROR_MSG ?? 'unknown'}`);
  }
  return data;
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
