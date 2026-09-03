import { QueryClient } from "@tanstack/react-query";

/**
 * The QueryClient's defaults. The provider builds the instance inside useState
 * from these, so a module-level singleton cannot share data between SSR
 * requests.
 */
export const queryClientOptions = {
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes in memory
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
} satisfies ConstructorParameters<typeof QueryClient>[0];
