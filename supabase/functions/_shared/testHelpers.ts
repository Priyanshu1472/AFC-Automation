// supabase/functions/_shared/testHelpers.ts
// Fakes for the Supabase JS client used across edge-function unit tests.
// Not imported by any deployed function — filenames under `_shared` are
// skipped by `supabase functions deploy` the same way `_shared` itself is.

export type FakeResult = { data?: unknown; error?: unknown; count?: number | null };

// A thenable + chainable stand-in for a PostgREST query builder. Every
// non-terminal call (`select`, `eq`, `is`, ...) returns itself; awaiting the
// builder at any point (directly, like real supabase-js) resolves to the
// configured result via `then`.
function makeQueryBuilder(result: FakeResult, calls: string[][]) {
  const record = (name: string, args: unknown[]) => {
    calls.push([name, ...args.map((a) => JSON.stringify(a))]);
    return builder;
  };
  const builder: Record<string, unknown> = {
    select: (...a: unknown[]) => record("select", a),
    insert: (...a: unknown[]) => record("insert", a),
    update: (...a: unknown[]) => record("update", a),
    upsert: (...a: unknown[]) => record("upsert", a),
    delete: (...a: unknown[]) => record("delete", a),
    eq: (...a: unknown[]) => record("eq", a),
    neq: (...a: unknown[]) => record("neq", a),
    is: (...a: unknown[]) => record("is", a),
    in: (...a: unknown[]) => record("in", a),
    not: (...a: unknown[]) => record("not", a),
    order: (...a: unknown[]) => record("order", a),
    limit: (...a: unknown[]) => record("limit", a),
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: FakeResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

export type FakeCallLog = { table: string; calls: string[][] }[];

// `routes`: table name -> array of results, consumed in FIFO order across
// however many times that table is queried during one handler call. A table
// queried more times than it has configured results repeats its last entry.
export function createFakeAdminClient(routes: Record<string, FakeResult[]> = {}, opts: {
  rpc?: Record<string, FakeResult>;
  storage?: { upload?: FakeResult; remove?: FakeResult };
  auth?: {
    createUser?: FakeResult | ((args: Record<string, unknown>) => FakeResult);
    deleteUser?: FakeResult;
  };
} = {}) {
  const cursors: Record<string, number> = {};
  const log: FakeCallLog = [];
  const authCalls: { method: string; args: unknown[] }[] = [];

  const client = {
    from(table: string) {
      const queue = routes[table] || [{ data: null, error: null }];
      const idx = Math.min(cursors[table] ?? 0, queue.length - 1);
      cursors[table] = (cursors[table] ?? 0) + 1;
      const calls: string[][] = [];
      log.push({ table, calls });
      return makeQueryBuilder(queue[idx], calls);
    },
    rpc(name: string, _args?: Record<string, unknown>) {
      const result = opts.rpc?.[name] ?? { data: null, error: null };
      return Promise.resolve(result);
    },
    storage: {
      from(_bucket: string) {
        return {
          upload: (..._a: unknown[]) => Promise.resolve(opts.storage?.upload ?? { data: {}, error: null }),
          remove: (..._a: unknown[]) => Promise.resolve(opts.storage?.remove ?? { data: {}, error: null }),
        };
      },
    },
    auth: {
      admin: {
        createUser(args: Record<string, unknown>) {
          authCalls.push({ method: "createUser", args: [args] });
          const configured = opts.auth?.createUser;
          const result = typeof configured === "function" ? configured(args) : configured;
          return Promise.resolve(result ?? { data: { user: { id: "fake-user-id" } }, error: null });
        },
        deleteUser(id: string) {
          authCalls.push({ method: "deleteUser", args: [id] });
          return Promise.resolve(opts.auth?.deleteUser ?? { data: {}, error: null });
        },
      },
    },
    __log: log,
    __authCalls: authCalls,
  };
  return client;
}

export function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;
}

export function authedReq(url: string, opts: { token?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method: opts.method || "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
