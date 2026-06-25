import type { EpisodeBookmark } from '../../src/domain/types';

interface AppProps {
  bookmarks: EpisodeBookmark[];
  onOpen: (url: string) => void;
  onRemove: (seriesId: string) => void;
  onClear: () => void;
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

export function App({ bookmarks, onOpen, onRemove, onClear }: AppProps) {
  const seasonLabel = (value: string) =>
    /^\d+(?:\.\d+)?$/.test(value) ? `Season ${value}` : value;

  return (
    <main className="shell">
      <header className="masthead">
        <img className="brand-mark" src="/icon/128.png" alt="" aria-hidden="true" />
        <div>
          <h1>Marker</h1>
        </div>
        <span className="count" aria-label={`${bookmarks.length} tracked series`}>
          {bookmarks.length.toString().padStart(2, '0')}
        </span>
      </header>

      {bookmarks.length === 0 ? (
        <section className="empty">
          <div className="empty-orbit">
            <PlayIcon />
          </div>
          <h2>No episodes tracked yet</h2>
          <p>Open any episode on Crunchyroll or Netflix. Your latest stop will appear here automatically.</p>
        </section>
      ) : (
        <>
          <div className="section-label">
            <span>Continue watching</span>
            <button type="button" onClick={onClear}>
              Clear all
            </button>
          </div>
          <ol className="bookmark-list">
            {bookmarks.map((bookmark, index) => (
              <li key={bookmark.seriesId} style={{ '--index': index } as React.CSSProperties}>
                <button
                  type="button"
                  className="bookmark-card"
                  aria-label={`Continue ${bookmark.seriesTitle}, ${seasonLabel(bookmark.seasonNumber)}, episode ${bookmark.episodeNumber}`}
                  onClick={() => onOpen(bookmark.watchUrl)}
                >
                  <span className="episode-index">{bookmark.episodeNumber}</span>
                  <span className="bookmark-copy">
                    <strong>{bookmark.seriesTitle}</strong>
                    <span className="metadata">
                      <b>{seasonLabel(bookmark.seasonNumber)}</b>
                      <i />
                      <b>Episode {bookmark.episodeNumber}</b>
                    </span>
                    <span className="episode-title">{bookmark.episodeTitle}</span>
                  </span>
                  <span className="play">
                    <PlayIcon />
                  </span>
                </button>
                <button
                  type="button"
                  className="remove"
                  aria-label={`Remove ${bookmark.seriesTitle}`}
                  onClick={() => onRemove(bookmark.seriesId)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      <footer>
        <span className="pulse" />
        Tracking episodes automatically
      </footer>
    </main>
  );
}
