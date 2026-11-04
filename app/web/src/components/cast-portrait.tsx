import { posterUrl } from "@/lib/utils";

/** Render character artwork or an actor portrait in a fixed cast-card frame. */
export function CastPortrait({
  person,
}: {
  person: { profilePath?: string; characterImageUrl?: string };
}) {
  const src = person.characterImageUrl || posterUrl(person.profilePath);
  return (
    <div className="aspect-[3/4] overflow-hidden rounded-xl bg-card">
      {src && <img src={src} alt="" className="size-full object-cover" />}
    </div>
  );
}
