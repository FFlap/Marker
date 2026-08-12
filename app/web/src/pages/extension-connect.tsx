import { useUser } from "@clerk/react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";

export function ExtensionConnectPage() {
  const { user } = useUser();
  const account = user?.username
    ? `@${user.username}`
    : (user?.primaryEmailAddress?.emailAddress ?? "your Marker account");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-5">
      <div className="quiet-grid absolute inset-0 opacity-60" />
      <section className="relative w-full max-w-lg rounded-3xl border border-border bg-background/92 p-7 text-center shadow-2xl backdrop-blur sm:p-12">
        <Brand className="justify-center" />
        <div className="mx-auto mt-12 grid size-16 place-items-center rounded-2xl border border-border bg-card">
          <CheckCircle2 className="size-6" />
        </div>
        <h1 className="mt-7 text-4xl font-bold tracking-[-.04em]">
          Extension connected.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
          Clerk has securely shared {account} with the Marker extension. You can
          close this tab and reopen the extension popup.
        </p>
        <div className="mt-8 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[.12em] text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Managed by Clerk · no password
          stored in the extension
        </div>
      </section>
    </main>
  );
}
