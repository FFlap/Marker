import type { Status } from '@/types';

export type OptimisticTagOrders = {
  tagKey: string;
  orders: Partial<Record<Status, string[]>>;
};

export const TAG_HEADER_HEIGHT = 116;
