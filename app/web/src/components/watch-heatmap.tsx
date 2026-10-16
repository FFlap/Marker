import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildActivityHeatmap,
  formatActivityDate,
  type WatchActivityDay,
} from "../../../mobile/convex/watchActivityStats";
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
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return () => undefined;
    const update = () => setWidth(node.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const weekCount = Math.max(
    1,
    Math.min(MAX_WEEKS, Math.floor((width + GAP) / (TARGET_CELL + GAP))),
  );
  const heatmap = useMemo(
    () => buildActivityHeatmap(days, today, weekCount),
    [days, today, weekCount],
  );

  return (
    <figure className="border-b border-border pb-6">
      <SectionHeader title="Watch activity" />
      <div ref={container} className="mt-4">
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
            <div
              className="grid grid-flow-col"
              style={{
                gridTemplateRows: "repeat(7, auto)",
                gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                gap: GAP,
              }}
            >
              {/* Only days after today are empty, and they always trail the grid. */}
              {heatmap.weeks
                .flat()
                .map(
                  (day) =>
                    day && (
                      <span
                        key={day.date}
                        title={`${episodesLabel(day.episodes)} on ${formatActivityDate(day.date)}`}
                        className={cn(
                          "aspect-square rounded-[3px]",
                          LEVEL_CLASSES[day.level],
                        )}
                      />
                    ),
                )}
            </div>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <figcaption className="truncate tabular-nums">
          {episodesLabel(heatmap.total)} in the last {weekCount} weeks
        </figcaption>
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
