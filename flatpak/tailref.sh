#!/bin/sh
# Flatpak launcher for TailRef Studio.
#
# zypak-wrapper (provided by org.electronjs.Electron2.BaseApp) lets Chromium
# use the Flatpak sandbox instead of its own setuid sandbox helper. Without
# it Electron refuses to start or falls back to --no-sandbox.
#
# Keep this file POSIX sh: it is installed as /app/bin/tailref and is the
# `command:` of the Flatpak manifest.

exec zypak-wrapper /app/tailref/tailref "$@"
