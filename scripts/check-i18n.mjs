/**
 * The guard that stops new Spanish from being written into the code next month:
 * Spanish copy hard-coded in a component, and Spanish prose in a comment.
 *
 * It fails on any string literal, template chunk or JSX text in `src`, and on
 * any comment in `src`, `prisma` or `scripts`, that contains one of
 * `á é í ó ú ü ñ ¿ ¡` — the characters Spanish prose cannot avoid.
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
 *  - `src/generated/` (the Prisma client, written by `prisma generate`).
 *  - `*.test.ts` LITERALS. A test's fixtures are Spanish shopping-list words on
 *    purpose — that is the product's data — and they are not interface copy.
 *    Test COMMENTS are checked like any other comment; so are test
 *    descriptions, which are literals but not in a test-only position, and are
 *    covered by the literal rule everywhere except inside `*.test.ts`. Keeping
 *    them English is a convention, not something this file can see.
 *  - Arguments to `console.*`, anywhere: the log's audience is the operator,
 *    and operator-facing text is English by convention rather than translated —
 *    a log line has no `Accept-Language` to read. Nothing enforces the English;
 *    what this rule buys is that nobody has to route a boot error through the
 *    catalogs.
 *  - Quoted text inside a comment: anything between a pair of `"`, backticks,
 *    `«»` or `“”`. A comment that says what a user typed, or quotes a line of
 *    `messages/es.json` the code below is about to assert on, is quoting data,
 *    not writing prose. That is why the doc above can name the accented
 *    characters at all. The pairing is per-quote, not greedy: an unmatched
 *    quote strips nothing, so it cannot swallow the rest of a comment.
 *
 * Comments used to be exempt outright, on the grounds that Spanish explaining a
 * decision was Spanish in the right place. That stopped being true when the
 * repository was published: a reader who opens a file to understand it reads
 * the comments first. `AGENTS.md` now says comments, identifiers and test
 * descriptions are English, and this is what enforces the first of the three.
 *
 * Boot-time configuration errors used to be allowed here by path —
 * `src/lib/env.ts`, `src/lib/scheduler.ts`, `src/server/db.ts`,
 * `src/server/setup.ts`, `src/server/webauthn/config.ts`. They are all English
 * now, so the exception is gone and those files are checked like any other.
 * That is the point: the allowance existed to hold Spanish that is no longer
 * there, and an exception nobody needs is one that quietly grows.
 *
 * WHAT IT DOES NOT LOOK AT. Literals outside `src/`. Operator-facing text also
 * lives in `scripts/` — the password rescue and the helpers it imports — and
 * nothing here reads a line of it. Widening the LITERAL walk is not free: the
 * rule is "no Spanish characters in a literal", and a script whose job is to
 * print Spanish would need its own exceptions, which is the growth the
 * paragraph above warns about. The COMMENT walk has no such problem — no
 * comment anywhere has a reason to be Spanish — so it covers all three trees.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");
/** The trees whose comments are checked. Literals are checked in `src` only. */
const COMMENT_ROOTS = ["src", "prisma", "scripts"];

const SPANISH = /[áéíóúüñ¿¡ÁÉÍÓÚÜÑ]/;

const ALLOWED_PATHS = [
  (f) => f.startsWith("generated/"),
  (f) => /\.test\.tsx?$/.test(f),
];

/**
 * A comment with its quoted spans removed, so what is left is the prose the
 * author wrote rather than the data they were pointing at. Each pattern needs
 * its closing delimiter, so an unpaired quote leaves the text untouched.
 */
function commentProse(text) {
  return text
    .replace(/"[^"]*"/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/«[^»]*»/g, " ")
    .replace(/\u201c[^\u201d]*\u201d/g, " ");
}

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

function collectFiles(dir, pattern = /\.tsx?$/, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, pattern, out);
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

function parse(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Every comment in the file, in source order and without duplicates.
 *
 * Deliberately NOT `ts.createScanner`: a bare scanner has no parser context, so
 * it cannot tell a division from the start of a regular expression, and on the
 * first `/` it guesses wrong it swallows the rest of the file. That is not a
 * theoretical risk — the first version of this check read twelve comments out
 * of `src/lib/fetcher.ts` and silently missed everything after them, including
 * a planted Spanish line at the end. Walking the parsed tree instead means the
 * ranges come from the same parse the compiler makes.
 *
 * `getChildren` rather than `forEachChild`, because the latter skips
 * punctuation tokens, and a comment sitting before a closing brace or at the
 * very end of the file is leading trivia of exactly such a token.
 */
function commentRanges(sf, text) {
  const found = new Map();
  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
      found.set(range.pos, range);
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return [...found.values()].sort((a, b) => a.pos - b.pos);
}

const offences = [];
const commentOffences = [];

for (const file of collectFiles(srcRoot).sort()) {
  const rel = path.relative(srcRoot, file);
  if (ALLOWED_PATHS.some((test) => test(rel))) continue;

  const text = fs.readFileSync(file, "utf8");
  const sf = parse(file, text);

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

for (const commentRoot of COMMENT_ROOTS) {
  const dir = path.join(root, commentRoot);
  for (const file of collectFiles(dir, /\.(tsx?|mts|mjs)$/).sort()) {
    const rel = path.relative(root, file);
    if (rel.startsWith(`src${path.sep}generated${path.sep}`)) continue;

    const text = fs.readFileSync(file, "utf8");
    const sf = parse(file, text);

    for (const range of commentRanges(sf, text)) {
      const raw = text.slice(range.pos, range.end);
      if (!SPANISH.test(raw)) continue;
      if (!SPANISH.test(commentProse(raw))) continue;

      // Report the offending line, not the whole block: a thirty-line doc
      // comment with one Spanish sentence in it should point at the sentence.
      const firstLine = sf.getLineAndCharacterOfPosition(range.pos).line;
      raw.split("\n").forEach((lineText, i) => {
        if (!SPANISH.test(commentProse(lineText))) return;
        commentOffences.push({
          file: rel.split(path.sep).join("/"),
          line: firstLine + i + 1,
          text: lineText.replace(/\s+/g, " ").trim(),
        });
      });
    }
  }
}

if (commentOffences.length > 0) {
  console.error(`Spanish prose found in ${commentOffences.length} comment line(s):\n`);
  for (const o of commentOffences) {
    console.error(`  ${o.file}:${o.line}  ${o.text}`);
  }
  console.error(
    "\nComments are English — see AGENTS.md. If the Spanish is something being\n" +
      "quoted rather than said, such as what a user typed or a line of\n" +
      "messages/es.json, put it in quotes or backticks and it is allowed.",
  );
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

if (commentOffences.length > 0) process.exit(1);

console.log("i18n: no Spanish copy in src literals, no Spanish prose in comments.");
