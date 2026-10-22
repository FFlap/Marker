/** Single source of truth for provider ownership in the metadata merge. */
export const isAnime = (genres: readonly string[] | undefined) =>
  (genres ?? []).some((genre) => genre.trim().toLocaleLowerCase() === 'anime');

export const mergeGenres = (tmdb: readonly string[], tvdb: readonly string[]) => {
  const values = [...tmdb, ...tvdb];
  return [...new Map(values.map((value) => [value.toLocaleLowerCase(), value])).values()];
};
