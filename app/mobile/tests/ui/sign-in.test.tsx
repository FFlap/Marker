import React from 'react';
import { fireEvent, render, userEvent, waitFor } from '@testing-library/react-native';

const mockSignInPassword = jest.fn();
const mockSignInFinalize = jest.fn(async () => ({ error: null }));
const mockSignInCreate = jest.fn(async () => ({ error: null }));
const mockResetSendCode = jest.fn(async () => ({ error: null }));
const mockResetVerifyCode = jest.fn(async () => {
  mockSignInResource.status = 'needs_new_password';
  return { error: null };
});
const mockResetSubmitPassword = jest.fn(async () => {
  mockSignInResource.status = 'complete';
  return { error: null };
});
const mockSignInResource = {
  status: 'complete',
  create: mockSignInCreate,
  password: mockSignInPassword,
  finalize: mockSignInFinalize,
  reset: jest.fn(async () => ({ error: null })),
  resetPasswordEmailCode: {
    sendCode: mockResetSendCode,
    verifyCode: mockResetVerifyCode,
    submitPassword: mockResetSubmitPassword,
  },
  mfa: {
    sendEmailCode: jest.fn(async () => ({ error: null })),
    verifyEmailCode: jest.fn(async () => ({ error: null })),
  },
};
const mockSignUpPassword = jest.fn();
const mockSignUpSendCode = jest.fn(async () => ({ error: null }));
const mockSignUpVerifyEmailCode = jest.fn(async () => {
  mockSignUpResource.status = 'complete';
  return { error: null };
});
const mockSignUpFinalize = jest.fn(async () => ({ error: null }));
const mockSignUpResource = {
  status: 'missing_requirements',
  password: mockSignUpPassword,
  finalize: mockSignUpFinalize,
  reset: jest.fn(async () => ({ error: null })),
  verifications: {
    sendEmailCode: mockSignUpSendCode,
    verifyEmailCode: mockSignUpVerifyEmailCode,
  },
};
const mockSignUpReload = jest.fn(async () => ({ __internal_future: mockSignUpResource }));
jest.mock('@clerk/expo', () => ({
  useClerk: () => ({ client: { signUp: { reload: mockSignUpReload } } }),
  useSignIn: () => ({ signIn: mockSignInResource }),
  useSignUp: () => ({ fetchStatus: 'idle', signUp: mockSignUpResource }),
}));
jest.mock('@clerk/expo/experimental', () => ({
  useSSO: () => ({ startSSOFlow: jest.fn() }),
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import SignIn from '../../src/app/sign-in';

describe('sign-in screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignInResource.status = 'complete';
    mockSignUpResource.status = 'missing_requirements';
    mockSignInPassword.mockResolvedValue({ error: null });
    mockSignUpPassword.mockResolvedValue({ error: null });
  });

  it('shows friendly text for Clerk failures and toggles modes', async () => {
    const user = userEvent.setup();
    mockSignInPassword.mockResolvedValue({ error: new Error('invalid password') });
    const view = await render(<SignIn />);
    expect(view.getByText('Log in')).toBeTruthy();
    expect(view.getByText('Sign up')).toBeTruthy();
    expect(view.queryByPlaceholderText('Username or email')).toBeNull();

    await user.press(view.getByText('Log in'));
    await fireEvent.changeText(
      view.getByPlaceholderText('Username or email'),
      'person@example.com',
    );
    await fireEvent.changeText(view.getByPlaceholderText('Password'), 'password');
    await user.press(view.getByText('Sign in'));
    expect(mockSignInPassword).toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByText('That email or password is not correct.')).toBeTruthy(),
    );
    await user.press(view.getByText('New here? Create an account'));
    await waitFor(() => expect(view.getByText('Create account')).toBeTruthy());
  });

  it('finalizes Clerk after a successful password sign-in', async () => {
    const user = userEvent.setup();
    const view = await render(<SignIn />);
    await user.press(view.getByText('Log in'));
    await fireEvent.changeText(view.getByPlaceholderText('Username or email'), 'viewer_name');
    await fireEvent.changeText(view.getByPlaceholderText('Password'), 'long-password');
    await user.press(view.getByText('Sign in'));
    await waitFor(() =>
      expect(mockSignInPassword).toHaveBeenCalledWith({
        identifier: 'viewer_name',
        password: 'long-password',
      }),
    );
    expect(mockSignInFinalize).toHaveBeenCalled();
  });

  it('starts Clerk email verification during sign-up', async () => {
    const user = userEvent.setup();
    const view = await render(<SignIn />);
    await user.press(view.getByText('Sign up'));
    await fireEvent.changeText(view.getByLabelText('Username'), 'Flappy_7');
    await fireEvent.changeText(view.getByPlaceholderText('Email'), 'new@marker.local');
    await fireEvent.changeText(view.getByPlaceholderText('Password'), 'long-password');
    await user.press(view.getByText('Create account'));
    await waitFor(() =>
      expect(mockSignUpPassword).toHaveBeenCalledWith({
        emailAddress: 'new@marker.local',
        password: 'long-password',
        username: 'Flappy_7',
      }),
    );
    expect(mockSignUpSendCode).toHaveBeenCalled();
    expect(view.getByPlaceholderText('Verification code')).toBeTruthy();
  });

  it('finalizes immediately after Clerk accepts a sign-up verification code', async () => {
    const user = userEvent.setup();
    const view = await render(<SignIn />);
    await user.press(view.getByText('Sign up'));
    await fireEvent.changeText(view.getByLabelText('Username'), 'Flappy_7');
    await fireEvent.changeText(view.getByPlaceholderText('Email'), 'new@marker.local');
    await fireEvent.changeText(view.getByPlaceholderText('Password'), 'long-password');
    await user.press(view.getByText('Create account'));
    await fireEvent.changeText(view.getByPlaceholderText('Verification code'), '424242');
    await user.press(view.getByText('Verify email'));

    await waitFor(() => expect(mockSignUpVerifyEmailCode).toHaveBeenCalledWith({ code: '424242' }));
    expect(mockSignUpFinalize).toHaveBeenCalled();
    expect(view.queryByText('That verification code is invalid or expired.')).toBeNull();
  });

  it('trusts Clerk’s reloaded completed signup over a contradictory verification result', async () => {
    mockSignUpVerifyEmailCode.mockImplementationOnce(async () => {
      mockSignUpResource.status = 'complete';
      return { error: new Error('code is invalid') };
    });
    const user = userEvent.setup();
    const view = await render(<SignIn />);
    await user.press(view.getByText('Sign up'));
    await fireEvent.changeText(view.getByLabelText('Username'), 'Flappy_7');
    await fireEvent.changeText(view.getByPlaceholderText('Email'), 'new@marker.local');
    await fireEvent.changeText(view.getByPlaceholderText('Password'), 'long-password');
    await user.press(view.getByText('Create account'));
    await fireEvent.changeText(view.getByPlaceholderText('Verification code'), '424242');
    await user.press(view.getByText('Verify email'));

    await waitFor(() => expect(mockSignUpReload).toHaveBeenCalled());
    expect(mockSignUpFinalize).toHaveBeenCalled();
    expect(view.queryByText('That verification code is invalid or expired.')).toBeNull();
  });

  it('shows the real password requirement during sign-up instead of a sign-in error', async () => {
    const user = userEvent.setup();
    mockSignUpPassword.mockResolvedValue({
      error: {
        errors: [
          {
            code: 'form_password_pwned',
            longMessage: 'Password has been found in an online data breach.',
            meta: { paramName: 'password' },
          },
        ],
      },
    });
    const view = await render(<SignIn />);

    await user.press(view.getByText('Sign up'));
    await fireEvent.changeText(view.getByLabelText('Username'), 'Flappy_7');
    await fireEvent.changeText(view.getByPlaceholderText('Email'), 'new@marker.local');
    await fireEvent.changeText(view.getByPlaceholderText('Password'), 'long-password');
    await user.press(view.getByText('Create account'));

    await waitFor(() =>
      expect(
        view.getByText('That password has appeared in a data breach. Choose a different password.'),
      ).toBeTruthy(),
    );
    expect(view.queryByText('That email or password is not correct.')).toBeNull();
    expect(mockSignInPassword).not.toHaveBeenCalled();
  });

  it('keeps password recovery inside the custom Clerk UI', async () => {
    const user = userEvent.setup();
    const view = await render(<SignIn />);

    await user.press(view.getByText('Log in'));
    await user.press(view.getByText('Forgot password?'));
    await fireEvent.changeText(view.getByPlaceholderText('Email or username'), 'viewer_name');
    await user.press(view.getByText('Send reset code'));

    await waitFor(() =>
      expect(mockSignInCreate).toHaveBeenCalledWith({ identifier: 'viewer_name' }),
    );
    expect(mockResetSendCode).toHaveBeenCalled();

    await fireEvent.changeText(view.getByPlaceholderText('Verification code'), '123456');
    await user.press(view.getByText('Verify code'));
    await waitFor(() => expect(mockResetVerifyCode).toHaveBeenCalledWith({ code: '123456' }));

    await fireEvent.changeText(view.getByPlaceholderText('New password'), 'new-password');
    await fireEvent.changeText(view.getByPlaceholderText('Confirm new password'), 'new-password');
    await user.press(view.getByText('Update password'));

    await waitFor(() =>
      expect(mockResetSubmitPassword).toHaveBeenCalledWith({
        password: 'new-password',
        signOutOfOtherSessions: true,
      }),
    );
    expect(mockSignInFinalize).toHaveBeenCalled();
  });
});
