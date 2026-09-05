import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Camera, Globe2, LockKeyhole, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAvatarUpload } from "@/hooks/use-avatar-upload";
import { USERNAME_PATTERN } from "@/lib/profile";

export function ProfileEditPage() {
  const profile = useQuery(api.profiles.me, {});
  const save = useMutation(api.profiles.save);
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { pending: photoPending, upload, clear: clearAvatar } =
    useAvatarUpload(setError);
  const profileUsername = profile?.username;
  const profileIsPublic = profile?.isPublic;

  useEffect(() => {
    if (profileIsPublic === undefined) return;
    setUsername(profileUsername ?? "");
    setIsPublic(profileIsPublic);
  }, [profileIsPublic, profileUsername]);

  const submit = async () => {
    const value = username.trim();
    if (!USERNAME_PATTERN.test(value)) {
      setError("Use 3–24 letters, numbers, or underscores.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await save({ username: value, isPublic });
      void navigate({ to: "/profile" });
    } catch (cause) {
      setError(
        cause instanceof Error && /taken/i.test(cause.message)
          ? "That username is already taken."
          : "Couldn’t save your profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page width="compact">
      <PageHeader title="Edit profile" back backFallback="/profile" />
      {profile === undefined ? (
        <div className="mt-6 h-72 animate-pulse rounded-xl bg-card" />
      ) : (
        <div className="mt-6 grid gap-8">
          <div className="flex items-center gap-5">
            <label className="group relative grid size-24 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-card text-xl font-bold">
              {profile.avatarUrl ? (
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
              <strong className="text-sm">{profile.avatarUrl ? "Your photo" : "Add a photo"}</strong>
              <p className="mt-1 text-xs text-muted-foreground">Square images work best. Up to 5 MB.</p>
              {profile.avatarUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-muted-foreground"
                  disabled={photoPending}
                  onClick={() => void clearAvatar()}
                >
                  <Trash2 className="size-4" /> Remove
                </Button>
              )}
            </div>
          </div>

          <label className="grid gap-2 text-sm font-bold">
            Username
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <Input
                aria-label="Username"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value.replace(/\s/g, ""));
                  setError("");
                }}
                maxLength={24}
                className="pl-9"
              />
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              3–24 characters. Letters, numbers, and underscores.
            </span>
          </label>

          <fieldset>
            <legend className="text-sm font-bold">Profile visibility</legend>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                aria-pressed={isPublic}
                onClick={() => setIsPublic(true)}
                className={`flex min-h-20 items-center gap-3 rounded-xl border p-4 text-left ${isPublic ? "border-foreground bg-card" : "border-border"}`}
              >
                <Globe2 className="size-5" />
                <span>
                  <strong className="block text-sm">Public</strong>
                  <span className="text-xs text-muted-foreground">Anyone can view your profile and watch statistics.</span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={!isPublic}
                onClick={() => setIsPublic(false)}
                className={`flex min-h-20 items-center gap-3 rounded-xl border p-4 text-left ${!isPublic ? "border-foreground bg-card" : "border-border"}`}
              >
                <LockKeyhole className="size-5" />
                <span>
                  <strong className="block text-sm">Private</strong>
                  <span className="text-xs text-muted-foreground">Only you can see your profile activity.</span>
                </span>
              </button>
            </div>
          </fieldset>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button disabled={saving || photoPending || !username.trim()} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </Page>
  );
}
