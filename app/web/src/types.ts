import type { FunctionReturnType } from "convex/server";
import type { api } from "@marker/shared/api";

export type WebLibraryItem = FunctionReturnType<typeof api.library.items.listItems>[number];
