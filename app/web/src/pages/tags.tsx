import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Tags as TagsIcon } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/page";
import { isDemoMode, posterUrl } from "@/lib/utils";

type TagPreview = {
  tag: string;
  count: number;
  posters: Array<{ itemId: string; title: string; posterPath?: string }>;
};

const demoTags: TagPreview[] = [
  {
    tag: "Anime",
    count: 2,
    posters: [
      {
        itemId: "2",
        title: "Frieren: Beyond Journey’s End",
        posterPath: "/dqZENchTd7lp5zht7BdlqM7RBhD.jpg",
      },
    ],
  },
  {
    tag: "Quiet",
    count: 1,
    posters: [
      {
        itemId: "1",
        title: "Perfect Days",
        posterPath: "/mjEk5Wwx6TYVqw29zSaUHclMIgp.jpg",
      },
    ],
  },
  {
    tag: "Sci-fi",
    count: 1,
    posters: [
      {
        itemId: "3",
        title: "Severance",
        posterPath: "/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
      },
    ],
  },
];

export function TagsPage() {
  const demo = isDemoMode();
  const queried = useQuery(api.tags.mine, demo ? "skip" : {});
  const [search, setSearch] = useState("");
  const collections = (demo ? demoTags : queried) as TagPreview[] | undefined;
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (collections ?? []).filter(
      (entry) => !query || entry.tag.toLocaleLowerCase().includes(query),
    );
  }, [collections, search]);
  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader title="Tags" />
      <Input
        className="mt-6 h-11 border-0 bg-card text-sm sm:h-9"
        aria-label="Search your tags"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search your tags"
      />
      {queried === undefined && !demo ? (
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-56 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : visible.length ? (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
          {visible.map((collection) => (
            <Link
              key={collection.tag}
              to="/tags/$tag"
              params={{ tag: collection.tag }}
              className="group min-h-11 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="relative mx-auto flex h-[198px] w-full max-w-[360px] items-end justify-center overflow-hidden rounded-2xl bg-card">
                {collection.posters.slice(0, 3).map((poster, index) => (
                  <div
                    key={poster.itemId}
                    className="aspect-[2/3] w-[60%] max-w-[132px] overflow-hidden rounded-xl border-2 border-background bg-card shadow-xl transition-transform duration-300 group-hover:-translate-y-1"
                    style={{
                      marginLeft: index ? "-40%" : 0,
                      zIndex: index,
                    }}
                  >
                    {poster.posterPath && (
                      <img
                        src={posterUrl(poster.posterPath)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                ))}
              </div>
              <strong className="mt-2 block text-[17px] leading-5">
                {collection.tag}
              </strong>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-16 rounded-xl border border-dashed border-border p-10 text-center">
          <TagsIcon className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-4 text-sm font-semibold">
            {collections?.length ? "No matching tags" : "No tags yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {collections?.length
              ? "Try a different search."
              : "Add tags to titles and they’ll become visual collections here."}
          </p>
        </div>
      )}
    </Page>
  );
}
