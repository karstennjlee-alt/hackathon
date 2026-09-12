// Expo push registration. Called once a real campus session exists.
//
// Needs a development/production build with an EAS project id — Expo Go
// can't receive remote push (removed on Android in SDK 53; iOS Go lacks
// the entitlement for the app's bundle). Every failure here is silent by
// design: the app's local notifications keep working regardless.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { env } from './env';

let registeredToken: string | null = null;

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('emergency', {
    name: 'Emergency alerts',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400],
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync('updates', {
    name: 'Campus updates',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ensureAndroidChannels();
    const perm = await Notifications.getPermissionsAsync();
    const status = perm.granted ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return; // Expo Go / no EAS project yet — skip quietly.

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token || token === registeredToken) return;

    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt) return;
    const res = await fetch(`${env.EXPO_PUBLIC_API_BASE_URL}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ pushToken: token, platform: Platform.OS }),
    });
    if (res.ok) registeredToken = token;
  } catch {
    // best effort
  }
}

export async function unregisterPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt) return;
    await fetch(`${env.EXPO_PUBLIC_API_BASE_URL}/v1/devices`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ pushToken: token }),
    });
  } catch {
    // best effort
  }
}
