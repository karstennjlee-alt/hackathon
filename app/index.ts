// IMPORTANT: env validation MUST be the first import.
// This throws a red-box at boot if any required EXPO_PUBLIC_* var is missing,
// naming the var and its KEYS.md section. No silent misconfiguration.
import './src/env';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
