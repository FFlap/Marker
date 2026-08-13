import { SlidersHorizontal } from "lucide-react";
import { ChipGroup } from "@/components/chip-group";
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
export function FilterDialog({
  value,
  onChange,
  availableTags = noTags,
  showTags = true,
}: {
  value: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
  availableTags?: string[];
  showTags?: boolean;
}) {
  const active =
    value.media !== "all" ||
    value.minimum > 0 ||
    value.status !== "all" ||
    (showTags && value.tags.length > 0);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-11 rounded-full border-0 bg-transparent hover:bg-transparent sm:size-9"
          aria-label={
            active ? "Library filters, filters active" : "Library filters"
          }
        >
          <SlidersHorizontal className="size-[18px]" />
          {active && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground"
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Filter library</DialogTitle>
        <ChipGroup
          label="Status"
          options={statuses.map((status) => ({
            value: status,
            label:
              status === "all"
                ? "All"
                : status[0].toUpperCase() + status.slice(1),
          }))}
          value={value.status}
          onChange={(status) => onChange({ ...value, status })}
        />
        <ChipGroup
          label="Type"
          options={(["all", "movie", "tv", "anime"] as const).map(
            (media) => ({
              value: media,
              label:
                media === "tv"
                  ? "TV shows"
                  : media[0].toUpperCase() + media.slice(1),
            }),
          )}
          value={value.media}
          onChange={(media) => onChange({ ...value, media })}
        />
        <ChipGroup
          label="Minimum rating"
          options={[0, 9, 8, 7, 6].map((minimum) => ({
            value: minimum,
            label: minimum ? `${minimum}+` : "Any",
          }))}
          value={value.minimum}
          onChange={(minimum) => onChange({ ...value, minimum })}
        />
        {showTags && availableTags.length > 0 ? (
          <ChipGroup
            label="Tags"
            className="max-h-36 overflow-y-auto"
            options={availableTags.map((tag) => ({
              value: tag,
              label: tag,
              ariaLabel: `Tag: ${tag}`,
            }))}
            value=""
            isSelected={(tag) => value.tags.includes(tag)}
            onChange={(tag) => {
              const selected = value.tags.includes(tag);
              onChange({
                ...value,
                tags: selected
                  ? value.tags.filter((entry) => entry !== tag)
                  : [...value.tags, tag],
              });
            }}
          />
        ) : null}
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
