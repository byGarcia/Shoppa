import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El proxy arrastra NextAuth —y con él la base de datos— sólo por el guardián de
// sesión, que aquí no se ejercita: la validación del entorno ocurre antes de
// llegar a él. Sin este doble, el módulo ni siquiera se puede importar en Node.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("arranque del proxy", () => {
  it("importar el módulo sin APP_ORIGIN no lanza", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: undefined };
    const modulo = await import("./proxy.ts");
    expect(typeof modulo.proxy).toBe("function");
  });

  it("la primera petición sin APP_ORIGIN falla nombrando la variable", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: undefined };
    const { proxy } = await import("./proxy.ts");
    await expect(proxy(new NextRequest("http://localhost:3004/favicon.ico"))).rejects.toThrow(
      /APP_ORIGIN/,
    );
  });

  it("una segunda petición sin APP_ORIGIN también falla: el guardián no se da por satisfecho", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: undefined };
    const { proxy } = await import("./proxy.ts");
    await expect(proxy(new NextRequest("http://localhost:3004/favicon.ico"))).rejects.toThrow(
      /APP_ORIGIN/,
    );
    // Si la bandera se marcase antes de validar, esta segunda petición pasaría
    // el guardián con la configuración todavía rota: 500 una vez y silencio después.
    await expect(proxy(new NextRequest("http://localhost:3004/favicon.ico"))).rejects.toThrow(
      /APP_ORIGIN/,
    );
  });

  it("con el entorno válido la petición sigue su curso", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: "http://localhost:3004" };
    const { proxy } = await import("./proxy.ts");
    const respuesta = await proxy(new NextRequest("http://localhost:3004/favicon.ico"));
    expect(respuesta.status).toBe(200);
  });
});

// next.config.ts ponía HSTS en TODAS las respuestas, también en las que el
// middleware corta antes de llegar al final. Al mover la cabecera aquí, esa
// cobertura tiene que seguir siendo la misma o es una regresión.
describe("HSTS en las respuestas cortocircuitadas", () => {
  async function proxyCon(origen: string) {
    process.env = { ...ORIGINAL, APP_ORIGIN: origen };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  it("la redirección a /login la lleva: es la primera respuesta que ve un visitante sin sesión", async () => {
    const proxy = await proxyCon("https://shopping.example.com");
    const respuesta = await proxy(new NextRequest("https://shopping.example.com/precios"));
    expect(respuesta.status).toBe(307);
    expect(respuesta.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("el 403 del CSRF la lleva: un atacante lo provoca sin esfuerzo", async () => {
    const proxy = await proxyCon("https://shopping.example.com");
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/items", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(respuesta.status).toBe(403);
    expect(respuesta.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("el 401 de la API y los activos públicos también", async () => {
    const proxy = await proxyCon("https://shopping.example.com");
    const noAutorizada = await proxy(new NextRequest("https://shopping.example.com/api/items"));
    expect(noAutorizada.status).toBe(401);
    expect(noAutorizada.headers.get("strict-transport-security")).toContain("max-age=");
    const activo = await proxy(new NextRequest("https://shopping.example.com/favicon.ico"));
    expect(activo.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("sobre http no la lleva ninguna: fijaría el navegador a un https que no existe", async () => {
    const proxy = await proxyCon("http://192.168.1.50:3004");
    const redireccion = await proxy(new NextRequest("http://192.168.1.50:3004/precios"));
    expect(redireccion.status).toBe(307);
    expect(redireccion.headers.get("strict-transport-security")).toBeNull();
    const activo = await proxy(new NextRequest("http://192.168.1.50:3004/favicon.ico"));
    expect(activo.headers.get("strict-transport-security")).toBeNull();
  });
});

// La tarea 4 dejó el cubo por IP en «si no hay dirección de fiar, no se limita».
// Eso quitaba el limitador de TODAS las rutas estrictas con TRUSTED_PROXY=none
// —el valor por defecto—, incluida /api/ingest, cuyo Bearer no pertenece a
// ninguna cuenta y por tanto es invisible al freno por cuenta. El techo por ruta
// es lo que mantiene ahí un tope absoluto.
describe("techo por ruta cuando no hay IP de fiar", () => {
  async function proxyCon(env: Record<string, string>) {
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com", ...env };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  function ingesta(cabeceras: Record<string, string> = {}) {
    // Ruta estricta, pública y exenta de CSRF: el atajo de Siri llega sin Origin.
    return new NextRequest("https://shopping.example.com/api/ingest/voz", {
      method: "POST",
      headers: cabeceras,
    });
  }

  it("con none la petición 31 del minuto se corta con 429", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 30; i += 1) {
      expect((await proxy(ingesta())).status).not.toBe(429);
    }
    const cortada = await proxy(ingesta());
    expect(cortada.status).toBe(429);
    // El 429 sale por withHsts como cualquier otra respuesta.
    expect(cortada.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("con none una cabecera X-Real-IP falsificada no abre cubo nuevo", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 30; i += 1) {
      await proxy(ingesta({ "x-real-ip": `192.168.0.${i}` }));
    }
    // Treinta direcciones inventadas y el techo sigue en pie: es lo que un cubo
    // por IP no puede hacer cuando el que elige la IP es quien ataca.
    expect((await proxy(ingesta({ "x-real-ip": "192.168.0.99" }))).status).toBe(429);
  });

  it("el techo no toca las rutas no estrictas", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 40; i += 1) {
      const respuesta = await proxy(
        new NextRequest("https://shopping.example.com/api/items", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        }),
      );
      // Sin sesión son 401, nunca 429: el tope es sólo para las estrictas.
      expect(respuesta.status).toBe(401);
    }
  });

  it("el techo no toca las lecturas de una ruta estricta", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 40; i += 1) {
      const respuesta = await proxy(new NextRequest("https://shopping.example.com/login"));
      expect(respuesta.status).not.toBe(429);
    }
  });

  it("cada ruta estricta lleva su propia cuenta", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 31; i += 1) await proxy(ingesta());
    const login = await proxy(
      new NextRequest("https://shopping.example.com/login", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(login.status).not.toBe(429);
  });

  it("un sufijo distinto bajo la misma ruta no estrena techo", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 30; i += 1) {
      await proxy(
        new NextRequest(`https://shopping.example.com/api/ingest/voz${i}`, { method: "POST" }),
      );
    }
    // La clave es el prefijo casado, no el pathname: si no, rellenar la ruta
    // daría un cubo nuevo por intento y el techo no sería un techo.
    expect((await proxy(ingesta())).status).toBe(429);
  });
});

describe("con proxy configurado manda el cubo por IP", () => {
  async function proxyConIp() {
    process.env = {
      ...ORIGINAL,
      APP_ORIGIN: "https://shopping.example.com",
      TRUSTED_PROXY: "x-real-ip",
    };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  function ingestaDesde(ip: string) {
    return new NextRequest("https://shopping.example.com/api/ingest/voz", {
      method: "POST",
      headers: { "x-real-ip": ip },
    });
  }

  it("la sexta petición de una misma IP a una ruta estricta se corta", async () => {
    const proxy = await proxyConIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await proxy(ingestaDesde("1.2.3.4"))).status).not.toBe(429);
    }
    expect((await proxy(ingestaDesde("1.2.3.4"))).status).toBe(429);
  });

  it("el techo por ruta no se entromete: 40 IPs distintas pasan todas", async () => {
    const proxy = await proxyConIp();
    for (let i = 0; i < 40; i += 1) {
      expect((await proxy(ingestaDesde(`192.168.0.${i}`))).status).not.toBe(429);
    }
  });
});

// El primer arranque abre dos puertas públicas: la pantalla de instalación y la
// ruta que reclama la instancia. Las dos aceptan un secreto tecleado por una
// persona, así que las dos tienen que ser públicas Y estrictas: pública para que
// se pueda llegar sin cuenta —no hay ninguna todavía— y estricta porque son los
// únicos sitios de esta instancia donde adivinar merece la pena.
describe("primer arranque en el proxy", () => {
  async function proxyCon(env: Record<string, string> = {}) {
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com", ...env };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  it("/setup se sirve sin sesión: no hay ninguna cuenta con la que tenerla", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(new NextRequest("https://shopping.example.com/setup"));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("location")).toBeNull();
  });

  it("/api/setup se sirve sin sesión", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/setup", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(respuesta.status).not.toBe(401);
  });

  it("/api/setup está en las rutas estrictas: la sexta de una IP se corta", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "x-real-ip" });
    function intento() {
      return new NextRequest("https://shopping.example.com/api/setup", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "x-real-ip": "1.2.3.4" },
      });
    }
    for (let i = 0; i < 5; i += 1) expect((await proxy(intento())).status).not.toBe(429);
    expect((await proxy(intento())).status).toBe(429);
  });

  // El prefijo /api/auth está exento del control CSRF porque lo cubre el token
  // propio de NextAuth, y ese token no cubre los endpoints de WebAuthn que esta
  // aplicación añadió bajo el mismo prefijo. El alta es la única operación
  // irreversible de la casa: no puede depender sólo de SameSite.
  it("un POST desde otro sitio al alta de passkey se corta con 403", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/auth/webauthn/register?step=verify", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(respuesta.status).toBe(403);
  });

  it("y el de la misma instancia pasa: sus llamadas son fetch del mismo origen", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/auth/webauthn/register?step=verify", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(respuesta.status).not.toBe(403);
  });

  it("las rutas propias de NextAuth conservan su exención", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/auth/callback/credentials", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(respuesta.status).not.toBe(403);
  });

  it("los tres pasos del alta comparten cubo: el barato no compra presupuesto", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "x-real-ip" });
    function paso(step: string) {
      return new NextRequest(`https://shopping.example.com/api/auth/webauthn/register?step=${step}`, {
        method: "POST",
        headers: { "x-real-ip": "1.2.3.4", "sec-fetch-site": "same-origin" },
      });
    }
    // Doce es el cupo del alta: cuatro ceremonias completas por minuto.
    const pasos = ["presence", "options", "verify"];
    for (let i = 0; i < 12; i += 1) {
      expect((await proxy(paso(pasos[i % 3]))).status).not.toBe(429);
    }
    expect((await proxy(paso("verify"))).status).toBe(429);
  });
});

// Quien llega invitado no tiene sesión —ése es el sentido entero de la
// invitación—, así que su pantalla y su ruta de canje tienen que ser públicas o
// el proxy lo manda a /login y el enlace no sirve para nada. Estrictas por el
// mismo motivo que /api/setup: aceptan un secreto que viene en la dirección.
describe("invitaciones en el proxy", () => {
  async function proxyCon(env: Record<string, string> = {}) {
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com", ...env };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  const TOKEN = "un-token-de-invitacion-cualquiera";

  it("/invite/<token> se sirve sin sesión y sin redirigir", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(new NextRequest(`https://shopping.example.com/invite/${TOKEN}`));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("location")).toBeNull();
  });

  // La lista exacta no vale para una ruta que lleva un valor dentro, y el
  // prefijo no puede ablandar a las demás: /loginXYZ no es /login.
  it("el prefijo de páginas públicas no abre /login con sufijo", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(new NextRequest("https://shopping.example.com/loginXYZ"));
    expect(respuesta.status).toBe(307);
  });

  it("/api/invitations/redeem se sirve sin sesión", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/redeem", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(respuesta.status).not.toBe(401);
  });

  // El emparejamiento de PUBLIC_API_ROUTES es por prefijo: poner
  // "/api/invitations" en vez de la ruta completa habría hecho pública también
  // la CREACIÓN, y con ella la capacidad de fabricarse invitaciones.
  it("crear invitaciones sigue exigiendo sesión", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(respuesta.status).toBe(401);
  });

  it("el canje está en las rutas estrictas: la sexta de una IP se corta", async () => {
    const proxy = await proxyCon({ TRUSTED_PROXY: "x-real-ip" });
    function intento() {
      return new NextRequest("https://shopping.example.com/api/invitations/redeem", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "x-real-ip": "1.2.3.4" },
      });
    }
    for (let i = 0; i < 5; i += 1) expect((await proxy(intento())).status).not.toBe(429);
    expect((await proxy(intento())).status).toBe(429);
  });

  // El emparejamiento de PUBLIC_API_ROUTES era startsWith a secas, así que
  // /api/invitations/redeemXYZ contaba como público — y Next lo enruta a
  // /api/invitations/[id], cuyo DELETE revoca. Ningún id real empieza por
  // "redeem", así que no había nada alcanzable, pero «inalcanzable por suerte»
  // no es lo mismo que cerrado. Ahora casa por frontera de segmento.
  it("un sufijo pegado al canje no hereda su exención", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/redeemXYZ", {
        method: "DELETE",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(respuesta.status).toBe(401);
  });

  it("revocar exige sesión", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/lo-que-sea", {
        method: "DELETE",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(respuesta.status).toBe(401);
  });

  // La misma frontera vale para las demás rutas públicas, y ahí el error habría
  // sido peor: /api/setupXYZ no es /api/setup.
  it("tampoco lo hereda un sufijo pegado a /api/setup", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/setupXYZ", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(respuesta.status).toBe(401);
  });

  it("y las rutas públicas de verdad lo siguen siendo", async () => {
    const proxy = await proxyCon();
    for (const ruta of ["/api/health", "/api/setup", "/api/ingest/voz", "/api/auth/session"]) {
      const respuesta = await proxy(new NextRequest(`https://shopping.example.com${ruta}`));
      expect([ruta, respuesta.status]).not.toEqual([ruta, 401]);
    }
  });

  it("un POST al canje desde otro sitio se corta con 403", async () => {
    const proxy = await proxyCon();
    const respuesta = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/redeem", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(respuesta.status).toBe(403);
  });
});

// El log del arranque es lo único que le dice a quien instala esto cuál es su
// token. Va DESPUÉS de `booted = true` a propósito: `booted` significa
// "validado", y esto abre una conexión a la base de datos, que no es un
// requisito para dar la instancia por levantada. Por eso es «mejor esfuerzo» y
// un fallo aquí no puede convertir cada petición en un 500.
// El limitador estricto y el general compartían contador mientras se juzgaban
// contra límites distintos —5 y 100—, así que cada lectura inocente gastaba un
// cupo dimensionado para cinco intentos de adivinar. Seis GET dejaban el
// siguiente POST en 429: una petición rechazada por algo que no hizo, y en la
// ceremonia de alta cae justo en el paso posterior al prompt del autenticador.
describe("las lecturas no gastan el cupo de las escrituras", () => {
  async function proxyConIp() {
    process.env = {
      ...ORIGINAL,
      APP_ORIGIN: "https://shopping.example.com",
      TRUSTED_PROXY: "x-real-ip",
    };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  const IP = "1.2.3.4";
  function get(path: string) {
    return new NextRequest(`https://shopping.example.com${path}`, {
      headers: { "x-real-ip": IP },
    });
  }
  function post(path: string) {
    return new NextRequest(`https://shopping.example.com${path}`, {
      method: "POST",
      headers: { "x-real-ip": IP, "sec-fetch-site": "same-origin" },
    });
  }

  // Aislado del cupo: /api/ingest sigue en cinco, así que si lectura y escritura
  // compartieran contador, seis lecturas dejarían la escritura en 429 sin que
  // ningún límite haya cambiado de valor.
  it("seis lecturas de una ruta estricta de cinco no cortan la escritura siguiente", async () => {
    const proxy = await proxyConIp();
    for (let i = 0; i < 6; i += 1) {
      expect((await proxy(get("/api/ingest/voz"))).status).not.toBe(429);
    }
    expect((await proxy(post("/api/ingest/voz"))).status).not.toBe(429);
  });

  it("trece lecturas del alta tampoco cortan la escritura siguiente", async () => {
    const proxy = await proxyConIp();
    for (let i = 0; i < 13; i += 1) {
      expect((await proxy(get("/api/auth/webauthn/register"))).status).not.toBe(429);
    }
    expect((await proxy(post("/api/auth/webauthn/register?step=options"))).status).not.toBe(429);
  });

  it("la ceremonia entera más un reintento completo no se corta", async () => {
    const proxy = await proxyConIp();
    // Entrar con passkey, y desde Ajustes añadir otra: opciones de login, la
    // consulta de cómo confirmar, y los tres pasos del alta.
    const ceremonia = [
      post("/api/auth/webauthn/options"),
      get("/api/auth/webauthn/register"),
      post("/api/auth/webauthn/register?step=presence"),
      post("/api/auth/webauthn/register?step=options"),
      post("/api/auth/webauthn/register?step=verify"),
    ];
    for (const peticion of ceremonia) {
      expect((await proxy(peticion)).status).not.toBe(429);
    }
    // Un Face ID cancelado, una contraseña mal tecleada: se repite entera.
    const reintento = [
      post("/api/auth/webauthn/register?step=presence"),
      post("/api/auth/webauthn/register?step=options"),
      post("/api/auth/webauthn/register?step=verify"),
    ];
    for (const peticion of reintento) {
      expect((await proxy(peticion)).status).not.toBe(429);
    }
  });

  it("el alta y la entrada por passkey ya no comparten cubo", async () => {
    const proxy = await proxyConIp();
    for (let i = 0; i < 5; i += 1) {
      await proxy(post("/api/auth/webauthn/options"));
    }
    // El de login está en su tope; el del alta no ha gastado nada.
    expect((await proxy(post("/api/auth/webauthn/options"))).status).toBe(429);
    expect((await proxy(post("/api/auth/webauthn/register?step=verify"))).status).not.toBe(429);
  });

  it("las demás rutas estrictas conservan su cinco, y un sufijo no estrena cubo", async () => {
    const proxy = await proxyConIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await proxy(post(`/api/ingest/voz${i}`))).status).not.toBe(429);
    }
    expect((await proxy(post("/api/ingest/voz"))).status).toBe(429);
  });
});

/**
 * Waits for the boot announcement to appear rather than for a stopwatch.
 *
 * The line comes out of `void isClaimed()` — a promise nobody awaits — and that
 * promise opens a database connection. How long it takes is therefore a
 * property of the machine, not of the code: a cold pool on a loaded CI runner
 * is not a laptop with a warm one. The fixed 50 ms sleep that used to sit here
 * was a bet on that timing, and it lost roughly one run in four; a stranger's
 * first pull request would go red for something they had not touched.
 *
 * The ceiling is deliberately far larger than any plausible connection so that
 * reaching it means the announcement is genuinely never coming — a real
 * failure, not a slow moment. Reaching it costs nothing on the happy path,
 * where the loop exits on the first poll that sees the line.
 */
const SETUP_LINE_TIMEOUT_MS = 4_000;

/** Structural, so it fits any console spy without naming Vitest's mock types. */
type ConsoleSpy = { mock: { calls: unknown[][] } };

async function waitForSetupLine(info: ConsoleSpy, warn: ConsoleSpy): Promise<string | undefined> {
  const deadline = Date.now() + SETUP_LINE_TIMEOUT_MS;
  for (;;) {
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes("[setup]"));
    if (line) return line;
    // The proxy reports a failed announcement instead of swallowing it, so a
    // warning means the answer has already arrived and it is "no line". Waiting
    // out the ceiling for it would only make the failure slower to read.
    if (warn.mock.calls.some((c) => String(c[0]).includes("[setup]"))) return undefined;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("el token de instalación en el arranque", () => {
  afterEach(() => {
    vi.doUnmock("@/server/setup");
    vi.resetModules();
  });

  async function arranca(reclamada: boolean) {
    vi.doMock("@/server/setup", () => ({
      isClaimed: async () => reclamada,
      setupToken: () => "token-de-prueba",
    }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com" };
    const { proxy } = await import("./proxy.ts");
    await proxy(new NextRequest("https://shopping.example.com/favicon.ico"));
    // El aviso sale de una promesa sin await; un tick basta para que se resuelva.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return info;
  }

  it("sin dueño, el token se escribe en el log", async () => {
    const info = await arranca(false);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("token-de-prueba"));
    info.mockRestore();
  });

  it("ya reclamada, no se escribe: no hay nada que instalar", async () => {
    const info = await arranca(true);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  // Las dos de arriba doblan @/server/setup, que es precisamente el módulo cuya
  // duplicación era el defecto: no habrían visto nada. Ésta usa el módulo real y
  // comprueba lo único que importa — que el valor impreso es el que otra copia
  // del módulo acepta.
  it("el token impreso es el que acepta una copia distinta del módulo", async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL,
      APP_ORIGIN: "https://shopping.example.com",
      AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
      SETUP_TOKEN: undefined,
    };
    const { prisma } = await import("@/server/db");
    await prisma.webAuthnCredential.deleteMany();
    await prisma.user.deleteMany();
    await prisma.instanceSetup.upsert({
      where: { id: "singleton" },
      update: { claimedAt: null },
      create: { id: "singleton" },
    });

    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { proxy } = await import("./proxy.ts");
    await proxy(new NextRequest("https://shopping.example.com/favicon.ico"));

    const linea = await waitForSetupLine(info, warn);
    const fallo = warn.mock.calls.find((c) => String(c[0]).includes("[setup]"));
    info.mockRestore();
    warn.mockRestore();
    expect(linea, fallo ? `boot reported: ${fallo.map(String).join(" ")}` : undefined).toBeDefined();
    const impreso = linea!.split(": ")[1];

    // Otra instancia del módulo, como la que compila Next para las rutas.
    vi.resetModules();
    const otraCopia = await import("@/server/setup");
    expect(otraCopia.setupTokenMatches(impreso)).toBe(true);
    // Above the wait's own ceiling on purpose: when the announcement never
    // arrives the failure should be this test's assertion, naming what was
    // missing, and not the runner's generic timeout.
  }, 15_000);
});
