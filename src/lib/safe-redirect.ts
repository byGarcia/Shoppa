/**
 * Guard against open redirect: only a same-origin, path-only target is
 * allowed. Rejects absolute URLs, protocol-relative ("//") and backslash
 * tricks ("/\", which browsers normalise to "//").
 *
 * The tab, newline and carriage return come out FIRST because the URL parser
 * removes them before parsing, whatever their position: `/\t/evil.com` passes
 * every prefix check above and then `location.assign` resolves it to
 * `https://evil.com/`. Checking the string the parser will not see is checking
 * the wrong string.
 *
 * Shared by every sign-in path, so a second way in cannot come with a second,
 * weaker copy of this check.
 */
export function safeRedirect(target: string): string {
  const cleaned = target.replace(/[\t\n\r]/g, "");
  return cleaned.startsWith("/") && !cleaned.startsWith("//") && !cleaned.startsWith("/\\")
    ? cleaned
    : "/";
}
