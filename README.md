# Round Trip

한국어 문서는 [README.ko.md](README.ko.md).

`Alt+G` takes you to the definition. Press it again on the definition and it
takes you back to the declaration. One key, both directions.

VS Code already ships `Go to Definition`, `Go to Declaration` and
`Go to Implementation` as three separate commands on three separate keys. That
is one key too many for the thing you do a hundred times a day, because at any
given cursor position only one of them has an answer worth having. Round Trip
asks them in order and takes the first answer that is not the place you are
already standing.

Anyone coming from Visual Assist will recognise the behaviour; this is a small
independent extension, not affiliated with or derived from that product.

## How it decides

On each press, the configured chain is walked in order:

| Where the cursor is | What answers | Where you land |
| --- | --- | --- |
| a call site | `definition` | the definition |
| the definition, in a `.cpp` | `declaration` | the declaration in the header |
| the declaration, in a header | `definition` | the definition in the `.cpp` |
| a virtual, over its base | `implementation` | the overrides |

A provider that can only point at the location under the cursor is treated as
having no answer, and the next link in the chain is tried. That single rule is
what turns three one-way commands into a round trip.

The analysis is entirely your language server's — clangd, cpptools,
rust-analyzer, tsserver. Round Trip contributes no parser and no index, so it
works in any language that has a server, and it is exactly as accurate as that
server is.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `roundTrip.chain` | `["definition", "declaration", "implementation"]` | Which providers to ask, in order. |
| `roundTrip.pickWhenAmbiguous` | `true` | Show a picker when several locations answer, instead of taking the first. |

## Rebinding

`Alt+G` is the default. To change it, open Keyboard Shortcuts and search for
`Round Trip`, or put this in `keybindings.json`:

```json
{ "key": "alt+g", "command": "roundTrip.go", "when": "editorTextFocus" }
```

To get back where you came from, VS Code's own `Go Back` (`Alt+Left`) already
covers it — Round Trip's jumps land in the same navigation history.

## Developing

No build step and no dependencies. Clone it, open it, press `F5`; a second
VS Code window opens with the extension loaded.

## License

MIT
