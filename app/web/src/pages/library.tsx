import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { Grid3X3, List, Plus } from "lucide-react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { FilterDialog, type LibraryFilters } from "@/components/filter-dialog";
import { SortableHandle, SortableItemActions } from "@/components/sortable-item-controls";
import { AddTitleDialog } from "@/components/title-dialog";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Page, SectionHeader } from "@/components/page";
import type { WebLibraryItem } from "@/types";
import { posterUrl } from "@/lib/utils";
import { matchesMediaType } from "@/lib/library-filters";
import { gridWidth, listType, listWidth } from "@/lib/display-preferences";
import { usePointerSortable, type SortableLocation } from "@/hooks/use-pointer-sortable";
import { useSessionLibraryView } from "@/hooks/use-session-library-view";

const statusLabels: Record<WebLibraryItem["status"], string> = {
  watched: "Watched",
  watching: "Watching",
  watchlist: "Watchlist",
  dropped: "Dropped",
};
const statuses = ["watched", "watching", "watchlist", "dropped"] as const;
const statusOptions = statuses.map((value) => ({
  value,
  label: statusLabels[value],
}));
function ListItem({
  item,
  index,
  textSize,
  ranked,
  contained,
}: {
  item: WebLibraryItem;
  index: number;
  textSize: "small" | "medium" | "large";
  ranked: boolean;
  contained: boolean;
}) {
  const typography = listType(textSize);
  return (
    <Link
      to="/item/$itemId"
      params={{ itemId: String(item._id) }}
      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-1 text-left focus:outline-none focus:ring-2 focus:ring-ring"
      style={{ minHeight: typography.minHeight }}
    >
      {ranked && (
        <span className="w-9 shrink-0 text-base font-semibold tabular-nums text-muted-foreground">
          {index + 1}.
        </span>
      )}
        <span className="min-w-0 flex-1 overflow-hidden">
          <strong
            className={`block font-medium ${contained ? "line-clamp-2" : "truncate"}`}
            style={{ fontSize: typography.fontSize, lineHeight: `${typography.lineHeight}px` }}
          >
            {item.title}
          </strong>
        </span>
        {item.rating !== undefined && (
          <span className="w-[34px] shrink-0 text-right font-normal tabular-nums" style={{ fontSize: typography.fontSize, lineHeight: `${typography.lineHeight}px` }}>{item.rating.toFixed(1)}</span>
        )}
    </Link>
  );
}

function PosterItem({ item, index, ranked }: { item: WebLibraryItem; index: number; ranked: boolean }) {
  return (
    <Link
      to="/item/$itemId"
      params={{ itemId: String(item._id) }}
      className="block min-h-11 text-left focus:outline-none focus:ring-2 focus:ring-ring"
    >
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-card">
          {posterUrl(item.posterPath) ? (
            <img
              src={posterUrl(item.posterPath)}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : null}
        </div>
        <strong className="mt-1.5 block line-clamp-2 text-[13px] leading-[17px] font-semibold">
          {ranked && <span className="text-muted-foreground">{index + 1}. </span>}
          {item.title}
        </strong>
    </Link>
  );
}

export function LibraryPage() {
  const queried = useQuery(api.library.items.listItems, {});
  const settings = useQuery(api.settings.getSettings, {});
  const reorderItem = useMutation(api.library.ordering.reorderItem);
  const moveItemToWatched = useAction(api.library.seasonWatched.moveItemToWatched);
  const items = queried as WebLibraryItem[] | undefined;
  const { view, setView } = useSessionLibraryView(
    settings?.defaultView ?? "list",
  );
  const gridColumns = settings?.gridColumns ?? 3;
  const listColumns = settings?.listColumns ?? 1;
  const listTextSize = settings?.listTextSize ?? "medium";
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>({
    media: "all",
    minimum: 0,
    status: "all",
    tags: [],
  });
  const [orders, setOrders] = useState<Partial<Record<WebLibraryItem["status"], string[]>>>({});
  const [moving, setMoving] = useState<string>();
  const movePending = useRef(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const allTags = useMemo(
    () => [...new Set((items ?? []).flatMap((item) => item.tags))].toSorted((a, b) => a.localeCompare(b)),
    [items],
  );
  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (item) =>
          item.title
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()) &&
          matchesMediaType(item, filters.media) &&
          (filters.status === "all" || item.status === filters.status) &&
          (!filters.minimum || (item.rating ?? -1) >= filters.minimum) &&
          filters.tags.every((tag) => item.tags.includes(tag)),
      ),
    [items, search, filters],
  );
  const visibleStatuses = statuses.filter(
    (status) => filters.status === "all" || filters.status === status,
  );
  const filtersActive =
    Boolean(search.trim()) ||
    filters.media !== "all" ||
    filters.status !== "all" ||
    filters.minimum > 0 ||
    filters.tags.length > 0;
  const sectionItems = (status: WebLibraryItem["status"]) => {
    const section = filtered
      .filter((item) => item.status === status)
      .toSorted((a, b) => a.rank - b.rank);
    const order = orders[status];
    if (!order) return section;
    const position = (id: string) => {
      const index = order.indexOf(id);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return section.toSorted(
      (left, right) =>
        position(String(left._id)) - position(String(right._id)) || left.rank - right.rank,
    );
  };
  const move = async (
    status: WebLibraryItem["status"],
    section: WebLibraryItem[],
    from: number,
    to: number,
  ) => {
    if (filtersActive || movePending.current || from === to || to < 0 || to >= section.length) return;
    setError("");
    const next = [...section];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setAnnouncement(
      `${moved.title} moved to position ${to + 1} of ${section.length} in ${statusLabels[status]}.`,
    );
    setOrders((current) => ({ ...current, [status]: next.map((item) => String(item._id)) }));
    movePending.current = true;
    setMoving(String(moved._id));
    try {
      await reorderItem({
        itemId: moved._id as Id<"items">,
        status,
        ...(next[to - 1] && { beforeId: next[to - 1]._id as Id<"items"> }),
        ...(next[to + 1] && { afterId: next[to + 1]._id as Id<"items"> }),
      });
      setOrders((current) => ({ ...current, [status]: undefined }));
    } catch {
      setOrders((current) => ({ ...current, [status]: undefined }));
      setError("Couldn’t save the new order.");
    } finally {
      movePending.current = false;
      setMoving(undefined);
    }
  };
  const moveStatus = async (item: WebLibraryItem, status: WebLibraryItem["status"], targetIndex?: number) => {
    if (filtersActive || movePending.current || item.status === status) return;
    const target = (items ?? [])
      .filter((entry) => entry.status === status && entry._id !== item._id)
      .toSorted((left, right) => left.rank - right.rank);
    const insertion = Math.max(0, Math.min(targetIndex ?? target.length, target.length));
    const placed = [...target];
    placed.splice(insertion, 0, item);
    movePending.current = true;
    setMoving(String(item._id));
    setError("");
    try {
      const placement = {
        itemId: item._id as Id<"items">,
        ...(placed[insertion - 1] && { beforeId: placed[insertion - 1]._id as Id<"items"> }),
        ...(placed[insertion + 1] && { afterId: placed[insertion + 1]._id as Id<"items"> }),
      };
      if (status === "watched") await moveItemToWatched(placement);
      else await reorderItem({ ...placement, status });
      setOrders({});
    } catch {
      setError(status === "watched" ? "Couldn’t mark every episode watched." : "Couldn’t move this title.");
    } finally {
      movePending.current = false;
      setMoving(undefined);
    }
  };

  const sortable = usePointerSortable({
    onMove: (source: SortableLocation, target: SortableLocation) => {
      const sourceStatus = statuses.find((status) => status === source.group);
      const targetStatus = statuses.find((status) => status === target.group);
      if (!sourceStatus || !targetStatus) return;
      if (sourceStatus === targetStatus) {
        void move(
          sourceStatus,
          sectionItems(sourceStatus),
          source.index,
          target.index,
        );
        return;
      }
      const sourceItem = (items ?? []).find(
        (entry) => String(entry._id) === source.id,
      );
      if (sourceItem) void moveStatus(sourceItem, targetStatus, target.index);
    },
  });

  const keyboardMove = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    status: WebLibraryItem["status"],
    section: WebLibraryItem[],
    index: number,
  ) => {
    if (!event.altKey) return;
    const direction =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    void move(status, section, index, index + direction);
  };

  return (
    <Page width="wide" className="max-w-4xl">
      <h1 className="sr-only">Library</h1>
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-2 flex gap-2 bg-background/90 px-2 py-3 backdrop-blur-xl lg:top-0">
        <SearchField
          wrapperClassName="flex-1"
          aria-label="Search your library"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Library"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={view === "list" ? "Show poster view" : "Show list view"}
          aria-pressed={view === "posters"}
          onClick={() => setView(view === "list" ? "posters" : "list")}
        >
          {view === "list" ? <Grid3X3 className="size-4" /> : <List className="size-4" />}
        </Button>
        <FilterDialog value={filters} onChange={setFilters} availableTags={allTags} />
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {filtersActive && (
        <p className="mt-2 text-xs text-muted-foreground">
          {filtered.length} results · Clear filters to reorder
        </p>
      )}

      {queried === undefined || settings === undefined ? (
        <div className="mt-12 grid gap-3">
          {["one", "two", "three", "four", "five", "six"].map((key) => (
            <div key={key} className="h-16 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : (
        <div
          data-testid={view === "posters" ? "poster-grid" : "library-list"}
          className="mt-6 grid gap-6"
        >
          {visibleStatuses.map((status) => {
            const section = sectionItems(status);
            return (
              <section key={status} {...sortable.groupProps(status)}>
                <SectionHeader
                  className="mb-4"
                  title={statusLabels[status]}
                  count={section.length}
                />
                {!section.length ? (
                  <div className="py-[22px] text-center">
                    <p className="text-base font-semibold">
                      {filtersActive ? "No matches" : "Nothing here yet"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {filtersActive ? "Try a broader filter." : "Add a title when you’re ready."}
                    </p>
                  </div>
                ) : view === "list" ? (
                  <div className="flex flex-wrap gap-x-[3.5%]">
                    {section.map((item, index) => (
                      <div
                        key={item._id}
                        {...sortable.itemProps({ group: status, id: String(item._id), index })}
                        className="flex min-w-0 items-center rounded-lg"
                        style={{ width: listWidth(listColumns), flexBasis: listWidth(listColumns), flexGrow: 0, flexShrink: 0 }}
                      >
                        <SortableHandle
                          disabled={filtersActive || Boolean(moving)}
                          label={`Drag ${item.title}`}
                          pointerProps={sortable.handleProps(
                            { group: status, id: String(item._id), index },
                            filtersActive || Boolean(moving),
                          )}
                          onKeyDown={(event) => keyboardMove(event, status, section, index)}
                        />
                        <ListItem
                          item={item}
                          index={index}
                          textSize={listTextSize}
                          ranked={status === "watched"}
                          contained={listColumns === 2}
                        />
                        <SortableItemActions
                          title={item.title}
                          disabled={filtersActive || Boolean(moving)}
                          canMoveUp={index > 0}
                          canMoveDown={index < section.length - 1}
                          onMoveUp={() => void move(status, section, index, index - 1)}
                          onMoveDown={() => void move(status, section, index, index + 1)}
                          status={status}
                          statuses={statusOptions}
                          onMoveToStatus={(next) => void moveStatus(item, next as WebLibraryItem["status"])}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-x-[3.5%] gap-y-3 pb-1">
                    {section.map((item, index) => (
                      <div
                        key={item._id}
                        {...sortable.itemProps({ group: status, id: String(item._id), index })}
                        className="relative min-w-0 rounded-xl"
                        style={{ width: gridWidth(gridColumns), flexBasis: gridWidth(gridColumns), flexGrow: 0, flexShrink: 0 }}
                      >
                        <div className="absolute inset-x-1 top-1 z-10 flex justify-between">
                          <SortableHandle
                            disabled={filtersActive || Boolean(moving)}
                            label={`Drag ${item.title}`}
                            pointerProps={sortable.handleProps(
                              { group: status, id: String(item._id), index },
                              filtersActive || Boolean(moving),
                            )}
                            onKeyDown={(event) => keyboardMove(event, status, section, index)}
                          />
                          <SortableItemActions
                            title={item.title}
                            disabled={filtersActive || Boolean(moving)}
                            canMoveUp={index > 0}
                            canMoveDown={index < section.length - 1}
                            onMoveUp={() => void move(status, section, index, index - 1)}
                            onMoveDown={() => void move(status, section, index, index + 1)}
                            status={status}
                            statuses={statusOptions}
                            onMoveToStatus={(next) => void moveStatus(item, next as WebLibraryItem["status"])}
                          />
                        </div>
                        <PosterItem
                          item={item}
                          index={index}
                          ranked={status === "watched"}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <AddTitleDialog>
        <Button
          size="icon"
          aria-label="Add title"
          className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-30 size-14 rounded-full shadow-2xl lg:bottom-8 lg:right-8"
        >
          <Plus className="size-5" />
        </Button>
      </AddTitleDialog>
    </Page>
  );
}
