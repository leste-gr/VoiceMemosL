import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { RecordingsProvider } from './src/store/RecordingsStore';
import RecordingListScreen from './src/screens/RecordingListScreen';
import PlaybackScreen from './src/screens/PlaybackScreen';
import { RootStackParamList } from './src/screens/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <RecordingsProvider>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#fff' },
            headerTintColor: '#e53935',
            headerTitleStyle: { fontWeight: '700' },
          }}
        >
          <Stack.Screen
            name="List"
            component={RecordingListScreen}
            options={{ title: 'Voice Memos' }}
          />
          <Stack.Screen
            name="Playback"
            component={PlaybackScreen}
            options={{ title: 'Now Playing' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </RecordingsProvider>
  );
}
