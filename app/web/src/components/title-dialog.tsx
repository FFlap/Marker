import {
  useEffect,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Search } from "lucide-react";
import { api } from "../../../mobile/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { LibraryEntryControls } from "@/components/library-entry-controls";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { posterUrl } from "@/lib/utils";

export type SearchResult = {
  id: number;
  title: string;
  mediaType: "movie" | "tv";
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
};

type DialogState = {
  query: string;
  results: SearchResult[];
  selected?: SearchResult;
  status: "watching" | "watchlist" | "watched" | "dropped";
  rating: string;
  timesWatched: string;
  tags: string;
  busy: boolean;
  error: string;
};

const initialState: DialogState = {
  query: "",
  results: [],
  status: "watchlist",
  rating: "",
  timesWatched: "0",
  tags: "",
  busy: false,
  error: "",
};
const freshTitleFields = {
  status: "watchlist" as const,
  rating: "",
  timesWatched: "0",
  tags: "",
  error: "",
};

type DialogAction =
  | { type: "patch"; value: Partial<DialogState> }
  | { type: "reset"; selected?: SearchResult };

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  if (action.type === "reset")
    return { ...initialState, selected: action.selected };
  return { ...state, ...action.value };
}

export function AddTitleDialog({
  children,
  initialSelection,
  onAdded,
}: {
  children: ReactNode;
  initialSelection?: SearchResult;
  onAdded?: (itemId: string) => void;
}) {
  const searchTitles = useAction(api.tmdb.searchMulti);
  const addItemAndMarkWatched = useAction(api.library.addItemAndMarkWatched);
  const addItem = useMutation(api.library.addItem);
  const touchTitle = useMutation(api.resolvedMetadata.touchTitle);
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(dialogReducer, {
    ...initialState,
    selected: initialSelection,
  });
  const {
    query,
    results,
    selected,
    status,
    rating,
    timesWatched,
    tags,
    busy,
    error,
  } = state;
  const resolvedTitle = useQuery(
    api.resolvedMetadata.getTitle,
    selected ? { mediaType: selected.mediaType, tmdbId: selected.id } : "skip",
  );
  const suggestions = useQuery(
    api.library.listTagSuggestions,
    !open || !selected ? "skip" : {},
  );
  const canonicalRuntime =
    resolvedTitle?.runtime ??
    (resolvedTitle?.episodeRunTime.length
      ? resolvedTitle.episodeRunTime.reduce(
          (total, value) => total + value,
          0,
        ) / resolvedTitle.episodeRunTime.length
      : selected?.runtime);

  useEffect(() => {
    if (!selected) return;
    void touchTitle({
      mediaType: selected.mediaType,
      tmdbId: selected.id,
      title: selected.title,
    }).catch(() => undefined);
  }, [selected, touchTitle]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    dispatch({ type: "patch", value: { busy: true, error: "" } });
    try {
      dispatch({
        type: "patch",
        value: { results: await searchTitles({ query: query.trim() }) },
      });
    } catch {
      dispatch({
        type: "patch",
        value: { error: "Couldn’t search right now. Try again." },
      });
    } finally {
      dispatch({ type: "patch", value: { busy: false } });
    }
  };

  const save = async () => {
    if (!selected) return;
    const numericRating = rating === "" ? undefined : Number(rating);
    const numericTimesWatched = Number(timesWatched);
    if (
      numericRating !== undefined &&
      (!Number.isFinite(numericRating) ||
        numericRating < 0 ||
        numericRating > 10)
    ) {
      dispatch({
        type: "patch",
        value: { error: "Rating must be between 0 and 10." },
      });
      return;
    }
    if (!Number.isInteger(numericTimesWatched) || numericTimesWatched < 0) {
      dispatch({
        type: "patch",
        value: { error: "Times watched must be a non-negative number." },
      });
      return;
    }
    dispatch({ type: "patch", value: { busy: true, error: "" } });
    try {
      const addArgs = {
        tmdbId: selected.id,
        mediaType: selected.mediaType,
        title: selected.title,
        ...(selected.posterPath && { posterPath: selected.posterPath }),
        ...(selected.overview && { overview: selected.overview }),
        ...(selected.releaseDate && { releaseDate: selected.releaseDate }),
        ...(canonicalRuntime !== undefined && { runtime: canonicalRuntime }),
        ...((resolvedTitle?.genres ?? selected.genres) && {
          genres: resolvedTitle?.genres ?? selected.genres,
        }),
        status,
        ...(numericRating !== undefined && { rating: numericRating }),
        timesWatched: numericTimesWatched,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      const itemId =
        selected.mediaType === "tv" && status === "watched"
          ? await addItemAndMarkWatched(addArgs)
          : await addItem(addArgs);
      setOpen(false);
      dispatch({ type: "reset", selected: initialSelection });
      onAdded?.(String(itemId));
    } catch (cause) {
      dispatch({
        type: "patch",
        value: {
          error:
            cause instanceof Error && /already exists/i.test(cause.message)
              ? "That title is already in your library."
              : "Couldn’t add this title. Check the rating and try again.",
        },
      });
    } finally {
      dispatch({ type: "patch", value: { busy: false } });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        dispatch({
          type: "reset",
          selected: next ? initialSelection : undefined,
        });
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogTitle>{selected ? "Add to library" : "Add a title"}</DialogTitle>
        {selected ? (
          <>
            {!initialSelection ? (
              <div className="grid grid-cols-[74px_1fr] items-center gap-4">
                <div className="aspect-[2/3] overflow-hidden rounded-lg bg-card">
                  {selected.posterPath && (
                    <img
                      src={posterUrl(selected.posterPath)}
                      alt=""
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <strong className="block truncate text-base">
                    {selected.title}
                  </strong>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {selected.releaseDate?.slice(0, 4) ?? "—"} ·{" "}
                    {selected.mediaType === "movie" ? "Movie" : "TV Show"}
                  </span>
                </div>
              </div>
            ) : null}
            <LibraryEntryControls
              value={{
                status,
                rating: rating === "" ? undefined : Number(rating),
                timesWatched: Number(timesWatched),
                tags: tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              }}
              suggestions={suggestions ?? []}
              onChange={(next) =>
                dispatch({
                  type: "patch",
                  value: {
                    status: next.status,
                    rating:
                      next.rating === undefined ? "" : String(next.rating),
                    timesWatched: String(next.timesWatched),
                    tags: next.tags.join(", "),
                  },
                })
              }
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {!initialSelection && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    dispatch({
                      type: "patch",
                      value: { selected: undefined, ...freshTitleFields },
                    })
                  }
                >
                  Back
                </Button>
              )}
              <Button onClick={() => void save()} disabled={busy}>
                <Check className="size-4" />{" "}
                {busy ? "Adding…" : "Add to library"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={search} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search TMDB"
                  value={query}
                  onChange={(event) =>
                    dispatch({
                      type: "patch",
                      value: { query: event.target.value },
                    })
                  }
                  placeholder="Search TMDB"
                  className="pl-10"
                />
              </div>
              <Button
                type="submit"
                disabled={busy || query.trim().length < 2}
              >
                {busy ? "Searching…" : "Search"}
              </Button>
            </form>
            {results.length ? (
              <div className="grid max-h-80 gap-1 overflow-y-auto">
                {results.map((result) => (
                  <button
                    type="button"
                    key={`${result.mediaType}:${result.id}`}
                    onClick={() =>
                      dispatch({
                        type: "patch",
                        value: { selected: result, ...freshTitleFields },
                      })
                    }
                    className="flex min-h-11 items-center gap-3 rounded-xl p-2 text-left hover:bg-card"
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-card">
                      {result.posterPath && (
                        <img
                          src={posterUrl(result.posterPath)}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      )}
                    </div>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">
                        {result.title}
                      </strong>
                      <span className="mt-1 block text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                        {result.mediaType === "tv" ? "TV series" : "Movie"} ·{" "}
                        {result.releaseDate?.slice(0, 4) || "—"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : query.trim().length >= 2 && !busy ? (
              <p className="py-5 text-center text-xs text-muted-foreground">
                No matches yet.
              </p>
            ) : null}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
