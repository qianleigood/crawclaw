#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <absolute-file-path> [timeout-seconds] [target-app]" >&2
  exit 64
fi

FILE_PATH="$1"
TIMEOUT_SECONDS="${2:-15}"
TARGET_APP="${3:-Google Chrome}"

if [[ ! "$FILE_PATH" = /* ]]; then
  echo "File path must be absolute: $FILE_PATH" >&2
  exit 64
fi

if [[ ! -f "$FILE_PATH" ]]; then
  echo "File does not exist: $FILE_PATH" >&2
  exit 66
fi

/usr/bin/osascript - "$FILE_PATH" "$TIMEOUT_SECONDS" "$TARGET_APP" <<'APPLESCRIPT'
on run argv
  set filePath to item 1 of argv
  set timeoutSeconds to (item 2 of argv) as integer
  set targetApp to item 3 of argv

  set startedAt to (current date)
  set clipboardBackup to the clipboard

  try
    set panelReady to my waitForOpenPanel(targetApp, timeoutSeconds)
    if panelReady is false then error "Timed out waiting for an open panel in " & targetApp

    tell application targetApp to activate
    delay 0.2

    tell application "System Events"
      keystroke "G" using {command down, shift down}
    end tell

    delay 0.5

    set the clipboard to filePath
    tell application "System Events"
      keystroke "v" using command down
      delay 0.25
      key code 36
    end tell

    if my waitForButton(targetApp, {"打开", "Open"}, 8) then
      my clickFirstButton(targetApp, {"打开", "Open"})
    else
      tell application "System Events"
        key code 36
      end tell
    end if

    delay 0.8
    set finishedAt to (current date)
    set elapsedSeconds to (finishedAt - startedAt)
    set the clipboard to clipboardBackup
    return "OK selected file in open panel after " & elapsedSeconds & "s"
  on error errMsg number errNum
    try
      set the clipboard to clipboardBackup
    end try
    error errMsg number errNum
  end try
end run

on waitForOpenPanel(targetApp, timeoutSeconds)
  set deadline to ((current date) + timeoutSeconds)
  repeat while (current date) is less than deadline
    tell application "System Events"
      if exists process targetApp then
        tell process targetApp
          try
            if exists sheet 1 of window 1 then return true
          end try
          try
            if my hasAnyButton(targetApp, {"打开", "Open", "前往", "Go"}) then return true
          end try
        end tell
      end if
    end tell
    delay 0.2
  end repeat
  return false
end waitForOpenPanel

on waitForButton(targetApp, namesList, timeoutSeconds)
  set deadline to ((current date) + timeoutSeconds)
  repeat while (current date) is less than deadline
    if my hasAnyButton(targetApp, namesList) then return true
    delay 0.2
  end repeat
  return false
end waitForButton

on hasAnyButton(targetApp, namesList)
  tell application "System Events"
    if not (exists process targetApp) then return false
    tell process targetApp
      repeat with btnName in namesList
        try
          if exists button (contents of btnName) of window 1 then return true
        end try
        try
          if exists button (contents of btnName) of sheet 1 of window 1 then return true
        end try
      end repeat
    end tell
  end tell
  return false
end hasAnyButton

on clickFirstButton(targetApp, namesList)
  tell application "System Events"
    tell process targetApp
      repeat with btnName in namesList
        try
          click button (contents of btnName) of sheet 1 of window 1
          return true
        end try
        try
          click button (contents of btnName) of window 1
          return true
        end try
      end repeat
    end tell
  end tell
  return false
end clickFirstButton
APPLESCRIPT
