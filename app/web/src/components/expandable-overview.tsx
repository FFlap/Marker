import { useEffect, useId, useRef, useState } from "react";

export function ExpandableOverview({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      setTruncated(element.scrollHeight > lineHeight * 3 + 1);
    };
    measure();
    // A font swap can change wrapping without changing the clamped element's size.
    document.fonts?.addEventListener("loadingdone", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    if (!observer) window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [text]);

  return (
    <div className="mt-9">
      <p
        ref={ref}
        id={id}
        className={`text-[15px] leading-6 text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}
      >
        {text}
      </p>
      {truncated && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
          className="mt-1 min-h-11 rounded-sm text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "Read less" : "Read more"}
        </button>
      )}
    </div>
  );
}
