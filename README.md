# rn-legacy-android-patches

A zero-dependency CLI utility to apply essential compatibility patches and code modifications to legacy React Native projects (e.g. React Native `0.62.x` and packages like `reanimated` v1, `touch-id`, `widget-center`) to compile and run on modern Android versions (Android 14+ / API 34 & 35).

## The Problems This Solves

1. **Gradle 7.x & 8.x Compatibility (`Plugin with id 'maven' not found`)**:
   Older versions of native libraries (like `react-native-reanimated` v1 and `react-native-widget-center`) use the deprecated `maven` plugin in their `build.gradle`. Gradle 7+ completely removed it. This package patches them to use `maven-publish` instead.

2. **Android 14+ Broadcast Receiver Security Crashes (`SecurityException: One of RECEIVER_EXPORTED or RECEIVER_NOT_EXPORTED should be specified`)**:
   On Android 14 (API 34) and higher, registering a dynamic broadcast receiver without specifying export flags is a security violation and crashes the app immediately on startup. This tool patches `MainApplication.java` to override and inject the safety flags globally, and also includes patches for the internal code of React Native.

---

## Usage

You can run this tool directly without installation using `npx`:

### 1. List Available Patches
See which npm packages have compatibility patches available:
```bash
npx rn-legacy-android-patches --list
```

### 2. Apply a Specific Patch
Apply the patch for a single library (e.g. `react-native-reanimated`):
```bash
npx rn-legacy-android-patches --patch react-native-reanimated
```
*This copies the `.patch` file into your local `patches/` folder and applies it using `patch-package`.*

### 3. Apply All Patches
Copy and apply all legacy compatibility patches at once:
```bash
npx rn-legacy-android-patches --all
```

### 4. Patch `MainApplication.java` (Android 14+ Compatibility)
Automatically scans your project's `android/` directory and overrides `registerReceiver` in your `MainApplication.java` to prevent runtime `SecurityException` crashes:
```bash
npx rn-legacy-android-patches --patch-app
```

---

## Manual Integration / Local Setup

If you want to install it as a development dependency:

```bash
npm install --save-dev rn-legacy-android-patches
```

Then add it to your package script or run locally:
```bash
npx rn-legacy-android-patches --all
```

## Contributing / Adding New Patches
To add a new patch to this repository:
1. Make your changes to the target package inside `node_modules/`.
2. Run `npx patch-package <package-name>` to generate the patch in your project's `patches/` folder.
3. Copy the generated `.patch` file into the `patches/` folder of this repository.
4. The CLI will automatically detect the new patch and list it.
