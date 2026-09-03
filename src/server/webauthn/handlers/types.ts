import type { NextResponse } from "next/server";

type Awaitable<T> = T | Promise<T>;

export interface AuthenticatedSession {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
  };
}

export interface WebAuthnHandlerDeps {
  /** Return the authenticated session or throw an ApiError(401) if unauthenticated. */
  getAuthSession: () => Promise<AuthenticatedSession>;
  /**
   * Return the session, or null when there is none. Registration needs to
   * *ask* whether a session exists rather than demand one: it accepts exactly
   * one form of authority — a session, a setup token or an invitation — and
   * having to distinguish "no session" from "session" is what lets it refuse a
   * request that carries two, instead of quietly falling back to the weaker.
   */
  getOptionalAuthSession: () => Promise<AuthenticatedSession | null>;
  /**
   * Map an unknown error to a NextResponse. Context string is optional.
   *
   * The response may arrive as a promise: the real implementation reads the
   * message from the request's catalog. Declared as either so that the test
   * doubles, which have nothing to translate, can stay synchronous.
   */
  handleApiError: (error: unknown, context?: string) => Awaitable<NextResponse>;
  /** Typed application error with an HTTP status code. */
  ApiError: new (message: string, statusCode?: number) => Error & { statusCode: number };
  /** Standardised JSON response helpers. */
  ApiResponse: {
    success: <T>(data: T) => NextResponse;
    /** 401 response — used by withAuthParams-style handlers when auth fails. */
    unauthorized: () => Awaitable<NextResponse>;
    /** 400 response with a human message. */
    badRequest: (message?: string) => Awaitable<NextResponse>;
  };
}
