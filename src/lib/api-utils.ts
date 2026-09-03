import { NextResponse } from "next/server";
import { auth } from "./auth";
import { apiText, translateIssue } from "./api-messages";
import { Prisma } from "@/server/db";
import { z } from "zod";

// ============================================================================
// TYPES
// ============================================================================

export interface AuthenticatedSession {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
  };
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Check authentication and return either the session or an error response.
 */
export async function requireAuth(): Promise<
  | { success: true; session: AuthenticatedSession }
  | { success: false; response: NextResponse }
> {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      success: false,
      response: await ApiResponse.unauthorized(),
    };
  }

  return {
    success: true,
    session: session as AuthenticatedSession,
  };
}

/**
 * The authenticated session. Throws when there is none.
 */
export async function getAuthSession(): Promise<AuthenticatedSession> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new ApiError(await apiText("unauthorized"), 401);
  }

  return session as AuthenticatedSession;
}

/**
 * The authenticated session, or null. Unlike getAuthSession it does not throw:
 * passkey registration has to be able to ask whether there is a session, so it
 * can refuse a request that brings two kinds of authority at once.
 */
export async function getOptionalAuthSession(): Promise<AuthenticatedSession | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session as AuthenticatedSession;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Error personalizado para APIs
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Maneja errores y retorna una respuesta apropiada
 */
export async function handleApiError(error: unknown, context?: string): Promise<NextResponse> {
  // Log without the payload. A Prisma error carries the offending row in
  // `meta` — an item name, an email address, a tracked product's URL — so
  // logging the raw error copies the household's own data into the container
  // log, where it is read by whoever runs `docker compose logs`. ApiError
  // carries only the human message, which is safe to keep.
  const safeError = redactErrorForLog(error);
  if (context) {
    console.error(`Error in ${context}:`, safeError);
  } else {
    console.error("API error:", safeError);
  }

  // Error personalizado de la API
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    );
  }

  // Validation error from Zod — surface as 400 instead of leaking 500.
  if (error instanceof z.ZodError) {
    return ApiResponse.badRequest(
      (await translateIssue(error.issues[0]?.message)) ?? (await apiText("invalidData")),
    );
  }

  // Errores de Prisma
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return handlePrismaError(error);
  }


  // Anything else: never expose internal detail in production.
  const isProduction = process.env.NODE_ENV === "production";
  const message =
    isProduction || !(error instanceof Error)
      ? await apiText("internalError")
      : error.message;

  return NextResponse.json({ error: message }, { status: 500 });
}

/** Strip PII-bearing fields before sending an error to the logger. */
function redactErrorForLog(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      name: error.name,
      code: error.code,
      clientVersion: error.clientVersion,
      message: error.message,
    };
  }
  if (error instanceof ApiError) {
    return { name: error.name, statusCode: error.statusCode, message: error.message };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return error;
}

/**
 * Prisma's own error codes, mapped to status codes.
 */
async function handlePrismaError(
  error: Prisma.PrismaClientKnownRequestError
): Promise<NextResponse> {
  switch (error.code) {
    case "P2025":
      // Record not found
      return NextResponse.json(
        { error: await apiText("notFoundGeneric"), code: "NOT_FOUND" },
        { status: 404 }
      );
    case "P2002":
      // Unique constraint violation
      return NextResponse.json(
        { error: await apiText("duplicate"), code: "DUPLICATE" },
        { status: 409 }
      );
    case "P2003":
      // Foreign key constraint violation
      return NextResponse.json(
        { error: await apiText("invalidReference"), code: "INVALID_REFERENCE" },
        { status: 400 }
      );
    case "P2014":
      // Required relation violation
      return NextResponse.json(
        {
          error: await apiText("relationViolation"),
          code: "RELATION_VIOLATION",
        },
        { status: 400 }
      );
    default:
      return NextResponse.json(
        { error: await apiText("databaseError"), code: error.code },
        { status: 500 }
      );
  }
}



// ============================================================================
// STANDARDIZED RESPONSES
// ============================================================================

// Authenticated responses must never be cached by any intermediary, must vary
// by Cookie, and must not be embedded by other origins. Funnelling every
// helper through this builder enforces that without each route having to
// remember.
function jsonResponse(body: unknown, status: number): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, private");
  res.headers.set("Vary", "Cookie");
  return res;
}

export const ApiResponse = {
  /**
   * Respuesta exitosa con datos
   */
  success: <T>(data: T, status: number = 200): NextResponse => {
    return jsonResponse(data, status);
  },

  /**
   * Created (201).
   */
  created: <T>(data: T): NextResponse => {
    return jsonResponse(data, 201);
  },

  /**
   * Any error, with the status and code the caller chooses.
   */
  error: (
    message: string,
    status: number = 500,
    code?: string
  ): NextResponse => {
    return jsonResponse({ error: message, ...(code && { code }) }, status);
  },

  /**
   * Respuesta 404 - No encontrado
   */
  notFound: async (entity?: string): Promise<NextResponse> => {
    return jsonResponse(
      {
        error: await apiText("notFound", { entity: entity ?? (await apiText("resource")) }),
        code: "NOT_FOUND",
      },
      404
    );
  },

  /**
   * Respuesta 401 - No autorizado
   */
  unauthorized: async (): Promise<NextResponse> => {
    return jsonResponse(
      { error: await apiText("unauthorized"), code: "UNAUTHORIZED" },
      401
    );
  },

  /**
   * Bad request (400).
   */
  badRequest: async (message?: string): Promise<NextResponse> => {
    return jsonResponse(
      { error: message ?? (await apiText("badRequest")), code: "BAD_REQUEST" },
      400
    );
  },

  /**
   * Respuesta 409 - Conflicto
   */
  conflict: async (message?: string): Promise<NextResponse> => {
    return jsonResponse(
      { error: message ?? (await apiText("conflict")), code: "CONFLICT" },
      409
    );
  },

  /**
   * Deleted (200).
   */
  deleted: (): NextResponse => {
    return jsonResponse({ success: true }, 200);
  },
};

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Valida el body de una request contra un schema Zod
 * Retorna los datos validados o una respuesta de error
 */
export async function validateRequest<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);

    if (!result.success) {
      const errors = (
        await Promise.all(result.error.issues.map((e) => translateIssue(e.message)))
      )
        .filter((message): message is string => Boolean(message))
        .join(", ");
      return {
        success: false,
        response: await ApiResponse.badRequest(errors),
      };
    }

    return { success: true, data: result.data };
  } catch {
    return {
      success: false,
      response: await ApiResponse.badRequest(await apiText("invalidJson")),
    };
  }
}

/**
 * Pull the id out of the route params and validate it.
 */
export async function getRouteId(
  params: Promise<{ id: string }>
): Promise<string> {
  const { id } = await params;
  if (!id) {
    throw new ApiError(await apiText("idRequired"), 400);
  }
  return id;
}

// ============================================================================
// ROUTE WRAPPER (OPTIONAL)
// ============================================================================

// Internal helper that all wrappers use
async function withAuthBase<P extends Record<string, string> = { id: string }>(
  request: Request | null,
  params: Promise<P> | null,
  handler: (request: Request | null, session: AuthenticatedSession, params: Promise<P> | null) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) return authResult.response;
    return await handler(request, authResult.session, params);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * API route wrapper: authentication plus error handling.
 *
 * @example
 * export const GET = withAuth(async (session) => {
 *   const data = await prisma.model.findMany({ where: { userId: session.user.id } });
 *   return ApiResponse.success({ data });
 * });
 */
export function withAuth(
  handler: (session: AuthenticatedSession) => Promise<NextResponse>
) {
  return async (): Promise<NextResponse> => {
    return withAuthBase(null, null, (_req, session) => handler(session));
  };
}

/**
 * API route wrapper with the request: authentication plus error handling.
 *
 * @example
 * export const POST = withAuthRequest(async (request, session) => {
 *   const body = await request.json();
 *   const data = await prisma.model.create({ data: { ...body, userId: session.user.id } });
 *   return ApiResponse.created({ data });
 * });
 */
export function withAuthRequest(
  handler: (
    request: Request,
    session: AuthenticatedSession
  ) => Promise<NextResponse>
) {
  return async (request: Request): Promise<NextResponse> => {
    return withAuthBase(request, null, (req, session) => handler(req!, session));
  };
}

/**
 * API route wrapper with route params: authentication plus error handling.
 *
 * @example
 * export const GET = withAuthParams(async (session, params) => {
 *   const id = await getRouteId(params);
 *   const data = await prisma.model.findUnique({ where: { id, userId: session.user.id } });
 *   return data ? ApiResponse.success({ data }) : ApiResponse.notFound();
 * });
 */
export function withAuthParams<P extends Record<string, string> = { id: string }>(
  handler: (
    session: AuthenticatedSession,
    params: Promise<P>
  ) => Promise<NextResponse>
) {
  return async (
    _request: Request,
    context: { params: Promise<P> }
  ): Promise<NextResponse> => {
    return withAuthBase(null, context.params, (_req, session, params) => handler(session, params!));
  };
}

/**
 * API route wrapper with request and route params: authentication plus error
 * handling.
 *
 * @example
 * export const PUT = withAuthRequestParams(async (request, session, params) => {
 *   const id = await getRouteId(params);
 *   const body = await request.json();
 *   const data = await prisma.model.update({ where: { id }, data: body });
 *   return ApiResponse.success({ data });
 * });
 */
export function withAuthRequestParams<P extends Record<string, string> = { id: string }>(
  handler: (
    request: Request,
    session: AuthenticatedSession,
    params: Promise<P>
  ) => Promise<NextResponse>
) {
  return async (
    request: Request,
    context: { params: Promise<P> }
  ): Promise<NextResponse> => {
    return withAuthBase(request, context.params, (req, session, params) => handler(req!, session, params!));
  };
}
