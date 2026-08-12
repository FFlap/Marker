import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Trash2 } from 'lucide-react-native';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Button, Input } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { usernameError } from '@/lib/profile';
import { createStyles } from '@/lib/typography';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileFormSkeleton } from './PageSkeletons';
import { ProfileVisibility } from './ProfileVisibility';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

async function fetchImageBlob(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the selected image');
  return response.blob();
}

export function ProfileForm({ setup = false, onSaved }: { setup?: boolean; onSaved: () => void }) {
  const profile = useQuery(api.profiles.me);
  if (profile === undefined) {
    return <ProfileFormSkeleton />;
  }
  return (
    <ProfileFormFields
      key={`${profile.username ?? ''}:${profile.isPublic}`}
      profile={profile}
      setup={setup}
      onSaved={onSaved}
    />
  );
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
  const toast = useToast();
  const [username, setUsername] = useState(profile.username ?? '');
  const [isPublic, setIsPublic] = useState(profile.isPublic);
  const [saving, setSaving] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const validation = usernameError(username);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await save({ username: username.trim(), isPublic });
      onSaved();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(
        /taken/i.test(message) ? 'That username is already taken.' : 'Couldn’t save your profile.',
      );
    }
    setSaving(false);
  };

  const pickAvatar = async () => {
    setPhotoPending(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
      });
      if (result.canceled) {
        setPhotoPending(false);
        return;
      }
      const asset = result.assets[0];
      if (!asset) {
        setPhotoPending(false);
        return;
      }
      if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
        toast.show('Choose an image under 5 MB');
        setPhotoPending(false);
        return;
      }
      const blob = asset.file ?? (await fetchImageBlob(asset.uri));
      if (blob.size > MAX_AVATAR_BYTES) {
        toast.show('Choose an image under 5 MB');
        setPhotoPending(false);
        return;
      }
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': asset.mimeType || blob.type || 'image/jpeg' },
        body: blob,
      });
      if (!response.ok) {
        toast.show('Couldn’t update your profile photo');
        setPhotoPending(false);
        return;
      }
      const payload = (await response.json()) as { storageId?: string };
      if (!payload.storageId) {
        toast.show('Couldn’t update your profile photo');
        setPhotoPending(false);
        return;
      }
      await setAvatar({ storageId: payload.storageId as Id<'_storage'> });
      toast.show('Profile photo updated');
    } catch {
      toast.show('Couldn’t update your profile photo');
    }
    setPhotoPending(false);
  };

  const clearAvatar = async () => {
    setPhotoPending(true);
    try {
      await removeAvatar();
      toast.show('Profile photo removed');
    } catch {
      toast.show('Couldn’t remove your profile photo');
    }
    setPhotoPending(false);
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

const s = createStyles({
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
});
