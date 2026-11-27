import { FilterSheet, type FilterSection } from '@/components/FilterSheet';

export type ShowFilter = 'all' | 'anime' | 'other';

const showOptions = [
  { value: 'all', label: 'All shows' },
  { value: 'anime', label: 'Anime' },
  { value: 'other', label: 'Other TV' },
] as const satisfies readonly { value: ShowFilter; label: string }[];

export function EpisodeFiltersDrawer({
  tab,
  showFilter,
  minimumRating,
  tagFilter,
  tags,
  onShowFilterChange,
  onMinimumRatingChange,
  onTagFilterChange,
}: {
  tab: 'watching' | 'favorites';
  showFilter: ShowFilter;
  minimumRating: number;
  tagFilter: string;
  tags: string[];
  onShowFilterChange: (value: ShowFilter) => void;
  onMinimumRatingChange: (value: number) => void;
  onTagFilterChange: (value: string) => void;
}) {
  const sections: FilterSection[] = [
    {
      kind: 'single',
      key: 'show',
      label: 'Show type',
      options: showOptions,
      value: showFilter,
      defaultValue: 'all',
      onChange: (value) => onShowFilterChange(value as ShowFilter),
    },
  ];
  if (tab === 'favorites') {
    sections.push({
      kind: 'rating',
      key: 'rating',
      label: 'Rating',
      value: minimumRating,
      onChange: onMinimumRatingChange,
    });
    if (tags.length)
      sections.push({
        kind: 'single',
        key: 'tag',
        label: 'Tag',
        options: [
          { value: 'all', label: 'Any tag' },
          ...tags.map((tag) => ({ value: tag.toLocaleLowerCase(), label: tag })),
        ],
        value: tagFilter,
        defaultValue: 'all',
        onChange: onTagFilterChange,
      });
  }
  return (
    <FilterSheet
      accessibilityLabel={`Filter ${tab} episodes`}
      title="Filters"
      sections={sections}
    />
  );
}
