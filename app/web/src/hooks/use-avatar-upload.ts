import { useOperation } from "./use-operation";
import { avatarStep, uploadAvatar } from "@marker/shared/clientEffects";
import { useAuth } from "@clerk/react";
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@marker/shared/api";
import type { Id } from "@marker/shared/dataModel";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function useAvatarUpload(onError: (message: string) => void) {
  const { getToken } = useAuth();
  const generateUploadUrl = useMutation(api.profiles.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profiles.setAvatar);
  const removeAvatar = useMutation(api.profiles.removeAvatar);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = useOperation();
  const finish = () => {
    busy.current = false;
    setPending(false);
  };

  const upload = (file: File | undefined) => {
    if (!file || busy.current) return Promise.resolve();
    if (file.size > MAX_AVATAR_BYTES) {
      onError("Choose an image under 5 MB.");
      return Promise.resolve();
    }
    busy.current = true;
    setPending(true);
    onError("");
    return run.write(
      uploadAvatar({
        blob: file,
        contentType: file.type || "image/jpeg",
        uploadPath: generateUploadUrl,
        token: getToken,
        resolveUrl: (uploadPath) => {
          const siteUrl =
            import.meta.env.VITE_CONVEX_SITE_URL ??
            import.meta.env.VITE_CONVEX_URL?.replace(
              /\.convex\.cloud$/u,
              ".convex.site",
            );
          if (!siteUrl) throw new Error("Convex site URL is required");
          const uploadUrl = new URL(uploadPath, siteUrl);
          const local =
            import.meta.env.DEV &&
            uploadUrl.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(uploadUrl.hostname);
          if (uploadUrl.protocol !== "https:" && !local)
            throw new Error("Upload requires HTTPS");
          if (uploadUrl.origin !== new URL(siteUrl).origin)
            throw new Error("Invalid upload origin");
          return uploadUrl;
        },
        publish: (storageId) =>
          setAvatar({ storageId: storageId as Id<"_storage"> }),
      }),
      {
        failure: () => onError("Couldn’t update your profile photo."),
        settled: finish,
      },
    );
  };
  const clear = () => {
    if (busy.current) return Promise.resolve();
    busy.current = true;
    setPending(true);
    onError("");
    return run.write(
      avatarStep(() => removeAvatar()),
      {
        failure: () => onError("Couldn’t remove your profile photo."),
        settled: finish,
      },
    );
  };
  return { pending, upload, clear };
}
