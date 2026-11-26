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
