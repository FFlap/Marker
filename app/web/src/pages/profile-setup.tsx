import { useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "../../../mobile/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeInternalPath } from "@/lib/utils";
import { useAvatarUpload } from "@/hooks/use-avatar-upload";
import { USERNAME_PATTERN } from "@/lib/profile";

export function ProfileSetupPage() {
  const profile = useQuery(api.profiles.me, {});
  const save = useMutation(api.profiles.save);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { next?: string };
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { pending: photoPending, upload, clear: clearAvatar } =
    useAvatarUpload(setError);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = username.trim();
    if (!USERNAME_PATTERN.test(value)) {
      setError("Choose 3–24 letters, numbers, or underscores.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({ username: value, isPublic: profile?.isPublic ?? false });
      await navigate({ to: safeInternalPath(search.next) });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        /taken/i.test(message)
          ? "That username is already taken."
          : /username|letters|numbers|underscore|3.?24/i.test(message)
            ? "Choose 3–24 letters, numbers, or underscores."
            : "Couldn’t save your profile. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-6 pb-12 pt-16">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Marker</p>
        <h1 className="mt-3 text-[34px] font-bold tracking-[-.035em]">Create your profile</h1>
        <p className="mt-2.5 max-w-md text-sm leading-5 text-muted-foreground">
          Choose how you’ll appear. You can change profile visibility later.
        </p>
        <form onSubmit={submit} className="mt-12 grid gap-4">
          <div className="mb-3 flex items-center gap-5">
            <label className="group relative grid size-24 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-card text-xl font-bold">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                username[0]?.toUpperCase() ?? "M"
              )}
              <span className="absolute bottom-0 right-0 grid size-8 place-items-center rounded-full border-2 border-background bg-foreground text-background">
                <Camera className="size-4" />
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="sr-only"
                disabled={photoPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void upload(file);
                }}
              />
            </label>
            <div>
              <strong className="text-sm">{profile?.avatarUrl ? "Your photo" : "Add a photo"}</strong>
              <p className="mt-1 text-xs text-muted-foreground">Square images work best. Up to 5 MB.</p>
              {profile?.avatarUrl && (
                <Button type="button" variant="ghost" size="sm" className="mt-2 text-muted-foreground" disabled={photoPending} onClick={() => void clearAvatar()}>
                  <Trash2 className="size-4" /> Remove
                </Button>
              )}
            </div>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
              @
            </span>
            <Input
              aria-label="Username"
              className="pl-8"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.replace(/\s/g, ""))
              }
              placeholder="username"
              maxLength={24}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={busy || photoPending || username.length < 3}
          >
            {busy ? "Saving…" : "Create profile"}
          </Button>
        </form>
      </div>
    </main>
  );
}
