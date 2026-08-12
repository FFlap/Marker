export type WebLibraryItem = {
  _id: string;
  title: string;
  status: "watched" | "watching" | "watchlist" | "dropped";
  mediaType: "movie" | "tv";
  rating?: number;
  rank: number;
  tags: string[];
  posterPath?: string;
  releaseDate?: string;
  overview?: string;
  isAnime?: boolean;
  genres?: string[];
  runtime?: number;
  timesWatched?: number;
};

export const demoItems: WebLibraryItem[] = [
  {
    _id: "1",
    title: "Perfect Days",
    status: "watched",
    mediaType: "movie",
    rating: 9.4,
    rank: 1,
    tags: ["Quiet", "Favorites"],
    posterPath: "/mjEk5Wwx6TYVqw29zSaUHclMIgp.jpg",
    releaseDate: "2023-11-10",
  },
  {
    _id: "2",
    title: "Frieren: Beyond Journey’s End",
    status: "watching",
    mediaType: "tv",
    rating: 9.1,
    rank: 1,
    tags: ["Anime", "Fantasy"],
    posterPath: "/dqZENchTd7lp5zht7BdlqM7RBhD.jpg",
    releaseDate: "2023-09-29",
    overview:
      "After the party of heroes defeated the Demon King, they restored peace to the land and returned to lives of solitude. Generations pass, and the elven mage Frieren comes face to face with humanity’s mortality. She takes on a new apprentice and begins a journey to fulfill her old friends’ final wishes.",
    genres: ["Animation", "Action & Adventure", "Drama", "Sci-Fi & Fantasy"],
    timesWatched: 1,
    isAnime: true,
  },
  {
    _id: "3",
    title: "Severance",
    status: "watching",
    mediaType: "tv",
    rating: 8.8,
    rank: 2,
    tags: ["Sci-fi"],
    posterPath: "/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
    releaseDate: "2022-02-18",
  },
  {
    _id: "4",
    title: "The Boy and the Heron",
    status: "watchlist",
    mediaType: "movie",
    rank: 1,
    tags: ["Animation"],
    posterPath: "/f4oZTcfGrVTXKTWg157AwikXqmP.jpg",
    releaseDate: "2023-07-14",
    isAnime: true,
  },
  {
    _id: "5",
    title: "Shōgun",
    status: "watchlist",
    mediaType: "tv",
    rank: 2,
    tags: ["Drama"],
    posterPath: "/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg",
    releaseDate: "2024-02-27",
  },
];

export const demoEpisodes = {
  watching: [
    {
      itemId: "2",
      title: "Frieren: Beyond Journey’s End",
      seasonName: "Season 1",
      season: 1,
      episode: 18,
      name: "First-Class Mage Exam",
      overview:
        "The party reaches Äußerst and prepares for the first-class mage exam.",
      runtime: 25,
      airDate: "2024-01-12",
      isAnime: true,
      tags: ["Anime"],
    },
    {
      itemId: "3",
      title: "Severance",
      seasonName: "Season 2",
      season: 2,
      episode: 4,
      name: "Woe’s Hollow",
      overview: "The team ventures beyond the familiar halls of Lumon.",
      runtime: 48,
      airDate: "2025-02-07",
      isAnime: false,
      tags: ["Sci-fi"],
    },
  ],
  favorites: [
    {
      itemId: "2",
      title: "Frieren: Beyond Journey’s End",
      seasonName: "Season 1",
      season: 1,
      episode: 10,
      name: "A Powerful Mage",
      overview:
        "Frieren confronts Aura and reveals the depth of her restraint.",
      runtime: 25,
      airDate: "2023-11-10",
      rating: 10,
      isAnime: true,
      tags: ["Anime"],
    },
    {
      itemId: "3",
      title: "Severance",
      seasonName: "Season 1",
      season: 1,
      episode: 9,
      name: "The We We Are",
      overview:
        "The innies awaken outside Lumon and discover the lives of their outies.",
      runtime: 40,
      airDate: "2022-04-08",
      rating: 9.7,
      isAnime: false,
      tags: ["Sci-fi"],
    },
  ],
};
