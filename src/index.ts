interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
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

// e-Stat is a SLOW upstream, and it has no timeout of its own. Measured through
// the gateway 2026-08-27: /getStatsList takes ~26s uncached, and
// /getDataCatalog with a valid appId ran past the gateway's 75s request
// deadline on every attempt, at limit 1, 5 and 20 alike -- so the size of the
// page is not what makes it slow, and no default limit would have saved it
// (fleet #560). An unbounded fetch turns that into a hung connection, which the
// caller reads as "Pipeworx is down" rather than "this endpoint is slow today".
// Every request therefore carries its own budget, and running out of it comes
// back as a soft failure naming a tool that does work.
// 55s leaves ~20s of headroom under the gateway's 75s request deadline, which is
// what the budget has to beat. It is deliberately generous: /getStatsList was
// measured at 26s and again at 35s within the same hour, and a budget that cuts
// off a call which would have succeeded is a worse tool, not a safer one. The
// catalog gets less because it is the endpoint that does not finish at all --
// past 75s at every page size -- so waiting longer only delays the same answer.
const TIMEOUT_MS = 55_000;
const CATALOG_TIMEOUT_MS = 35_000;

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
    description: 'Fetch the dimension definitions and code lists for a specific e-Stat statistics table (statsDataId). Returns category codes needed to construct filters for get_data. Requires _apiKey.',
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
    description:
      'Browse the e-Stat high-level data catalog (dataset/table groupings) with an optional free-text filter. Returns catalog entries with dataset IDs, names, and organization metadata. This endpoint is slow at e-Stat and often exceeds its 35s budget, in which case it returns {found:false, reason:"upstream_timeout"}; search_stats answers "which Japanese statistics table covers X" faster. Requires _apiKey.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional free-text filter, Japanese or English' },
        limit: { type: 'number', description: 'Page size, 1-100. Defaults to 20 when omitted, so a bare call is already bounded.' },
        start_position: { type: 'number', description: '1-based offset (default 1)' },
        lang: { type: 'string', description: 'J (Japanese, default) | E (English)' },
        data_type: { type: 'string', description: 'Restrict to one file format: XLS | CSV | PDF | XML | XLS_REP | DB' },
        survey_years: { type: 'string', description: 'Survey period: yyyy, yyyymm, or yyyymm-yyyymm' },
        stats_code: { type: 'string', description: 'Government statistics code, e.g. "00200521" (population census)' },
        stats_field: { type: 'string', description: 'Statistical field code, 2 digits (major) or 4 digits (minor)' },
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
  if (args.data_type) params.set('dataType', String(args.data_type).toUpperCase());
  if (args.survey_years) params.set('surveyYears', String(args.survey_years));
  if (args.stats_code) params.set('statsCode', String(args.stats_code));
  if (args.stats_field) params.set('statsField', String(args.stats_field));
  if (lang) params.set('lang', lang);
  return estatGet('/getDataCatalog', params, {
    timeoutMs: CATALOG_TIMEOUT_MS,
    onTimeout:
      'e-Stat /getDataCatalog did not answer in time. It stalls for spells at a time — measured 2026-08-27, narrowing by query, data_type, stats_code or survey_years did not shorten it during one. Retry later, or use search_stats, which searches the same tables and answered in seconds throughout.',
  });
}

async function estatGet(
  path: string,
  params: URLSearchParams,
  opts: { timeoutMs?: number; onTimeout?: string } = {},
) {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const url = `${BASE}${path}?${params}`;
  let res: Response;
  try {
    // The signal covers the body read below as well as the headers, which is
    // where a slow e-Stat response actually stalls.
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (isTimeout(err)) return timedOut(path, timeoutMs, opts.onTimeout);
    throw err;
  }
  if (res.status === 429) throw new Error('e-Stat: rate-limit (HTTP 429)');
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`e-Stat error: ${res.status} ${t.slice(0, 200)}`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    if (isTimeout(err)) return timedOut(path, timeoutMs, opts.onTimeout);
    throw err;
  }
  // e-Stat embeds status codes inside the payload — propagate as errors
  const root = (data as { GET_STATS_LIST?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } }; GET_STATS_DATA?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } }; GET_META_INFO?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } }; GET_DATA_CATALOG?: { RESULT?: { STATUS?: number; ERROR_MSG?: string } } });
  const env = root.GET_STATS_LIST ?? root.GET_STATS_DATA ?? root.GET_META_INFO ?? root.GET_DATA_CATALOG;
  if (env?.RESULT?.STATUS && env.RESULT.STATUS !== 0) {
    throw new Error(`e-Stat status ${env.RESULT.STATUS}: ${env.RESULT.ERROR_MSG ?? 'unknown'}`);
  }
  return data;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * A slow upstream is not a data bug, and it should not look like one. Returning
 * the soft-fail envelope (rather than throwing) keeps the answer machine-
 * readable and points the caller at the tool that can still answer them.
 */
function timedOut(path: string, timeoutMs: number, hint?: string) {
  return {
    found: false,
    reason: 'upstream_timeout',
    endpoint: `${BASE}${path}`,
    timeout_ms: timeoutMs,
    hint:
      hint ??
      `e-Stat did not respond within ${Math.round(timeoutMs / 1000)}s. It is frequently slow rather than down — retry, or narrow the request.`,
  };
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
