# Dot to arrow fixture

One C++ file holding every case `assist.dotArrow.enabled` has to get right.
Open **this folder** in the Extension Development Host, not the repository:

```
code --extensionDevelopmentPath=<repo> --new-window fixtures/dot-arrow
```

Needs clangd, and the setting on. In the development window:

```jsonc
"assist.dotArrow.enabled": true
```

Then write the database once and restart clangd:

```
node fixtures/dot-arrow/make-compile-db.js
```

Without it clangd falls back to default flags for the open file. Completion
still answers, so most rows below pass either way - but the database is what
makes a failure mean something about this extension rather than about clangd
not knowing how to parse the file.

## What to press

Each position is a statement marked with a `// [n]` comment on the line above.
**Put the cursor just before the `;` and type a single `.`** - the file is
written so that every one of those places is the end of an expression.

The file compiles as it stands, on purpose: a fixture full of errors makes a
language server answer worse, and then a failure here says nothing.

| | line | type on the left | expect |
|---|---|---|---|
| 1 | `pMgr;` | `AddressMgr*` | **`->`** |
| 2 | `rMgr;` | `AddressMgr&` | stays `.` |
| 3 | `vMgr;` | `AddressMgr` | stays `.` |
| 4 | `owned;` | `Owned<AddressMgr>` | stays `.` - `.reset()` and `.get()` are the right thing to write |
| 5 | `it;` | `Cursor<AddrInfo>` | stays `.` |
| 6 | `pNode->next;` | `Node*` | **`->`** |
| 7 | `pNode->mgr;` | `AddressMgr` | stays `.` |
| 8 | `ppMgr;` | `AddressMgr**` | stays `.` - one arrow reaches a pointer, which has no members, so nothing is offered |
| 9 | `float f = 3;` | a digit | stays `.` - **never asked**, the trace says `left of the dot is number` |
| 10 | the `// [10]` comment itself | - | stays `.` - nothing is offered inside a comment |
| 11 | inside `"pMgr"` | - | stays `.` |
| 12 | `pMgr->First();` | `AddrInfo*` | stays `.` - **never asked**, the trace says `left of the dot is other`. A pointer, and still left alone: the type of a whole expression is a harder question than the type of a name, and it is not asked yet |
| 13 | row 1 again, then `Ctrl+Z` once | - | the `.` is back, and the line is otherwise untouched |

## What this fixture does not cover

- **The real `unique_ptr`, `shared_ptr` and `vector::iterator`.** Rows 4 and 5
  stand in for them, and they stand in on the one property that decides the
  case - a class with `operator->`. No server is known to special-case the
  standard types, but nobody has checked here. Try it once in a real project.
- **cpptools on its own.** Everything above is clangd. cpptools is not known to
  offer the fix at all, in which case every row simply stays a `.`, which is
  the safe way to be wrong.
- **What it costs while typing.** Turn tracing on (`Assist: Start or stop
  tracing`), run the rows, and read the milliseconds per dot.
