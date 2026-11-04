import { records, text, type Json } from './tvdbParsing';

export type CharacterArtwork = { name: string; imageUrl: string; personName?: string };

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(voice\)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const nameKey = (value: string) => normalize(value).split(' ').sort().join(' ');
const roleKeys = (value: string) =>
  value
    .split(/\s*\/\s*/u)
    .map(nameKey)
    .filter(Boolean);
// Common alternative romanizations, used only alongside the same voice actor.
const romanizedKey = (value: string) => value.replace(/uu/g, 'u').replace(/ou|oo/g, 'o');

/** Map all illustrated roles before matching, without substituting actor portraits. */
export function mapCharacterArtwork(data: Json): CharacterArtwork[] {
  return records(data.characters).flatMap((character) => {
    const name = text(character.name);
    const image = text(character.image);
    if (!name || !image || normalize(name) === 'narrator') return [];
    // TVDB also provides personImgURL: only the character's image belongs here.
    const imageUrl = /^https?:\/\//i.test(image)
      ? image
      : `https://artworks.thetvdb.com/banners/${image.replace(/^\/?banners\//, '').replace(/^\//, '')}`;
    const personName = text(character.personName);
    return [{ name, imageUrl, ...(personName && { personName }) }];
  });
}

/** Match unambiguous role artwork, using actor identity to resolve aliases. */
export function withCharacterArtwork<
  T extends { name: string; character: string; characterImageUrl?: string },
>(cast: T[], characters: CharacterArtwork[]): T[] {
  return cast.map((member) => {
    const roles = roleKeys(member.character);
    if (!roles.length) return member;
    const candidates = characters.filter((character) =>
      roleKeys(character.name).some(
        (role) =>
          roles.includes(role) ||
          (character.personName &&
            nameKey(character.personName) === nameKey(member.name) &&
            roles.some((memberRole) => romanizedKey(memberRole) === romanizedKey(role))),
      ),
    );
    const actorMatches = candidates.filter(
      (character) => character.personName && nameKey(character.personName) === nameKey(member.name),
    );
    const images = new Set(
      (actorMatches.length ? actorMatches : candidates).map((character) => character.imageUrl),
    );
    const characterImageUrl = images.size === 1 ? [...images][0] : undefined;
    return characterImageUrl ? { ...member, characterImageUrl } : member;
  });
}
