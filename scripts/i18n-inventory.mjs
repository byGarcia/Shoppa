/**
 * The i18n worklist.
 *
 * Parses every `src/**\/*.ts` and `src/**\/*.tsx` with the TypeScript compiler
 * that already ships in this repository and reports every string literal,
 * template chunk and JSX text node it finds. It walks `.ts` as well as `.tsx`
 * because copy does not only appear as JSX: `src/app/ajustes/atajo/page.tsx`
 * keeps its instructions in an array of plain strings, and toast messages and
 * validation text live in plain modules. A `.tsx`-only sweep reports those
 * files as clean and they are not.
 *
 * It is deliberately over-inclusive. Static analysis cannot tell a label from a
 * cache key, and the failure that costs a day is the one it stays quiet about.
 * The narrowing is done by the exclusion list below — rules a human reads and
 * signs off, not clever heuristics. Anything no rule covers stays in the report
 * and is decided by hand.
 *
 * Usage:
 *   node scripts/i18n-inventory.mjs           # writes i18n-inventory.json, prints counts
 *   node scripts/i18n-inventory.mjs --list    # also prints the surviving literals
 *
 * Exit code is 0 always: this is an inventory, not the gate. The gate is
 * scripts/check-i18n.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");

// ---------------------------------------------------------------------------
// Exclusion rules
//
// Each rule says what it exempts and why. They are applied in order; the first
// match wins and is recorded in the report, so every excluded literal can be
// traced back to the sentence that let it through.
// ---------------------------------------------------------------------------

/**
 * Files that hold no interface copy at all.
 *
 * - `src/generated/`: the Prisma client, written by `prisma generate`. Not ours
 *   to edit and regenerated on every schema change.
 * - `*.test.ts` / `*.test.tsx`: test descriptions are Spanish on purpose (a
 *   project convention) and fixtures deliberately hold literal copy to assert
 *   against.
 * - `src/i18n/`: the wiring that loads the catalogs; the locale codes in it are
 *   identifiers, not copy.
 *
 * `lib/env.ts` used to be exempt here as well, for boot messages that were
 * Spanish. They are English now, and operator-facing text is English by
 * convention rather than translated, so the exemption came out — the same one
 * that came out of scripts/check-i18n.mjs, and for the same reason. The rule
 * that still covers those strings is `console-argument` further down, which is
 * about the audience rather than about a path.
 */
const EXCLUDED_PATHS = [
  { rule: "path:generated", test: (f) => f.startsWith("generated/") },
  { rule: "path:test", test: (f) => /\.test\.tsx?$/.test(f) },
  { rule: "path:i18n", test: (f) => f.startsWith("i18n/") },
];

/**
 * JSX attributes whose value is never user-visible prose: styling, wiring,
 * input semantics and test hooks. Deliberately a list of names rather than a
 * pattern, because the copy-bearing attributes sit right next to them —
 * `placeholder`, `title`, `alt`, `aria-label`, `aria-description` and
 * `aria-placeholder` are NOT here and never will be.
 */
const NON_COPY_JSX_ATTRIBUTES = new Set([
  "className",
  "class",
  "id",
  "htmlFor",
  "href",
  "src",
  "srcSet",
  "rel",
  "target",
  "type",
  "name",
  "key",
  "role",
  "value",
  "defaultValue",
  "autoComplete",
  "autoCapitalize",
  "autoCorrect",
  "spellCheck",
  "inputMode",
  "enterKeyHint",
  "pattern",
  "accept",
  "method",
  "action",
  "encType",
  "charSet",
  "lang",
  "dir",
  "width",
  "height",
  "viewBox",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "d",
  "xmlns",
  "media",
  "content",
  "property",
  "loading",
  "decoding",
  "referrerPolicy",
  "crossOrigin",
  "as",
  "sizes",
  "color",
  "position",
  "variant",
  "size",
  "tone",
  "aria-live",
  "aria-hidden",
  "aria-current",
  "aria-pressed",
  "aria-checked",
  "aria-busy",
  "aria-modal",
  "aria-orientation",
  "aria-controls",
  "aria-labelledby",
  "aria-describedby",
  "data-theme",
  "data-testid",
]);

/**
 * Call targets whose string arguments are keys, URLs or protocol constants.
 * Same reasoning as the attribute list: named, not guessed. `t()` is here so
 * that already-extracted message keys stop showing up as work still to do.
 */
const NON_COPY_CALLEES = new Set([
  "t",
  "markup",
  "has",
  "RegExp",
  "isUniqueViolation",
  "createHmac",
  "update",
  "tCat",
  "getTranslations",
  "useTranslations",
  "fetch",
  "fetchJson",
  "require",
  "import",
  "getItem",
  "setItem",
  "removeItem",
  "get",
  "set",
  "has",
  "delete",
  "getAll",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getAttribute",
  "setAttribute",
  "removeAttribute",
  "addEventListener",
  "removeEventListener",
  "matchMedia",
  "createElement",
  "revalidatePath",
  "revalidateTag",
  "redirect",
  "push",
  "replace",
  "prefetch",
  "enum",
  "literal",
  "startsWith",
  "endsWith",
  "includes",
  "split",
  "join",
  "normalize",
  "toLowerCase",
  "toUpperCase",
  "localeCompare",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleString",
  "toFixed",
  "NumberFormat",
  "DateTimeFormat",
  "Intl",
]);

/**
 * This installation's environment variables, by name.
 *
 * A message that names one is addressed to whoever wrote the compose file: it
 * is thrown at boot or returned to a machine, and it is read in the container
 * log, never on a screen. Listed explicitly rather than matched by shape so
 * that adding a variable is a decision somebody makes on purpose.
 *
 * Naming a variable is not enough on its own. The first version excluded any
 * literal that merely mentioned one anywhere inside it, which hid two rendered
 * `<li>` lines of the Telegram guide ("TELEGRAM_CHAT_ID = el chat donde quieres
 * los avisos.") and would have hidden the toast that lists the missing
 * variables. Those were extracted because those files were worked whole, which
 * is luck, not a rule. So the name must also sit somewhere that cannot reach a
 * screen — see `isEnvDiagnostic`.
 */
const ENV_VARS =
  /\b(APP_ORIGIN|AUTH_MODE|AUTH_SECRET|DATABASE_URL|N8N_API_KEY|TRUSTED_PROXY|PRICE_FETCH_MODE|WEBAUTHN_RP_ID|WEBAUTHN_ORIGIN|TELEGRAM_[A-Z_]+|SETUP_TOKEN)\b/;

/** SQL. The database speaks one language and it is not Spanish. */
const SQL = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE|RETURNING)\b/;

/**
 * Content-Security-Policy directives, assembled in src/proxy.ts. A grammar of
 * the web platform, not prose.
 */
const CSP = /^(default|script|style|img|font|connect|manifest|worker|frame|object|media|child)-src\s|^(frame-ancestors|base-uri|form-action)\s/;

/**
 * Cookie and header attributes: `; path=/`, `max-age=…; includeSubDomains`.
 * Fragments of a Set-Cookie or Strict-Transport-Security value.
 */
const HEADER_ATTRIBUTES = /^[;\s]*(path|max-age|samesite|secure|httponly|expires|domain|includeSubDomains|preload)\b/i;

/**
 * Codes: SCREAMING_SNAKE event names, Prisma error codes, currency and
 * algorithm identifiers — LOGIN_FAILED, NOT_FOUND, EUR, HS256. Written in
 * capitals precisely because they are values a machine compares, and no copy
 * in this app is shouted.
 */
const CONSTANT_CODE = /^[A-Z][A-Z0-9_]+$/;

/**
 * A single token with no spaces and at least one separator: hostnames, cookie
 * names, meta property names, storage keys, slugs. A sentence in any language
 * has a space in it; these never do.
 */
const TOKEN_LITERAL = /^[.A-Za-z0-9_@][\w@.:/=+-]*[.:/_=-][\w@.:/=+-]*$/;

/** An HTML tag on its own — the markup a rich-text message is given back. */
const BARE_TAG = /^<\/?[a-z][a-z0-9]*>$/;

/** Route labels the security log records: "POST /api/setup". */
const TELEMETRY_ROUTE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//;

/**
 * Text that carries no language: empty strings and whitespace, digits and
 * units, punctuation, separators and lone emoji. `"🧺"` is the app's basket
 * glyph and reads the same in every language; `"🔑 Entrar con passkey"` is copy
 * and does not match this rule, because it has letters in it.
 */
const NON_LINGUISTIC = /^[^\p{L}]*$/u;

/**
 * Route paths, file paths and URLs. Anchored on the leading slash, dot or
 * scheme so that a sentence which merely contains a slash is not swallowed.
 */
const PATH_LIKE = /^(\.{0,2}\/[\w\-./[\]:?=&%#]*|https?:\/\/\S*|mailto:\S*|data:\S*)$/;

/**
 * Identifier-shaped values: ids, slugs, CSS class names, route segments, query
 * keys, cache keys, enum members. The rule the brief names. Kept strict —
 * lowercase, digits and hyphens only — so that a one-word Spanish label like
 * `"Correo"` (capitalised) or `"por súper"` (spaced, accented) cannot slip
 * through it. Single lowercase Spanish words that ARE copy would match, so this
 * rule only applies in identifier positions (see `isIdentifierPosition`).
 */
const IDENTIFIER_LIKE = /^[a-z][A-Za-z0-9_-]*$/;

/**
 * CSS values: custom properties, colours, lengths, shorthand declarations.
 *
 * Every alternative is anchored at BOTH ends unless it deliberately scans the
 * middle of the string. The first version left `[\d.]+` and the hex colour
 * unanchored, and since the whole pattern only anchors the start, they matched
 * any literal that merely BEGAN with a digit or a dot. That hid all six
 * numbered headings of the two guide pages — "1 · El bot", "3 · Inyectar las
 * variables" — and the tail ". Escríbelo a mano y lo intentaré cada mañana.".
 * One of them was then changed without the worklist ever naming it. A rule that
 * silently swallows copy is worse than no rule.
 */
const CSS_LIKE =
  /^(var\(--[\w-]+\)$|#[0-9a-fA-F]{3,8}$|((-?[\d.]+(px|rem|em|%|vh|vw|dvh|s|ms|deg|fr)\s*)+$)|[\d.]+$|.*var\(--[\w-]+\).*|color-mix\(.*|.*\d+%,\s*transparent\).*|\(prefers-color-scheme:.*|(light|dark|auto|none|inherit|initial|unset|hidden|visible|block|flex|grid|inline|absolute|relative|fixed|sticky|static|center|start|end|left|right|top|bottom|row|column|nowrap|wrap|pointer|default|button|submit|text|password|email|search|tel|url|number|checkbox|radio|cover|contain)$)/;

/** HTTP verbs, header names and media types. */
const PROTOCOL_LIKE =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Content-Type|Authorization|Accept|Accept-Language|Cookie|Set-Cookie|User-Agent|Cache-Control|Vary|application\/[\w.+-]+|text\/[\w.+-]+|image\/[\w.+-]+|multipart\/[\w.+-]+|no-store[\w,\s-]*|utf-?8|UTF-?8|HTTP\s*|Forbidden|Unauthorized|Not Found|Too Many Requests)$/i;

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

/** `"use client"`, `"use server"` and friends: directives, not text. */
function isDirective(node) {
  const p = node.parent;
  return (
    p &&
    ts.isExpressionStatement(p) &&
    p.parent &&
    (ts.isSourceFile(p.parent) || ts.isBlock(p.parent) || ts.isModuleBlock(p.parent)) &&
    p.expression === node
  );
}

/** Module specifiers: `import x from "…"`, `export … from "…"`, `import("…")`. */
function isModuleSpecifier(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return p.moduleSpecifier === node;
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isImportTypeNode(p) || ts.isExternalModuleReference(p)) return true;
  return false;
}

/**
 * Object keys and property names — `{ "Content-Type": … }`, `obj["cache-key"]`,
 * interface members. The name of a slot is not the text in it.
 */
function isPropertyName(node) {
  const p = node.parent;
  if (!p) return false;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isGetAccessor(p) ||
      ts.isSetAccessor(p)) &&
    p.name === node
  ) {
    return true;
  }
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  return false;
}

/**
 * Literals in type position: string literal types, and the members of the
 * unions they build. `type AuthMode = "auto" | "passkey"` is a contract, and a
 * `satisfies`/`as const` value that feeds one behaves the same way.
 */
function isTypePosition(node) {
  let n = node.parent;
  while (n) {
    if (ts.isLiteralTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isTypeReferenceNode(n)) return true;
    if (ts.isExpression(n) && !ts.isLiteralExpression(n) && !ts.isUnionTypeNode(n)) break;
    n = n.parent;
  }
  return false;
}

/**
 * Literals compared with `===`/`!==` or matched in a `switch`. Without a type
 * checker this cannot prove the other side is a union type, so it is stated as
 * what it actually tests: a literal used as a discriminant. That is the shape
 * the rule was written for and the reason it is safe — a comparison against
 * displayed prose would be a bug on its own.
 */
function isDiscriminant(node) {
  const p = node.parent;
  if (!p) return false;
  if (
    ts.isBinaryExpression(p) &&
    (p.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      p.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      p.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
      p.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)
  ) {
    return true;
  }
  if (ts.isCaseClause(p)) return true;
  return false;
}

/**
 * The JSX attribute a literal belongs to, if any.
 *
 * Climbs, because `className={`h-12 ${BAR}`}` puts the class names two nodes
 * below the attribute. Stops at a function boundary and at a JSX element, so a
 * literal in the element's children is never mistaken for one of its props.
 */
function jsxAttributeName(node) {
  let n = node.parent;
  while (n) {
    if (ts.isJsxAttribute(n)) return n.name.getText();
    if (
      ts.isJsxElement(n) ||
      ts.isJsxFragment(n) ||
      ts.isArrowFunction(n) ||
      ts.isFunctionExpression(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isStatement(n)
    ) {
      return null;
    }
    n = n.parent;
  }
  return null;
}

/**
 * The callee name a literal is an argument of, if any.
 *
 * Climbs through the object and array literals an argument may be wrapped in —
 * `t("key", { token: "<TOKEN>" })`, `z.enum(["json-ld", …])` — because the
 * nesting does not change whose argument it is. Stops at function boundaries:
 * a literal inside a callback is that callback's, not the call's.
 */
function calleeName(node) {
  let n = node;
  let p = n.parent;
  while (p) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      if (!p.arguments || !p.arguments.includes(n)) return null;
      const e = p.expression;
      if (ts.isIdentifier(e)) return e.text;
      if (ts.isPropertyAccessExpression(e)) return e.name.text;
      return null;
    }
    if (
      ts.isObjectLiteralExpression(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isParenthesizedExpression(p) ||
      ts.isTemplateExpression(p) ||
      ts.isTemplateSpan(p)
    ) {
      n = p;
      p = p.parent;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * The full text of the template a chunk belongs to, or the chunk itself.
 *
 * A template is cut into pieces at every `${}`, and the piece is not what was
 * written: " AND used_at IS NULL" is unmistakably SQL only when read next to
 * the UPDATE three lines above it. Rules about what a string *is* therefore
 * read the whole template.
 */
function wholeTemplate(node) {
  let n = node.parent;
  while (n && (ts.isTemplateSpan(n) || ts.isTemplateExpression(n))) {
    if (ts.isTemplateExpression(n)) return n.getText();
    n = n.parent;
  }
  return null;
}

/** The nearest enclosing variable declaration's name, if it has one. */
function enclosingConstName(node) {
  let n = node.parent;
  while (n && !ts.isStatement(n)) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return null;
    n = n.parent;
  }
  return null;
}

/** True when the literal is the operand of an `in` check: `"html" in remote`. */
function isFeatureProbe(node) {
  const p = node.parent;
  return (
    p &&
    ts.isBinaryExpression(p) &&
    p.operatorToken.kind === ts.SyntaxKind.InKeyword &&
    p.left === node
  );
}

/**
 * True when the literal is handed to `new Error(...)` or to a `NextResponse`
 * body — the two places a configuration complaint can end up.
 *
 * Environment validation throws before anything renders (the container does not
 * start), and a misconfigured deployment answers the price worker with a 500
 * whose body only its own log will ever hold. Neither is copy. A component
 * never reaches a screen through either of these.
 */
function isEnvDiagnostic(node) {
  let n = node;
  let p = n.parent;
  while (p) {
    if (ts.isNewExpression(p) || ts.isCallExpression(p)) {
      const e = p.expression;
      if (ts.isIdentifier(e) && e.text === "Error") return true;
      if (ts.isPropertyAccessExpression(e) && e.name.text === "json") {
        return ts.isIdentifier(e.expression) && e.expression.text === "NextResponse";
      }
      return false;
    }
    if (
      ts.isObjectLiteralExpression(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isTemplateExpression(p) ||
      ts.isTemplateSpan(p) ||
      ts.isBinaryExpression(p) ||
      ts.isParenthesizedExpression(p)
    ) {
      n = p;
      p = p.parent;
      continue;
    }
    return false;
  }
  return false;
}

/** True when the literal is an argument to `console.*`. */
function isConsoleArgument(node) {
  let n = node;
  let p = n.parent;
  while (p) {
    if (ts.isCallExpression(p)) {
      const e = p.expression;
      return (
        ts.isPropertyAccessExpression(e) &&
        ts.isIdentifier(e.expression) &&
        e.expression.text === "console"
      );
    }
    if (ts.isTemplateExpression(p) || ts.isTemplateSpan(p) || ts.isBinaryExpression(p)) {
      n = p;
      p = p.parent;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * True when the literal is returned by a function that declares what it
 * returns, and that declared type is not `string`.
 *
 * A function whose return type is a named union — `InvitationRefusal | null` —
 * returns members of that union, not sentences; a function that returns copy is
 * typed `string`. The distinction is the annotation, which is why this rule can
 * be trusted without a type checker.
 */
function isTypedUnionReturn(node) {
  let n = node.parent;
  while (
    n &&
    (ts.isConditionalExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n))
  ) {
    n = n.parent;
  }
  if (!n || !ts.isReturnStatement(n)) return false;
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isArrowFunction(n) ||
      ts.isFunctionExpression(n) ||
      ts.isMethodDeclaration(n)
    ) {
      if (!n.type) return false;
      const text = n.type.getText();
      return !/^(string|Promise<string>)$/.test(text.replace(/\s+/g, ""));
    }
    n = n.parent;
  }
  return false;
}

/** True when the literal is assigned to `this.name` — an Error subclass's tag. */
function isErrorName(node) {
  const p = node.parent;
  return (
    p &&
    ts.isBinaryExpression(p) &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(p.left) &&
    p.left.name.text === "name" &&
    p.left.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

/** True when an ancestor property assignment has one of the given names. */
function underProperty(node, names) {
  let n = node.parent;
  while (n && !ts.isStatement(n)) {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && names.has(n.name.text)) return true;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return false;
    n = n.parent;
  }
  return false;
}

/**
 * Positions where an identifier-shaped value is wiring rather than a word:
 * inside a `style={{}}` object, a `class`/`id`/route attribute, a call argument
 * to a keyed API, an array of ids, or a variable whose name says so.
 */
function isIdentifierPosition(node) {
  const attr = jsxAttributeName(node);
  if (attr) return true;
  if (calleeName(node)) return true;
  if (isTypedUnionReturn(node)) return true;
  let p = node.parent;
  // Climb the array literals and `as const` an id may be wrapped in — a query
  // key factory writes `stores: ["stores"] as const`. A value written `as
  // const` is there to become a literal type, which is never a sentence.
  let sawConstAssertion = false;
  while (
    p &&
    (ts.isArrayLiteralExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isParenthesizedExpression(p) ||
      // `const expectedScope = options.expectedScope ?? "login"` — the default
      // for a value is the same kind of value.
      (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
  ) {
    if (ts.isAsExpression(p)) sawConstAssertion = true;
    p = p.parent;
  }
  if (sawConstAssertion) return true;
  if (p && ts.isPropertyAssignment(p)) return true;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
    return /(KEY|ID|SLUG|PATH|ROUTE|CLASS|TAG|COOKIE|EVENT|MODE|SCOPE|STORAGE)/i.test(p.name.text);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classify(text, node, relFile) {
  for (const { rule, test } of EXCLUDED_PATHS) {
    if (test(relFile)) return rule;
  }
  // Directives and module wiring, before anything else looks at the text.
  if (isDirective(node)) return "directive";
  if (isModuleSpecifier(node)) return "import";
  if (isPropertyName(node)) return "object-key";
  if (isTypePosition(node)) return "type-literal";
  if (isDiscriminant(node)) return "comparison";
  if (isFeatureProbe(node)) return "feature-probe";
  if (isConsoleArgument(node)) return "console";
  if (isErrorName(node)) return "error-name";

  // Text that cannot be translated because it is not language.
  if (NON_LINGUISTIC.test(text)) return "non-linguistic";
  // One or two characters between two interpolations is a separator, not a
  // sentence: `${id}re${index}`, `${seconds}s`.
  if (text.trim().length <= 2) return "short-join";
  if (PATH_LIKE.test(text)) return "path";
  if (TELEMETRY_ROUTE.test(text)) return "telemetry-route";
  if (PROTOCOL_LIKE.test(text)) return "protocol";
  const template = wholeTemplate(node);
  if (SQL.test(text) || (template && SQL.test(template))) return "sql";
  // A regular expression assembled from pieces: the pieces are syntax.
  if (template && /^`[^`]*[\\^$(?\[][^`]*`$/.test(template) && calleeName(node) === "RegExp") {
    return "regexp";
  }
  if (CSP.test(text)) return "csp";
  if (HEADER_ATTRIBUTES.test(text)) return "header-attribute";
  if (ENV_VARS.test(text) && isEnvDiagnostic(node)) return "env-guard";
  if (BARE_TAG.test(text)) return "markup-tag";
  if (CONSTANT_CODE.test(text)) return "constant-code";
  if (isCatalogKey(text)) return "catalog-key";

  const attr = jsxAttributeName(node);
  if (attr && NON_COPY_JSX_ATTRIBUTES.has(attr)) return `jsx-attr:${attr}`;
  if (attr && attr.startsWith("data-")) return "jsx-attr:data-*";

  const callee = calleeName(node);
  if (callee && NON_COPY_CALLEES.has(callee)) return `call:${callee}`;
  // Translators are named `t` or `tSomething` throughout this codebase, and
  // everything handed to one is a key or an already-translated value.
  if (callee && /^t([A-Z]\w*)?$/.test(callee)) return "call:translator";

  // Styling. A `style={{}}` object holds CSS, whatever it looks like.
  let n = node.parent;
  while (n && !ts.isJsxAttribute(n) && !ts.isStatement(n)) {
    if (ts.isObjectLiteralExpression(n) && n.parent && ts.isJsxExpression(n.parent)) {
      const a = n.parent.parent;
      if (a && ts.isJsxAttribute(a) && a.name.getText() === "style") return "css-value";
    }
    n = n.parent;
  }
  if (CSS_LIKE.test(text)) return "css-value";

  if (IDENTIFIER_LIKE.test(text) && isIdentifierPosition(node)) return "identifier";

  // Module-level constants named in SCREAMING_SNAKE are this codebase's
  // convention for data tables: header sets, marker lists, unit codes, the
  // word lists a regex is built from. They are matched against or stored, never
  // read by a person as a sentence. A const holding copy is named in camelCase
  // (`steps` in the two guide pages), which is why this rule is safe here.
  const constName = enclosingConstName(node);
  if (constName && /^[A-Z][A-Z0-9_]*$/.test(constName)) return "const-table";
  // The theme bootstrap is a <script> body, not prose.
  if (constName && /(script|bootstrap)/i.test(constName)) return "inline-script";

  // Next.js middleware matcher: a regular expression in a config object.
  if (underProperty(node, new Set(["matcher"]))) return "middleware-matcher";
  // NextAuth's own credential field labels, for provider pages this app never
  // renders — it has its own /login.
  if (underProperty(node, new Set(["credentials"]))) return "authjs-credentials";

  // Trimmed, because a template chunk carries the space that joins it to the
  // next piece: `Shoppa ${ua}`.
  if (TOKEN_LITERAL.test(text.trim())) return "token-literal";

  return null; // survives: decided by hand
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Keys of the Spanish catalog, flattened to dotted paths.
 *
 * A literal that names one is not copy any more: it is the handle the copy was
 * moved behind. Checked against the catalog rather than by shape, so the rule
 * cannot quietly bless a string that no message answers to. Template chunks
 * count as well — `t(`source.${key}`)` leaves "source." in the source — hence
 * the substring test, guarded by a length floor so that a two-letter unit code
 * cannot match by accident.
 */
const CATALOG_KEYS = (() => {
  const flat = [];
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") walk(v, key);
      else flat.push(key);
    }
  };
  walk(JSON.parse(fs.readFileSync(path.join(root, "messages", "es.json"), "utf8")), "");
  return flat;
})();

function isCatalogKey(text) {
  if (text.length < 3 || !/^[\w.-]+$/.test(text)) return false;
  // A whole key, or a whole trailing segment of one. NOT a substring: `includes`
  // blessed "ces", "Item", "Passkey" and — because the catalog holds
  // `categories.gcat-lacteos` — the bare words "lacteos", "hogar" and
  // "limpieza". A rule that answers "yes" to a fragment of a key is not
  // checking against the catalog at all.
  return CATALOG_KEYS.some((key) => key === text || key.endsWith(`.${text}`));
}

const findings = [];

for (const file of collectFiles(srcRoot).sort()) {
  const rel = path.relative(srcRoot, file);
  const text = fs.readFileSync(file, "utf8");
  // Script kind follows the extension. Parsing a `.ts` file as TSX turns every
  // generic — `Promise<T>`, `Record<string, string>` — into a JSX element and
  // fills the report with fragments of type syntax masquerading as copy.
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    let value = null;
    let kind = null;

    if (ts.isStringLiteral(node)) {
      value = node.text;
      kind = "string";
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      value = node.text;
      kind = "template";
    } else if (
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      value = node.text;
      kind = "template-chunk";
    } else if (ts.isJsxText(node)) {
      // JSX text is where most interface copy actually lives: `<label>Correo`.
      // A sweep of string literals alone would miss it entirely.
      value = node.text;
      kind = "jsx-text";
    }

    if (value !== null) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf, false)).line + 1;
      const trimmed = kind === "jsx-text" ? value.replace(/\s+/g, " ").trim() : value;
      // JSX whitespace between elements is not a literal at all.
      if (!(kind === "jsx-text" && trimmed === "")) {
        findings.push({
          file: `src/${rel}`,
          line,
          kind,
          text: trimmed,
          excludedBy: classify(trimmed, node, rel),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
}

const survivors = findings.filter((f) => f.excludedBy === null);

const byRule = {};
for (const f of findings) {
  if (f.excludedBy) byRule[f.excludedBy] = (byRule[f.excludedBy] ?? 0) + 1;
}

fs.writeFileSync(
  path.join(root, "i18n-inventory.json"),
  `${JSON.stringify({ total: findings.length, survivors: survivors.length, byRule, findings }, null, 2)}\n`,
);

console.log(`Total literals found:      ${findings.length}`);
console.log(`Excluded by the rules:     ${findings.length - survivors.length}`);
console.log(`Survivors (the worklist):  ${survivors.length}`);

if (process.argv.includes("--list")) {
  const grouped = new Map();
  for (const f of survivors) {
    if (!grouped.has(f.file)) grouped.set(f.file, []);
    grouped.get(f.file).push(f);
  }
  for (const [file, items] of [...grouped].sort()) {
    console.log(`\n${file}  (${items.length})`);
    for (const i of items) console.log(`  ${i.line}\t${i.kind}\t${JSON.stringify(i.text)}`);
  }
}

if (process.argv.includes("--rules")) {
  console.log("\nExclusions by rule:");
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${rule}`);
  }
}
