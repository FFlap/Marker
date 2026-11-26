const SYNOPSIS_LIMIT = 400;

function cutAtWord(value: string, maximum: number) {
  const head = value.slice(0, maximum - 1);
  const space = head.search(/\s\S*$/);
  const cut = space > maximum * 0.6 ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,;:.–—-]+$/, '')}…`;
}

/**
 * Synopses are stored with a length limit. Cut long ones at a whole word, and tidy ones
 * that were stored cut mid-word, so they end with an ellipsis instead of half a word.
 */
export function clipSynopsis(value: string, maximum = SYNOPSIS_LIMIT) {
  const text = value.trim();
  if (text.length > maximum) return cutAtWord(text, maximum);
  if (text.length >= maximum - 1 && !/[.!?…"”')\]]$/.test(text))
    // Replace the cut-off tail rather than adding to it, so the result stays in the limit.
    return cutAtWord(text, text.length);
  return text;
}

/**
 * Some providers store episode names in capitals ("SECURE A WIFE"). Show those in title
 * case so they sit with the rest of the type; mixed-case names are left alone.
 */
export function displayEpisodeName(name: string) {
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || letters !== letters.toUpperCase()) return name;
  const small = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'but',
    'by',
    'for',
    'in',
    'of',
    'on',
    'or',
    'the',
    'to',
    'vs',
  ]);
  // Keep separators, so each part of "COUNTER-SECRET" is capitalized on its own.
  const parts = name.toLocaleLowerCase().split(/([\s\-\u2013\u2014/]+)/);
  const wordIndexes = parts.flatMap((part, index) => (index % 2 === 0 && part ? [index] : []));
  const firstIndex = wordIndexes[0];
  const lastIndex = wordIndexes[wordIndexes.length - 1];
  return parts
    .map((part, index) =>
      index % 2 === 1 || (small.has(part) && index !== firstIndex && index !== lastIndex)
        ? part
        : part.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase()),
    )
    .join('');
}

/**
 * TMDB lists paired TV genres ("Action & Adventure") next to single ones ("Action").
 * Split the pairs, drop repeats, and drop "Animation" when "Anime" already says it.
 */
export function displayGenres(genres: readonly string[] = []) {
  const seen = new Map<string, string>();
  for (const genre of genres)
    for (const part of genre.split(/\s*&\s*/)) {
      const name = part.trim();
      if (name && !seen.has(name.toLocaleLowerCase())) seen.set(name.toLocaleLowerCase(), name);
    }
  if (seen.has('anime')) seen.delete('animation');
  return [...seen.values()];
}

/** Rough characters per line for a caption, allowing for wide capital letters. */
export function captionCharsPerLine(title: string, width: number, fontSize: number) {
  const letters = title.replace(/[^A-Za-z]/g, '');
  const capitals = letters.replace(/[^A-Z]/g, '').length / Math.max(1, letters.length);
  const average = fontSize * (0.6 + 0.16 * capitals);
  return Math.max(4, Math.floor(width / average));
}

/**
 * From a title laid out in full (each rendered line's text and width), the caption to show
 * in `lines` lines: undefined when it fits as is; otherwise the first lines with "…",
 * keeping the last word when the ellipsis still fits beside it and dropping it when not.
 */
export function captionFromLines(
  rendered: readonly { text: string; width: number }[],
  boxWidth: number,
  ellipsisWidth: number,
  lines = 2,
) {
  if (rendered.length <= lines) return undefined;
  const kept = rendered.slice(0, lines);
  const lastLine = kept[lines - 1]!;
  const before = kept
    .slice(0, lines - 1)
    .map((line) => line.text)
    .join('');
  let last = lastLine.text.trimEnd();
  if (lastLine.width + ellipsisWidth > boxWidth) {
    const space = last.lastIndexOf(' ');
    if (space > 0) last = last.slice(0, space);
    else {
      // One long word: take off enough letters for the ellipsis.
      const perChar = lastLine.width / Math.max(1, last.length);
      last = last.slice(0, Math.max(1, last.length - Math.ceil(ellipsisWidth / perChar)));
    }
  }
  const trailing = /[\s,;:.\u2013\u2014-]+$/;
  let head = `${before}${last}`.trimEnd().replace(trailing, '');
  // Never end on a connecting word ("Inception: The…"): it names nothing.
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace > 0 && DANGLING_WORDS.has(head.slice(lastSpace + 1).toLocaleLowerCase()))
    head = head.slice(0, lastSpace).replace(trailing, '');
  return `${head}…`;
}

const DANGLING_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  '&',
  'x',
]);

/** Leading marks such as the brackets of 【OSHI NO KO】 or quotes, which shouldn't decide order. */
const LEADING_MARKS = /^[^\p{L}\p{N}]+/u;

/** A–Z title order that ignores leading punctuation, letter case and accents, with numbers in order. */
export function compareTitles(left: string, right: string) {
  return left
    .replace(LEADING_MARKS, '')
    .localeCompare(right.replace(LEADING_MARKS, ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
}
