try {
  const response = await fetch("http://127.0.0.1:3004/api/health", {
    signal: AbortSignal.timeout(4_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
