// `server-only` has no implementation in this repo: Next resolves the specifier
// through its own bundler alias, so `node_modules/server-only` does not exist
// and any test importing a module marked with it fails to resolve. Vitest maps
// the specifier to this empty module (see vitest.config.mts), which is what the
// `react-server` condition resolves to in a real build. The marker still does
// its job where it matters — in the bundler, not in the test runner.
export {};
