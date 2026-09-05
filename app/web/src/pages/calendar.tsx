import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Film, Tv2 } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Page, PageHeader } from "@/components/page";

type CalendarEvent = {
  id: string;
  date: string;
  kind: "movie" | "episode";
  title: string;
  status: "watched" | "watching" | "watchlist";
  season?: number;
  episode?: number;
  episodeName?: string;
};

function CalendarDay({
  day,
  events,
  inMonth,
  active,
  onSelect,
}: {
  day: Date;
  events: CalendarEvent[];
  inMonth: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return () => undefined;
    const update = () => {
      const nextHeight = element.getBoundingClientRect().height;
      setHeight((current) =>
        Math.abs(current - nextHeight) > 0.5 ? nextHeight : current,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rowCapacity = Math.max(2, Math.floor((height - 29) / 16));
  const hasOverflow = events.length > rowCapacity;
  const visibleCount = hasOverflow
    ? Math.max(0, rowCapacity - 1)
    : events.length;
  const overflowCount = events.length - visibleCount;

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      aria-label={`${day.toLocaleDateString()}, ${events.length} release${events.length === 1 ? "" : "s"}`}
      onClick={onSelect}
      className={`aspect-[.68] min-h-11 min-w-0 overflow-hidden border-b border-r border-border p-1 text-left transition sm:aspect-[.86] sm:p-1.5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? "bg-card ring-1 ring-inset ring-foreground" : ""}`}
    >
      <span className="flex size-full min-w-0 flex-col gap-1">
        <span
          className={`block text-right text-[10px] font-semibold tabular-nums sm:text-[11px] ${!inMonth ? "text-muted-foreground" : ""}`}
        >
          {day.getDate()}
        </span>
        {inMonth && events.length > 0 && (
          <span className="grid min-w-0 gap-0.5 overflow-hidden">
            {events.slice(0, visibleCount).map((event) => (
              <span
                key={event.id}
                className="block truncate rounded bg-secondary px-1 py-0.5 text-[8px] font-semibold leading-3 text-secondary-foreground sm:px-1.5 sm:text-[9px]"
              >
                {event.title}
              </span>
            ))}
            {hasOverflow && (
              <span className="truncate px-1 text-[8px] leading-3 text-muted-foreground sm:text-[9px]">
                +{overflowCount} more
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);
const monthEnd = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0);
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

function regionFromLocale() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && /^[A-Z]{2}$/u.test(region) ? region : "US";
  } catch {
    return "US";
  }
}

export function CalendarPage() {
  const fetchUpcoming = useAction(api.calendar.upcoming);
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>();
  const [error, setError] = useState("");
  const [partialFailure, setPartialFailure] = useState("");
  const start = monthStart(month);
  const end = monthEnd(month);
  const startDate = dateKey(start);
  const endDate = dateKey(end);
  const gridStart = addDays(start, -start.getDay());
  const days = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const result = await fetchUpcoming({
          startDate,
          endDate,
          region: regionFromLocale(),
        });
        if (!ignore) {
          setError("");
          setEvents(result.events as CalendarEvent[]);
          setPartialFailure(
            result.failedTitles.count > 0
              ? `Some titles could not be loaded${result.failedTitles.names.length ? `: ${result.failedTitles.names.join(", ")}` : "."}`
              : "",
          );
        }
      } catch {
        if (!ignore) {
          setEvents([]);
          setError("Couldn’t refresh release dates. Try again shortly.");
        }
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [endDate, fetchUpcoming, startDate]);

  const changeMonth = (next: Date) => {
    const nextMonth = monthStart(next);
    setEvents(undefined);
    setError("");
    setPartialFailure("");
    setMonth(nextMonth);
    setSelectedDate(dateKey(nextMonth));
  };

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events ?? [])
      map.set(event.date, [...(map.get(event.date) ?? []), event]);
    return map;
  }, [events]);
  const selectedEvents = byDate.get(selectedDate) ?? [];

  return (
    <Page width="wide" className="max-w-5xl">
      <PageHeader title="Calendar" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
        <section>
          {partialFailure && (
            <output className="mb-3 block text-xs leading-5 text-muted-foreground">
              {partialFailure}
            </output>
          )}
          <div className="mb-5 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                changeMonth(
                  new Date(month.getFullYear(), month.getMonth() - 1, 1),
                )
              }
              className="grid size-11 place-items-center rounded-full bg-transparent transition hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-10"
            >
              <ChevronLeft className="size-4" />
            </button>
            <h2 className="text-[17px] font-bold">
              {month.toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                changeMonth(
                  new Date(month.getFullYear(), month.getMonth() + 1, 1),
                )
              }
              className="grid size-11 place-items-center rounded-full bg-transparent transition hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-10"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7">
            {[
              ["sun", "S"],
              ["mon", "M"],
              ["tue", "T"],
              ["wed", "W"],
              ["thu", "T"],
              ["fri", "F"],
              ["sat", "S"],
            ].map(([key, day]) => (
              <div
                key={key}
                className="pb-2 text-center text-[9px] font-bold text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 border-l border-t border-border">
            {days.map((day) => {
              const key = dateKey(day);
              const inMonth = day.getMonth() === month.getMonth();
              const active = selectedDate === key;
              const dayEvents = byDate.get(key) ?? [];
              return (
                <CalendarDay
                  key={key}
                  day={day}
                  events={dayEvents}
                  inMonth={inMonth}
                  active={active}
                  onSelect={() => setSelectedDate(key)}
                />
              );
            })}
          </div>
        </section>
        <aside className="mt-7 lg:sticky lg:top-8 lg:mt-0 lg:border-l lg:border-border lg:pl-8">
          <h2 className="text-[10px] font-bold uppercase tracking-[.06em] text-muted-foreground">
            {new Date(`${selectedDate}T00:00:00`).toLocaleDateString(
              undefined,
              {
                weekday: "long",
                month: "long",
                day: "numeric",
              },
            )}
          </h2>
          {events === undefined ? (
            <div className="mt-4 grid gap-2">
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-16 animate-pulse rounded-xl bg-card"
                />
              ))}
            </div>
          ) : error ? (
            <p role="alert" className="mt-4 text-xs leading-5 text-destructive">
              {error}
            </p>
          ) : selectedEvents.length ? (
            <div className="mt-2 divide-y divide-border">
              {selectedEvents.map((event) => (
                <article key={event.id} className="flex gap-3 py-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-card">
                    {event.kind === "movie" ? (
                      <Film className="size-4" />
                    ) : (
                      <Tv2 className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <strong className="block truncate text-[13px]">
                      {event.title}
                    </strong>
                    {event.episodeName && (
                      <p className="mt-1 truncate text-[11px] text-foreground">
                        {event.episodeName}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {event.kind === "episode"
                        ? `Season ${event.season} · Episode ${event.episode}`
                        : "Movie release"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm font-semibold">No releases</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Choose a marked date to see what’s coming up.
              </p>
            </div>
          )}
        </aside>
      </div>
    </Page>
  );
}
