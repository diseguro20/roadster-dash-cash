export function c() {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInAnonymously: async () => ({ data: { user: { id: 'local' } }, error: null })
    },
    functions: {
      invoke: async () => ({ data: {}, error: null })
    },
    rpc: () => ({
      maybeSingle: async () => ({ data: null, error: null })
    })
  };
}
export function g() {
  return c();
}
