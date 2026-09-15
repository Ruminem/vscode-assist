# Assist

한국어 문서는 [README.ko.md](README.ko.md).

Navigation shortcuts VS Code does not ship, bound to keys VS Code does not use.

| Key | What it does |
| --- | --- |
| `Alt+G` / `Alt+D` | Go to the definition. Press it on the definition and it goes back to the declaration. |
| `Ctrl+Shift+↓` / `Ctrl+Shift+↑` | Jump to the next / previous function in this file. |
| `Shift+Alt+S` | Search symbols in the workspace, with fuzzy matching you can switch off. |
| `Shift+Alt+O` | Open a file anywhere in the workspace. |
| `Alt+M` | List the symbols in this file. |

The last two are VS Code's own `Ctrl+P` and `Ctrl+Shift+O` under a second key.
The first three rows are the ones that needed code.

Verified on Windows only. The macOS and Linux keys are in the manifest, but
nobody has run them.

## The round trip

VS Code ships `Go to Definition`, `Go to Declaration` and `Go to Implementation`
as three one-way commands on three keys. `Alt+G` asks all of them at once, adds
whatever the workspace symbol index has under the same name, and drops every
answer that points at the place the cursor already is. One place left is a
jump; several open a small menu at the cursor, with the one outside a header
first.

| Where the cursor is | Where you land |
| --- | --- |
| a call site | a menu: the definition in the `.cpp` first, the declaration in the header next |
| the declaration, in a header | the definition in the `.cpp` |
| the definition, in a `.cpp` | the declaration in the header |
| inside a member function's body | a menu: the declarations that carry that name |
| a virtual, over its base | the override |

That table was measured with Microsoft's C/C++ extension, which answers most
positions with exactly one location - the name search is what supplies the
second row of the menu at a call site. When a jump goes somewhere unexpected,
**Assist: Explain what the round trip sees here** lists what each source
answered and which answers were dropped.

The analysis is entirely your language server's — clangd, cpptools,
rust-analyzer, tsserver. This extension contributes no parser and no index, so
it works in any language that has a server, and it is exactly as accurate as
that server is.

## Moving between functions

`Ctrl+Shift+↓` and `Ctrl+Shift+↑` move the cursor to the name of the next or
previous function, method or constructor in the file. The list comes from the
same language server that answers `Alt+G`, so it works in any language whose
server reports document symbols, and where none does the keys are not claimed.
Inside a function body, `Ctrl+Shift+↑` goes to the function you are in.

On Windows those keys are a second binding for extending the selection a line
at a time, which `Shift+↑` and `Shift+↓` already do, so nothing is lost in the
editor. On Linux the same keys add cursors above and below, so they are not
bound there. What decides it is the machine the VS Code window runs on: a
Windows window connected to a Linux host over SSH gets the Windows keys.

## Searching symbols

`Shift+Alt+S` opens a symbol search that matches the letters you type in order,
with gaps: `ce` finds `Circle`. VS Code's own `Ctrl+T` cannot do that with
clangd, and it is not VS Code's fault. That search hands the query to the
language server and can only re-filter what comes back, and clangd matches
only at the start of a name or of a word inside it, so for `ce` it returns
nothing. This search takes the full list the server gives for an empty query,
adds the server's answer to the query itself, and does the matching here.

The button in the search box turns fuzzy matching off for that search, so the
letters have to be adjacent. `assist.symbolSearch.fuzzy` sets where it starts.
`Ctrl+T` is untouched.

The letters that matched are shown in bold. VS Code does not let an extension
choose which letters of a search result it highlights, so they are drawn in
Unicode's bold sans-serif letters instead. Only A-Z, a-z and 0-9 have those,
they can look slightly different from the text around them, and a screen reader
reads them as mathematical letters.

clangd returns at most 100 symbols per request unless it is started with
`--limit-results=0`. In a large project, a name you only remember the middle of
can fall outside that list. The same limit applies to code completion, which is
why it is not raised for you.

## How this extension treats your keyboard

A keymap extension can make a mess of a keyboard, so this one is built around
four rules.

**It adds keys, it does not take them.** A conflict happens when a key that
already did something starts doing something else. `Ctrl+T` and `Ctrl+Shift+O`
still work; `Alt+M` is a second key onto the same command, and `Shift+Alt+S`
opens a search of its own next to `Ctrl+T` rather than instead of it. Nothing
is displaced.

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
| `assist.roundTrip.providers` | `["definition", "implementation", "declaration"]` | Which providers `Alt+G` asks. The order only breaks ties. |
| `assist.roundTrip.searchByName` | `true` | Also look the name up in the workspace symbol index. |
| `assist.roundTrip.pickWhenAmbiguous` | `true` | Show a menu when several locations answer. |
| `assist.symbolSearch.fuzzy` | `true` | Start `Shift+Alt+S` with fuzzy matching on. |

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
