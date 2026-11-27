import { FilterSheet, type FilterSection } from '@/components/FilterSheet';
import {
  LIBRARY_SORTS,
  LIBRARY_STATUSES,
  type LibrarySort,
  type MediaTypeFilter,
  type StatusFilter,
} from '@/lib/libraryFilters';

const typeOptions = [
  { value: 'all', label: 'All types' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV shows' },
  { value: 'anime', label: 'Anime' },
] as const satisfies readonly { value: MediaTypeFilter; label: string }[];

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  ...LIBRARY_STATUSES.map(([value, label]) => ({ value, label })),
] satisfies { value: StatusFilter; label: string }[];

type LibraryFiltersDrawerProps = {
  accessibilityLabel?: string;
  mediaType: MediaTypeFilter;
  status: StatusFilter;
  minimumRating: number;
  onMediaTypeChange: (value: MediaTypeFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
  onMinimumRatingChange: (value: number) => void;
  sort?: { value: LibrarySort; onChange: (value: LibrarySort) => void };
  tags?: {
    all: string[];
    selected: string[];
    onChange: (tags: string[]) => void;
  };
  /** Number of titles the current filters show, for the footer button. */
  resultCount?: number;
};

export function LibraryFiltersDrawer({
  accessibilityLabel = 'Filter tag titles',
  mediaType,
  status,
  minimumRating,
  onMediaTypeChange,
  onStatusChange,
  onMinimumRatingChange,
  sort,
  tags,
  resultCount,
}: LibraryFiltersDrawerProps) {
  const sections: FilterSection[] = [
    ...(sort
      ? [
          {
            kind: 'single' as const,
            key: 'sort',
            label: 'Sort by',
            options: LIBRARY_SORTS,
            value: sort.value,
            defaultValue: 'custom',
            onChange: (value: string) => sort.onChange(value as LibrarySort),
          },
        ]
      : []),
    {
      kind: 'single',
      key: 'type',
      label: 'Type',
      options: typeOptions,
      value: mediaType,
      defaultValue: 'all',
      onChange: (value) => onMediaTypeChange(value as MediaTypeFilter),
    },
    {
      kind: 'single',
      key: 'status',
      label: 'Status',
      options: statusOptions,
      value: status,
      defaultValue: 'all',
      onChange: (value) => onStatusChange(value as StatusFilter),
    },
    {
      kind: 'rating',
      key: 'rating',
      label: 'Rating',
      value: minimumRating,
      onChange: onMinimumRatingChange,
    },
    ...(tags && tags.all.length > 0
      ? [
          {
            kind: 'multi' as const,
            key: 'tags',
            label: 'Tags',
            options: tags.all.map((tag) => ({ value: tag, label: tag })),
            values: tags.selected,
            onChange: tags.onChange,
          },
        ]
      : []),
  ];
  return (
    <FilterSheet
      accessibilityLabel={accessibilityLabel}
      title={sort ? 'Sort & filter' : 'Filters'}
      sections={sections}
      resultLabel={
        resultCount === undefined
          ? undefined
          : `Show ${resultCount.toLocaleString()} ${resultCount === 1 ? 'title' : 'titles'}`
      }
    />
  );
}
