import { View } from 'react-native';

import { colors } from '@/lib/theme';

/** The root layout redirects to /welcome or /home once the session is known. */
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
