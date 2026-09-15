# Assist

한국어 문서는 [README.ko.md](README.ko.md).

Navigation shortcuts VS Code does not ship, bound to keys VS Code does not use.

| Key | What it does |
| --- | --- |
| `Alt+G` / `Alt+D` | Go to the definition. Press it on the definition and it goes back to the declaration. |
| `Shift+Alt+O` | Open a file anywhere in the workspace. |
| `Shift+Alt+S` | Find a symbol anywhere in the workspace. |
| `Alt+M` | List the symbols in this file. |

The last three are VS Code's own `Ctrl+P`, `Ctrl+T` and `Ctrl+Shift+O` under a
second key.
`Alt+G` is the one that needed code.

## The round trip

VS Code ships `Go to Definition`, `Go to Declaration` and `Go to Implementation`
as three one-way commands on three keys, but at any given cursor position only
one of them has an answer worth having. `Alt+G` asks them in order and takes the
first location that is not the one under the cursor:

| Where the cursor is | What answers | Where you land |
| --- | --- | --- |
| a call site | `definition` | the definition |
| the definition, in a `.cpp` | `declaration` | the declaration in the header |
| the declaration, in a header | `definition` | the definition in the `.cpp` |
| a virtual, over its base | `implementation` | the overrides |

The analysis is entirely your language server's — clangd, cpptools,
rust-analyzer, tsserver. This extension contributes no parser and no index, so
it works in any language that has a server, and it is exactly as accurate as
that server is.

## How this extension treats your keyboard

A keymap extension can make a mess of a keyboard, so this one is built around
four rules.

**It adds keys, it does not take them.** A conflict happens when a key that
already did something starts doing something else. `Ctrl+T` and `Ctrl+Shift+O`
still work; `Shift+Alt+S` and `Alt+M` are second keys onto the same commands.
Nothing is displaced.

**Every key is checked against the default keymap first.** `tools/check-keys.js`
reads the shipped defaults for Windows, macOS and Linux and reports whether a
candidate key is already spoken for. Run it before adding a binding, and on a
key you are considering:

```bash
node tools/check-keys.js alt+o
```

A key that is spoken for can still be shared, if the rule holding it is
conditional. That is how `Shift+Alt+O` got in. By default it is `Organize
Imports`, but only in a file whose language server can organize imports, and
cpptools cannot, so in C++ the key does nothing. This extension binds it to
Quick Open, and then binds it once more, after that, back to `Organize Imports`
under the default's own `when` clause. The later rule wins wherever both apply:
a TypeScript file still organizes its imports, a C++ file opens Quick Open.
`check-keys` reports that pair as `yields` rather than taken.

**Every binding is scoped as tightly as it can be.** `Alt+G` carries
`editorHasDefinitionProvider`, so in a Markdown file or a settings tab the key is
not claimed at all and whatever else wants it keeps working.

**One switch hands everything back.** Turn off `assist.keymap.enabled` and every
key this extension binds is released at once, because each `when` clause carries
it. The commands stay available from the Command Palette and from your own
`keybindings.json`.

That last one exists because of an asymmetry worth knowing about: rules in your
`keybindings.json` are appended below both the defaults and every extension's,
so **you always win** — and you can remove any rule by prefixing the command with
`-`. An extension has no equivalent. Once it takes a key, a `when` clause is the
only thing that can give it back.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `assist.keymap.enabled` | `true` | Master switch for every contributed key. |
| `assist.roundTrip.chain` | `["definition", "declaration", "implementation"]` | Which providers `Alt+G` asks, in order. |
| `assist.roundTrip.pickWhenAmbiguous` | `true` | Show a picker when several locations answer. |

## Rebinding

Keyboard Shortcuts, search for `Assist`. Or in `keybindings.json`:

```json
{ "key": "alt+g", "command": "assist.roundTrip", "when": "editorTextFocus" }
```

To get back where you came from, VS Code's own `Go Back` (`Alt+Left`) covers it —
these jumps land in the same navigation history.

## Developing

No build step and no dependencies. Clone it, open it, press `F5`; a second
VS Code window opens with the extension loaded.

A feature that needs code is a file in `features/` exporting
`{ commands: { id: handler } }`, a line in the list at the top of
`extension.js`, and a `contributes` entry. A feature that only needs a key is
the `contributes` entry alone.

## License

MIT
