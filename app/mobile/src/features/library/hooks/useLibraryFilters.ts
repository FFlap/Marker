import { useState } from 'react';
import type { MediaTypeFilter, StatusFilter } from '@/lib/libraryFilters';

// Keep input state above the account-loading/ready screen boundary.
export function useLibraryFilters() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MediaTypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minimumRating, setMinimumRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const active =
    !!search.trim() ||
    type !== 'all' ||
    status !== 'all' ||
    minimumRating > 0 ||
    selectedTags.length > 0;

  return {
    filters: { search, type, status, minimumRating, selectedTags, active },
    actions: {
      setSearch,
      setType,
      setStatus,
      setMinimumRating,
      setSelectedTags,
      clear: () => {
        setSearch('');
        setType('all');
        setStatus('all');
        setMinimumRating(0);
        setSelectedTags([]);
      },
    },
  };
}

export type LibraryFilterControls = ReturnType<typeof useLibraryFilters>;
