import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type LibraryFilters = {
  media: "all" | "movie" | "tv" | "anime";
  minimum: number;
  status: "all" | "watched" | "watching" | "watchlist" | "dropped";
  tags: string[];
};

const statuses = [
  "all",
  "watched",
  "watching",
  "watchlist",
  "dropped",
] as const;
const noTags: string[] = [];
const chipClass = (selected: boolean) =>
  `min-h-11 rounded-full border px-3 py-1.5 text-sm font-semibold transition sm:min-h-9 ${selected ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"}`;
const labelClass = "mb-3 text-xs font-semibold text-muted-foreground";

export function FilterDialog({
  value,
  onChange,
  availableTags = noTags,
}: {
  value: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
  availableTags?: string[];
}) {
  const active =
    value.media !== "all" ||
    value.minimum > 0 ||
    value.status !== "all" ||
    value.tags.length > 0;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-11 rounded-full border-0 bg-transparent hover:bg-transparent sm:size-9"
          aria-label="Library filters"
        >
          <SlidersHorizontal className="size-[18px]" />
          {active && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Filter library</DialogTitle>
        <section>
          <p className={labelClass}>Status</p>
          <div className="flex flex-wrap gap-2">
            {statuses.map((status) => (
              <button
                type="button"
                aria-pressed={value.status === status}
                key={status}
                className={chipClass(value.status === status)}
                onClick={() => onChange({ ...value, status })}
              >
                {status === "all"
                  ? "All"
                  : status[0].toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className={labelClass}>Type</p>
          <div className="flex flex-wrap gap-2">
            {(["all", "movie", "tv", "anime"] as const).map((media) => (
              <button
                type="button"
                aria-pressed={value.media === media}
                key={media}
                className={chipClass(value.media === media)}
                onClick={() => onChange({ ...value, media })}
              >
                {media === "tv"
                  ? "TV shows"
                  : media[0].toUpperCase() + media.slice(1)}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className={labelClass}>Minimum rating</p>
          <div className="flex flex-wrap gap-2">
            {[0, 9, 8, 7, 6].map((minimum) => (
              <button
                type="button"
                aria-pressed={value.minimum === minimum}
                key={minimum}
                className={chipClass(value.minimum === minimum)}
                onClick={() => onChange({ ...value, minimum })}
              >
                {minimum ? `${minimum}+` : "Any"}
              </button>
            ))}
          </div>
        </section>
        {availableTags.length > 0 && (
          <section>
            <p className={labelClass}>Tags</p>
            <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
              {availableTags.map((tag) => {
                const selected = value.tags.includes(tag);
                return (
                  <button
                    type="button"
                    aria-label={`Tag: ${tag}`}
                    aria-pressed={selected}
                    key={tag}
                    className={chipClass(selected)}
                    onClick={() =>
                      onChange({
                        ...value,
                        tags: selected
                          ? value.tags.filter((entry) => entry !== tag)
                          : [...value.tags, tag],
                      })
                    }
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {active && (
          <Button
            variant="ghost"
            onClick={() =>
              onChange({ media: "all", minimum: 0, status: "all", tags: [] })
            }
          >
            Clear filters
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
