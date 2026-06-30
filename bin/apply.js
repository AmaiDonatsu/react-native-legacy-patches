#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_DIR = path.join(__dirname, '..');
const PATCHES_SOURCE_DIR = path.join(PACKAGE_DIR, 'patches');
const TARGET_PROJECT_DIR = process.cwd();
const TARGET_PATCHES_DIR = path.join(TARGET_PROJECT_DIR, 'patches');

// Helper to list patches in package
function getAvailablePatches() {
  if (!fs.existsSync(PATCHES_SOURCE_DIR)) {
    return [];
  }
  return fs.readdirSync(PATCHES_SOURCE_DIR)
    .filter(file => file.endsWith('.patch'))
    .map(file => {
      // e.g. "react-native-reanimated+1.13.3.patch" -> { filename: ..., packageName: "react-native-reanimated", version: "1.13.3" }
      const match = file.match(/^(.+?)\+(.+?)\.patch$/);
      if (match) {
        return {
          filename: file,
          packageName: match[1].replace(/%2B/g, '+'),
          version: match[2]
        };
      }
      return {
        filename: file,
        packageName: file.replace('.patch', ''),
        version: 'unknown'
      };
    });
}

function printUsage() {
  console.log(`
rn-legacy-android-patches - CLI Tool to apply compatibility patches for legacy React Native projects

Usage:
  npx rn-legacy-android-patches [options]

Options:
  --list           List all legacy patches available in this utility
  --patch <name>   Copy and apply the patch for the specified package
  --copy <name>    Only copy the patch file to target project's patches/ folder
  --all            Copy and apply all patches to the target project
  --patch-app      Auto-patch MainApplication.java to fix Android 14+ BroadcastReceiver crashes
  --help           Show this help menu

Examples:
  npx rn-legacy-android-patches --list
  npx rn-legacy-android-patches --patch react-native-reanimated
  npx rn-legacy-android-patches --all
  npx rn-legacy-android-patches --patch-app
`);
}

function listPatches() {
  const patches = getAvailablePatches();
  console.log('\n--- Legacy React Native Patches Available ---');
  if (patches.length === 0) {
    console.log('No patches found.');
    return;
  }
  patches.forEach(p => {
    console.log(` * ${p.packageName} (version match: ${p.version})`);
  });
  console.log('---------------------------------------------\n');
}

function copyPatch(patchInfo, silent = false) {
  if (!fs.existsSync(TARGET_PATCHES_DIR)) {
    fs.mkdirSync(TARGET_PATCHES_DIR, { recursive: true });
  }

  const srcPath = path.join(PATCHES_SOURCE_DIR, patchInfo.filename);
  const destPath = path.join(TARGET_PATCHES_DIR, patchInfo.filename);

  fs.copyFileSync(srcPath, destPath);
  if (!silent) {
    console.log(`Copied ${patchInfo.filename} to project patches/ directory.`);
  }
}

function applyPatch(packageName) {
  const patches = getAvailablePatches();
  // Find matching patch by package name
  const match = patches.find(p => p.packageName.toLowerCase() === packageName.toLowerCase());
  if (!match) {
    console.error(`Error: No patch found for package name "${packageName}". Run with --list to see available patches.`);
    process.exit(1);
  }

  copyPatch(match);

  console.log(`Applying patch for ${match.packageName}...`);
  try {
    execSync('npx patch-package', { stdio: 'inherit', cwd: TARGET_PROJECT_DIR });
    console.log(`Successfully patched ${match.packageName}!`);
  } catch (error) {
    console.error(`Error executing patch-package: ${error.message}`);
    process.exit(1);
  }
}

function applyAllPatches() {
  const patches = getAvailablePatches();
  if (patches.length === 0) {
    console.log('No patches to copy.');
    return;
  }

  console.log(`Copying all ${patches.length} patches to project patches/ directory...`);
  patches.forEach(p => copyPatch(p, true));
  console.log('All patches copied successfully.');

  console.log('Executing patch-package to apply all patches...');
  try {
    execSync('npx patch-package', { stdio: 'inherit', cwd: TARGET_PROJECT_DIR });
    console.log('All patches applied successfully!');
  } catch (error) {
    console.error(`Error executing patch-package: ${error.message}`);
    process.exit(1);
  }
}

// Find MainApplication.java files recursively
function findMainApplication(dir) {
  if (!fs.existsSync(dir)) return [];
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(findMainApplication(fullPath));
      } else if (file === 'MainApplication.java') {
        results.push(fullPath);
      }
    }
  } catch (e) {
    // Ignore read errors
  }
  return results;
}

function runPatchApp() {
  const searchDir = path.join(TARGET_PROJECT_DIR, 'android', 'app', 'src', 'main');
  console.log(`Searching for MainApplication.java in ${searchDir}...`);
  
  const files = findMainApplication(searchDir);
  if (files.length === 0) {
    console.error('Error: Could not find MainApplication.java. Make sure you run this tool from the root of a React Native Android project.');
    return;
  }

  files.forEach(filePath => {
    console.log(`Found MainApplication.java at: ${filePath}`);
    patchMainApplication(filePath);
  });
}

function patchMainApplication(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 1. Add registerReceiver override if not present
  if (!content.includes('public Intent registerReceiver(')) {
    console.log(`- Injecting registerReceiver compatibility override...`);
    
    // Find onCreate method to insert it before
    const onCreateIndex = content.indexOf('public void onCreate(');
    if (onCreateIndex !== -1) {
      let insertIndex = onCreateIndex;
      const lastOverride = content.lastIndexOf('@Override', onCreateIndex);
      // Ensure the @Override is close to the onCreate (within 50 chars)
      if (lastOverride !== -1 && (onCreateIndex - lastOverride) < 50) {
        insertIndex = lastOverride;
      }
      
      const overrideCode = `  @Override\n  public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter) {\n    if (Build.VERSION.SDK_INT >= 34 && getApplicationInfo().targetSdkVersion >= 34) {\n      return super.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);\n    } else {\n      return super.registerReceiver(receiver, filter);\n    }\n  }\n\n`;
      
      content = content.substring(0, insertIndex) + overrideCode + content.substring(insertIndex);
      modified = true;
    } else {
      console.warn(`Warning: Could not find onCreate method in ${filePath}. Skipping method injection.`);
    }
  }

  // 2. Add imports if not present
  const requiredImports = [
    'import android.content.BroadcastReceiver;',
    'import android.content.Intent;',
    'import android.content.IntentFilter;'
  ];

  let importsToAdd = [];
  for (const imp of requiredImports) {
    if (!content.includes(imp)) {
      importsToAdd.push(imp);
    }
  }

  if (importsToAdd.length > 0) {
    console.log(`- Adding missing Android imports...`);
    // Find the package declaration line to insert imports after it
    const pkgMatch = content.match(/package\s+[\w\.]+;/);
    if (pkgMatch) {
      const insertIndex = pkgMatch.index + pkgMatch[0].length;
      const importsStr = '\n' + importsToAdd.join('\n') + '\n';
      content = content.substring(0, insertIndex) + importsStr + content.substring(insertIndex);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Successfully patched MainApplication.java for Android 14+ compatibility.`);
  } else {
    console.log(`MainApplication.java is already compatible.`);
  }
}

// MAIN CLI ENTRYPOINT
const args = process.argv.slice(2);

if (args.length === 0) {
  printUsage();
  process.exit(0);
}

const command = args[0];

switch (command) {
  case '--list':
    listPatches();
    break;
  case '--patch':
    if (!args[1]) {
      console.error('Error: Please specify the package name to patch (e.g. --patch react-native-reanimated).');
      process.exit(1);
    }
    applyPatch(args[1]);
    break;
  case '--copy':
    if (!args[1]) {
      console.error('Error: Please specify the package name to copy.');
      process.exit(1);
    }
    const patches = getAvailablePatches();
    const match = patches.find(p => p.packageName.toLowerCase() === args[1].toLowerCase());
    if (!match) {
      console.error(`Error: No patch found for package name "${args[1]}".`);
      process.exit(1);
    }
    copyPatch(match);
    break;
  case '--all':
    applyAllPatches();
    break;
  case '--patch-app':
    runPatchApp();
    break;
  case '--help':
  default:
    printUsage();
    break;
}
