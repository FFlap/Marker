import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { RatingControl, TagEditor } from "@/components/library-entry-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type EpisodeView = {
  itemId: string;
  title: string;
  seasonName: string;
  season: number;
  episode: number;
  name: string;
  overview?: string;
  runtime?: number;
  rating?: number;
  tags?: string[];
  imageUrl?: string;
  watched?: boolean;
  airDate?: string;
};

export function EpisodeDialog({
  children,
  episode,
}: {
  children: ReactNode;
  episode: EpisodeView;
}) {
  const setEpisodeState = useMutation(api.library.episodes.setEpisodeState);
  const [open, setOpen] = useState(false);
  const suggestions = useQuery(
    api.library.items.listTagSuggestions,
    !open ? "skip" : {},
  );
  const [rating, setRating] = useState<number | undefined>(
    () => episode.rating,
  );
  const [tags, setTags] = useState<string[]>(() => episode.tags ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mutate = async (patch: {
    rating?: number;
    clearRating?: boolean;
    tags?: string[];
    watched?: boolean;
  }) => {
    setBusy(true);
    setError("");
    try {
      await setEpisodeState({
        itemId: episode.itemId as Id<"items">,
        season: episode.season,
        episode: episode.episode,
        seasonName: episode.seasonName,
        name: episode.name,
        ...(episode.overview !== undefined && { overview: episode.overview }),
        ...(episode.runtime !== undefined && { runtime: episode.runtime }),
        ...(episode.imageUrl !== undefined && { imageUrl: episode.imageUrl }),
        ...(episode.airDate !== undefined && { airDate: episode.airDate }),
        ...patch,
      });
      if (patch.watched === false) setOpen(false);
      return true;
    } catch {
      setError("Couldn’t update this episode. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        setOpen(next);
        if (next) {
          setRating(episode.rating);
          setTags(episode.tags ?? []);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="sr-only">Episode options</DialogTitle>
        <fieldset disabled={busy}>
          <RatingControl
            value={rating}
            onChange={(next) => {
              const previous = rating;
              setRating(next);
              void mutate(
                next === undefined ? { clearRating: true } : { rating: next },
              ).then((saved) => {
                if (!saved) setRating(previous);
                return undefined;
              });
            }}
          />
          <div className="mt-6">
            <TagEditor
              tags={tags}
              suggestions={suggestions ?? []}
              onChange={(next) => {
                const previous = tags;
                setTags(next);
                void mutate({ tags: next }).then((saved) => {
                  if (!saved) setTags(previous);
                  return undefined;
                });
              }}
            />
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {episode.watched ? (
          <Button
            variant="ghost"
            onClick={() => void mutate({ watched: false })}
            disabled={busy}
            className="justify-self-start"
          >
            {busy ? "Saving…" : "Mark episode unwatched"}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
