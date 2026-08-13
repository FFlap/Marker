/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityEvents from "../activityEvents.js";
import type * as calendar from "../calendar.js";
import type * as clerkAuth from "../clerkAuth.js";
import type * as crons from "../crons.js";
import type * as episodeAvailability from "../episodeAvailability.js";
import type * as episodeHub from "../episodeHub.js";
import type * as episodeProjectionRepair from "../episodeProjectionRepair.js";
import type * as episodeSummaries from "../episodeSummaries.js";
import type * as extensionExchange from "../extensionExchange.js";
import type * as http from "../http.js";
import type * as library from "../library.js";
import type * as mergePolicy from "../mergePolicy.js";
import type * as nextEpisode from "../nextEpisode.js";
import type * as notifications from "../notifications.js";
import type * as profileFavorites from "../profileFavorites.js";
import type * as profileRules from "../profileRules.js";
import type * as profileStats from "../profileStats.js";
import type * as profileStatsRefresh from "../profileStatsRefresh.js";
import type * as profiles from "../profiles.js";
import type * as providerHttp from "../providerHttp.js";
import type * as providerSnapshots from "../providerSnapshots.js";
import type * as publicValidators from "../publicValidators.js";
import type * as rank from "../rank.js";
import type * as resolvedMetadata from "../resolvedMetadata.js";
import type * as resolvedTitleModel from "../resolvedTitleModel.js";
import type * as seasonNames from "../seasonNames.js";
import type * as seasonStorage from "../seasonStorage.js";
import type * as settings from "../settings.js";
import type * as stats from "../stats.js";
import type * as sync from "../sync.js";
import type * as tagCollectionsModel from "../tagCollectionsModel.js";
import type * as tags from "../tags.js";
import type * as tmdb from "../tmdb.js";
import type * as tvdb from "../tvdb.js";
import type * as tvdbGuideKeys from "../tvdbGuideKeys.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityEvents: typeof activityEvents;
  calendar: typeof calendar;
  clerkAuth: typeof clerkAuth;
  crons: typeof crons;
  episodeAvailability: typeof episodeAvailability;
  episodeHub: typeof episodeHub;
  episodeProjectionRepair: typeof episodeProjectionRepair;
  episodeSummaries: typeof episodeSummaries;
  extensionExchange: typeof extensionExchange;
  http: typeof http;
  library: typeof library;
  mergePolicy: typeof mergePolicy;
  nextEpisode: typeof nextEpisode;
  notifications: typeof notifications;
  profileFavorites: typeof profileFavorites;
  profileRules: typeof profileRules;
  profileStats: typeof profileStats;
  profileStatsRefresh: typeof profileStatsRefresh;
  profiles: typeof profiles;
  providerHttp: typeof providerHttp;
  providerSnapshots: typeof providerSnapshots;
  publicValidators: typeof publicValidators;
  rank: typeof rank;
  resolvedMetadata: typeof resolvedMetadata;
  resolvedTitleModel: typeof resolvedTitleModel;
  seasonNames: typeof seasonNames;
  seasonStorage: typeof seasonStorage;
  settings: typeof settings;
  stats: typeof stats;
  sync: typeof sync;
  tagCollectionsModel: typeof tagCollectionsModel;
  tags: typeof tags;
  tmdb: typeof tmdb;
  tvdb: typeof tvdb;
  tvdbGuideKeys: typeof tvdbGuideKeys;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
