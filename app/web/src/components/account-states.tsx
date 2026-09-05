export function AccountLinkError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="grid min-h-screen place-items-center px-6 text-center text-sm text-destructive"
    >
      <div>
        <p>We couldn’t link this account to Marker.</p>
        <button
          type="button"
          className="mt-3 block w-full underline"
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function AccountLoading() {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      Opening Marker…
    </div>
  );
}
