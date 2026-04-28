# Hotkey Snippets

Bind `t` (the fzf picker) to a global hotkey on your platform. These
snippets are documentation only — `t` does not install them.

The canonical incantation is to spawn `t` inside your usual terminal
emulator. Pick whichever shell + terminal you live in; the snippets
below assume `kitty`, `Alacritty`, `iTerm2`, and Windows Terminal
respectively, but any terminal that takes a `-e <command>` style flag
works.

---

## Linux (KDE Plasma) — `kwriteconfig5` + `kdialog`

KDE bindings live in `~/.config/khotkeysrc`. The cleanest path is:
**System Settings → Shortcuts → Custom Shortcuts**, add a new
"Global Shortcut → Command/URL" item, hotkey `Ctrl+Alt+T`, command:

```sh
kitty --class t-picker -e t
```

Scripted equivalent (re-applies after KDE picks up changes via
`hotkeys reload`):

```sh
kwriteconfig5 --file khotkeysrc --group Data_1 --key Comment "t picker"
kwriteconfig5 --file khotkeysrc --group Data_1 --key Enabled true
kwriteconfig5 --file khotkeysrc --group Data_1 --key Type "SIMPLE_ACTION_DATA"
kwriteconfig5 --file khotkeysrc --group Data_1Actions --key ActionsCount 1
kwriteconfig5 --file khotkeysrc --group Data_1Actions0 --key Type "COMMAND_URL"
kwriteconfig5 --file khotkeysrc --group Data_1Actions0 --key CommandURL "kitty --class t-picker -e t"
kwriteconfig5 --file khotkeysrc --group Data_1Triggers --key TriggersCount 1
kwriteconfig5 --file khotkeysrc --group Data_1Triggers0 --key Type "SHORTCUT"
kwriteconfig5 --file khotkeysrc --group Data_1Triggers0 --key Key "Ctrl+Alt+T"
qdbus org.kde.kglobalaccel /component/khotkeys reread
```

For a "quick capture" prompt without launching the picker:

```sh
TASK=$(kdialog --inputbox "New task:" "")
[ -n "$TASK" ] && t add "$TASK"
```

GNOME / sway / Hyprland: bind `Ctrl+Alt+T` to your terminal of choice
running `-e t`. The command line is the only thing that changes.

---

## macOS — Hammerspoon (Lua)

Drop into `~/.hammerspoon/init.lua`:

```lua
-- Cmd+Alt+T → open t picker in a new iTerm2 tab
hs.hotkey.bind({"cmd", "alt"}, "T", function()
  hs.osascript.applescript([[
    tell application "iTerm"
      activate
      create window with default profile
      tell current session of current window
        write text "t"
      end tell
    end tell
  ]])
end)

-- Cmd+Alt+N → quick-capture without opening the picker
hs.hotkey.bind({"cmd", "alt"}, "N", function()
  local button, title = hs.dialog.textPrompt("New task", "Title:", "", "Add", "Cancel")
  if button == "Add" and title and #title > 0 then
    hs.execute("/usr/local/bin/t add " .. string.format("%q", title), true)
  end
end)
```

Reload Hammerspoon (menubar → Reload Config) after editing.

If you use Terminal.app instead of iTerm2:

```lua
hs.hotkey.bind({"cmd", "alt"}, "T", function()
  hs.osascript.applescript([[
    tell application "Terminal"
      activate
      do script "t"
    end tell
  ]])
end)
```

---

## Windows — AutoHotkey v2

Save as `t-hotkey.ahk` and run on startup (drop into
`shell:startup` or register as a logon task):

```ahk
#Requires AutoHotkey v2.0

; Ctrl+Alt+T → open t picker in a new Windows Terminal tab
^!t::
{
    Run 'wt new-tab --title "t" cmd /k t'
}

; Ctrl+Alt+N → quick capture
^!n::
{
    title := InputBox("New task title:", "t add", "w320 h120").Value
    if (title != "")
    {
        Run A_ComSpec ' /c t add "' title '"', , "Hide"
    }
}
```

If `wt` (Windows Terminal) isn't installed, fall back to:

```ahk
^!t::Run 'cmd /k t'
```

For PowerShell users who prefer pwsh in the new tab:

```ahk
^!t::Run 'wt new-tab --title "t" pwsh -NoExit -Command t'
```

---

## Notes

- All of the above invoke `t` with no arguments → the fzf picker. The
  picker re-fetches the task list every iteration; there is no caching
  in the CLI process.
- The picker requires `fzf` on `$PATH`; on missing-fzf the CLI prints
  a one-line install hint and exits 2 (see `src/cli/picker.ts`).
- For tmux users, the simplest binding is in `~/.tmux.conf`:
  `bind-key t split-window -h "t"` — opens the picker in a vertical
  split.
