import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_UPLOAD_TIMEOUT_MS = 30_000;

export function useAvatarUpload(onError: (message: string) => void) {
  const generateUploadUrl = useMutation(api.profiles.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profiles.setAvatar);
  const removeAvatar = useMutation(api.profiles.removeAvatar);
  const [pending, setPending] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      onError("Choose an image under 5 MB.");
      return;
    }
    setPending(true);
    onError("");
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
        signal: AbortSignal.timeout(AVATAR_UPLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("Upload failed");
      const payload = (await response.json()) as { storageId?: string };
      if (!payload.storageId) throw new Error("Upload failed");
      await setAvatar({ storageId: payload.storageId as Id<"_storage"> });
    } catch {
      onError("Couldn’t update your profile photo.");
    } finally {
      setPending(false);
    }
  };

  const clear = async () => {
    setPending(true);
    onError("");
    try {
      await removeAvatar();
    } catch {
      onError("Couldn’t remove your profile photo.");
    } finally {
      setPending(false);
    }
  };

  return { pending, upload, clear };
}
