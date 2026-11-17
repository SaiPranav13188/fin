// App entry: expo-router, plus the Android home-screen widget's background task.
import 'expo-router/entry';

import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './src/widget/task';

if (Platform.OS === 'android') registerWidgetTaskHandler(widgetTaskHandler);
