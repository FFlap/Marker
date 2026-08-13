import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useParams } from "@tanstack/react-router";
import { EllipsisVertical, Globe2, LockKeyhole, Plus } from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { FilterDialog, type LibraryFilters } from "@/components/filter-dialog";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import {
  SortableHandle,
  SortableItemActions,
} from "@/components/sortable-item-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import type { WebLibraryItem } from "@/types";
import { posterUrl } from "@/lib/utils";
import { matchesMediaType } from "@/lib/library-filters";
import {
  gridWidth,
  listType,
  listWidth,
} from "@/lib/display-preferences";
import {
  usePointerSortable,
  type SortableLocation,
} from "@/hooks/use-pointer-sortable";
import { useSessionLibraryView } from "@/hooks/use-session-library-view";

const statuses = ["watched", "watching", "watchlist", "dropped"] as const;
const labels = {
  watched: "Watched",
  watching: "Watching",
  watchlist: "Watchlist",
  dropped: "Dropped",
};
const statusOptions = statuses.map((value) => ({
  value,
  label: labels[value],
}));

type RankedItem = WebLibraryItem & { tagRank?: number };

function TagItemLink({
  children,
  itemId,
  title,
  view,
  style,
}: {
  children: ReactNode;
  itemId: string;
  title: string;
  view: "list" | "posters";
  style: CSSProperties;
}) {
  return (
    <Link
      to="/item/$itemId"
      params={{ itemId }}
      aria-label={title}
      className={`min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === "posters" ? "block rounded-xl" : "flex flex-1 items-center gap-2 overflow-hidden rounded-lg px-1 font-medium"}`}
      style={style}
    >
      {children}
    </Link>
  );
}

function VisibilityDialog({
  tag,
  onError,
}: {
  tag: string;
  onError: (message: string) => void;
}) {
  const visibility = useQuery(api.tags.visibility, { tag });
  const setVisibility = useMutation(api.tags.setVisibility);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const update = async (isPublic: boolean) => {
    if (pending || visibility?.isPublic === isPublic) return;
    setPending(true);
    onError("");
    setDialogError("");
    try {
      await setVisibility({ tag, isPublic });
    } catch {
      const message = "Couldn’t update tag visibility.";
      onError(message);
      setDialogError(message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tag visibility">
          <EllipsisVertical className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Tag visibility</DialogTitle>
        <div className="grid gap-2">
          <button
            type="button"
            aria-pressed={visibility?.isPublic === true}
            disabled={pending}
            onClick={() => void update(true)}
            className={`flex min-h-16 items-center gap-4 rounded-xl border p-4 text-left ${visibility?.isPublic ? "border-foreground bg-card" : "border-border"}`}
          >
            <Globe2 className="size-5 shrink-0" />
            <span>
              <strong className="block text-sm">Public</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Show this collection on your profile and in global tags.
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-pressed={visibility?.isPublic === false}
            disabled={pending}
            onClick={() => void update(false)}
            className={`flex min-h-16 items-center gap-4 rounded-xl border p-4 text-left ${visibility?.isPublic === false ? "border-foreground bg-card" : "border-border"}`}
          >
            <LockKeyhole className="size-5 shrink-0" />
            <span>
              <strong className="block text-sm">Private</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Keep this collection visible only to you.
              </span>
            </span>
          </button>
          {dialogError ? <p role="alert" className="text-xs text-destructive">{dialogError}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TagDetailPage() {
  const { tag } = useParams({ from: "/app/tags/$tag" });
  const libraryQuery = useQuery(api.library.listItems, {});
  const rankQuery = useQuery(api.library.listTagRanks, { tag });
  const settings = useQuery(api.settings.getSettings, {});
  const reorderTagItem = useMutation(api.library.reorderTagItem);
  const reorderItem = useMutation(api.library.reorderItem);
  const moveItemToWatched = useAction(api.library.moveItemToWatched);
  const library = libraryQuery as WebLibraryItem[] | undefined;
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>({
    media: "all",
    minimum: 0,
    status: "all",
    tags: [],
  });
  const [orders, setOrders] = useState<
    Partial<Record<(typeof statuses)[number], string[]>>
  >({});
  const [moving, setMoving] = useState<string>();
  const movePending = useRef(false);
  const [error, setError] = useState("");
  const { view } = useSessionLibraryView(settings?.defaultView ?? "list");
  const gridColumns = settings?.gridColumns ?? 3;
  const listColumns = settings?.listColumns ?? 1;
  const listTextSize = settings?.listTextSize ?? "medium";

  const ranked = useMemo<RankedItem[]>(() => {
    const rankById = new Map(
      (rankQuery ?? []).map((entry) => [String(entry.itemId), entry.rank]),
    );
    return (library ?? [])
      .filter((item) =>
        item.tags.some(
          (entry) =>
            entry.trim().toLocaleLowerCase() === tag.trim().toLocaleLowerCase(),
        ),
      )
      .map((item) =>
        Object.assign({}, item, { tagRank: rankById.get(String(item._id)) }),
      )
      .toSorted(
        (left, right) =>
          (left.tagRank ?? Number.MAX_SAFE_INTEGER) -
            (right.tagRank ?? Number.MAX_SAFE_INTEGER) ||
          left.rank - right.rank,
      );
  }, [library, rankQuery, tag]);

  useEffect(() => {
    setOrders({});
  }, [tag]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ranked.filter(
      (item) =>
        (!query || item.title.toLocaleLowerCase().includes(query)) &&
        matchesMediaType(item, filters.media) &&
        (filters.status === "all" || item.status === filters.status) &&
        (!filters.minimum || (item.rating ?? -1) >= filters.minimum) &&
        filters.tags.every((filterTag) =>
          item.tags.some(
            (itemTag) =>
              itemTag.toLocaleLowerCase() === filterTag.toLocaleLowerCase(),
          ),
        ),
    );
  }, [filters, ranked, search]);

  const sectionItems = (status: (typeof statuses)[number]) => {
    const items = filtered.filter((item) => item.status === status);
    const order = orders[status];
    if (!order) return items;
    const position = (id: string) => {
      const index = order.indexOf(id);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return [...items].toSorted(
      (left, right) =>
        position(String(left._id)) - position(String(right._id)) || left.rank - right.rank,
    );
  };

  const move = async (
    status: (typeof statuses)[number],
    items: RankedItem[],
    from: number,
    to: number,
  ) => {
    if (filtersActive || movePending.current || moving || to < 0 || to >= items.length || from === to)
      return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setOrders((current) => ({
      ...current,
      [status]: next.map((item) => String(item._id)),
    }));
    movePending.current = true;
    setMoving(String(moved._id));
    setError("");
    try {
      await reorderTagItem({
        tag,
        itemId: moved._id as Id<"items">,
        ...(next[to - 1] && {
          beforeId: next[to - 1]._id as Id<"items">,
        }),
        ...(next[to + 1] && {
          afterId: next[to + 1]._id as Id<"items">,
        }),
      });
      setOrders((current) => ({ ...current, [status]: undefined }));
    } catch {
      setOrders((current) => ({ ...current, [status]: undefined }));
      setError("Couldn’t save the tag order.");
    } finally {
      movePending.current = false;
      setMoving(undefined);
    }
  };

  const moveStatus = async (
    item: RankedItem,
    status: (typeof statuses)[number],
  ) => {
    if (filtersActive || movePending.current || moving || item.status === status) return;
    const target = (library ?? [])
      .filter((entry) => entry.status === status && entry._id !== item._id)
      .toSorted((left, right) => left.rank - right.rank);
    movePending.current = true;
    setMoving(String(item._id));
    setError("");
    try {
      const placement = {
        itemId: item._id as Id<"items">,
        ...(target.at(-1) && { beforeId: target.at(-1)!._id as Id<"items"> }),
      };
      if (status === "watched") await moveItemToWatched(placement);
      else await reorderItem({ ...placement, status });
      setOrders({});
    } catch {
      setError(
        status === "watched"
          ? "Couldn’t mark every episode watched."
          : "Couldn’t move this title.",
      );
    } finally {
      movePending.current = false;
      setMoving(undefined);
    }
  };

  const filtersActive =
    Boolean(search.trim()) ||
    filters.media !== "all" ||
    filters.status !== "all" ||
    filters.minimum > 0 ||
    filters.tags.length > 0;
  const availableTags = useMemo(
    () =>
      [...new Set(ranked.flatMap((item) => item.tags))]
        .filter(
          (entry) =>
            entry.trim().toLocaleLowerCase() !== tag.trim().toLocaleLowerCase(),
        )
        .toSorted((left, right) => left.localeCompare(right)),
    [ranked, tag],
  );
  const loading = libraryQuery === undefined || rankQuery === undefined;
  const sortable = usePointerSortable({
    onMove: (source: SortableLocation, target: SortableLocation) => {
      if (source.group !== target.group) return;
      const status = statuses.find((value) => value === source.group);
      if (!status) return;
      void move(status, sectionItems(status), source.index, target.index);
    },
  });

  const keyboardMove = (
    event: KeyboardEvent<HTMLButtonElement>,
    status: (typeof statuses)[number],
    items: RankedItem[],
    index: number,
  ) => {
    if (!event.altKey) return;
    const direction =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    void move(status, items, index, index + direction);
  };
  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader
        title={tag || "Tag"}
        back
        backFallback="/tags"
        actions={<VisibilityDialog tag={tag} onError={setError} />}
      />
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-2 mt-3 flex gap-2 bg-background/90 px-2 py-3 backdrop-blur-xl lg:top-0">
        <SearchField
          aria-label={`Search titles in ${tag}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${tag}`}
          className="h-11 flex-1 border-0 bg-card text-sm sm:h-9"
        />
        <FilterDialog
          value={filters}
          onChange={setFilters}
          availableTags={availableTags}
        />
      </div>
      {filtersActive && (
        <p className="mt-2 text-xs text-muted-foreground">
          Clear search and filters to reorder.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-8 grid gap-3">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : (
        <div className="mt-8 grid gap-12">
          {statuses
            .filter(
              (status) => filters.status === "all" || filters.status === status,
            )
            .map((status) => {
              const items = sectionItems(status);
              return (
                <section key={status} {...sortable.groupProps(status)}>
                  <SectionHeader title={labels[status]} count={items.length} />
                  {items.length ? (
                    <div
                      className={`flex flex-wrap gap-x-[3.5%] ${view === "posters" ? "mt-4 gap-y-3 pb-1" : "mt-2"}`}
                    >
                      {items.map((item, index) => (
                        <div
                          key={item._id}
                          {...sortable.itemProps({
                            group: status,
                            id: String(item._id),
                            index,
                          })}
                          className={`relative min-w-0 rounded-xl ${view === "list" ? "flex items-center" : ""}`}
                          style={{
                            width:
                              view === "posters"
                                ? gridWidth(gridColumns)
                                : listWidth(listColumns),
                            flexBasis:
                              view === "posters"
                                ? gridWidth(gridColumns)
                                : listWidth(listColumns),
                            flexGrow: 0,
                            flexShrink: 0,
                            ...(view === "list" && {
                              minHeight:
                                listType(listTextSize).minHeight,
                            }),
                          }}
                        >
                          {view === "posters" ? (
                            <div className="absolute inset-x-1 top-1 z-10 flex justify-between">
                              <SortableHandle
                                disabled={filtersActive || Boolean(moving)}
                                label={`Drag ${item.title}`}
                                pointerProps={sortable.handleProps(
                                  {
                                    group: status,
                                    id: String(item._id),
                                    index,
                                  },
                                  filtersActive || Boolean(moving),
                                )}
                                onKeyDown={(event) =>
                                  keyboardMove(event, status, items, index)
                                }
                              />
                              <SortableItemActions
                                title={item.title}
                                disabled={filtersActive || Boolean(moving)}
                                canMoveUp={index > 0}
                                canMoveDown={index < items.length - 1}
                                onMoveUp={() =>
                                  void move(status, items, index, index - 1)
                                }
                                onMoveDown={() =>
                                  void move(status, items, index, index + 1)
                                }
                                status={status}
                                statuses={statusOptions}
                                onMoveToStatus={(next) =>
                                  void moveStatus(
                                    item,
                                    next as (typeof statuses)[number],
                                  )
                                }
                              />
                            </div>
                          ) : (
                            <SortableHandle
                              disabled={filtersActive || Boolean(moving)}
                              label={`Drag ${item.title}`}
                              pointerProps={sortable.handleProps(
                                { group: status, id: String(item._id), index },
                                filtersActive || Boolean(moving),
                              )}
                              onKeyDown={(event) =>
                                keyboardMove(event, status, items, index)
                              }
                            />
                          )}
                          <TagItemLink
                            itemId={String(item._id)}
                            title={item.title}
                            view={view}
                            style={{
                              minHeight:
                                listType(listTextSize).minHeight,
                            }}
                          >
                            {view === "posters" ? (
                              <div className="aspect-[2/3] w-full overflow-hidden rounded-xl bg-card">
                                {item.posterPath && (
                                  <img
                                    src={posterUrl(item.posterPath)}
                                    alt=""
                                    className="size-full object-cover"
                                  />
                                )}
                              </div>
                            ) : status === "watched" ? (
                              <span className="w-9 shrink-0 font-semibold tabular-nums text-muted-foreground">
                                {index + 1}.
                              </span>
                            ) : null}
                            <span
                              className={
                                view === "posters"
                                  ? "mt-2 block min-w-0"
                                  : "min-w-0 flex-1 overflow-hidden"
                              }
                            >
                              <strong
                                className={`block ${view === "posters" ? "line-clamp-2 text-xs leading-4 font-semibold" : listColumns === 2 ? "line-clamp-2 font-medium" : "truncate font-medium"}`}
                                style={
                                  view === "list"
                                    ? {
                                        fontSize: listType(listTextSize).fontSize,
                                        lineHeight: `${listType(listTextSize).lineHeight}px`,
                                      }
                                    : undefined
                                }
                              >
                                {view === "posters" && status === "watched" && (
                                  <span className="text-muted-foreground">
                                    {index + 1}.{" "}
                                  </span>
                                )}
                                {item.title}
                              </strong>
                            </span>
                            {view === "list" && item.rating !== undefined ? (
                              <span
                                className="w-[34px] shrink-0 text-right font-normal tabular-nums"
                                style={{
                                  fontSize: listType(listTextSize).fontSize,
                                  lineHeight: `${listType(listTextSize).lineHeight}px`,
                                }}
                              >
                                {item.rating.toFixed(1)}
                              </span>
                            ) : null}
                          </TagItemLink>
                          {view === "list" ? (
                            <SortableItemActions
                              title={item.title}
                              disabled={filtersActive || Boolean(moving)}
                              canMoveUp={index > 0}
                              canMoveDown={index < items.length - 1}
                              onMoveUp={() =>
                                void move(status, items, index, index - 1)
                              }
                              onMoveDown={() =>
                                void move(status, items, index, index + 1)
                              }
                              status={status}
                              statuses={statusOptions}
                              onMoveToStatus={(next) =>
                                void moveStatus(
                                  item,
                                  next as (typeof statuses)[number],
                                )
                              }
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-sm font-semibold">
                        {filtersActive ? "No matches" : "Nothing here yet"}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {filtersActive
                          ? "Try a broader filter."
                          : "Add a tagged title when you’re ready."}
                      </p>
                    </div>
                  )}
                </section>
              );
            })}
        </div>
      )}
      <Button
        asChild
        size="icon"
        className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-30 size-12 rounded-full lg:bottom-8 lg:right-8"
      >
        <Link
          to="/tags/$tag/add"
          params={{ tag }}
          aria-label={`Add titles to ${tag}`}
        >
          <Plus className="size-5" />
        </Link>
      </Button>
    </Page>
  );
}
