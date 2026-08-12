import type { EpisodeBookmark } from "../../src/domain/types";
import { bookmarkKey } from "../../src/domain/bookmarks";
import React from "react";

interface AppProps {
  bookmarks: EpisodeBookmark[];
  onOpen: (url: string) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  sync?: {
    signedIn: boolean;
    accountLabel?: string;
    error?: string;
    notice?: string;
    lastResult?: { ok: boolean; at: number; reason?: string; seriesTitle?: string; unverified?: boolean };
    onConnect: () => Promise<void>;
    onSignOut: () => Promise<void>;
  };
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.25 5.2v13.6L19 12 8.25 5.2Z" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.5 4.5h7l.7 1.5H20v2H4V6h3.8l.7-1.5ZM6.5 9h11l-.7 10.5H7.2L6.5 9Z"
        fill="currentColor"
      />
    </svg>
  );
}

const seasonLabel = (value: string) =>
  /^\d+(?:\.\d+)?$/.test(value) ? `Season ${value}` : value;

export function App({ bookmarks, onOpen, onRemove, onClear, sync }: AppProps) {
  const [saving, setSaving] = React.useState(false);
  const syncResultText = sync?.lastResult && (() => {
    const title = sync.lastResult.seriesTitle?.trim();
    const shortTitle = title && title.length > 42 ? `${title.slice(0, 39)}…` : title;
    const prefix = shortTitle ? `${shortTitle}${sync.lastResult.ok ? "" : " —"}` : "Last sync";
    if (sync.lastResult.ok && sync.lastResult.unverified) return `${prefix} synced (unlisted special)`;
    if (sync.lastResult.ok) return `${prefix} synced`;
    if (sync.lastResult.reason === "unmatched-episode") return `${prefix} episode not matched by name`;
    if (sync.lastResult.reason === "unsupported-episode") return `${prefix} unsupported episode`;
    if (sync.lastResult.reason === "unmatched") return shortTitle ? `${prefix} episode couldn't be matched to a show` : "Last episode couldn't be matched to a show";
    return `${prefix} failed`;
  })();

  return (
    <main className="shell">
      <header className="masthead">
        <img
          className="brand-mark"
          src="/icon/128.png"
          alt=""
          aria-hidden="true"
        />
        <div>
          <h1>Marker</h1>
        </div>
        <span
          className="count"
          aria-label={`${bookmarks.length} tracked series`}
        >
          {bookmarks.length.toString().padStart(2, "0")}
        </span>
      </header>

      <details className="sync-settings">
        <summary>
          <span>Sync</span>
          <i className={sync?.signedIn ? "connected" : ""}>
            {sync?.signedIn ? "Signed in" : "Not signed in"}
          </i>
        </summary>
        <div className="sync-form">
          {sync?.signedIn ? (
            <p className="sync-account"><strong>Signed in</strong><br />{sync.accountLabel}</p>
          ) : <p className="sync-account"><strong>Connect your Marker account</strong><br />Sign in on the website. The extension never sees your password.</p>}
          <div aria-live="polite">
            {sync?.error && <small className="sync-error" role="alert">{sync.error}</small>}
            {sync?.notice && <small>{sync.notice}</small>}
            {sync?.lastResult && (
              <small>
                {syncResultText}{" "}
                · {new Date(sync.lastResult.at).toLocaleString()}
              </small>
            )}
          </div>
          <div>
            {sync?.signedIn ? <button type="button" className="disconnect" onClick={() => void sync.onSignOut()}>Sign out</button> :
            <button type="button" disabled={saving} onClick={async () => {
              if (!sync) return; setSaving(true);
              try { await sync.onConnect(); } finally { setSaving(false); }
            }}>{saving ? "Opening Marker…" : "Connect Marker"}</button>}
          </div>
        </div>
      </details>

      {bookmarks.length === 0 ? (
        <section className="empty">
          <div className="empty-orbit">
            <PlayIcon />
          </div>
          <h2>No episodes tracked yet</h2>
          <p>
            Open any episode on Crunchyroll or Netflix. Your latest stop will
            appear here automatically.
          </p>
        </section>
      ) : (
        <>
          <div className="section-label">
            <span>Continue watching</span>
            <button type="button" onClick={() => {
              if (window.confirm(`Clear all ${bookmarks.length} saved series? This cannot be undone.`)) onClear();
            }}>
              Clear all
            </button>
          </div>
          <div className="bookmark-scroll">
            <ol className="bookmark-list">
              {bookmarks.map((bookmark, index) => (
                <li
                  key={bookmarkKey(bookmark)}
                  style={{ "--index": index } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="bookmark-card"
                    aria-label={`Continue ${bookmark.seriesTitle}, ${seasonLabel(bookmark.seasonNumber)}, episode ${bookmark.episodeNumber}`}
                    onClick={() => onOpen(bookmark.watchUrl)}
                  >
                    <span className="episode-index">
                      {bookmark.episodeNumber}
                    </span>
                    <span className="bookmark-copy">
                      <strong>{bookmark.seriesTitle}</strong>
                      <span className="metadata">
                        <b>{seasonLabel(bookmark.seasonNumber)}</b>
                        <i />
                        <b>Episode {bookmark.episodeNumber}</b>
                      </span>
                      <span className="episode-title">
                        {bookmark.episodeTitle}
                      </span>
                    </span>
                    <span className="play">
                      <PlayIcon />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="remove"
                    aria-label={`Remove ${bookmark.seriesTitle}`}
                    onClick={() => onRemove(bookmarkKey(bookmark))}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </main>
  );
}
