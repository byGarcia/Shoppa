import { loadEnvFile } from "node:process";

/**
 * Carga `.env.local` sin pisar lo que ya venía del entorno.
 *
 * `loadEnvFile` sobrescribe `process.env`, y eso es peligroso de verdad para
 * cualquier herramienta que se lance con la base de datos por delante:
 * `DATABASE_URL=… pnpm db:seed` acabaría sembrando la base del fichero en vez
 * de la que se pidió, en silencio y con la salida diciendo otra cosa. Lo
 * explícito manda sobre lo implícito.
 *
 * Que el fichero no exista es normal —en el contenedor y en CI las variables
 * llegan del entorno— y no es un error.
 */
export function cargaEnvLocal(): void {
  const previo = { ...process.env };
  try {
    loadEnvFile(".env.local");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return;
  }
  for (const [clave, valor] of Object.entries(previo)) {
    if (valor !== undefined) process.env[clave] = valor;
  }
}
