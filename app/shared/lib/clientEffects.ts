import { ClientSessionGuard } from './clientOperations';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpBody from 'effect/http/HttpBody';
import * as HttpClient from 'effect/http/HttpClient';

export class SearchError extends Schema.TaggedError<SearchError>()('SearchError', {
  cause: Schema.Defect(),
}) {}
export class MetadataError extends Schema.TaggedError<MetadataError>()('MetadataError', {
  cause: Schema.Defect(),
}) {}
export class AccountError extends Schema.TaggedError<AccountError>()('AccountError', {
  cause: Schema.Defect(),
}) {}
export class ProfileError extends Schema.TaggedError<ProfileError>()('ProfileError', {
  cause: Schema.Defect(),
}) {}
export class LibraryError extends Schema.TaggedError<LibraryError>()('LibraryError', {
  cause: Schema.Defect(),
}) {}
export class AvatarError extends Schema.TaggedError<AvatarError>()('AvatarError', {
  cause: Schema.Defect(),
}) {}

export const searchTitles = <A>(search: () => Promise<A>, delayMs = 0) => {
  const request = Effect.tryPromise({ try: search, catch: (cause) => new SearchError({ cause }) });
  return delayMs > 0 ? Effect.sleep(delayMs).pipe(Effect.andThen(request)) : request;
};

export const touchMetadata = <A>(touch: () => Promise<A>) =>
  Effect.tryPromise({
    try: touch,
    catch: (cause) => new MetadataError({ cause }),
  });
export const linkAccount = (link: () => Promise<unknown>) =>
  Effect.tryPromise({
    try: link,
    catch: (cause) => new AccountError({ cause }),
  }).pipe(Effect.timeout(15_000));
// Check inside the native-call thunk, with no scheduler yield between identity and SDK call.
const guardedPromise = <A, E>(
  step: (signal: AbortSignal) => Promise<A>,
  onError: (cause: unknown) => E,
) =>
  Effect.flatMap(ClientSessionGuard, (current) => {
    const changed = Symbol('session changed');
    return Effect.tryPromise({
      try: (signal) => {
        if (!current()) throw changed;
        return step(signal);
      },
      catch: (cause) =>
        cause === changed
          ? { _tag: 'SessionChanged' as const }
          : { _tag: 'RequestFailed' as const, error: onError(cause) },
    }).pipe(
      Effect.catch((failure) =>
        failure._tag === 'SessionChanged' ? Effect.interrupt : Effect.fail(failure.error),
      ),
    );
  });

export const saveProfile = <A>(save: () => Promise<A>) =>
  guardedPromise(save, (cause) => new ProfileError({ cause }));
export const saveLibrary = <A>(save: () => Promise<A>) =>
  guardedPromise(save, (cause) => new LibraryError({ cause }));
export const avatarStep = <A>(step: (signal: AbortSignal) => Promise<A>) =>
  guardedPromise(step, (cause) => new AvatarError({ cause }));

const UploadResponse = Schema.Struct({ storageId: Schema.NonEmptyString });
/** Credentials are independent; publication happens only after a validated upload. */
export const uploadAvatar = Effect.fnUntraced(function* (args: {
  blob: Blob;
  contentType: string;
  uploadPath: () => Promise<string>;
  token: () => Promise<string | null>;
  resolveUrl: (path: string) => string | URL;
  publish: (storageId: string) => Promise<unknown>;
}) {
  const [path, token] = yield* Effect.all(
    [avatarStep(() => args.uploadPath()), avatarStep(() => args.token())],
    { concurrency: 2 },
  );
  if (!token) return yield* Effect.fail(new AvatarError({ cause: 'Authentication required' }));
  const url = yield* Effect.try({
    try: () => args.resolveUrl(path),
    catch: (cause) => new AvatarError({ cause }),
  });
  const raw = yield* Effect.scoped(
    Effect.gen(function* () {
      const current = yield* ClientSessionGuard;
      const changed = Symbol('session changed');
      const client = HttpClient.withScope(yield* HttpClient.HttpClient);
      const response = yield* client
        .post(url, {
          headers: { Authorization: `Bearer ${token}` },
          body: HttpBody.raw(args.blob, { contentType: args.contentType }),
        })
        .pipe(
          Effect.provideService(FetchHttpClient.Fetch, (input, init) => {
            // No scheduler yield between identity validation and the native call.
            if (!current()) throw changed;
            return fetch(input, init);
          }),
          Effect.catch((error) =>
            error.reason.cause === changed
              ? Effect.interrupt
              : Effect.fail(new AvatarError({ cause: error.reason.cause })),
          ),
        );
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(new AvatarError({ cause: 'Upload failed' }));
      yield* Effect.suspend(() => (current() ? Effect.void : Effect.interrupt));
      return yield* response.json.pipe(
        Effect.mapError((error) => new AvatarError({ cause: error.reason.cause })),
      );
    }),
  ).pipe(
    Effect.timeout(30_000),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provide(FetchHttpClient.layer),
  );
  const payload = yield* Schema.decodeUnknownEffect(UploadResponse)(raw).pipe(
    Effect.mapError((cause) => new AvatarError({ cause })),
  );
  yield* avatarStep(() => args.publish(payload.storageId));
  return undefined;
});

export class SessionError extends Schema.TaggedError<SessionError>()('SessionError', {
  cause: Schema.Defect(),
}) {}
export const sessionStep = <A>(step: () => Promise<A>) =>
  Effect.tryPromise({
    try: step,
    catch: (cause) => new SessionError({ cause }),
  });
export const sessionResult = (result: { error: unknown | null }) =>
  result.error ? Effect.fail(new SessionError({ cause: result.error })) : Effect.void;
