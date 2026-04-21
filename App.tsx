import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import { RecordingsProvider } from './src/store/RecordingsStore';
import RecordingListScreen from './src/screens/RecordingListScreen';
import PlaybackScreen from './src/screens/PlaybackScreen';
import { RootStackParamList } from './src/screens/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') {
        Alert.alert(
          'Microphone Required',
          'Please go to Settings → Privacy → Microphone and enable access for Voice Memos.',
        );
      }
    });
  }, []);
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
