# Round trip fixture

Three C++ files that put every case `Alt+G` has to answer within one screen.
Open **this folder** in the Extension Development Host, not the repository:

```
code --extensionDevelopmentPath=<repo> --new-window fixtures/round-trip
```

Needs a C++ language server installed (`ms-vscode.cpptools` or `clangd`). For
clangd, run this once first and restart clangd:

```
node fixtures/round-trip/make-compile-db.js
```

Without a `compile_commands.json` clangd indexes only the files open in the
editor, so row 1 finds nothing in `shape.cpp` until that file has been opened.
The database is not committed: clangd ignores an entry whose `directory` is
relative, and an absolute one differs per machine. The script writes it with
this folder's path, and `.gitignore` keeps it out.

## What to press

Put the cursor on the name and press `Alt+G`.

Expected rows are what clangd 22 answers. Each position is marked with a
`// [n]` comment on the line above.

| | file:line | on | expect |
|---|---|---|---|
| 1 | `main.cpp:9` | `totalArea` | **menu** - `Definition shape.cpp:18`, `Declaration shape.h:35` |
| 2 | `shape.h:35` | `totalArea` | jump to `shape.cpp:18` |
| 3 | `shape.cpp:18` | `totalArea` | jump to `shape.h:35` |
| 4 | `shape.cpp:7` | `area` | **menu** - `Definition shape.h:18`, `Base virtual shape.h:10` |
| 5 | `shape.h:10` | `area` | **menu** - `Override` four times: `shape.cpp:13`, `shape.cpp:7`, `shape.h:28`, `shape.h:18` |
| 6 | `shape.h:18` | `area` | **menu** - `Definition shape.cpp:7`, `Base virtual shape.h:10` |
| 7 | `shape.cpp:23` | `area` | **menu** - `Override shape.cpp:13`, `Override shape.cpp:7`, `Definition shape.h:10` |
| 8 | `main.cpp:12` | `scale` | **menu** - `Definition shape.cpp:29`, `Declaration shape.h:40`, and no `ui::scale` |

What each one guards:

- **1-3** are the plain round trip: a call site offers both sides, and each side
  goes straight to the other.
- **4-7** are virtuals. clangd answers a definition request made on the
  `override` keyword with the base, which is where **Base virtual** comes from
  (4, 6). On the base itself (5) the definition and declaration answers list the
  overrides; the declarations are marked **Override** because asking from their
  `override` keyword comes back to the cursor. If 5 shows `Definition` or
  `Declaration` rows, an override label lost to the provider order.
- **8** is the namespace filter. `geo::scale` and `ui::scale` share a name, and
  since the providers already answered twice no name search runs at all. On a
  server that answers once, the name rows must still stay inside `geo`.

On cpptools the rows differ - it answers most positions once, so the name search
fills in. `Assist: Explain what the round trip sees here` shows which source
said what.

## When a row is wrong

`Assist: Explain what the round trip sees here` from the command palette, at the
same cursor position. It lists what each source answered, marks the ones dropped
for being where the cursor already is, and ends with what the symbol index
returned *before* filtering - which is the difference between "the index found
nothing" and "the filter threw it all away". Those two look identical from the
outside and want opposite fixes.
