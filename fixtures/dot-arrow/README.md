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
| 4 | `owned;` | `Owned<AddressMgr>` | stays `.` - clangd answers 3 arrowed **and 2 plain** (`get`, `reset`), and a plain answer means the dot reaches something |
| 5 | `it;` | `Cursor<AddrInfo>` | stays `.` - 2 arrowed and 1 plain (`base`) |
| 6 | `pNode->next;` | `Node*` | **`->`** |
| 7 | `pNode->mgr;` | `AddressMgr` | stays `.` |
| 8 | `ppMgr;` | `AddressMgr**` | stays `.` - one arrow reaches a pointer, which has no members, so nothing is offered |
| 9 | `float f = 3;` | a digit | stays `.` - **never asked**, the trace says `left of the dot is number` |
| 10 | the `// [10]` comment itself | - | stays `.` - nothing is offered inside a comment |
| 11 | inside `"pMgr"` | - | stays `.` |
| 12 | `pMgr->First();` | `AddrInfo*` | stays `.` - **never asked**, the trace says `left of the dot is other`. A pointer, and still left alone: the type of a whole expression is a harder question than the type of a name, and it is not asked yet |
| 13 | row 1 again, then `Ctrl+Z` once | - | the `.` is back, and the line is otherwise untouched |

## Getting the numbers again

```
npm run probe-clangd
```

talks LSP to clangd directly - no editor, no extension host - types the dot at
every position above and prints how many answers carried an arrow, how many did
not, and what `countEdits()` decides given that. It needs a clangd
(`--clangd=<path>`, `CLANGD`, or one on PATH) and this folder's
`compile_commands.json`, and it exits 2 rather than 1 when it cannot measure, so
that a missing clangd never reads as a failed expectation.

The table below is what it printed. When a row here stops matching what it
prints, one of the two is out of date and the probe is the one that was
measured.

## Where the numbers came from

Rows 4 and 5 stand in for `unique_ptr`, `shared_ptr` and `vector::iterator`,
and they were checked against the real ones rather than assumed to match. The
same positions, driven straight at clangd 18 over LSP with the standard
headers included:

| left of the dot | arrowed | plain |
| --- | --- | --- |
| `AddressMgr*` | 2 | 0 |
| `std::unique_ptr<AddressMgr>` | 2 | 5 |
| `std::shared_ptr<AddressMgr>` | 2 | 10 |
| `std::vector<AddressMgr>::iterator` | 2 | 1 |
| `std::vector<AddressMgr>` | 0 | 38 |

That run is also why `Cursor` has a `base()` it does not obviously need. Its
first version had nothing but operators, which gave 2 arrowed and 0 plain and
made an iterator look exactly like a raw pointer - a stand-in that passed while
the thing it stood for would have been mangled.

## What this fixture does not cover

- **cpptools on its own.** Everything above is clangd. cpptools is not known to
  answer this way at all, in which case every row simply stays a `.`, which is
  the safe way to be wrong.
- **What it costs while typing.** Turn tracing on (`Assist: Start or stop
  tracing`), run the rows, and read the milliseconds per dot. The trace also
  names the reason for every row that did not convert, including the one that
  catches most first attempts: `dot arrow: off`.
