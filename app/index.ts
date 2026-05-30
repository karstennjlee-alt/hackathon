// IMPORTANT: env validation MUST be the first import.
// This throws a red-box at boot if any required EXPO_PUBLIC_* var is missing,
// naming the var and its KEYS.md section. No silent misconfiguration.
import './src/env';

import { registerRootComponent } from 'expo';

import AppRoot from './AppRoot';

// AppRoot wraps the v1 App in the auth gate (sign-in screen first, then v1
// monolith once authed). The bare v1 App can still be imported directly
// from './App' for ad-hoc testing.
registerRootComponent(AppRoot);
