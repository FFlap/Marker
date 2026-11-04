type CastMember = {
  name: string;
  character: string;
  profilePath?: string;
  characterImageUrl?: string;
};

/** Present animated roles with artwork and actor attribution; preserve live-action cast. */
export function castForDisplay<T extends CastMember>(cast: T[], genres: string[]): T[] {
  if (!genres.some((genre) => /^(animation|anime)$/i.test(genre))) return cast;
  return cast
    .filter((member) => member.characterImageUrl?.trim())
    .map((member) => ({
      ...member,
      name: member.character.replace(/\s*\(voice\)/gi, '').trim() || 'Unknown character',
      character: member.name,
      // Animated cast uses only character artwork, never the actor's photo.
      profilePath: undefined,
    }));
}
