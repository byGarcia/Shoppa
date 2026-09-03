import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  nextRunAt,
  parseCron,
  previousRunAt,
  shouldSchedule,
  startPriceScheduler,
  stopPriceScheduler,
} from "./scheduler.ts";

// La pasada real toca la base de datos; aquí sólo interesa que el planificador
// la llame y que sobreviva a que falle.
const SIN_PROBLEMAS = {
  checked: 3,
  skipped: 0,
  alerts: 0,
  notified: 0,
  failures: 0,
  pending: 0,
  telegramConfigured: true,
};
const runPriceCheck = vi.hoisted(() =>
  vi.fn(async (): Promise<Record<string, unknown>> => ({
    checked: 3,
    skipped: 0,
    alerts: 0,
    notified: 0,
    failures: 0,
    pending: 0,
    telegramConfigured: true,
  })),
);
// Por defecto, una casa sin nada que seguir: así el arranque no dispara ninguna
// recuperación y las pruebas del temporizador miden sólo el temporizador.
const runHistory = vi.hoisted(() =>
  vi.fn(async (): Promise<{ activeProducts: number; lastCheckedAt: Date | null }> => ({
    activeProducts: 0,
    lastCheckedAt: null,
  })),
);
vi.mock("@/lib/price-service", () => ({ runPriceCheck, runHistory }));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.APP_ORIGIN = "https://a.example";
  runPriceCheck.mockClear();
  runPriceCheck.mockImplementation(async () => ({ ...SIN_PROBLEMAS }));
  runHistory.mockClear();
  runHistory.mockImplementation(async () => ({ activeProducts: 0, lastCheckedAt: null }));
});

afterEach(() => {
  stopPriceScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL };
});

describe("planificador", () => {
  it("no programa nada con off", () => {
    process.env.PRICE_CHECK_CRON = "off";
    expect(shouldSchedule()).toBe(false);
  });

  it("programa por defecto a las ocho", () => {
    delete process.env.PRICE_CHECK_CRON;
    expect(shouldSchedule()).toBe(true);
  });

  it("interpreta la hora en la zona de TZ, no en UTC", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Europe/Madrid";
    const from = new Date("2026-09-02T00:00:00Z");
    // En horario de verano peninsular, las 08:00 locales son las 06:00 UTC.
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T06:00:00.000Z");
  });

  it("una expresión ilegible impide arrancar en vez de no hacer nada en silencio", () => {
    process.env.PRICE_CHECK_CRON = "todos los días";
    expect(() => nextRunAt(new Date())).toThrow(/PRICE_CHECK_CRON/);
  });
});

describe("la zona horaria", () => {
  it("la misma expresión cae en instantes distintos según TZ", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    const from = new Date("2026-09-02T00:00:00Z");

    process.env.TZ = "UTC";
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T08:00:00.000Z");

    process.env.TZ = "America/New_York";
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T12:00:00.000Z");

    process.env.TZ = "Asia/Tokyo";
    // Las 08:00 de Tokio del día 2 ya han pasado a las 00:00 UTC del día 2.
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T23:00:00.000Z");
  });

  it("sin TZ un contenedor razona en UTC", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    delete process.env.TZ;
    const from = new Date("2026-09-02T00:00:00Z");
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T08:00:00.000Z");
  });

  it("cruza el cambio de hora sin desplazar la cita", () => {
    // Madrid pasa de UTC+2 a UTC+1 la madrugada del 25 de octubre de 2026.
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Europe/Madrid";
    expect(nextRunAt(new Date("2026-10-24T08:00:00Z")).toISOString()).toBe(
      "2026-10-25T07:00:00.000Z",
    );
  });

  it("una hora que ese día no existe se salta, no se adelanta ni se atrasa", () => {
    // La madrugada del 28 de marzo de 2027 Madrid salta de las 02:00 a las
    // 03:00: ese día no hay ninguna 02:00. Una cita a esa hora tiene que
    // esperar al día siguiente, que en UTC son las 00:00 del 29.
    process.env.PRICE_CHECK_CRON = "0 2 * * *";
    process.env.TZ = "Europe/Madrid";
    expect(nextRunAt(new Date("2027-03-27T12:00:00Z")).toISOString()).toBe(
      "2027-03-29T00:00:00.000Z",
    );
  });

  it("una TZ inexistente falla nombrando la variable", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Marte/Olympus";
    expect(() => nextRunAt(new Date("2026-09-02T00:00:00Z"))).toThrow(/TZ/);
  });
});

describe("el subconjunto de cron que se acepta", () => {
  it("admite el comodín en minuto y hora", () => {
    expect(parseCron("* * * * *").minutes).toHaveLength(60);
    expect(parseCron("* * * * *").hours).toHaveLength(24);
  });

  it("admite enteros", () => {
    expect(parseCron("30 6 * * *")).toEqual({ minutes: [30], hours: [6] });
  });

  it("admite pasos", () => {
    expect(parseCron("0 */6 * * *")).toEqual({ minutes: [0], hours: [0, 6, 12, 18] });
    expect(parseCron("*/15 8 * * *")).toEqual({ minutes: [0, 15, 30, 45], hours: [8] });
  });

  it("cada seis horas cae seis horas después, no al día siguiente", () => {
    process.env.PRICE_CHECK_CRON = "0 */6 * * *";
    process.env.TZ = "UTC";
    expect(nextRunAt(new Date("2026-09-02T07:13:00Z")).toISOString()).toBe(
      "2026-09-02T12:00:00.000Z",
    );
  });

  it("rechaza rangos y listas, que no se implementan", () => {
    expect(() => parseCron("0 8-10 * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0,30 8 * * *")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("rechaza el día del mes, el mes y el día de la semana distintos de *", () => {
    expect(() => parseCron("0 8 1 * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 8 * 3 *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 8 * * 1")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("rechaza valores fuera de rango", () => {
    expect(() => parseCron("60 8 * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 24 * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("*/0 8 * * *")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("rechaza un número de campos que no sea cinco", () => {
    expect(() => parseCron("0 8 * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 8 * * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("perdona los espacios de sobra, que es un desliz al escribir y no otra intención", () => {
    expect(parseCron("  0   8  *  *  * ")).toEqual({ minutes: [0], hours: [8] });
  });
});

describe("el temporizador", () => {
  it("con off no arma nada", () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T00:00:00Z") });
    process.env.PRICE_CHECK_CRON = "off";
    startPriceScheduler();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispara la pasada cuando llega la hora", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    expect(runPriceCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(61_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a disparar hasta la cita siguiente", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(21 * 60 * 60 * 1000);
    expect(runPriceCheck).toHaveBeenCalledTimes(2);
  });

  it("si la pasada revienta, mañana se vuelve a intentar", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runPriceCheck.mockRejectedValue(new Error("la base de datos no responde"));

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();

    // El temporizador sigue vivo: un mal día no cancela el calendario.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(runPriceCheck).toHaveBeenCalledTimes(2);
  });

  it("dos arranques no apilan dos planificadores", () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T00:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    const armados = vi.getTimerCount();
    startPriceScheduler();
    startPriceScheduler();
    expect(vi.getTimerCount()).toBe(armados);
  });

  it("una expresión ilegible no arma nada y lo dice por el log", () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T00:00:00Z") });
    process.env.PRICE_CHECK_CRON = "todos los días";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    startPriceScheduler();

    expect(vi.getTimerCount()).toBe(0);
    expect(error.mock.calls.flat().join(" ")).toMatch(/PRICE_CHECK_CRON/);
  });
});

describe("la cita que ya pasó", () => {
  it("previousRunAt mira hacia atrás en la zona de TZ", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Europe/Madrid";
    // A las 09:00 de Madrid, la cita de las 08:00 acaba de pasar.
    expect(previousRunAt(new Date("2026-09-02T07:00:00Z")).toISOString()).toBe(
      "2026-09-02T06:00:00.000Z",
    );
    // A las 07:00 de Madrid, la última fue la de ayer.
    expect(previousRunAt(new Date("2026-09-02T05:00:00Z")).toISOString()).toBe(
      "2026-09-01T06:00:00.000Z",
    );
  });

  it("un contenedor que arranca tarde recupera la pasada que se perdió", async () => {
    // Reinicio de madrugada, primera petición a las 09:00: la cita de las 08:00
    // pasó mientras no había nadie escuchando y nadie la habría echado en falta.
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    runHistory.mockResolvedValue({
      activeProducts: 4,
      lastCheckedAt: new Date("2026-09-01T08:00:12Z"),
    });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).toHaveBeenCalledTimes(1);
  });

  it("si la pasada de hoy ya se hizo, no se repite al arrancar", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    runHistory.mockResolvedValue({
      activeProducts: 4,
      lastCheckedAt: new Date("2026-09-02T08:00:31Z"),
    });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it("arrancar ANTES de la cita no la adelanta", async () => {
    // Lo que separa «recuperar lo perdido» de «comprobar en cada arranque».
    vi.useFakeTimers({ now: new Date("2026-09-02T07:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    runHistory.mockResolvedValue({
      activeProducts: 4,
      lastCheckedAt: new Date("2026-09-01T08:00:07Z"),
    });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it("sin productos que seguir no se recupera nada", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    runHistory.mockResolvedValue({ activeProducts: 0, lastCheckedAt: null });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it("con off no se recupera nada tampoco", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "off";
    runHistory.mockResolvedValue({ activeProducts: 4, lastCheckedAt: null });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
    expect(runHistory).not.toHaveBeenCalled();
  });

  it("si la base de datos no contesta, el calendario sigue armado", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runHistory.mockRejectedValue(new Error("la base de datos aún no está arriba"));

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(error).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});

describe("dos pasadas a la vez", () => {
  it("una cita que llega con la anterior en curso se salta", async () => {
    // La gramática admite «cada minuto» y una pasada puede durar más de uno.
    // Dos solapadas leerían el mismo lastCheckedAt rancio y volverían a avisar
    // de la misma bajada.
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:30Z") });
    process.env.PRICE_CHECK_CRON = "* * * * *";
    process.env.TZ = "UTC";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runPriceCheck.mockImplementation(() => new Promise(() => {}));

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(runPriceCheck).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/previous pass is still running/);
  });

  it("cuando la anterior termina, la cita siguiente vuelve a disparar", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:30Z") });
    process.env.PRICE_CHECK_CRON = "* * * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(2);
  });
});

describe("lo que dice el log al terminar", () => {
  async function pasadaCon(summary: Record<string, unknown>) {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runPriceCheck.mockResolvedValue({ ...SIN_PROBLEMAS, ...summary });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(61_000);
    return { info, warn };
  }

  it("una pasada limpia es una línea informativa", async () => {
    const { info, warn } = await pasadaCon({});
    expect(info.mock.calls.flat().join(" ")).toMatch(/daily pass finished/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("productos que no se han podido leer no pasan por informativos", async () => {
    const { warn } = await pasadaCon({ checked: 40, failures: 40 });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/40 product\(s\) could not be read/);
  });

  it("media lista sin comprobar tampoco", async () => {
    const { warn } = await pasadaCon({ pending: 22 });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/22 left unchecked/);
  });

  it("avisos que no llegan a nadie tampoco, y dice que Telegram no está puesto", async () => {
    const { warn } = await pasadaCon({ alerts: 3, notified: 0, telegramConfigured: false });
    const texto = warn.mock.calls.flat().join(" ");
    expect(texto).toMatch(/3 of 3 alert\(s\) not delivered/);
    expect(texto).toMatch(/Telegram is not configured/);
  });
});
