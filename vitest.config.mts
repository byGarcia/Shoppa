import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@/…` is the project's alias for `src/` (declared in tsconfig paths, which
  // Vitest does not read). Needed by any test that imports a module that uses it.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See the stub for why: `server-only` is a bundler marker with no package
      // on disk, so it is unresolvable in the test runner without this.
      "server-only": fileURLToPath(new URL("./vitest.server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    fileParallelism: false,
  },
});
