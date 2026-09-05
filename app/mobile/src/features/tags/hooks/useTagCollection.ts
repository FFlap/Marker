import { useMemo, useState } from 'react';
import type { Id } from '@convex/_generated/dataModel';
import {
  LIBRARY_STATUSES,
  matchesMediaType,
  type MediaTypeFilter,
  type StatusFilter,
} from '@/lib/libraryFilters';
import type { LibraryItem, Status } from '@/types';
import type { RankedItem } from '../components/TagScreenParts';

export function useTagCollection({
  items,
  optimisticOrders,
  optimisticStatuses,
  ranks,
  tagKey,
}: {
  items: LibraryItem[] | undefined;
  optimisticOrders: Partial<Record<Status, string[]>>;
  optimisticStatuses: Record<string, Status>;
  ranks: { itemId: Id<'items'>; rank: number }[] | undefined;
  tagKey: string;
}) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MediaTypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minimumRating, setMinimumRating] = useState(0);
  const rankByItem = useMemo(
    () => new Map((ranks ?? []).map((rank) => [String(rank.itemId), rank.rank])),
    [ranks],
  );
  const members = useMemo<RankedItem[]>(
    () =>
      (items ?? [])
        .filter((item) => item.tags.some((tag) => tag.trim().toLocaleLowerCase() === tagKey))
        .map((item) => ({
          ...item,
          status: optimisticStatuses[String(item._id)] ?? item.status,
          tagRank: rankByItem.get(String(item._id)),
        }))
        .sort((left, right) => {
          if (left.tagRank !== undefined && right.tagRank !== undefined)
            return left.tagRank - right.tagRank;
          if (left.tagRank !== undefined) return -1;
          if (right.tagRank !== undefined) return 1;
          return left.rank - right.rank;
        }),
    [items, optimisticStatuses, rankByItem, tagKey],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return members.filter(
      (item) =>
        (!query || item.title.toLocaleLowerCase().includes(query)) &&
        matchesMediaType(item, type) &&
        (status === 'all' || item.status === status) &&
        (!minimumRating || (item.rating ?? -1) >= minimumRating),
    );
  }, [members, minimumRating, search, status, type]);

  const itemsForStatus = (target: Status) => {
    const visible = filtered.filter((item) => item.status === target);
    const order = optimisticOrders[target];
    if (!order) return visible;
    const orderIndexById = new Map(order.map((id, index) => [id, index]));
    return [...visible].sort((left, right) => {
      const leftIndex = orderIndexById.get(String(left._id)) ?? -1;
      const rightIndex = orderIndexById.get(String(right._id)) ?? -1;
      if (leftIndex === -1) return rightIndex === -1 ? left.rank - right.rank : 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  };

  const active = !!search.trim() || type !== 'all' || status !== 'all' || minimumRating > 0;
  return {
    active,
    itemsForStatus,
    members,
    minimumRating,
    search,
    setMinimumRating,
    setSearch,
    setStatus,
    setType,
    status,
    type,
    visibleStatuses:
      status === 'all' ? LIBRARY_STATUSES : LIBRARY_STATUSES.filter(([key]) => key === status),
    clear: () => {
      setSearch('');
      setType('all');
      setStatus('all');
      setMinimumRating(0);
    },
  };
}
