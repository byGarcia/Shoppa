import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkRouteCeiling,
  INSTANCE_CEILING_PER_MIN,
  MAX_FAILURES,
  isThrottled,
  recordFailure,
  recordSuccess,
  resetThrottleForTests,
  ROUTE_CEILING_PER_MIN,
  WINDOW_MS,
} from "./login-throttle.ts";

beforeEach(() => {
  vi.useFakeTimers();
  resetThrottleForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("freno por cuenta", () => {
  it("deja pasar los primeros fallos", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("ana@example.com")).toBe(false);
  });

  it("frena al llegar al máximo", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("ana@example.com")).toBe(true);
  });

  it("no arrastra a otra cuenta", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("luis@example.com")).toBe(false);
  });

  it("se suelta al pasar la ventana: es espera, no bloqueo permanente", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    vi.advanceTimersByTime(WINDOW_MS + 1);
    expect(isThrottled("ana@example.com")).toBe(false);
  });

  it("un acierto borra el contador", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) recordFailure("ana@example.com");
    recordSuccess("ana@example.com");
    recordFailure("ana@example.com");
    expect(isThrottled("ana@example.com")).toBe(false);
  });
});

describe("techo de la instancia", () => {
  it("frena todo cuando los fallos por minuto se disparan, aunque sean de cuentas distintas", () => {
    for (let i = 0; i < INSTANCE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    expect(isThrottled("nueva@example.com")).toBe(true);
  });

  it("no deja fuera a quien ya ha entrado alguna vez: el techo no es un cierre global", () => {
    recordSuccess("ana@example.com");
    for (let i = 0; i < INSTANCE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    expect(isThrottled("ana@example.com")).toBe(false);
    expect(isThrottled("nadie@example.com")).toBe(true);
  });

  it("normaliza la clave, o cambiar mayúsculas estrenaría contador", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("  Ana@Example.com  ")).toBe(true);
  });

  it("no crece sin límite: con el mapa lleno de entradas vivas, deja de admitir claves nuevas", () => {
    for (let i = 0; i < 10_000; i += 1) recordFailure(`relleno${i}@example.com`);
    // Se pasa el minuto para que el relleno no deje el techo de la instancia
    // enganchado: sin esto, isThrottled cortaría por el techo y el test no
    // llegaría a mirar el mapa, que es lo que quiere medir. Quince minutos no
    // han pasado, así que las 10.000 entradas siguen vivas y el mapa, lleno.
    vi.advanceTimersByTime(60_000 + 1);
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("desbordante@example.com");
    expect(isThrottled("desbordante@example.com")).toBe(false);

    // Y que ese false venga del tope y no de otra casualidad: en cuanto el mapa
    // se vacía al caducar la ventana, los mismos cinco fallos sí frenan.
    vi.advanceTimersByTime(WINDOW_MS + 1);
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("desbordante@example.com");
    expect(isThrottled("desbordante@example.com")).toBe(true);
  });

  it("el techo se suelta al minuto", () => {
    for (let i = 0; i < INSTANCE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    vi.advanceTimersByTime(60_000 + 1);
    expect(isThrottled("nueva@example.com")).toBe(false);
  });
});

describe("techo por ruta", () => {
  it("deja pasar hasta el tope y corta la siguiente", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) {
      expect(checkRouteCeiling("/api/ingest")).toBe(true);
    }
    expect(checkRouteCeiling("/api/ingest")).toBe(false);
  });

  it("cada ruta lleva su propia cuenta", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) checkRouteCeiling("/api/ingest");
    expect(checkRouteCeiling("/login")).toBe(true);
  });

  it("se suelta al minuto: el hogar no se queda sin voz para siempre", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) checkRouteCeiling("/api/ingest");
    expect(checkRouteCeiling("/api/ingest")).toBe(false);
    vi.advanceTimersByTime(60_000 + 1);
    expect(checkRouteCeiling("/api/ingest")).toBe(true);
  });

  it("es un techo compartido: no depende de quién llame", () => {
    // No hay clave de llamante en juego; el mismo contador lo agotan visitantes
    // distintos, que es justo lo que lo hace infalsificable por cabecera.
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) checkRouteCeiling("/login");
    expect(checkRouteCeiling("/login")).toBe(false);
  });

  it("no lo toca el freno por cuenta", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    expect(checkRouteCeiling("/login")).toBe(true);
  });
});
