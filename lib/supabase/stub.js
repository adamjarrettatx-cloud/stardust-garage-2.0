// Stub Supabase client used in dev when env vars are not configured.
// Returns empty results for all reads and silently no-ops on writes,
// so pages render with their fallback/empty states instead of crashing.
//
// This is automatically used by lib/supabase/server.js and
// lib/supabase/client.js when NEXT_PUBLIC_SUPABASE_URL or
// NEXT_PUBLIC_SUPABASE_ANON_KEY are missing.

function makeQueryBuilder() {
  const empty = { data: null, error: null };
  const emptyList = { data: [], error: null };

  // A chainable thenable so `await supabase.from(...).select(...)` works
  // and so does `.eq(...).order(...).single()` etc.
  const builder = {
    select: () => builder,
    insert: () => Promise.resolve(empty),
    update: () => builder,
    delete: () => builder,
    upsert: () => Promise.resolve(empty),
    eq: () => builder,
    neq: () => builder,
    gt: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    in: () => builder,
    is: () => builder,
    like: () => builder,
    ilike: () => builder,
    match: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    single: () => Promise.resolve(empty),
    maybeSingle: () => Promise.resolve(empty),
    // Make the builder itself awaitable -> resolves to an empty list.
    then: (resolve, reject) => Promise.resolve(emptyList).then(resolve, reject),
  };
  return builder;
}

export function createStubClient() {
  if (typeof window === 'undefined') {
    // Only log on the server, once-ish.
    if (!global.__sdgSupabaseStubWarned) {
      global.__sdgSupabaseStubWarned = true;
      console.warn(
        '[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
          'not set — using stub client. Pages will render with empty data. ' +
          'Add real keys to .env.local to connect to Supabase.'
      );
    }
  }

  return {
    from: () => makeQueryBuilder(),
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: 'Supabase is not configured in this environment.' },
      }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        remove: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  };
}

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
