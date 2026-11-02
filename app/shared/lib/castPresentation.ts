type CastMember = {
  name: string;
  character: string;
  profilePath?: string;
  characterImageUrl?: string;
};

export function castForDisplay<T extends CastMember>(cast: T[], genres: string[]): T[] {
  if (!genres.some((genre) => /^(animation|anime)$/i.test(genre))) return cast;
  return cast.map((member) => ({
    ...member,
    name: member.character.replace(/\s*\(voice\)/gi, '').trim() || 'Unknown character',
    character: member.name,
    // Missing character artwork stays a placeholder; never use the actor's photo.
    profilePath: undefined,
  }));
}
