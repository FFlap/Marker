import { useState } from "react";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type EntryStatus = "watched" | "watching" | "watchlist" | "dropped";

export type EntryDraft = {
  status: EntryStatus;
  rating?: number;
  timesWatched: number;
  tags: string[];
};
const emptySuggestions: string[] = [];

export function RatingControl({
  value,
  onChange,
}: {
  value?: number;
  onChange: (value?: number) => void;
}) {
  const starValue = (value ?? 0) / 2;
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Your Rating
        </span>
        {value !== undefined ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label="Current rating">
        {Array.from({ length: 5 }, (_, index) => {
          const fill = Math.max(0, Math.min(1, starValue - index));
          const halfRating = index + 0.5;
          const wholeRating = index + 1;
          return (
            <span key={wholeRating} className="relative size-11 sm:size-8">
              <Star
                className="absolute inset-0 size-7 text-muted-foreground"
                strokeWidth={1.6}
              />
              {fill > 0 ? (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                  aria-hidden="true"
                >
                  <Star
                    className="size-7 fill-foreground text-foreground"
                    strokeWidth={1.6}
                  />
                </span>
              ) : null}
              <input
                type="radio"
                name="entry-rating"
                aria-label={`Rate ${halfRating} stars`}
                checked={starValue === halfRating}
                onChange={() => onChange(halfRating * 2)}
                className="absolute inset-y-0 left-0 z-10 h-full w-1/2 cursor-pointer opacity-0"
              />
              <input
                type="radio"
                name="entry-rating"
                aria-label={`Rate ${wholeRating} ${wholeRating === 1 ? "star" : "stars"}`}
                checked={starValue === wholeRating}
                onChange={() => onChange(wholeRating * 2)}
                className="absolute inset-y-0 right-0 z-10 h-full w-1/2 cursor-pointer opacity-0"
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function TagEditor({
  tags,
  suggestions = emptySuggestions,
  onChange,
}: {
  tags: string[];
  suggestions?: string[];
  onChange: (tags: string[]) => void;
}) {
  const [tagText, setTagText] = useState("");
  const addTag = (tagValue = tagText) => {
    const tag = tagValue.trim();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setTagText("");
  };
  return (
    <div>
      <span className="text-[11px] font-semibold text-muted-foreground">
        Tags
      </span>
      <div className="mt-2 flex gap-2">
        <Input
          value={tagText}
          onChange={(event) => setTagText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="Add a tag"
        />
        <Button variant="ghost" onClick={() => addTag()}>
          Add
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <button
            type="button"
            key={tag}
            onClick={() =>
              onChange(tags.filter((candidate) => candidate !== tag))
            }
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground sm:min-h-9"
          >
            {tag} <X className="size-3" />
          </button>
        ))}
        {suggestions
          .filter((tag) => !tags.includes(tag))
          .slice(0, 5)
          .map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => addTag(tag)}
              className="min-h-11 rounded-full border border-border px-3 text-xs text-muted-foreground sm:min-h-9"
            >
              + {tag}
            </button>
          ))}
      </div>
    </div>
  );
}

const statusOptions: Array<{ label: string; value: EntryStatus }> = [
  { label: "Watched", value: "watched" },
  { label: "Watching", value: "watching" },
  { label: "Watchlist", value: "watchlist" },
  { label: "Dropped", value: "dropped" },
];

export function LibraryEntryControls({
  value,
  suggestions = emptySuggestions,
  onChange,
}: {
  value: EntryDraft;
  suggestions?: string[];
  onChange: (value: EntryDraft) => void;
}) {
  const updateStatus = (status: EntryStatus) =>
    onChange({
      ...value,
      status,
      timesWatched:
        status === "watched"
          ? Math.max(1, value.timesWatched)
          : status === "watchlist" || status === "dropped"
            ? 0
            : value.timesWatched,
    });

  return (
    <div className="grid gap-6">
      <div className="grid gap-2.5">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Status
        </span>
        <div
          className="grid grid-cols-4 rounded-xl bg-card p-1"
          role="radiogroup"
          aria-label="Status"
        >
          {statusOptions.map((option) => (
            <label key={option.value} className="relative cursor-pointer">
              <input
                type="radio"
                name="entry-status"
                value={option.value}
                checked={value.status === option.value}
                onChange={() => updateStatus(option.value)}
                className="peer sr-only"
              />
              <span className="grid min-h-11 place-items-center rounded-lg px-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring sm:min-h-10">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      <RatingControl
        value={value.rating}
        onChange={(rating) => onChange({ ...value, rating })}
      />

      {value.status === "watched" ? (
        <div className="flex items-center gap-3">
          <span className="mr-auto text-[11px] font-semibold text-muted-foreground">
            Times Watched
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Decrease times watched"
            disabled={value.timesWatched <= 1}
            onClick={() =>
              onChange({
                ...value,
                timesWatched: Math.max(1, value.timesWatched - 1),
              })
            }
          >
            −
          </Button>
          <span className="min-w-10 text-center text-lg tabular-nums">
            {value.timesWatched}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Increase times watched"
            onClick={() =>
              onChange({
                ...value,
                timesWatched: Math.min(99, value.timesWatched + 1),
              })
            }
          >
            +
          </Button>
        </div>
      ) : null}

      <TagEditor
        tags={value.tags}
        suggestions={suggestions}
        onChange={(tags) => onChange({ ...value, tags })}
      />
    </div>
  );
}
