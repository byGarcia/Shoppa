import { loadEnvFile } from "node:process";

/**
 * Loads `.env.local` without overwriting what the environment already carried.
 *
 * `loadEnvFile` overwrites `process.env`, and that is genuinely dangerous for
 * any tool launched with a database in front of it: `DATABASE_URL=… pnpm
 * db:seed` would end up seeding the database named in the file instead of the
 * one that was asked for — silently, and with the output claiming otherwise.
 * The explicit wins over the implicit.
 *
 * A missing file is normal — in the container and in CI the variables come
 * from the environment — and is not an error.
 */
export function loadLocalEnv(): void {
  const inherited = { ...process.env };
  try {
    loadEnvFile(".env.local");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return;
  }
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined) process.env[key] = value;
  }
}
