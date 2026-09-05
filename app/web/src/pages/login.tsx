import { useEffect, useState } from "react";
import { useSignIn, useSignUp } from "@clerk/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, LogIn, UserPlus } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeInternalPath } from "@/lib/utils";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.5 14.1a6 6 0 0 1 0-4.2V7.3H3.2a10 10 0 0 0 0 9.4l3.3-2.6Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.2 7.3l3.3 2.6A5.8 5.8 0 0 1 12 5.9Z"
      />
    </svg>
  );
}

function clerkError(cause: unknown) {
  const value = cause as {
    message?: string;
    longMessage?: string;
    errors?: Array<{ longMessage?: string; message?: string }>;
  };
  return (
    value?.errors?.[0]?.longMessage ??
    value?.errors?.[0]?.message ??
    value?.longMessage ??
    value?.message ??
    ""
  );
}

function throwIfError(result: { error: unknown | null }) {
  if (result.error) throw result.error;
}

type RecoveryStage = "identifier" | "code" | "password";

function recoveryError(cause: unknown) {
  const message = clerkError(cause);
  if (/too many|throttl|rate.?limit|try again later/i.test(message)) {
    return "Too many reset attempts. Wait a moment, then try again.";
  }
  if (/code|verification/i.test(message)) {
    return "That reset code is invalid or expired.";
  }
  if (/passwords? do not match/i.test(message)) {
    return "Those passwords do not match.";
  }
  if (
    /password|pwned|breach|compromised|too short|minimum|length/i.test(message)
  ) {
    return "Choose a stronger password with at least eight characters.";
  }
  return "We couldn’t reset that password. Check the account details and try again.";
}

export function LoginPage() {
  const search = useSearch({ strict: false }) as { next?: string };
  const next = safeInternalPath(search.next);
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const navigate = useNavigate();
  const [flow, setFlow] = useState<"choose" | "signIn" | "signUp">("choose");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState<
    "signUp" | "clientTrust" | "oauthUsername" | null
  >(null);
  const [recovery, setRecovery] = useState<RecoveryStage | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chooseFlow = (nextFlow: "signIn" | "signUp") => {
    setFlow(nextFlow);
    setIdentifier("");
    setUsername("");
    setPassword("");
    setCode("");
    setVerification(null);
    setRecovery(null);
    setConfirmPassword("");
    setError("");
  };
  const returnToChoices = () => {
    void signIn.reset();
    void signUp.reset();
    setFlow("choose");
    setIdentifier("");
    setUsername("");
    setPassword("");
    setCode("");
    setVerification(null);
    setRecovery(null);
    setConfirmPassword("");
    setError("");
  };
  useEffect(() => {
    if (
      signUp.status === "missing_requirements" &&
      signUp.missingFields.includes("username")
    ) {
      setFlow("signUp");
      setVerification("oauthUsername");
    }
  }, [signUp.missingFields, signUp.status]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (recovery === "identifier") {
        throwIfError(await signIn.create({ identifier: identifier.trim() }));
        throwIfError(await signIn.resetPasswordEmailCode.sendCode());
        setCode("");
        setRecovery("code");
      } else if (recovery === "code") {
        throwIfError(
          await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() }),
        );
        if (signIn.status !== "needs_new_password") {
          throw new Error("Password reset verification is incomplete");
        }
        setCode("");
        setPassword("");
        setConfirmPassword("");
        setRecovery("password");
      } else if (recovery === "password") {
        if (password !== confirmPassword)
          throw new Error("Passwords do not match");
        throwIfError(
          await signIn.resetPasswordEmailCode.submitPassword({
            password,
            signOutOfOtherSessions: true,
          }),
        );
        if (signIn.status === "complete") {
          throwIfError(await signIn.finalize());
          await navigate({ to: next });
        } else if (signIn.status === "needs_client_trust") {
          throwIfError(await signIn.mfa.sendEmailCode());
          setRecovery(null);
          setVerification("clientTrust");
        } else {
          throw new Error("Additional sign-in verification is required");
        }
      } else if (verification === "oauthUsername") {
        throwIfError(await signUp.update({ username: username.trim() }));
        if (signUp.status !== "complete")
          throw new Error("Username is required");
        throwIfError(await signUp.finalize());
        await navigate({ to: next });
      } else if (verification === "signUp") {
        throwIfError(
          await signUp.verifications.verifyEmailCode({ code: code.trim() }),
        );
        if (signUp.status !== "complete")
          throw new Error("Email verification is incomplete");
        throwIfError(await signUp.finalize());
        await navigate({ to: next });
      } else if (verification === "clientTrust") {
        throwIfError(await signIn.mfa.verifyEmailCode({ code: code.trim() }));
        if (signIn.status !== "complete")
          throw new Error("Verification is incomplete");
        throwIfError(await signIn.finalize());
        await navigate({ to: next });
      } else if (flow === "signUp") {
        throwIfError(
          await signUp.password({
            emailAddress: identifier.trim(),
            username: username.trim(),
            password,
          }),
        );
        if (signUp.status === "complete") {
          throwIfError(await signUp.finalize());
          await navigate({ to: next });
        } else {
          throwIfError(await signUp.verifications.sendEmailCode());
          setVerification("signUp");
        }
      } else {
        throwIfError(
          await signIn.password({ identifier: identifier.trim(), password }),
        );
        if (signIn.status === "complete") {
          throwIfError(await signIn.finalize());
          await navigate({ to: next });
        } else if (signIn.status === "needs_client_trust") {
          throwIfError(await signIn.mfa.sendEmailCode());
          setVerification("clientTrust");
        } else {
          throw new Error("Additional sign-in verification is required");
        }
      }
    } catch (cause) {
      if (recovery) {
        setError(recoveryError(cause));
        return;
      }
      const message = clerkError(cause);
      setError(
        /taken/i.test(message)
          ? "That username is already taken."
          : /already/i.test(message)
            ? "An account with that email already exists."
            : /code|verification/i.test(message)
              ? "That verification code is invalid or expired."
              : "We couldn’t sign you in. Check your details and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const resetToSignIn = () => {
    void signIn.reset();
    setFlow("signIn");
    setRecovery(null);
    setVerification(null);
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setError("");
  };
  const signInWithGoogle = async () => {
    setBusy(true);
    setError("");
    try {
      throwIfError(
        await signIn.sso({
          strategy: "oauth_google",
          redirectUrl: next,
          redirectCallbackUrl: next,
        }),
      );
    } catch (cause) {
      setError(
        clerkError(cause) || "Google sign-in couldn’t start. Please try again.",
      );
      setBusy(false);
    }
  };
  const enteringCode = Boolean(verification) || recovery === "code";
  const heading =
    verification === "oauthUsername"
      ? "Choose a username."
      : verification || recovery === "code"
        ? "Check your email."
        : recovery === "identifier"
          ? "Reset your password."
          : recovery === "password"
            ? "Choose a new password."
            : flow === "choose"
              ? "Welcome to Marker."
              : flow === "signIn"
                ? "Sign in."
                : "Make it yours.";
  return (
    <main className="relative grid min-h-[100dvh] overflow-hidden lg:grid-cols-[1.05fr_.95fr]">
      <div className="quiet-grid pointer-events-none absolute inset-0 opacity-60" />
      <section className="relative hidden border-r border-border p-12 lg:flex lg:flex-col lg:justify-center">
        <Brand className="absolute left-12 top-12" />
        <div className="max-w-xl animate-fade-up">
          <p className="text-7xl font-bold leading-[.92] tracking-[-.055em]">
            A quiet home
            <br />
            for everything
            <br />
            <span className="text-muted-foreground">you watch.</span>
          </p>
          <p className="mt-7 max-w-sm text-sm leading-6 text-muted-foreground">
            Rank the stories that stay with you. Keep the next episode close.
            Let the rest fall away.
          </p>
        </div>
      </section>
      <section className="relative flex min-h-[100dvh] items-center justify-center px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:p-10">
        <div className="w-full max-w-md">
          <Brand className="mb-14 lg:hidden" />
          {flow !== "choose" && !verification && !recovery && (
            <button
              type="button"
              className="mb-7 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              disabled={busy}
              onClick={returnToChoices}
            >
              <ArrowLeft className="size-4" /> Account options
            </button>
          )}
          <h1 className="text-5xl font-bold tracking-[-.04em]">{heading}</h1>
          {flow === "choose" && !verification && !recovery ? (
            <div className="mt-8 grid gap-3">
              <p className="mb-3 max-w-sm text-sm leading-6 text-muted-foreground">
                Sign in to pick up where you left off, or create an account to
                start your watchlist.
              </p>
              <Button
                size="lg"
                className="w-full"
                onClick={() => chooseFlow("signIn")}
              >
                <LogIn className="size-4" /> Log in
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => chooseFlow("signUp")}
              >
                <UserPlus className="size-4" /> Sign up
              </Button>
            </div>
          ) : (
            <>
              {!verification && !recovery && (
                <Button
                  variant="outline"
                  size="lg"
                  className="mt-8 w-full"
                  disabled={busy}
                  onClick={() => void signInWithGoogle()}
                >
                  <GoogleIcon /> Continue with Google
                </Button>
              )}
              {!verification && !recovery && (
                <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <form onSubmit={submit} className="grid gap-3">
                {verification === "oauthUsername" ? (
                  <>
                    <p className="mb-2 text-sm leading-6 text-muted-foreground">
                      One last detail for your Marker profile.
                    </p>
                    <Input
                      aria-label="Username"
                      placeholder="Username"
                      autoComplete="username"
                      maxLength={24}
                      value={username}
                      onChange={(event) =>
                        setUsername(event.target.value.replace(/\s/g, ""))
                      }
                    />
                  </>
                ) : enteringCode ? (
                  <>
                    <p className="mb-2 text-sm leading-6 text-muted-foreground">
                      {recovery === "code"
                        ? "Enter the six-digit password reset code Clerk sent you."
                        : "Enter the six-digit code Clerk sent to your email address."}
                    </p>
                    <Input
                      aria-label="Verification code"
                      placeholder="Verification code"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) =>
                        setCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                    />
                  </>
                ) : recovery === "password" ? (
                  <>
                    <p className="mb-2 text-sm leading-6 text-muted-foreground">
                      Use at least eight characters. You’ll be signed in when
                      it’s updated.
                    </p>
                    <Input
                      aria-label="New password"
                      placeholder="New password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <Input
                      aria-label="Confirm new password"
                      placeholder="Confirm new password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                    />
                  </>
                ) : (
                  !recovery &&
                  flow === "signUp" && (
                    <Input
                      aria-label="Username"
                      placeholder="Username"
                      autoComplete="username"
                      maxLength={24}
                      value={username}
                      onChange={(event) =>
                        setUsername(event.target.value.replace(/\s/g, ""))
                      }
                    />
                  )
                )}
                {!verification &&
                  recovery !== "code" &&
                  recovery !== "password" && (
                    <Input
                      aria-label={
                        recovery === "identifier"
                          ? "Email or username"
                          : flow === "signIn"
                            ? "Username or email"
                            : "Email"
                      }
                      placeholder={
                        recovery === "identifier"
                          ? "Email or username"
                          : flow === "signIn"
                            ? "Username or email"
                            : "Email"
                      }
                      type={flow === "signUp" ? "email" : "text"}
                      autoComplete="username"
                      maxLength={320}
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                    />
                  )}
                {!verification && !recovery && (
                  <Input
                    aria-label="Password"
                    placeholder="Password"
                    type="password"
                    autoComplete={
                      flow === "signIn" ? "current-password" : "new-password"
                    }
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
                {!verification && !recovery && flow === "signUp" && (
                  <div id="clerk-captcha" />
                )}
                {error && (
                  <p
                    role="alert"
                    className="text-xs leading-5 text-destructive"
                  >
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  size="lg"
                  className="mt-2 w-full"
                  disabled={
                    busy ||
                    (verification === "oauthUsername"
                      ? username.length < 3
                      : enteringCode
                        ? code.length !== 6
                        : recovery === "identifier"
                          ? !identifier.trim()
                          : recovery === "password"
                            ? password.length < 8 || confirmPassword.length < 8
                            : !identifier ||
                              password.length < 8 ||
                              (flow === "signUp" && username.length < 3))
                  }
                >
                  {busy ? (
                    "Please wait…"
                  ) : verification === "oauthUsername" ? (
                    "Finish account"
                  ) : recovery === "identifier" ? (
                    "Send reset code"
                  ) : recovery === "code" ? (
                    "Verify code"
                  ) : recovery === "password" ? (
                    "Update password"
                  ) : verification ? (
                    "Verify email"
                  ) : flow === "signIn" ? (
                    <>
                      <LogIn className="size-4" /> Sign in
                      <ArrowRight className="size-4" />
                    </>
                  ) : (
                    <>
                      <UserPlus className="size-4" /> Create account
                    </>
                  )}
                </Button>
              </form>
              {!verification && !recovery && flow === "signIn" && (
                <button
                  type="button"
                  className="mt-4 min-h-11 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => {
                    void signIn.reset();
                    setPassword("");
                    setError("");
                    setRecovery("identifier");
                  }}
                >
                  Forgot password?
                </button>
              )}
              <button
                type="button"
                className="mt-6 min-h-11 text-xs font-semibold text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => {
                  if (recovery) {
                    resetToSignIn();
                    return;
                  }
                  if (verification) {
                    void (verification === "clientTrust"
                      ? signIn.reset()
                      : signUp.reset());
                    setVerification(null);
                    setCode("");
                    setError("");
                    return;
                  }
                  chooseFlow(flow === "signIn" ? "signUp" : "signIn");
                }}
              >
                {verification
                  ? "Use a different account"
                  : recovery
                    ? "Back to sign in"
                    : flow === "signIn"
                      ? "New here? Create an account"
                      : "Already have an account? Sign in"}
              </button>
            </>
          )}
          <p className="mt-12 text-[10px] leading-5 text-muted-foreground">
            By continuing, you agree to keep your watchlist exceptionally well
            curated.
          </p>
        </div>
      </section>
    </main>
  );
}
