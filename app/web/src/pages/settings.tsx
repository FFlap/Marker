import { useState } from "react";
import { useClerk } from "@clerk/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { Button } from "@/components/ui/button";

type Preferences = {
  defaultView: "list" | "posters";
  gridColumns: 3 | 4 | 5;
  listTextSize: "small" | "medium" | "large";
  listColumns: 1 | 2;
  activityRatings: boolean;
  activityWatching: boolean;
  activityWatched: boolean;
};
type FailedPreference = {
  [K in keyof Preferences]: { key: K; value: Preferences[K] };
}[keyof Preferences];

const defaults: Preferences = {
  defaultView: "list",
  gridColumns: 3,
  listTextSize: "medium",
  listColumns: 1,
  activityRatings: true,
  activityWatching: true,
  activityWatched: true,
};
const densityPreviewKeys = ["one", "two", "three", "four", "five"];

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-flow-col auto-cols-fr rounded-xl bg-card p-1">
      {options.map((option) => (
        <button
          type="button"
          key={String(option.value)}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 sm:min-h-10 ${value === option.value ? "border-border bg-accent text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-16 w-full items-center gap-5 border-b border-border py-3 text-left disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <strong className="block text-sm">{label}</strong>
        <span className="mt-1 block text-xs text-muted-foreground">
          {detail}
        </span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full p-[3px] transition ${checked ? "bg-foreground" : "bg-accent"}`}
      >
        <span
          className={`block size-[18px] rounded-full transition-transform ${checked ? "translate-x-5 bg-background" : "bg-muted-foreground"}`}
        />
      </span>
    </button>
  );
}

export function SettingsPage() {
  const stored = useQuery(api.settings.getSettings, {});
  const save = useMutation(api.settings.setSettings);
  const { signOut } = useClerk();
  const [overrides, setOverrides] = useState<Partial<Preferences>>({});
  const [saving, setSaving] = useState<keyof Preferences>();
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [failedPreference, setFailedPreference] =
    useState<FailedPreference>();
  const current: Preferences = { ...defaults, ...stored, ...overrides };

  const update = async <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    if (saving) return;
    setOverrides({ [key]: value });
    setSaving(key);
    setError("");
    try {
      await save({ [key]: value });
      setOverrides((old) => {
        const next = { ...old };
        delete next[key];
        return next;
      });
      setFailedPreference(undefined);
    } catch {
      setFailedPreference({ key, value } as FailedPreference);
      setError(
        "Couldn’t save that preference. Your selection is kept locally so you can retry.",
      );
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <Page width="compact">
      <PageHeader title="Settings" />
      {error && (
        <div role="alert" className="mt-5 text-sm text-destructive">
          <p>{error}</p>
          {failedPreference ? (
            <button
              type="button"
              disabled={Boolean(saving)}
              className="mt-2 underline disabled:opacity-50"
              onClick={() =>
                void update(failedPreference.key, failedPreference.value)
              }
            >
              Retry
            </button>
          ) : null}
        </div>
      )}
      <div className="mt-6">
        <section>
          <div className="grid gap-7">
            <div className="grid gap-3">
              <div>
                <h3 className="text-sm font-bold">Default view</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used across Library and Tags
                </p>
              </div>
              <Segmented
                disabled={Boolean(saving)}
                options={[
                  { label: "List", value: "list" },
                  { label: "Posters", value: "posters" },
                ]}
                value={current.defaultView}
                onChange={(value) => void update("defaultView", value)}
              />
            </div>
            {current.defaultView === "posters" ? (
              <div className="grid gap-3">
                <div>
                  <h3 className="text-sm font-bold">Grid scale</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose how many posters fit in each row
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([3, 4, 5] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={current.gridColumns === value}
                      disabled={Boolean(saving)}
                      onClick={() => void update("gridColumns", value)}
                      className={`grid min-h-24 place-items-center gap-2 rounded-xl border p-3 transition ${current.gridColumns === value ? "border-foreground bg-card" : "border-border text-muted-foreground"}`}
                    >
                      <span
                        className="flex w-full items-center justify-center gap-1"
                        aria-hidden="true"
                      >
                        {densityPreviewKeys.slice(0, value).map((key) => (
                          <span
                            key={key}
                            className={`aspect-[2/3] w-full max-w-4 rounded-sm ${current.gridColumns === value ? "bg-foreground" : "bg-muted-foreground"}`}
                          />
                        ))}
                      </span>
                      <span className="text-xs font-semibold">{value}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-3">
                  <div>
                    <h3 className="text-sm font-bold">Text size</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Adjust title and rating readability
                    </p>
                  </div>
                  <Segmented
                    disabled={Boolean(saving)}
                    options={[
                      { label: "Small", value: "small" },
                      { label: "Standard", value: "medium" },
                      { label: "Large", value: "large" },
                    ]}
                    value={current.listTextSize}
                    onChange={(value) => void update("listTextSize", value)}
                  />
                </div>
                <div className="grid gap-3">
                  <div>
                    <h3 className="text-sm font-bold">List layout</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Fit more titles without switching to posters
                    </p>
                  </div>
                  <Segmented
                    disabled={Boolean(saving)}
                    options={[
                      { label: "One column", value: 1 as const },
                      { label: "Two columns", value: 2 as const },
                    ]}
                    value={current.listColumns}
                    onChange={(value) => void update("listColumns", value)}
                  />
                </div>
              </>
            )}
          </div>
        </section>
        <section className="mt-10 border-t border-border pt-7">
          <SectionHeader title="NOTIFICATIONS" />
          <p className="mt-4 text-[13px] leading-5 text-muted-foreground">
            Choose which updates appear in the activity feed from people you
            follow.
          </p>
          <div className="mt-3">
            <Toggle
              label="Ratings"
              detail="Ratings shared by people you follow"
              checked={current.activityRatings}
              disabled={Boolean(saving)}
              onChange={(value) => void update("activityRatings", value)}
            />
            <Toggle
              label="Watching"
              detail="When someone starts watching a title"
              checked={current.activityWatching}
              disabled={Boolean(saving)}
              onChange={(value) => void update("activityWatching", value)}
            />
            <Toggle
              label="Watched"
              detail="Finished titles and watched episodes"
              checked={current.activityWatched}
              disabled={Boolean(saving)}
              onChange={(value) => void update("activityWatched", value)}
            />
          </div>
        </section>
        <section className="mt-10 border-t border-border pt-7">
          <SectionHeader title="EXTENSION SYNC" />
          <p className="mt-4 text-[13px] leading-5 text-muted-foreground">
            Install the Marker Chrome extension and sign in with this same
            account to sync watch history automatically.
          </p>
        </section>
        <section className="mt-11">
          <div>
            <Button
              variant="destructive"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                setSignOutError("");
                void signOut()
                  .catch(() => setSignOutError("Couldn’t sign out. Please try again."))
                  .finally(() => setSigningOut(false));
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
            {signOutError && <p role="alert" className="mt-3 text-sm text-destructive">{signOutError}</p>}
          </div>
        </section>
      </div>
    </Page>
  );
}
