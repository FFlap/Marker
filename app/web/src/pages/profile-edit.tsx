import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Camera, Globe2, LockKeyhole, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDemoMode } from "@/lib/utils";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function ProfileEditPage() {
  const demo = isDemoMode();
  const profileQuery = useQuery(api.profiles.me, demo ? "skip" : {});
  const profile = demo
    ? { username: "demo_viewer", isPublic: true, avatarUrl: undefined }
    : profileQuery;
  const save = useMutation(api.profiles.save);
  const generateUploadUrl = useMutation(api.profiles.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profiles.setAvatar);
  const removeAvatar = useMutation(api.profiles.removeAvatar);
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [error, setError] = useState("");
  const profileUsername = profile?.username;
  const profileIsPublic = profile?.isPublic;

  useEffect(() => {
    if (profileIsPublic === undefined) return;
    setUsername(profileUsername ?? "");
    setIsPublic(profileIsPublic);
  }, [profileIsPublic, profileUsername]);

  const submit = async () => {
    const value = username.trim();
    if (demo) return;
    if (!/^[A-Za-z0-9_]{3,24}$/.test(value)) {
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

  const upload = async (file: File | undefined) => {
    if (!file || demo) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Choose an image under 5 MB.");
      return;
    }
    if (demo) return;
    setPhotoPending(true);
    setError("");
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const payload = (await response.json()) as { storageId?: string };
      if (!payload.storageId) throw new Error("Upload failed");
      await setAvatar({ storageId: payload.storageId as Id<"_storage"> });
    } catch {
      setError("Couldn’t update your profile photo.");
    } finally {
      setPhotoPending(false);
    }
  };

  const clearAvatar = async () => {
    setPhotoPending(true);
    try {
      await removeAvatar();
    } catch {
      setError("Couldn’t remove your profile photo.");
    } finally {
      setPhotoPending(false);
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
                onChange={(event) => void upload(event.target.files?.[0])}
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
          <Button disabled={demo || saving || photoPending || !username.trim()} onClick={() => void submit()}>
            {saving ? "Saving…" : demo ? "Preview only" : "Save changes"}
          </Button>
        </div>
      )}
    </Page>
  );
}
