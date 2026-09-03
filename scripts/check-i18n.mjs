/**
 * The guard that stops new Spanish copy from being written straight into a
 * component next month.
 *
 * It fails on any string literal, template chunk or JSX text in `src` that
 * contains á é í ó ú ü ñ ¿ or ¡ — the characters Spanish prose cannot avoid.
 *
 * This is NOT the inventory and it will not tell you when an extraction is
 * complete: "Guardar", "Cancelar", "Nombre" and "Compra" have no accents, and
 * they are exactly the words a shopping list is made of. For that question run
 * `node scripts/i18n-inventory.mjs`, which parses for every literal and narrows
 * with rules a human signed off. This one is the tripwire, and it is cheap
 * enough to sit in `pnpm check`.
 *
 * What it deliberately allows, and why:
 *
 *  - `src/generated/` (the Prisma client, written by `prisma generate`) and
 *    `*.test.ts` (Spanish test descriptions are a project convention).
 *  - Arguments to `console.*`, anywhere: the log's audience is the operator,
 *    and operator-facing text is English by convention rather than translated —
 *    a log line has no `Accept-Language` to read. Nothing enforces the English;
 *    what this rule buys is that nobody has to route a boot error through the
 *    catalogs.
 *
 *  - Comments. Only literals are checked, so the Spanish that explains a
 *    decision stays where it belongs.
 *
 * Boot-time configuration errors used to be allowed here by path —
 * `src/lib/env.ts`, `src/lib/scheduler.ts`, `src/server/db.ts`,
 * `src/server/setup.ts`, `src/server/webauthn/config.ts`. They are all English
 * now, so the exception is gone and those files are checked like any other.
 * That is the point: the allowance existed to hold Spanish that is no longer
 * there, and an exception nobody needs is one that quietly grows.
 *
 * WHAT IT DOES NOT LOOK AT. It walks `src/` and only `src/`. Operator-facing
 * text also lives in `scripts/` — the password rescue and the helpers it
 * imports — and nothing here has ever read a line of it. The English of those
 * files is a convention somebody has to keep by hand. Widening the walk is not
 * free: this rule is "no Spanish characters in a literal", and a script whose
 * job is to print Spanish would need its own exceptions, which is the growth
 * the paragraph above warns about.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");

const SPANISH = /[áéíóúüñ¿¡ÁÉÍÓÚÜÑ]/;

const ALLOWED_PATHS = [
  (f) => f.startsWith("generated/"),
  (f) => /\.test\.tsx?$/.test(f),
];

/** True when the literal is an argument to `console.*`, however it is nested. */
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

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offences = [];

for (const file of collectFiles(srcRoot).sort()) {
  const rel = path.relative(srcRoot, file);
  if (ALLOWED_PATHS.some((test) => test(rel))) continue;

  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail;

    if (isLiteral && SPANISH.test(node.text) && !isConsoleArgument(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf, false)).line + 1;
      offences.push({ file: `src/${rel}`, line, text: node.text.replace(/\s+/g, " ").trim() });
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
}

if (offences.length > 0) {
  console.error(`Spanish copy found in ${offences.length} literal(s). It belongs in messages/es.json:\n`);
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  ${JSON.stringify(o.text)}`);
  }
  console.error(
    "\nMove the text into messages/es.json and messages/en.json, then read it from\n" +
      "the catalog with useTranslations/getTranslations. If the string is genuinely\n" +
      "not interface copy, say so in scripts/check-i18n.mjs rather than here.",
  );
  process.exit(1);
}

console.log("i18n: no Spanish copy left in src.");
