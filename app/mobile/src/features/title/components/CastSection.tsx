import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PosterImage } from '@/components/ui/PosterImage';
import { SkeletonShimmer, SkeletonShimmerGroup } from '@/components/SkeletonShimmer';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { SectionHeader } from './SectionHeader';

type Member = { name: string; character: string; profilePath?: string; characterImageUrl?: string };

function CastPortrait({ member }: { member: Member }) {
  const [displayed, setDisplayed] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = !!(member.profilePath || member.characterImageUrl) && !displayed && !failed;
  return (
    <View style={styles.portrait}>
      <PosterImage
        path={failed ? undefined : member.profilePath}
        imageUrl={failed ? undefined : member.characterImageUrl}
        title={member.name}
        testID={`cast-portrait-${member.name}`}
        style={styles.portrait}
        transition={0}
        onDisplay={() => setDisplayed(true)}
        onError={() => setFailed(true)}
      />
      {pending && (
        <View
          style={styles.imageSkeleton}
          pointerEvents="none"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Loading artwork for ${member.name}`}
        >
          <SkeletonShimmer />
        </View>
      )}
    </View>
  );
}

/** Reserve cast layout while metadata loads, then cover each image until it is displayed. */
export function CastSection({ members, loading }: { members: Member[]; loading: boolean }) {
  if (!members.length && !loading) return null;
  return (
    <>
      <SectionHeader title="Cast" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {members.length ? (
          members.map((member) => (
            <View key={`${member.name}-${member.character}`} style={styles.member}>
              <CastPortrait
                key={member.characterImageUrl ?? member.profilePath ?? ''}
                member={member}
              />
              <Text numberOfLines={1} style={styles.name}>
                {member.name}
              </Text>
              <Text numberOfLines={1} style={styles.role}>
                {member.character}
              </Text>
            </View>
          ))
        ) : (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading cast"
            style={styles.row}
          >
            <SkeletonShimmerGroup>
              {[0, 1, 2, 3].map((index) => (
                <View key={index} style={styles.member}>
                  <View style={[styles.portrait, styles.placeholder]}>
                    <SkeletonShimmer />
                  </View>
                  <View style={styles.nameSkeleton}>
                    <SkeletonShimmer />
                  </View>
                  <View style={styles.roleSkeleton}>
                    <SkeletonShimmer />
                  </View>
                </View>
              ))}
            </SkeletonShimmerGroup>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = createAppStyles(
  {
    row: { flexDirection: 'row' },
    member: { width: 80, marginRight: 12 },
    portrait: { width: 72, height: 96, borderRadius: 10, overflow: 'hidden' },
    placeholder: { backgroundColor: colors.surface },
    imageSkeleton: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.surface,
    },
    name: { color: colors.text, fontSize: 11, fontWeight: '600', marginTop: 7 },
    role: { color: colors.muted, fontSize: 10, marginTop: 3 },
    nameSkeleton: {
      height: 14,
      width: 72,
      marginTop: 7,
      borderRadius: 4,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    roleSkeleton: {
      height: 12,
      width: 54,
      marginTop: 3,
      borderRadius: 4,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
  },
  ['name', 'role'],
);
