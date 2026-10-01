import type { FunctionReturnType } from "convex/server";
import type { api } from "../../mobile/convex/_generated/api";

export type WebLibraryItem = FunctionReturnType<typeof api.library.items.listItems>[number];
