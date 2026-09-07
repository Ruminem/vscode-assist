# Round trip fixture

Three C++ files that put every case `Alt+G` has to answer within one screen.
Open **this folder** in the Extension Development Host, not the repository:

```
code --extensionDevelopmentPath=<repo> --new-window fixtures/round-trip
```

Needs a C++ language server installed (`ms-vscode.cpptools` or `clangd`). There
is no `compile_commands.json` on purpose - three files with an include is the
smallest thing a server will index, and adding a build system would only add a
way for the fixture to break.

## What to press

Put the cursor on the name and press `Alt+G`.

| | file:line | on | expect |
|---|---|---|---|
| 1 | `main.cpp:11` | `totalArea` | **picker** - `Definition shape.cpp:13` first, `By name · totalArea shape.h:24` second |
| 2 | `shape.h:24` | `totalArea` | jump to `shape.cpp:13`, no picker |
| 3 | `shape.cpp:13` | `totalArea` | jump to `shape.h:24`, no picker |
| 4 | `shape.cpp:8` | `area` | **picker** - `By name · Shape::area`, `By name · Circle::area` |
| 5 | `shape.h:10` | `area` | jump to `shape.cpp:8`, no picker |

Two of those are the ones worth re-running after any change:

- **1** is the only place the picker exists at all. cpptools answers a call site
  with exactly one location, and one location cannot be offered as a choice, so
  the second row only exists because the workspace symbol index supplies it. If
  row 1 stops showing a picker, `searchByName` has stopped working.
- **4** is the position no provider can answer. Standing in a member function's
  body, definition and typeDefinition both point at that same body and there is
  no declaration provider on cpptools at all, so subtracting the cursor's own
  position leaves nothing. If row 4 says "nowhere to go from here", the name
  search is gone again.

## When a row is wrong

`Assist: Explain what the round trip sees here` from the command palette, at the
same cursor position. It lists what each source answered, marks the ones dropped
for being where the cursor already is, and ends with what the symbol index
returned *before* filtering - which is the difference between "the index found
nothing" and "the filter threw it all away". Those two look identical from the
outside and want opposite fixes.
