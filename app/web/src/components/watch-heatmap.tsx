import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  buildActivityHeatmap,
  formatActivityDate,
  type WatchActivityDay,
} from "@marker/shared/watchActivityStats";
import { SectionHeader } from "@/components/page";
import { cn } from "@/lib/utils";

const TARGET_CELL = 13;
const GAP = 3;
const MAX_WEEKS = 53;
const LEVEL_CLASSES = [
  "bg-muted",
  "bg-foreground/25",
  "bg-foreground/45",
  "bg-foreground/70",
  "bg-foreground",
] as const;

const episodesLabel = (count: number) =>
  `${count.toLocaleString()} episode${count === 1 ? "" : "s"}`;

export function WatchHeatmap({
  days,
  today,
}: {
  days: WatchActivityDay[];
  today: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>();
  const observeContainer = useCallback((node: HTMLDivElement | null) => {
    if (!node) return undefined;
    container.current = node;
    const update = () => setWidth(node.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      container.current = null;
    };
  }, []);
  const weekCount = Math.max(
    1,
    Math.min(MAX_WEEKS, Math.floor((width + GAP) / (TARGET_CELL + GAP))),
  );
  const heatmap = useMemo(
    () => buildActivityHeatmap(days, today, weekCount),
    [days, today, weekCount],
  );
  const cells = heatmap.weeks.flat().filter((day) => day !== null);
  const selected = cells.find((day) => day.date === selectedDate);
  const caption = selected
    ? `${episodesLabel(selected.episodes)} · ${formatActivityDate(selected.date)}`
    : `${episodesLabel(heatmap.total)} in the last ${weekCount} ${weekCount === 1 ? "week" : "weeks"}`;
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (event.key) {
      case "ArrowUp":
        next = index - 1;
        break;
      case "ArrowDown":
        next = index + 1;
        break;
      case "ArrowLeft":
        next = index - 7;
        break;
      case "ArrowRight":
        next = index + 7;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = cells.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const date = cells[Math.max(0, Math.min(cells.length - 1, next))]!.date;
    container.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
      ?.focus();
  };

  return (
    <figure className="border-b border-border pb-6">
      <SectionHeader title="Watch activity" />
      <div ref={observeContainer} className="mt-4">
        {width > 0 && (
          <>
            <div
              aria-hidden
              className="mb-1 grid h-3.5 text-[10px] font-semibold text-muted-foreground"
              style={{
                gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                columnGap: GAP,
              }}
            >
              {heatmap.months.map(({ week, label }) => (
                <span
                  key={week}
                  style={{
                    gridColumnStart: week + 1,
                    justifySelf: week === weekCount - 1 ? "end" : "start",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <fieldset
              className="grid min-w-0 grid-flow-col"
              style={{
                gridTemplateRows: "repeat(7, auto)",
                gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                gap: GAP,
              }}
            >
              <legend className="sr-only">
                Daily watch activity. Use arrow keys to navigate days and weeks.
              </legend>
              {cells.map((day, index) => (
                <button
                  key={day.date}
                  type="button"
                  data-date={day.date}
                  tabIndex={day.date === (selected?.date ?? today) ? 0 : -1}
                  aria-label={`${episodesLabel(day.episodes)} on ${formatActivityDate(day.date)}`}
                  title={`${episodesLabel(day.episodes)} on ${formatActivityDate(day.date)}`}
                  onFocus={() => setSelectedDate(day.date)}
                  onClick={() => setSelectedDate(day.date)}
                  onKeyDown={(event) => navigate(event, index)}
                  className={cn(
                    "aspect-square min-w-0 rounded-[3px] p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground",
                    selected?.date === day.date &&
                      "ring-1 ring-muted-foreground",
                    LEVEL_CLASSES[day.level],
                  )}
                />
              ))}
            </fieldset>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <figcaption className="tabular-nums">{caption}</figcaption>
        <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
          <span className="mr-1">Less</span>
          {LEVEL_CLASSES.map((level) => (
            <span key={level} className={cn("size-2.5 rounded-[2px]", level)} />
          ))}
          <span className="ml-1">More</span>
        </span>
      </div>
    </figure>
  );
}
