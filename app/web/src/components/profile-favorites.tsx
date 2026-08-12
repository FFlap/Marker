import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  SortableHandle,
  SortableItemActions,
} from "@/components/sortable-item-controls";
import {
  usePointerSortable,
  type SortableLocation,
} from "@/hooks/use-pointer-sortable";
import { isDemoMode, posterUrl } from "@/lib/utils";

type MediaType = "movie" | "tv";
type FavoriteSection = MediaType | "anime";

export type Favorite = {
  _id: string;
  title: string;
  mediaType: MediaType;
  isAnime: boolean;
  posterPath?: string;
  rank: number;
};

const sections: Array<{
  section: FavoriteSection;
  title: string;
  singular: string;
}> = [
  { section: "tv", title: "TV Shows", singular: "TV show" },
  { section: "anime", title: "Anime", singular: "anime" },
  { section: "movie", title: "Movies", singular: "movie" },
];

const favoriteSection = (
  favorite: Pick<Favorite, "isAnime" | "mediaType">,
): FavoriteSection => (favorite.isAnime ? "anime" : favorite.mediaType);

const sectionLabel = (section: FavoriteSection) =>
  section === "tv" ? "TV show" : section === "anime" ? "anime" : "movie";

export function ProfileFavorites({
  favorites,
  interactive = true,
}: {
  favorites: Favorite[];
  interactive?: boolean;
}) {
  const demo = isDemoMode();
  const eligible = useQuery(
    api.profileFavorites.eligible,
    demo || !interactive ? "skip" : {},
  );
  const addFavorite = useMutation(api.profileFavorites.add);
  const removeFavorite = useMutation(api.profileFavorites.remove);
  const reorderFavorite = useMutation(api.profileFavorites.reorder);
  const [pickerType, setPickerType] = useState<FavoriteSection>();
  const [pending, setPending] = useState<string>();
  const [orders, setOrders] = useState<
    Partial<Record<FavoriteSection, string[]>>
  >({});
  const [error, setError] = useState("");
  const persisted = useMemo(
    () => [...favorites].toSorted((left, right) => left.rank - right.rank),
    [favorites],
  );

  const displayedFor = (section: FavoriteSection) => {
    const group = persisted.filter(
      (favorite) => favoriteSection(favorite) === section,
    );
    const order = orders[section];
    if (
      !order ||
      order.length !== group.length ||
      order.some((id) => !group.some((item) => item._id === id))
    ) {
      return group;
    }
    return order
      .map((id) => group.find((favorite) => favorite._id === id))
      .filter((favorite): favorite is Favorite => favorite !== undefined);
  };

  const move = async (section: FavoriteSection, from: number, to: number) => {
    const displayed = displayedFor(section);
    if (demo || pending || from === to || to < 0 || to >= displayed.length)
      return;
    const next = [...displayed];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setOrders((current) => ({
      ...current,
      [section]: next.map((favorite) => favorite._id),
    }));
    setPending(moved._id);
    setError("");
    try {
      await reorderFavorite({
        itemId: moved._id as Id<"items">,
        ...(next[to - 1] && { beforeId: next[to - 1]._id as Id<"items"> }),
        ...(next[to + 1] && { afterId: next[to + 1]._id as Id<"items"> }),
      });
    } catch {
      setOrders((current) => ({ ...current, [section]: undefined }));
      setError(`Couldn’t save the ${sectionLabel(section)} order.`);
    } finally {
      setPending(undefined);
    }
  };

  const remove = async (favorite: Favorite) => {
    if (demo || pending) return;
    setPending(favorite._id);
    setError("");
    try {
      await removeFavorite({ itemId: favorite._id as Id<"items"> });
      setOrders((current) => ({
        ...current,
        [favoriteSection(favorite)]: undefined,
      }));
    } catch {
      setError("Couldn’t remove this favorite.");
    } finally {
      setPending(undefined);
    }
  };

  const add = async (itemId: Id<"items">) => {
    if (demo || pending || !pickerType) return;
    setPending(String(itemId));
    setError("");
    try {
      await addFavorite({ itemId });
      setOrders((current) => ({ ...current, [pickerType]: undefined }));
      setPickerType(undefined);
    } catch {
      setError("Couldn’t add this favorite.");
    } finally {
      setPending(undefined);
    }
  };

  const pickerItems = eligible?.filter(
    (item) => favoriteSection(item) === pickerType,
  );
  const sortable = usePointerSortable({
    onMove: (source: SortableLocation, target: SortableLocation) => {
      if (source.group !== target.group) return;
      const section = sections.find(
        (entry) => entry.section === source.group,
      )?.section;
      if (section) void move(section, source.index, target.index);
    },
  });

  return (
    <section className="grid gap-10">
      {sections.map(({ section, title, singular }) => {
        const displayed = displayedFor(section);
        return (
          <section
            key={section}
            aria-labelledby={`favorite-${section}-heading`}
            {...sortable.groupProps(section)}
          >
            <div className="flex min-h-9 items-center justify-between gap-4 border-b border-border pb-2">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <h2
                  id={`favorite-${section}-heading`}
                  className="truncate text-[13px] font-semibold tracking-[.01em]"
                >
                  {title}
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {displayed.length}
                </span>
              </div>
              {interactive && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Add favorite ${singular}`}
                  disabled={demo}
                  onClick={() => setPickerType(section)}
                  className="h-11 px-2.5 text-xs sm:h-8"
                >
                  <Plus className="size-3.5" /> Add
                </Button>
              )}
            </div>

            {displayed.length ? (
              <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(112px,132px))] gap-x-4 gap-y-5">
                {displayed.map((favorite, index) => (
                  <article
                    key={favorite._id}
                    {...sortable.itemProps({
                      group: section,
                      id: favorite._id,
                      index,
                    })}
                    className="group relative min-w-0 rounded-lg"
                  >
                    <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-card">
                      <Link
                        to="/item/$itemId"
                        params={{ itemId: favorite._id }}
                        aria-label={`Open ${favorite.title}`}
                        className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        {favorite.posterPath && (
                          <img
                            src={posterUrl(favorite.posterPath)}
                            alt=""
                            className="size-full object-cover"
                          />
                        )}
                      </Link>
                      {interactive && (
                        <div className="absolute inset-x-1 top-1 flex justify-between">
                          <SortableHandle
                            disabled={demo || Boolean(pending)}
                            label={`Drag ${favorite.title}`}
                            pointerProps={sortable.handleProps(
                              { group: section, id: favorite._id, index },
                              demo || Boolean(pending),
                            )}
                            onKeyDown={(event) => {
                              if (!event.altKey) return;
                              const direction =
                                event.key === "ArrowUp"
                                  ? -1
                                  : event.key === "ArrowDown"
                                    ? 1
                                    : 0;
                              if (!direction) return;
                              event.preventDefault();
                              void move(section, index, index + direction);
                            }}
                          />
                          <SortableItemActions
                            title={favorite.title}
                            disabled={demo || Boolean(pending)}
                            canMoveUp={index > 0}
                            canMoveDown={index < displayed.length - 1}
                            onMoveUp={() =>
                              void move(section, index, index - 1)
                            }
                            onMoveDown={() =>
                              void move(section, index, index + 1)
                            }
                          >
                            <Button
                              variant="destructive"
                              className="w-full justify-start"
                              disabled={Boolean(pending)}
                              onClick={() => void remove(favorite)}
                            >
                              <Trash2 className="size-4" /> Remove from
                              favorites
                            </Button>
                          </SortableItemActions>
                        </div>
                      )}
                    </div>
                    <strong className="mt-2 block truncate text-xs font-semibold">
                      {favorite.title}
                    </strong>
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex min-h-24 items-center border-b border-border py-5">
                <p className="text-sm text-muted-foreground">
                  No favorite {title.toLowerCase()} yet.
                </p>
              </div>
            )}
          </section>
        );
      })}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <Dialog
        open={pickerType !== undefined}
        onOpenChange={(open) => !open && setPickerType(undefined)}
      >
        <DialogContent>
          <DialogTitle>
            Add {pickerType ? sectionLabel(pickerType) : "favorite"}
          </DialogTitle>
          {eligible === undefined && !demo ? (
            <div className="h-40 animate-pulse rounded-lg bg-card" />
          ) : pickerItems?.length ? (
            <div className="grid max-h-[60vh] gap-1 overflow-y-auto">
              {pickerItems.map((item) => (
                <button
                  type="button"
                  key={item._id}
                  disabled={Boolean(pending)}
                  onClick={() => void add(item._id)}
                  className="flex min-h-16 items-center gap-3 rounded-lg p-2 text-left hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-card">
                    {item.posterPath && (
                      <img
                        src={posterUrl(item.posterPath)}
                        alt=""
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <strong className="min-w-0 flex-1 truncate text-sm">
                    {item.title}
                  </strong>
                  <Plus className="size-4" />
                </button>
              ))}
            </div>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              No more watched {pickerType === "tv" ? "TV shows" : pickerType}{" "}
              are available.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
