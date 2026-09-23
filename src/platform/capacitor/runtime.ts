import { Capacitor } from '@capacitor/core';

/** True inside the Android app (Capacitor native shell); false in any browser. */
export const isAndroidApp = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
