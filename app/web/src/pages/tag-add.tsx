import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import type { WebLibraryItem } from "@/types";
import { posterUrl } from "@/lib/utils";

export function TagAddPage() {
  const { tag } = useParams({ from: "/app/tags/$tag/add" });
  const itemQuery = useQuery(api.library.items.listItems, {});
  const items = itemQuery as WebLibraryItem[] | undefined;
  const addTagToItems = useMutation(api.library.items.addTagToItems);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const tagKey = tag.trim().toLocaleLowerCase();
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (items ?? [])
      .filter(
        (item) => !query || item.title.toLocaleLowerCase().includes(query),
      )
      .toSorted((left, right) => left.title.localeCompare(right.title));
  }, [items, search]);
  const isMember = (item: WebLibraryItem) =>
    item.tags.some((entry) => entry.trim().toLocaleLowerCase() === tagKey);
  const toggle = (itemId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };
  const confirm = async () => {
    if (!selected.size || saving) return;
    setSaving(true);
    setError("");
    let savedCount = 0;
    try {
      const ids = [...selected] as Id<"items">[];
      const batches = Array.from(
        { length: Math.ceil(ids.length / 100) },
        (_, index) => ids.slice(index * 100, index * 100 + 100),
      );
      for (const itemIds of batches) {
        // Convex batches update the same tag records and must run in order.
        // eslint-disable-next-line no-await-in-loop
        await addTagToItems({ tag, itemIds });
        savedCount += itemIds.length;
      }
      void navigate({ to: "/tags/$tag", params: { tag } });
    } catch {
      setError(
        savedCount
          ? `${savedCount} ${savedCount === 1 ? "title was" : "titles were"} added to ${tag}, but the rest could not be saved.`
          : `Couldn’t add titles to ${tag}.`,
      );
      setSaving(false);
    }
  };
  return (
    <Page width="compact">
      <PageHeader title={`Add to ${tag}`} back backFallback="/tags" />
      <SearchField
        aria-label="Search your library"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search your library"
        className="mt-6 h-11 border-0 bg-card text-sm sm:h-9"
      />
      {items === undefined ? (
        <div className="mt-8 grid gap-2">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-6 border-b border-border pb-5">
            <p className="text-[10px] font-bold uppercase tracking-[.11em] text-muted-foreground">
              Your library
            </p>
            <p className="mt-2 max-w-[480px] text-sm leading-5">
              Select every title you want to include. Existing members stay
              checked.
            </p>
          </div>
          {filtered.length ? (
            <div className="divide-y divide-border">
              {filtered.map((item) => {
                const member = isMember(item);
                const checked = member || selected.has(String(item._id));
                return (
                  <label
                    key={item._id}
                    className={`flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-3 text-left ${checked ? "bg-card" : ""} ${member || saving ? "cursor-default opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={member || saving}
                      onChange={() => toggle(String(item._id))}
                      aria-label={
                        member
                          ? `${item.title}, already in ${tag}`
                          : `${checked ? "Remove" : "Add"} ${item.title}`
                      }
                      className="peer sr-only"
                    />
                    <div className="aspect-[2/3] w-10 shrink-0 overflow-hidden rounded-md bg-card">
                      {item.posterPath && (
                        <img
                          src={posterUrl(item.posterPath)}
                          alt=""
                          className="size-full object-cover"
                        />
                      )}
                    </div>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {item.title}
                      </strong>
                      <span className="mt-1 block text-[10px] uppercase tracking-[.1em] text-muted-foreground">
                        {member
                          ? `In ${tag}`
                          : item.mediaType === "movie"
                            ? "Movie"
                            : "Series"}
                      </span>
                    </span>
                    <span
                      className={`grid size-7 place-items-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background ${checked ? "border-foreground bg-foreground text-background" : "border-border"}`}
                    >
                      {checked && <Check className="size-4" />}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="py-20 text-center">
              <p className="text-sm font-semibold">
                {items.length ? "No matching titles" : "Your library is empty"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {items.length
                  ? "Try another search."
                  : "Add titles to your library before building this tag."}
              </p>
            </div>
          )}
        </>
      )}
      <div className="sticky bottom-20 mt-8 flex items-center justify-between border-t border-border bg-background py-4 lg:bottom-0">
        <span className="text-xs text-muted-foreground">
          {selected.size} {selected.size === 1 ? "title" : "titles"} selected
        </span>
        <Button
          disabled={!selected.size || saving}
          onClick={() => void confirm()}
        >
          {saving ? "Adding…" : selected.size ? `Add ${selected.size}` : "Select titles"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </Page>
  );
}
