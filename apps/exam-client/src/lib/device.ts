/**
 * Screen capture (`getDisplayMedia`) is a desktop-only web feature: it is
 * absent on iOS/iPadOS Safari, Chrome for Android and most mobile WebViews
 * (caniuse: "not supported"). Feature-detect it so phones/tablets fall back
 * to camera-only monitoring instead of getting stuck at verification.
 */
export function isScreenShareSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const md = navigator.mediaDevices as MediaDevices | undefined;
  return typeof md?.getDisplayMedia === "function";
}

/** Best-effort mobile/tablet hint for copy (not a gate — support check rules). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}
