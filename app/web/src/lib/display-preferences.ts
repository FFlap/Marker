export const collectionGridWidth = {
  3: "31%",
  4: "22.375%",
  5: "17.2%",
} as const;

export const collectionListWidth = {
  1: "100%",
  2: "48.25%",
} as const;

export const collectionListType = {
  small: { fontSize: 13, lineHeight: 18, minHeight: 44 },
  medium: { fontSize: 16, lineHeight: 22, minHeight: 44 },
  large: { fontSize: 19, lineHeight: 26, minHeight: 52 },
} as const;

export function gridWidth(value: unknown) {
  return collectionGridWidth[
    value === 4 || value === 5 ? value : 3
  ];
}

export function listWidth(value: unknown) {
  return collectionListWidth[value === 2 ? 2 : 1];
}

export function listType(value: unknown) {
  return collectionListType[
    value === "small" || value === "large" ? value : "medium"
  ];
}
