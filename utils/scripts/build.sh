#!/usr/bin/env bash
# NexVora ONE build entry point.
# Stop immediately if configuration, web bundling, or Cordova packaging fails.
set -Eeuo pipefail

app="paid"
mode="d"
fdroidFlag=""
packageType="apk"
webpackmode="development"
release_args=()

for arg in "$@"; do
  case "$arg" in
    free|paid)
      app="$arg"
      ;;
    p|prod)
      mode="p"
      webpackmode="production"
      release_args+=(--release)
      ;;
    d|dev)
      mode="d"
      webpackmode="development"
      ;;
    fdroid)
      fdroidFlag="fdroid"
      ;;
    apk|bundle)
      packageType="$arg"
      ;;
    *)
      echo "Warning: Unknown argument '$arg' ignored" >&2
      ;;
  esac
done

root="$(npm prefix)"
cd "$root"

if [[ -n "${TMPDIR:-}" && -d "$TMPDIR" && -r "$TMPDIR" && -w "$TMPDIR" ]]; then
  tmpdir="$TMPDIR"
elif [[ -d /tmp && -r /tmp && -w /tmp ]]; then
  tmpdir="/tmp"
else
  tmpdir=""
  echo "Warning: no writable temporary directory; skipping fdroid.bool." >&2
fi

if [[ -n "$tmpdir" ]]; then
  if [[ "$fdroidFlag" == "fdroid" ]]; then
    printf 'true\n' > "$tmpdir/fdroid.bool"
  else
    printf 'false\n' > "$tmpdir/fdroid.bool"
  fi
fi

if [[ "$fdroidFlag" == "fdroid" ]]; then
  if [[ -d plugins/com.foxdebug.acode.rk.exec.proot ]]; then
    cordova plugin remove com.foxdebug.acode.rk.exec.proot
  fi
else
  if [[ -d src/plugins/proot && ! -d plugins/com.foxdebug.acode.rk.exec.proot ]]; then
    cordova plugin add src/plugins/proot/
  fi
fi

if [[ "$packageType" == "bundle" ]]; then
  echo "Building AAR library file..."
else
  echo "Building APK file..."
fi

echo "App variant: $app"
echo "Build mode: $mode"
echo "Rspack mode: $webpackmode"
echo "Package type: $packageType"

# Do not package stale www/build assets after a failed production bundle.
node ./utils/config.js "$mode" "$app"
rspack --mode "$webpackmode"

cordova_args=(build android)
if [[ "${#release_args[@]}" -gt 0 ]]; then
  cordova_args+=("${release_args[@]}")
fi
cordova_args+=(-- "--packageType=$packageType")

cordova "${cordova_args[@]}"

echo "NexVora ONE build completed successfully."
