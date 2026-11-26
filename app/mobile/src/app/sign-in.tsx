import { useTaskState } from '@/hooks/use-task-state';
import {
  transitionAuthScreen,
  type AuthScreen,
  type AuthFlow,
  type RecoveryStage,
} from '@marker/shared/lifecycle';
import { ScreenKeyboardScrollView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { sessionStep, sessionResult, SessionError } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, Text, View, type TextInput } from 'react-native';
import { useClerk, useSignIn, useSignUp } from '@clerk/expo';
import { useSSO } from '@clerk/expo/experimental';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Bookmark from 'lucide-react-native/icons/bookmark';
import Eye from 'lucide-react-native/icons/eye';
import EyeOff from 'lucide-react-native/icons/eye-off';
import LogIn from 'lucide-react-native/icons/log-in';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Svg, { Path } from 'react-native-svg';
import { Button, IconButton, Input } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import { usernameError } from '@/lib/profile';

type MissingField = 'identifier' | 'password' | 'confirmPassword' | 'username' | 'code';
type AuthErrorContext = 'signIn' | 'signUp' | 'recovery' | 'verification' | 'session' | 'oauth';

const AuthErrorDetail = Schema.Struct({
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  longMessage: Schema.optional(Schema.String),
  meta: Schema.optional(Schema.Struct({ paramName: Schema.optional(Schema.String) })),
});
const AuthFailure = Schema.Struct({
  ...AuthErrorDetail.fields,
  errors: Schema.optional(Schema.Array(AuthErrorDetail)),
});

const friendly = (e: unknown, context: AuthErrorContext) => {
  const value = Option.getOrUndefined(Schema.decodeUnknownOption(AuthFailure)(e));
  const clerkError = value?.errors?.[0];
  const code = clerkError?.code ?? value?.code ?? '';
  const parameter = clerkError?.meta?.paramName ?? '';
  const message =
    clerkError?.longMessage ?? clerkError?.message ?? value?.longMessage ?? value?.message ?? '';

  if (/passwords? do not match/i.test(message)) return 'Those passwords do not match.';

  if (context === 'verification') {
    return 'That verification code is invalid or expired.';
  }

  if (context === 'session') {
    return 'Your email is verified, but we couldn’t open your account. Tap Verify email to retry.';
  }

  if (context === 'signIn') {
    if (/client trust|additional sign-in verification/i.test(message)) {
      return 'Additional verification is required to sign in.';
    }
    return 'That email or password is not correct.';
  }

  if (context === 'recovery') {
    if (/code|verification/i.test(message)) {
      return 'That reset code is invalid or expired.';
    }
    if (/password/i.test(message)) return 'Choose a stronger password and try again.';
    return 'We couldn’t reset that password. Check the account details and try again.';
  }

  if (context === 'signUp') {
    if (
      code === 'form_identifier_exists' ||
      /already (?:exists|taken|registered)|has been taken/i.test(message)
    ) {
      return /username/i.test(`${parameter} ${message}`)
        ? 'That username is already taken.'
        : 'An account with that email already exists. Try signing in instead.';
    }
    if (/username/i.test(`${code} ${parameter} ${message}`)) {
      return 'Choose a valid username using letters, numbers, or underscores.';
    }
    if (/email/i.test(`${code} ${parameter} ${message}`) && /invalid|format|valid/i.test(message)) {
      return 'Enter a valid email address.';
    }
    if (/pwned|breach|compromised/i.test(`${code} ${message}`)) {
      return 'That password has appeared in a data breach. Choose a different password.';
    }
    if (/too short|length|at least|minimum/i.test(`${code} ${message}`)) {
      return 'Use a password with at least eight characters.';
    }
    if (/password/i.test(`${code} ${parameter} ${message}`)) {
      return 'Choose a stronger password and try again.';
    }
    if (/captcha|bot|challenge/i.test(`${code} ${message}`)) {
      return 'Account verification failed. Please try again.';
    }
    if (message) return message;
    return 'We couldn’t create that account. Check your details and try again.';
  }

  if (/cancel/i.test(message)) return 'Google sign-in was cancelled.';
  return 'We couldn’t complete that request. Try again.';
};

function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"
      />
      <Path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z"
      />
      <Path fill="#FBBC05" d="M6.5 14.1a6 6 0 0 1 0-4.2V7.3H3.2a10 10 0 0 0 0 9.4l3.3-2.6Z" />
      <Path
        fill="#EA4335"
        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.2 7.3l3.3 2.6A5.8 5.8 0 0 1 12 5.9Z"
      />
    </Svg>
  );
}

export default function SignIn() {
  const runOperation = useOperation();
  const router = useRouter();
  const { client, setActive } = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [authScreen, setAuthScreen] = useState<AuthScreen>({ state: 'form', flow: 'choose' });
  const flow = authScreen.flow;
  const verification = authScreen.state === 'verification' ? authScreen.verification : null;
  const recovery = authScreen.state === 'recovery' ? authScreen.stage : null;
  const setFlow = (flow: AuthFlow) =>
    setAuthScreen((current) => transitionAuthScreen(current, { type: 'choose', flow }));
  const setVerification = (verification: 'signUp' | 'clientTrust' | null) =>
    setAuthScreen((current) => transitionAuthScreen(current, { type: 'verify', verification }));
  const setRecovery = (stage: RecoveryStage | null) =>
    setAuthScreen((current) => transitionAuthScreen(current, { type: 'recover', stage }));
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { pending: busy, error, setPending: setBusy, setError: setTaskError } = useTaskState();
  // Every field still missing, so one tap points at all of them.
  const [missing, setMissing] = useState<Partial<Record<MissingField, string>>>({});
  const [passwordVisible, setPasswordVisible] = useState(false);
  const fieldRefs: Record<MissingField, RefObject<TextInput | null>> = {
    code: useRef<TextInput>(null),
    username: useRef<TextInput>(null),
    identifier: useRef<TextInput>(null),
    password: useRef<TextInput>(null),
    confirmPassword: useRef<TextInput>(null),
  };
  // Any new message or a cleared one replaces the field-level hint.
  const setError = (message: string) => {
    setMissing({});
    setTaskError(message);
  };

  const openSignedInApp = () => router.replace('/');

  const chooseFlow = (nextFlow: 'signIn' | 'signUp') => {
    setFlow(nextFlow);
    setIdentifier('');
    setPassword('');
    setUsername('');
    setCode('');
    setVerification(null);
    setRecovery(null);
    setConfirmPassword('');
    setError('');
  };

  const returnToChoices = () => {
    void signIn.reset();
    void signUp.reset();
    setFlow('choose');
    setIdentifier('');
    setPassword('');
    setUsername('');
    setCode('');
    setVerification(null);
    setRecovery(null);
    setConfirmPassword('');
    setError('');
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    await runOperation(
      Effect.gen(function* () {
        if (recovery === 'identifier') {
          yield* sessionResult(
            yield* sessionStep(() => signIn.create({ identifier: identifier.trim() })),
          );
          yield* sessionResult(yield* sessionStep(() => signIn.resetPasswordEmailCode.sendCode()));
          setCode('');
          setRecovery('code');
        } else if (recovery === 'code') {
          yield* sessionResult(
            yield* sessionStep(() =>
              signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() }),
            ),
          );
          if (signIn.status !== 'needs_new_password') {
            return yield* Effect.fail(
              new SessionError({ cause: new Error('Password reset verification is incomplete') }),
            );
          }
          setCode('');
          setPassword('');
          setConfirmPassword('');
          setRecovery('password');
        } else if (recovery === 'password') {
          if (password !== confirmPassword)
            return yield* Effect.fail(
              new SessionError({ cause: new Error('Passwords do not match') }),
            );
          yield* sessionResult(
            yield* sessionStep(() =>
              signIn.resetPasswordEmailCode.submitPassword({
                password,
                signOutOfOtherSessions: true,
              }),
            ),
          );
          if (signIn.status === 'complete') {
            yield* sessionResult(yield* sessionStep(() => signIn.finalize()));
            openSignedInApp();
          } else if (signIn.status === 'needs_client_trust') {
            yield* sessionResult(yield* sessionStep(() => signIn.mfa.sendEmailCode()));
            setRecovery(null);
            setVerification('clientTrust');
          } else {
            return yield* Effect.fail(
              new SessionError({ cause: new Error('Additional sign-in verification is required') }),
            );
          }
        } else if (verification === 'signUp') {
          const result = yield* sessionStep(() =>
            signUp.verifications.verifyEmailCode({ code: code.trim() }),
          );
          // Clerk can complete verification before the hook publishes its next snapshot. Reloading
          // the authoritative resource prevents a successful code from being reported as invalid.
          const currentSignUp = (yield* sessionStep(() => client.signUp.reload()))
            .__internal_future;
          if (currentSignUp.status === 'complete') {
            const finalized = yield* sessionStep(() => currentSignUp.finalize());
            if (finalized.error) {
              console.warn('[Marker auth] Could not activate verified sign-up');
              setError(friendly(finalized.error, 'session'));
            } else {
              openSignedInApp();
            }
          } else {
            yield* sessionResult(result);
            return yield* Effect.fail(
              new SessionError({ cause: new Error('Verification is incomplete') }),
            );
          }
        } else if (verification === 'clientTrust') {
          yield* sessionResult(
            yield* sessionStep(() => signIn.mfa.verifyEmailCode({ code: code.trim() })),
          );
          if (signIn.status !== 'complete')
            return yield* Effect.fail(
              new SessionError({ cause: new Error('Verification is incomplete') }),
            );
          yield* sessionResult(yield* sessionStep(() => signIn.finalize()));
          openSignedInApp();
        } else if (flow === 'signUp') {
          yield* sessionResult(
            yield* sessionStep(() =>
              signUp.password({
                emailAddress: identifier.trim(),
                username: username.trim(),
                password,
              }),
            ),
          );
          if (signUp.status === 'complete') {
            yield* sessionResult(yield* sessionStep(() => signUp.finalize()));
            openSignedInApp();
          } else {
            yield* sessionResult(yield* sessionStep(() => signUp.verifications.sendEmailCode()));
            setVerification('signUp');
          }
        } else {
          yield* sessionResult(
            yield* sessionStep(() => signIn.password({ identifier: identifier.trim(), password })),
          );
          if (signIn.status === 'complete') {
            yield* sessionResult(yield* sessionStep(() => signIn.finalize()));
            openSignedInApp();
          } else if (signIn.status === 'needs_client_trust') {
            yield* sessionResult(yield* sessionStep(() => signIn.mfa.sendEmailCode()));
            setVerification('clientTrust');
          } else {
            return yield* Effect.fail(
              new SessionError({ cause: new Error('Additional sign-in verification is required') }),
            );
          }
        }
        return undefined;
      }).pipe(
        Effect.catch(({ cause }) =>
          Effect.gen(function* () {
            // Clerk's native client can persist a session before finalize() publishes it to
            // React hooks, causing finalize() to throw even though the code was accepted.
            if (verification) {
              const recovered = yield* Effect.gen(function* () {
                const currentClient = yield* sessionStep(() => client.reload());
                const persistedSession = currentClient.signedInSessions[0];
                if (!persistedSession) return false;
                yield* sessionStep(() => setActive({ session: persistedSession }));
                return true;
              }).pipe(Effect.catch(() => Effect.succeed(false)));
              if (recovered) {
                openSignedInApp();
                return;
              }
            }
            const context: AuthErrorContext = verification
              ? 'verification'
              : recovery
                ? 'recovery'
                : flow === 'signUp'
                  ? 'signUp'
                  : 'signIn';
            setError(friendly(cause, context));
          }),
        ),
      ),
      {
        settled: () => {
          setBusy(false);
        },
      },
    );
  };

  const resetToSignIn = () => {
    void signIn.reset();
    setFlow('signIn');
    setRecovery(null);
    setVerification(null);
    setCode('');
    setPassword('');
    setConfirmPassword('');
    setError('');
  };

  const enteringCode = !!verification || recovery === 'code';
  const switchPrompt =
    recovery || verification
      ? undefined
      : flow === 'signIn'
        ? (['New here?', 'Create an account'] as const)
        : (['Already have an account?', 'Log in'] as const);
  const leaveForm = () => {
    if (recovery) {
      resetToSignIn();
      return;
    }
    if (verification) {
      void (verification === 'signUp' ? signUp.reset() : signIn.reset());
      setVerification(null);
      setCode('');
      setError('');
      return;
    }
    setFlow(flow === 'signIn' ? 'signUp' : 'signIn');
    setError('');
  };
  const identifierLabel =
    recovery === 'identifier'
      ? 'Username or email'
      : flow === 'signIn'
        ? 'Username or email'
        : 'Email';
  const passwordLabel = recovery === 'password' ? 'New password' : 'Password';
  const heading = verification
    ? 'Check your email'
    : recovery === 'identifier'
      ? 'Reset your password'
      : recovery === 'code'
        ? 'Check your email'
        : recovery === 'password'
          ? 'Choose a new password'
          : flow === 'choose'
            ? 'Welcome to Marker'
            : flow === 'signIn'
              ? 'Welcome back'
              : 'Make it yours';
  const lede = verification
    ? 'Enter the six-digit code we emailed you.'
    : recovery === 'identifier'
      ? 'We’ll send a reset code to the email on your account.'
      : recovery === 'code'
        ? 'Enter the six-digit password reset code we emailed you.'
        : recovery === 'password'
          ? 'Use at least eight characters. You’ll be signed in when it’s updated.'
          : flow === 'choose'
            ? 'A quiet home for everything you watch.'
            : '';

  const signInWithGoogle = async () => {
    setBusy(true);
    setError('');
    await runOperation(
      Effect.gen(function* () {
        const result = yield* sessionStep(() => startSSOFlow({ strategy: 'oauth_google' }));
        const oauthSignUp = result.signUp;
        if (oauthSignUp?.missingFields.includes('username')) {
          const prefix =
            oauthSignUp.emailAddress
              ?.split('@')[0]
              ?.replace(/[^A-Za-z0-9_]/g, '')
              .slice(0, 16) || 'marker';
          const generated = `${prefix}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);
          yield* sessionResult(
            yield* sessionStep(() => oauthSignUp.update({ username: generated })),
          );
          const currentSignUp = (yield* sessionStep(() => client.signUp.reload()))
            .__internal_future;
          if (currentSignUp.status === 'complete') {
            yield* sessionResult(yield* sessionStep(() => currentSignUp.finalize()));
            openSignedInApp();
          }
        }
        return undefined;
      }).pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            setError(friendly(cause, 'oauth'));
          }),
        ),
      ),
      {
        settled: () => {
          setBusy(false);
        },
      },
    );
  };

  const choosing = flow === 'choose' && !verification && !recovery;
  const fieldError = (field: MissingField) =>
    missing[field] ? (
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.fieldError}>
        {missing[field]}
      </Text>
    ) : null;
  const errorStyle = (field: MissingField) => !!missing[field] && s.inputError;

  return (
    <ScreenKeyboardScrollView
      style={s.root}
      contentContainerStyle={[s.content, choosing && s.contentChoosing]}
    >
      <View style={s.head}>
        {!choosing && !verification && !recovery && (
          <IconButton
            icon={ArrowLeft}
            accessibilityLabel="Account options"
            disabled={busy}
            onPress={returnToChoices}
            style={s.back}
          />
        )}
        {choosing && (
          <View accessibilityElementsHidden importantForAccessibility="no" style={s.brandMark}>
            <Bookmark size={26} color={colors.bg} fill={colors.bg} strokeWidth={2} />
          </View>
        )}
        <Text style={s.logo}>{heading}</Text>
        {!!lede && <Text style={s.lede}>{lede}</Text>}
      </View>
      <View style={s.form}>
        {choosing ? (
          <View style={s.choiceActions}>
            <Button
              title="Log in"
              size="lg"
              icon={<LogIn color={colors.bg} size={18} strokeWidth={2.2} />}
              onPress={() => chooseFlow('signIn')}
            />
            <Button
              title="Sign up"
              size="lg"
              icon={<UserPlus color={colors.text} size={18} strokeWidth={2.2} />}
              variant="secondary"
              style={s.secondaryChoice}
              onPress={() => chooseFlow('signUp')}
            />
          </View>
        ) : (
          <>
            {enteringCode ? (
              <>
                <Field label="Verification code">
                  <Input
                    ref={fieldRefs.code}
                    accessibilityLabel="Verification code"
                    autoComplete="one-time-code"
                    keyboardType="number-pad"
                    value={code}
                    onChangeText={(value) => {
                      setCode(value.replace(/\D/g, '').slice(0, 6));
                      if (missing.code) setMissing((current) => ({ ...current, code: undefined }));
                    }}
                    style={errorStyle('code')}
                  />
                </Field>
                {fieldError('code')}
              </>
            ) : !recovery && flow === 'signUp' ? (
              <View style={s.fieldGroup}>
                <Field label="Username">
                  <View style={[s.usernameField, errorStyle('username')]}>
                    <Text style={s.at}>@</Text>
                    <Input
                      ref={fieldRefs.username}
                      autoComplete="username-new"
                      accessibilityLabel="Username"
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={24}
                      placeholder="username"
                      value={username}
                      onChangeText={(value) => {
                        setUsername(value.replace(/\s/g, ''));
                        if (missing.username)
                          setMissing((current) => ({ ...current, username: undefined }));
                      }}
                      style={s.usernameInput}
                    />
                  </View>
                </Field>
                {fieldError('username')}
              </View>
            ) : null}
            {!verification && recovery !== 'code' && (
              <>
                {recovery !== 'password' && (
                  <Field label={identifierLabel}>
                    <Input
                      ref={fieldRefs.identifier}
                      accessibilityLabel={identifierLabel}
                      autoCapitalize="none"
                      keyboardType={flow === 'signUp' || !!recovery ? 'email-address' : 'default'}
                      // Sign-up and recovery ask for an email; log in takes a username too.
                      autoComplete={flow === 'signUp' || !!recovery ? 'email' : 'username'}
                      value={identifier}
                      onChangeText={(value) => {
                        setIdentifier(value);
                        if (missing.identifier)
                          setMissing((current) => ({ ...current, identifier: undefined }));
                      }}
                      style={errorStyle('identifier')}
                    />
                  </Field>
                )}
                {recovery !== 'password' && fieldError('identifier')}
                {recovery !== 'identifier' && (
                  <Field label={passwordLabel}>
                    <View>
                      <Input
                        ref={fieldRefs.password}
                        accessibilityLabel={passwordLabel}
                        secureTextEntry={!passwordVisible}
                        autoCapitalize="none"
                        autoComplete={
                          recovery === 'password' || flow === 'signUp'
                            ? 'new-password'
                            : 'current-password'
                        }
                        value={password}
                        onChangeText={(value) => {
                          setPassword(value);
                          if (missing.password)
                            setMissing((current) => ({ ...current, password: undefined }));
                        }}
                        style={[s.passwordInput, errorStyle('password')]}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                        hitSlop={6}
                        onPress={() => setPasswordVisible((visible) => !visible)}
                        style={s.reveal}
                      >
                        {passwordVisible ? (
                          <EyeOff size={19} color={colors.secondary} strokeWidth={1.8} />
                        ) : (
                          <Eye size={19} color={colors.secondary} strokeWidth={1.8} />
                        )}
                      </Pressable>
                    </View>
                  </Field>
                )}
                {recovery !== 'identifier' && fieldError('password')}
                {recovery === 'password' && (
                  <Field label="Confirm new password">
                    <Input
                      ref={fieldRefs.confirmPassword}
                      accessibilityLabel="Confirm new password"
                      secureTextEntry={!passwordVisible}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChangeText={(value) => {
                        setConfirmPassword(value);
                        if (missing.confirmPassword)
                          setMissing((current) => ({ ...current, confirmPassword: undefined }));
                      }}
                      style={errorStyle('confirmPassword')}
                    />
                  </Field>
                )}
                {recovery === 'password' && fieldError('confirmPassword')}
                {!recovery && flow === 'signUp' && <View nativeID="clerk-captcha" />}
              </>
            )}
            {!!error && <Text style={s.error}>{error}</Text>}
            <Button
              title={
                busy
                  ? 'Please wait…'
                  : recovery === 'identifier'
                    ? 'Send reset code'
                    : recovery === 'code'
                      ? 'Verify code'
                      : recovery === 'password'
                        ? 'Update password'
                        : verification
                          ? 'Verify email'
                          : flow === 'signIn'
                            ? 'Log in'
                            : 'Create account'
              }
              icon={
                busy || verification || recovery ? undefined : flow === 'signIn' ? (
                  <LogIn color={colors.bg} size={18} strokeWidth={2.2} />
                ) : (
                  <UserPlus color={colors.bg} size={18} strokeWidth={2.2} />
                )
              }
              size="lg"
              onPress={() => {
                // Keep the main action looking available; point at what is missing instead.
                const next: Partial<Record<MissingField, string>> = enteringCode
                  ? { code: code.length !== 6 ? 'Enter the 6-digit code.' : undefined }
                  : recovery === 'identifier'
                    ? {
                        identifier: !identifier.trim()
                          ? 'Enter your username or email.'
                          : undefined,
                      }
                    : recovery === 'password'
                      ? {
                          password: password.length < 8 ? 'Use at least 8 characters.' : undefined,
                          confirmPassword: !confirmPassword
                            ? 'Enter the new password again.'
                            : confirmPassword !== password
                              ? 'Passwords don’t match.'
                              : undefined,
                        }
                      : flow === 'signUp'
                        ? {
                            // The full username rule, shown under the field like the others.
                            username: usernameError(username) || undefined,
                            identifier: !identifier.trim() ? 'Enter your email.' : undefined,
                            password:
                              password.length < 8 ? 'Use at least 8 characters.' : undefined,
                          }
                        : {
                            identifier: !identifier.trim()
                              ? 'Enter your username or email.'
                              : undefined,
                            password: !password ? 'Enter your password.' : undefined,
                          };
                const first = (Object.keys(next) as MissingField[]).find((field) => next[field]);
                setMissing(next);
                if (first) {
                  // Take people straight to the first thing that needs fixing.
                  fieldRefs[first].current?.focus();
                  return;
                }
                void submit();
              }}
              disabled={busy}
            />
            {!verification && !recovery && (
              <>
                {flow === 'signIn' && (
                  <Button
                    title="Forgot password?"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => {
                      void signIn.reset();
                      setPassword('');
                      setError('');
                      setRecovery('identifier');
                    }}
                  />
                )}
                <View style={s.divider}>
                  <View style={s.dividerLine} />
                  <Text style={s.dividerText}>or</Text>
                  <View style={s.dividerLine} />
                </View>
                <Button
                  title="Continue with Google"
                  size="lg"
                  icon={<GoogleIcon />}
                  variant="secondary"
                  disabled={busy}
                  onPress={signInWithGoogle}
                />
              </>
            )}
            {switchPrompt ? (
              // Only the action is emphasized; the question stays quiet.
              <NativePressable
                accessibilityRole="button"
                accessibilityLabel={`${switchPrompt[0]} ${switchPrompt[1]}`}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={leaveForm}
                style={s.switchLink}
                pressedStyle={s.switchLinkPressed}
              >
                <Text style={s.switchText}>
                  {switchPrompt[0]} <Text style={s.switchAction}>{switchPrompt[1]}</Text>
                </Text>
              </NativePressable>
            ) : (
              <Button
                title={recovery ? 'Back to sign in' : 'Use a different account'}
                variant="ghost"
                disabled={busy}
                onPress={leaveForm}
              />
            )}
          </>
        )}
      </View>
    </ScreenKeyboardScrollView>
  );
}

/** A form field with a persistent label, so it stays clear what goes where while typing. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      flexGrow: 1,
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      // The same 20dp side margin as every other screen.
      padding: 20,
      paddingBottom: 40,
      gap: 36,
    },
    brandMark: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    // Brand and both actions sit together, a little above center.
    contentChoosing: { justifyContent: 'center', paddingBottom: 96 },
    switchLink: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    switchLinkPressed: { backgroundColor: colors.surface },
    secondaryChoice: { borderColor: colors.control },
    switchText: { color: colors.muted, fontSize: 14 },
    switchAction: { color: colors.text, fontWeight: '600' },
    head: { gap: 8 },
    // Lines the arrow up with the back button in every other screen header.
    back: { marginLeft: -10, marginBottom: 12 },
    logo: { color: colors.text, fontSize: 36, fontWeight: '700', letterSpacing: -1.2 },
    lede: { color: colors.secondary, fontSize: 16 },
    form: { gap: 12 },
    choiceActions: { gap: 12 },
    fieldError: { color: colors.danger, fontSize: 13, marginTop: -4 },
    inputError: { borderColor: colors.danger },
    fieldGroup: { gap: 10, marginVertical: 4 },
    field: { gap: 8 },
    fieldLabel: { color: colors.secondary, fontSize: 13, fontWeight: '600' },
    passwordInput: { paddingRight: 52 },
    reveal: {
      position: 'absolute',
      right: 4,
      top: 0,
      bottom: 0,
      width: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    usernameField: {
      height: 52,
      borderWidth: 1,
      borderColor: colors.control,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingLeft: 15,
    },
    at: { color: colors.muted, fontSize: 16, fontWeight: '600' },
    usernameInput: { flex: 1, height: 50, borderWidth: 0, backgroundColor: 'transparent' },
    error: { color: colors.danger, fontSize: 13 },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  },
  [
    'logo',
    'lede',
    'fieldError',
    'fieldLabel',
    'at',
    'error',
    'dividerText',
    'switchText',
    'switchAction',
  ] as const,
);
