import * as Effect from 'effect/Effect';
import { useOperation } from '@/hooks/use-operation';
import { AvatarError, avatarStep, uploadAvatar, saveProfile } from '@marker/shared/clientEffects';
import { useRef, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { ActivityIndicator, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Camera from 'lucide-react-native/icons/camera';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import type { Id } from '@marker/shared/dataModel';
import { Button, Input } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { getConvexSiteUrl } from '@/lib/convexUrl';
import { usernameError } from '@/lib/profile';
import { createAppStyles } from '@/lib/typography';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileFormSkeleton } from './PageSkeletons';
import { ProfileVisibility } from './ProfileVisibility';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function ProfileForm({ setup = false, onSaved }: { setup?: boolean; onSaved: () => void }) {
  const profile = useQuery(api.profiles.me);
  if (profile === undefined) {
    return <ProfileFormSkeleton />;
  }
  return <ProfileFormFields profile={profile} setup={setup} onSaved={onSaved} />;
}

function ProfileFormFields({
  profile,
  setup,
  onSaved,
}: {
  profile: {
    username?: string;
    avatarUrl?: string;
    isPublic: boolean;
  };
  setup: boolean;
  onSaved: () => void;
}) {
  const save = useMutation(api.profiles.save);
  const generateUploadUrl = useMutation(api.profiles.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profiles.setAvatar);
  const removeAvatar = useMutation(api.profiles.removeAvatar);
  const { getToken } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState(profile.username ?? '');
  const [isPublic, setIsPublic] = useState(profile.isPublic);
  const [saving, setSaving] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [error, setError] = useState('');
  const run = useOperation();
  const photoBusy = useRef(false);

  const submit = async () => {
    const validation = usernameError(username);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    await run.write(
      saveProfile(() => save({ username: username.trim(), isPublic })),
      {
        success: onSaved,
        failure: ({ cause }) => {
          const message = cause instanceof Error ? cause.message : '';
          setError(
            /taken/i.test(message)
              ? 'That username is already taken.'
              : 'Couldn’t save your profile.',
          );
        },
        settled: () => setSaving(false),
      },
    );
  };

  const finishPhoto = () => {
    photoBusy.current = false;
    setPhotoPending(false);
  };
  const persistAvatar = Effect.fn('persistAvatar')(function* (asset: ImagePicker.ImagePickerAsset) {
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) return 'Choose an image under 5 MB';
    const blob =
      asset.file ??
      (yield* Effect.gen(function* () {
        const response = yield* avatarStep((signal) => fetch(asset.uri, { signal }));
        if (!response.ok) return yield* new AvatarError({ cause: 'Could not read selected image' });
        return yield* avatarStep(() => response.blob());
      }));
    if (blob.size > MAX_AVATAR_BYTES) return 'Choose an image under 5 MB';
    yield* uploadAvatar({
      blob,
      contentType: asset.mimeType || blob.type || 'image/jpeg',
      uploadPath: generateUploadUrl,
      token: getToken,
      resolveUrl: (path) => {
        const siteUrl = getConvexSiteUrl();
        if (!siteUrl) throw new Error('Avatar uploads are unavailable');
        const url = new URL(path, siteUrl);
        if (url.origin !== new URL(siteUrl).origin) throw new Error('Invalid upload origin');
        return url.toString();
      },
      publish: (storageId) => setAvatar({ storageId: storageId as Id<'_storage'> }),
    });
    return 'Profile photo updated';
  });
  const pickAvatar = () => {
    if (photoBusy.current) return Promise.resolve();
    photoBusy.current = true;
    setPhotoPending(true);
    return run(
      avatarStep(() =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.82,
        }),
      ),
      {
        success: (result) => {
          if (result.canceled || !result.assets[0]) {
            finishPhoto();
            return;
          }
          void run.write(persistAvatar(result.assets[0]), {
            success: (message) => toast.show(message),
            failure: () => toast.show('Couldn’t update your profile photo'),
            settled: finishPhoto,
          });
        },
        failure: () => {
          toast.show('Couldn’t update your profile photo');
          finishPhoto();
        },
      },
    );
  };

  const clearAvatar = () => {
    if (photoBusy.current) return Promise.resolve();
    photoBusy.current = true;
    setPhotoPending(true);
    return run.write(
      avatarStep(() => removeAvatar()),
      {
        success: () => toast.show('Profile photo removed'),
        failure: () => toast.show('Couldn’t remove your profile photo'),
        settled: finishPhoto,
      },
    );
  };

  return (
    <View style={s.form}>
      <View style={s.photoRow}>
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={profile.avatarUrl ? 'Change profile photo' : 'Add profile photo'}
          disabled={photoPending}
          onPress={() => void pickAvatar()}
          style={s.avatarButton}
          pressedStyle={s.pressed}
        >
          <ProfileAvatar username={username} avatarUrl={profile.avatarUrl} size={88} />
          <View style={s.cameraBadge}>
            {photoPending ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Camera size={15} color={colors.bg} strokeWidth={2} />
            )}
          </View>
        </NativePressable>
        <View style={s.photoCopy}>
          <Text style={s.photoTitle}>{profile.avatarUrl ? 'Your photo' : 'Add a photo'}</Text>
          <Text style={s.photoHelp}>Square images work best. Up to 5 MB.</Text>
          {profile.avatarUrl && (
            <NativePressable
              accessibilityRole="button"
              disabled={photoPending}
              onPress={() => void clearAvatar()}
              hitSlop={2}
              style={s.remove}
              pressedStyle={s.pressed}
            >
              <Trash2 size={13} color={colors.muted} strokeWidth={1.8} />
              <Text style={s.removeText}>Remove</Text>
            </NativePressable>
          )}
        </View>
      </View>

      <View style={s.field}>
        <Text style={s.label}>Username</Text>
        <View style={[s.usernameField, !!error && s.usernameFieldError]}>
          <Text style={s.at}>@</Text>
          <Input
            accessibilityLabel="Username"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            placeholder="username"
            value={username}
            onChangeText={(value) => {
              setUsername(value.replace(/\s/g, ''));
              setError('');
            }}
            style={s.usernameInput}
          />
        </View>
        <Text style={error ? s.error : s.hint}>
          {error || '3–24 characters. Letters, numbers, and underscores.'}
        </Text>
      </View>

      {!setup && (
        <View style={s.field}>
          <Text style={s.label}>Profile visibility</Text>
          <ProfileVisibility value={isPublic} onChange={setIsPublic} disabled={saving} />
        </View>
      )}

      <Button
        title={saving ? 'Saving…' : setup ? 'Create profile' : 'Save changes'}
        disabled={saving || photoPending || !username.trim()}
        onPress={() => void submit()}
      />
    </View>
  );
}

const s = createAppStyles(
  {
    form: { gap: 32 },
    photoRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
    avatarButton: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.68 },
    cameraBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.text,
      borderWidth: 3,
      borderColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoCopy: { flex: 1 },
    photoTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    photoHelp: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
    remove: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
    },
    removeText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
    field: { gap: 10 },
    label: { color: colors.text, fontSize: 13, fontWeight: '700' },
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
    usernameFieldError: { borderColor: colors.danger },
    at: { color: colors.muted, fontSize: 16, fontWeight: '600' },
    usernameInput: { flex: 1, height: 50, borderWidth: 0, backgroundColor: 'transparent' },
    hint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
    error: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  },
  ['photoTitle', 'photoHelp', 'removeText', 'label', 'at', 'hint', 'error'] as const,
);
