import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getToken: vi.fn<() => Promise<string | null>>(),
  generateUploadUrl: vi.fn<() => Promise<string>>(),
  setAvatar: vi.fn<(args: unknown) => Promise<void>>(),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}));
vi.mock("convex/react", () => ({
  useMutation: (ref: string) =>
    ref === "generate" ? mocks.generateUploadUrl : mocks.setAvatar,
}));
vi.mock("@marker/shared/api", () => ({
  api: {
    profiles: {
      generateAvatarUploadUrl: "generate",
      setAvatar: "set",
      removeAvatar: "remove",
    },
  },
}));
import { useAvatarUpload } from "@/hooks/use-avatar-upload";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("uploads to Convex with the current Clerk session token", async () => {
  mocks.generateUploadUrl.mockResolvedValue("/avatar/upload?uploadId=upload");
  mocks.getToken.mockResolvedValue("test-token");
  mocks.setAvatar.mockResolvedValue(undefined);
  vi.stubEnv("VITE_CONVEX_URL", "https://marker-test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", undefined);
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ storageId: "stored-image" })),
    );
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() =>
    useAvatarUpload(vi.fn<(message: string) => void>()),
  );
  const file = new File(["image"], "photo.png", { type: "image/png" });
  await act(async () => {
    await result.current.upload(file);
  });
  expect(mocks.getToken).toHaveBeenCalledWith();
  expect(fetchMock).toHaveBeenCalledWith(
    new URL("https://marker-test.convex.site/avatar/upload?uploadId=upload"),
    expect.objectContaining({
      method: "POST",
      body: file,
      headers: {
        "content-type": "image/png",
        authorization: "Bearer test-token",
      },
    }),
  );
  expect(mocks.setAvatar).toHaveBeenCalledWith({ storageId: "stored-image" });
});
it("does not send a token to an unrelated upload origin", async () => {
  mocks.generateUploadUrl.mockResolvedValue("https://other.example/upload");
  mocks.getToken.mockResolvedValue("test-token");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://marker-test.convex.site");
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const onError = vi.fn<(message: string) => void>();
  const { result } = renderHook(() => useAvatarUpload(onError));
  await act(async () => {
    await result.current.upload(new File(["image"], "photo.png"));
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onError).toHaveBeenLastCalledWith(
    "Couldn’t update your profile photo.",
  );
});

it("finishes an accepted upload after navigation without notifying the old screen", async () => {
  mocks.generateUploadUrl.mockResolvedValue("/avatar/upload?uploadId=upload");
  mocks.getToken.mockResolvedValue("test-token");
  mocks.setAvatar.mockResolvedValue(undefined);
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://marker-test.convex.site");
  let finishUpload!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finishUpload = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onError = vi.fn<(message: string) => void>();
  const { result, unmount } = renderHook(() => useAvatarUpload(onError));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.upload(new File(["image"], "photo.png"));
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  onError.mockClear();
  unmount();
  const signal = fetchMock.mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  finishUpload(
    new Response(JSON.stringify({ storageId: "uploaded-after-navigation" })),
  );
  await pending;
  expect(mocks.setAvatar).toHaveBeenCalledWith({
    storageId: "uploaded-after-navigation",
  });
  expect(signal?.aborted).toBe(true);
  expect(onError).not.toHaveBeenCalled();
});

it.each([
  ["https://marker-test.convex.site", false, true],
  ["http://marker-test.convex.site", false, false],
  ["http://marker-test.convex.site", true, false],
  ["http://localhost:3211", true, true],
  ["http://127.0.0.1:3211", true, true],
  ["http://[::1]:3211", true, true],
  ["http://localhost:3211", false, false],
  ["http://localhost.example:3211", true, false],
])(
  "guards upload transport for %s (development: %s)",
  async (siteUrl, dev, allowed) => {
    mocks.generateUploadUrl.mockResolvedValue("/avatar/upload?uploadId=upload");
    mocks.getToken.mockResolvedValue("test-token");
    mocks.setAvatar.mockResolvedValue(undefined);
    vi.stubEnv("VITE_CONVEX_SITE_URL", siteUrl);
    vi.stubEnv("DEV", dev);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ storageId: "stored-image" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAvatarUpload(vi.fn()));
    await act(async () => {
      await result.current.upload(new File(["image"], "photo.png"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(mocks.setAvatar).toHaveBeenCalledTimes(allowed ? 1 : 0);
  },
);
