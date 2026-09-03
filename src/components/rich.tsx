import type { ReactNode } from "react";

/**
 * The inline tags message catalogs are allowed to use.
 *
 * Sentences that mix prose with a literal — `docker compose logs`, `https` —
 * used to be split into three JSX fragments and a `{" "}`. Split like that a
 * translator sees three stumps instead of a sentence, and the spacing between
 * them is a hazard in every language. The catalog keeps the sentence whole and
 * names the emphasis with a tag; this is where the tags get their look.
 *
 * `b` is the emphasis the two account cards use. A call site whose emphasis
 * looks different passes its own renderer for that one tag.
 */
export const richTags = {
  code: (chunks: ReactNode) => <span className="font-mono">{chunks}</span>,
  b: (chunks: ReactNode) => <strong className="text-ink">{chunks}</strong>,
};
