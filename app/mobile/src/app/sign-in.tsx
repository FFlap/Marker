import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useClerk, useSignIn, useSignUp } from '@clerk/expo';
import { useSSO } from '@clerk/expo/experimental';
import { ArrowLeft, LogIn, UserPlus } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, Input } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import { usernameError } from '@/lib/profile';

type AuthErrorContext = 'signIn' | 'signUp' | 'recovery' | 'verification' | 'session' | 'oauth';

const friendly = (e: unknown, context: AuthErrorContext) => {
  const value = e as {
    code?: string;
    message?: string;
    longMessage?: string;
    errors?: {
      code?: string;
      longMessage?: string;
      message?: string;
      meta?: { paramName?: string };
    }[];
  };
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

const throwIfError = (result: { error: unknown | null }) => {
  if (result.error) throw result.error;
};

type RecoveryStage = 'identifier' | 'code' | 'password';

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
  const { client } = useClerk();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [flow, setFlow] = useState<'choose' | 'signIn' | 'signUp'>('choose');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [verification, setVerification] = useState<'signUp' | 'clientTrust' | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStage | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    if (!verification && !recovery && flow === 'signUp') {
      const validation = usernameError(username);
      if (validation) {
        setError(validation);
        setBusy(false);
        return;
      }
    }
    try {
      if (recovery === 'identifier') {
        throwIfError(await signIn.create({ identifier: identifier.trim() }));
        throwIfError(await signIn.resetPasswordEmailCode.sendCode());
        setCode('');
        setRecovery('code');
      } else if (recovery === 'code') {
        throwIfError(await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() }));
        if (signIn.status !== 'needs_new_password') {
          throw new Error('Password reset verification is incomplete');
        }
        setCode('');
        setPassword('');
        setConfirmPassword('');
        setRecovery('password');
      } else if (recovery === 'password') {
        if (password !== confirmPassword) throw new Error('Passwords do not match');
        throwIfError(
          await signIn.resetPasswordEmailCode.submitPassword({
            password,
            signOutOfOtherSessions: true,
          }),
        );
        if (signIn.status === 'complete') {
          throwIfError(await signIn.finalize());
        } else if (signIn.status === 'needs_client_trust') {
          throwIfError(await signIn.mfa.sendEmailCode());
          setRecovery(null);
          setVerification('clientTrust');
        } else {
          throw new Error('Additional sign-in verification is required');
        }
      } else if (verification === 'signUp') {
        const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        // Clerk can complete verification before the hook publishes its next snapshot. Reloading
        // the authoritative resource prevents a successful code from being reported as invalid.
        const currentSignUp = (await client.signUp.reload()).__internal_future;
        if (currentSignUp.status === 'complete') {
          const finalized = await currentSignUp.finalize();
          if (finalized.error) {
            console.error('[Marker auth] Could not activate verified sign-up', finalized.error);
            setError(friendly(finalized.error, 'session'));
          }
        } else {
          throwIfError(result);
          throw new Error('Verification is incomplete');
        }
      } else if (verification === 'clientTrust') {
        throwIfError(await signIn.mfa.verifyEmailCode({ code: code.trim() }));
        if (signIn.status !== 'complete') throw new Error('Verification is incomplete');
        throwIfError(await signIn.finalize());
      } else if (flow === 'signUp') {
        throwIfError(
          await signUp.password({
            emailAddress: identifier.trim(),
            username: username.trim(),
            password,
          }),
        );
        if (signUp.status === 'complete') {
          throwIfError(await signUp.finalize());
        } else {
          throwIfError(await signUp.verifications.sendEmailCode());
          setVerification('signUp');
        }
      } else {
        throwIfError(await signIn.password({ identifier: identifier.trim(), password }));
        if (signIn.status === 'complete') {
          throwIfError(await signIn.finalize());
        } else if (signIn.status === 'needs_client_trust') {
          throwIfError(await signIn.mfa.sendEmailCode());
          setVerification('clientTrust');
        } else {
          throw new Error('Additional sign-in verification is required');
        }
      }
    } catch (cause) {
      const context: AuthErrorContext = verification
        ? 'verification'
        : recovery
          ? 'recovery'
          : flow === 'signUp'
            ? 'signUp'
            : 'signIn';
      setError(friendly(cause, context));
    }
    setBusy(false);
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
    ? 'Enter the six-digit code Clerk sent you.'
    : recovery === 'identifier'
      ? 'We’ll send a reset code to the email on your account.'
      : recovery === 'code'
        ? 'Enter the six-digit password reset code Clerk sent you.'
        : recovery === 'password'
          ? 'Use at least eight characters. You’ll be signed in when it’s updated.'
          : flow === 'choose'
            ? 'A quiet home for everything you watch.'
            : flow === 'signIn'
              ? 'Your watchlist, without the noise.'
              : 'One identity for everything you watch.';

  const signInWithGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await startSSOFlow({ strategy: 'oauth_google' });
      if (result.signUp?.missingFields.includes('username')) {
        const prefix =
          result.signUp.emailAddress
            ?.split('@')[0]
            ?.replace(/[^A-Za-z0-9_]/g, '')
            .slice(0, 16) || 'marker';
        const generated = `${prefix}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);
        throwIfError(await result.signUp.update({ username: generated }));
        if (result.signUp.status === 'complete') throwIfError(await result.signUp.finalize());
      }
    } catch (cause) {
      setError(friendly(cause, 'oauth'));
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View>
          <Text style={s.logo}>{heading}</Text>
          <Text style={s.lede}>{lede}</Text>
        </View>
        <View style={s.form}>
          {flow === 'choose' && !verification && !recovery ? (
            <View style={s.choiceActions}>
              <Text style={s.choiceDetail}>
                Log in to pick up where you left off, or sign up to start your watchlist.
              </Text>
              <Button
                title="Log in"
                icon={<LogIn color={colors.bg} size={18} strokeWidth={2.2} />}
                onPress={() => chooseFlow('signIn')}
              />
              <Button
                title="Sign up"
                icon={<UserPlus color={colors.text} size={18} strokeWidth={2.2} />}
                variant="outline"
                onPress={() => chooseFlow('signUp')}
              />
            </View>
          ) : (
            <>
              {!verification && !recovery && (
                <Button
                  title="Account options"
                  icon={<ArrowLeft color={colors.muted} size={17} strokeWidth={2.2} />}
                  variant="ghost"
                  disabled={busy}
                  onPress={returnToChoices}
                />
              )}
              {enteringCode ? (
                <Input
                  autoComplete="one-time-code"
                  keyboardType="number-pad"
                  placeholder="Verification code"
                  value={code}
                  onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                />
              ) : !recovery && flow === 'signUp' ? (
                <View style={s.fieldGroup}>
                  <Text style={s.label}>Username</Text>
                  <View style={s.usernameField}>
                    <Text style={s.at}>@</Text>
                    <Input
                      accessibilityLabel="Username"
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={24}
                      placeholder="username"
                      value={username}
                      onChangeText={(value) => setUsername(value.replace(/\s/g, ''))}
                      style={s.usernameInput}
                    />
                  </View>
                </View>
              ) : null}
              {!verification && recovery !== 'code' && (
                <>
                  {recovery !== 'password' && (
                    <Input
                      autoCapitalize="none"
                      keyboardType={flow === 'signUp' || !!recovery ? 'email-address' : 'default'}
                      autoComplete="username"
                      placeholder={
                        recovery === 'identifier'
                          ? 'Email or username'
                          : flow === 'signIn'
                            ? 'Username or email'
                            : 'Email'
                      }
                      value={identifier}
                      onChangeText={setIdentifier}
                    />
                  )}
                  <Input
                    secureTextEntry
                    autoComplete={
                      recovery === 'password' || flow === 'signUp'
                        ? 'new-password'
                        : 'current-password'
                    }
                    placeholder={recovery === 'password' ? 'New password' : 'Password'}
                    value={password}
                    onChangeText={setPassword}
                  />
                  {recovery === 'password' && (
                    <Input
                      secureTextEntry
                      autoComplete="new-password"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                    />
                  )}
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
                              ? 'Sign in'
                              : 'Create account'
                }
                icon={
                  busy || verification || recovery ? undefined : flow === 'signIn' ? (
                    <LogIn color={colors.bg} size={18} strokeWidth={2.2} />
                  ) : (
                    <UserPlus color={colors.bg} size={18} strokeWidth={2.2} />
                  )
                }
                onPress={submit}
                disabled={
                  busy ||
                  (enteringCode
                    ? code.length !== 6
                    : recovery === 'identifier'
                      ? !identifier.trim()
                      : recovery === 'password'
                        ? password.length < 8 || confirmPassword.length < 8
                        : !identifier || password.length < 8 || (flow === 'signUp' && !username))
                }
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
                    <Text style={s.dividerText}>OR</Text>
                    <View style={s.dividerLine} />
                  </View>
                  <Button
                    title="Continue with Google"
                    icon={<GoogleIcon />}
                    variant="outline"
                    disabled={busy}
                    onPress={signInWithGoogle}
                  />
                </>
              )}
              <Button
                title={
                  recovery
                    ? 'Back to sign in'
                    : verification
                      ? 'Use a different account'
                      : flow === 'signIn'
                        ? 'New here? Create an account'
                        : 'Already have an account? Sign in'
                }
                variant="ghost"
                onPress={() => {
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
                }}
              />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    padding: 28,
    justifyContent: 'space-between',
    paddingTop: 72,
    paddingBottom: 40,
    gap: 56,
  },
  logo: { color: colors.text, fontSize: 36, fontWeight: '700', letterSpacing: -1.2 },
  lede: { color: colors.muted, fontSize: 16, marginTop: 8 },
  form: { gap: 12 },
  choiceActions: { gap: 12 },
  choiceDetail: { color: colors.muted, fontSize: 14, lineHeight: 22, marginBottom: 10 },
  fieldGroup: { gap: 10, marginVertical: 4 },
  label: { color: colors.text, fontSize: 12, fontWeight: '700' },
  usernameField: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
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
  dividerText: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
});
