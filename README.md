# Assist

한국어 문서는 [README.ko.md](README.ko.md).

Navigation shortcuts VS Code does not ship, bound to keys VS Code does not use.

| Key | What it does |
| --- | --- |
| `Alt+G` / `Alt+D` | Go to the definition. Press it on the definition and it goes back to the declaration. |
| `Ctrl+Shift+↓` / `Ctrl+Shift+↑` | Jump to the next / previous function in this file. |
| `Shift+Alt+S` | Search symbols in the workspace, with fuzzy matching you can switch off. |
| `Alt+E` | Search files in the workspace, and find them through a Korean keyboard too. |
| `Ctrl+Alt+P` | Attach the debugger to a running process. |
| `Shift+Alt+P` | Attach again to the process attached last. |
| `Shift+Alt+O` | Open a file anywhere in the workspace. |
| `Alt+M` | List the symbols in this file. |
| `Alt+F` | Find every reference to the symbol under the cursor, in the References panel. Press it again there to go back to the editor. |

The last three are VS Code's own `Ctrl+P`, `Ctrl+Shift+O` and `Shift+Alt+F12` under a second key.
The first six rows are the ones that needed code.

Verified on Windows only. The macOS and Linux keys are in the manifest, but
nobody has run them.

## The round trip

VS Code ships `Go to Definition`, `Go to Declaration` and `Go to Implementation`
as three one-way commands on three keys. `Alt+G` asks all of them at once and drops every
answer that points at the place the cursor already is. One place left is a
jump; several open a small menu at the cursor, with the one outside a header
first.

When those answers leave fewer than two places, it also looks the name up in
the workspace symbol index. Those rows are guesses - an index knows names, not
which of them you meant - so they only fill in for a server that answered with
one place or none, they keep only the namespace or class of the symbol the
providers landed on (or the cursor stands on) - when that cannot be told and a
provider found anything at all, there are none - and they always sit below the
answers the providers resolved. A name shared across namespaces used to put a
dozen of them on top of the two rows that mattered.

In C++, virtuals get rows of their own. An implementation answer is always an
override there, so it is labelled **Override**. The other direction has no
request of its own, but clangd answers a definition request made on the
`override` keyword with the virtual being overridden - so when the line the
cursor or a provider landed on spells `override` or `final`, `Alt+G` asks
there too and adds the answer as **Base virtual**. On the base itself that same
question tells the overrides' declarations apart from the base's own, and they
are marked **Override** as well.

Until clangd has indexed the project it only knows the files open in the
editor, and without a `compile_commands.json` it never indexes anything else.
For that stretch `Alt+G` adds **text guesses** in C/C++: lines that look like a
definition of the name, found with the ripgrep VS Code already ships. They are
not an index - nothing is kept once the menu closes. A guess never jumps on its
own; up to five open the menu, each with a similarity percentage built from what
a line of text can show (the header/source pair of what the server did find, a
`geo::` qualifier against `namespace geo`, the argument count, a body rather
than a `;`, the same folder), and the last row says how far the index has got,
counted from the files clangd leaves in `.cache/clangd/index`. The search only
runs while that index is incomplete and the server left fewer than two places to
go, skips names shorter than three characters and keywords, and stops after 1.5
seconds. While indexing, `Alt+G` also stops waiting on the server after two
seconds instead of sitting on a parse. None of this happens when clangd is not
installed or `clangd.enable` is `false`: then cpptools is the one answering, its
answers are waited for in full, and there is no clangd index to report on. Only that first line is
read; a signature wrapped before the keyword gets no base row.

| Where the cursor is | Where you land |
| --- | --- |
| a call site | a menu: the definition in the `.cpp` first, the declaration in the header next |
| the declaration, in a header | the definition in the `.cpp` |
| the definition, in a `.cpp` | the declaration in the header |
| inside a member function's body | the declaration in the header; for an override, a menu that adds the base virtual |
| a virtual, over its base | the override, or a menu of them when there are several |

That table was measured with Microsoft's C/C++ extension, which answers most
positions with exactly one location - the name search is what supplies the
second row of the menu at a call site. When a jump goes somewhere unexpected,
**Assist: Explain what the round trip sees here** lists what each source
answered, how long each took, and which answers were dropped. While the
sources are still answering, the status bar shows a spinner - the menu can only
open once the slowest of them is done, so a server still parsing the file is a
wait with nothing else on screen.

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
The full list is not waited for - on a large project it is the slowest answer -
so rows for the query show first and the gap-matched ones join when it arrives.

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

## Attaching the debugger

`Ctrl+Alt+P` opens the C/C++ extension's process picker and attaches its Windows
debugger to the process you choose, with no `launch.json` entry to write first.
`Shift+Alt+P` attaches again to the process attached last in this window. It
finds that process by its executable name, so a program that was stopped and
started again is picked up under its new process id. When several running
processes share the name you choose among them, and before anything has been
attached it opens the picker instead.

Both need the C/C++ extension (`ms-vscode.cpptools`): its debugger does the
work, and this extension only asks it to. They are bound on Windows only, where
that debugger can attach from a process id alone. The process attached last is
forgotten when the window reloads.

## Turning a dot into an arrow

In C and C++, a `.` typed after a pointer is a slip of the hand every time, and
the fix is always the same three keystrokes back. With
`assist.dotArrow.enabled` on, the dot becomes `->` as you type.

**It is on by default**, and it is the one thing here that does not wait to be
asked: everything else happens when you press a key, this one changes what you
typed. If that is not wanted, turn it off for a workspace, or for one language
with a `"[cpp]"` block.

**Whether the thing on the left is a pointer is not decided here.** Right after
the dot, the language server is asked what could be completed at that spot, and
the dot is converted only when **nothing on that list can be reached with a
dot** - when every answer came back with an edit that reaches over the dot and
writes `->` in its place. That is true of a raw pointer by definition, and it
is the whole test. Only the dot is then replaced; the member name that came
with the completion is not inserted.

Both halves of that sentence are load-bearing, and the first version of this
feature only had the first. A class with `operator->` answers a dot with an
arrow too - that is how `unique_ptr` offers you the pointee's members - but it
answers with `get`, `reset` and `release` untouched alongside them, because
those really are reached with a dot. Converting on the presence of an arrow
alone rewrites `.reset()` into `->reset()`, which is the one accident this
feature must not have. Requiring that nothing was left plain leaves smart
pointers and iterators alone without a list of exceptions to keep correct.

Measured against clangd 18, one dot at a time:

| left of the dot | answers with an arrow | answers left plain | converted |
| --- | --- | --- | --- |
| `AddressMgr*` | 2 | 0 | yes |
| `std::unique_ptr<AddressMgr>` | 2 | 5 | no |
| `std::shared_ptr<AddressMgr>` | 2 | 10 | no |
| `std::vector<AddressMgr>::iterator` | 2 | 1 | no |
| `std::vector<AddressMgr>` | 0 | 38 | no |

Asking the server rather than reasoning about types also means this extension
still has no parser - the standing rule here - and that a server which does not
answer this way simply leaves your dot alone.

Three smaller decisions, in the order you would hit them:

- The conversion is applied as an edit of its own, so **one `Ctrl+Z` brings the
  dot back** and leaves the typing before it alone. An automatic change you
  cannot undo in one press is not help, it is an argument.
- **One `Backspace` right after the conversion takes the whole `->`.** You
  typed one character and got two; the key that would have taken the dot takes
  both. This is the only moment the extension claims `Backspace`: a context key
  is set by the conversion and cleared as soon as the cursor moves, and the
  keybinding fires only while it holds. Everywhere else `Backspace` is not this
  extension's business, and `assist.keymap.enabled` turns this off with the
  rest.
- An answer that arrives **after anything else has been typed is dropped**. The
  question takes a moment, and in that moment the cursor can be a word further
  on; applying a stale yes there is the one way this can damage a file rather
  than merely annoy.
- A dot after a digit (`3.14`) is never asked about. A dot after `)` or `]` -
  a call, a subscript, a cast - is asked the same question as a dot after a
  name, because the type is never worked out here either way. Measured on
  clangd 22 at 37 such positions: every expression that yields a pointer
  answered with arrows only, and every value, reference, smart pointer,
  `optional` and iterator answered with plain members alongside, so
  `MakeRaw().` becomes `MakeRaw()->` and `vec.begin().` stays as it is.

`fixtures/dot-arrow/` holds every one of these cases in one file, with what to
expect at each. Turn tracing on to see what the server answered and how long it
took per dot.

## Searching files

`Alt+E` opens a file search of this extension's own. Type any letters of the
path in order - `fda` reaches `features/dot-arrow.js` - and the letters that
matched are drawn in bold.

**It also finds files through a Korean keyboard.** Code is written in English
and file names follow it, but an input method left switched on does not know
that: reaching for `abcd` puts `뮻ㅇ` in the box, because the keys land as jamo
and the jamo compose into syllables. Every jamo came from exactly one key, so
the query is simply read twice - as itself, and as the keys that produced it -
and whichever reading scores higher is the one you see. Nothing detects a
language and nothing is guessed at, so a file actually named in Korean still
matches as itself.

**`Shift+Alt+O` still opens VS Code's own file picker, unchanged.** That is not
a hedge: an extension cannot read what is typed into that box, cannot replace
the matcher behind it, and can only open it. So this is a second key rather than
a replacement - keys are added here, not taken - and VS Code's picker keeps what
it is better at: `:42` to jump to a line, `@` for symbols, and the recently
opened files it offers before you type anything. This window has none of those.

## When it feels slow

**Assist: Start or stop tracing** is a debugging aid, off until you start it.
While it runs the status bar shows **Assist: tracing** - click it to stop - and
every `Alt+G`, `Shift+Alt+S` and function step writes one line to a
temporary file: when each stage finished, how many answers it had, and the
total. Stopping asks where to save it as a text file; saved or not, the
temporary file is deleted. Closing the window mid-trace deletes it too, and one
left behind by a crash is deleted the next time VS Code starts. The lines hold
file paths, symbol names and what you typed into symbol search, which is why
tracing never runs on its own and never goes to an output channel, whose
contents VS Code copies into its session logs. `Alt+G` lists the providers, the base virtual lookup, the name search
(or that it was not waited for) and the menu; symbol search lists the server's
answer, the full list, and how long the matching here took.

When something feels off, run **Assist: Write a note about what just felt wrong**
right there. It asks what felt wrong and opens an unsaved Markdown note with
that sentence, the versions and settings of clangd and cpptools, the cursor's
file, line and word, and timings of every stage at the cursor asked one at a
time - including the one the trace cannot see, how long VS Code takes to
collect code actions before the menu opens - followed by the last 50 trace
lines when tracing was on. Nothing is written until you save it. Read it before sharing: it carries
file paths, symbol names and the line of code under the cursor.

Some waiting is avoided up front. `Ctrl+Shift+↓` pressed in a row reuses the
outline while the file is unchanged, and a symbol search query that only adds
letters rescans what the last one matched rather than the whole list.

## How this extension treats your keyboard

A keymap extension can make a mess of a keyboard, so this one is built around
four rules.

**It adds keys, it does not take them.** A conflict happens when a key that
already did something starts doing something else. `Ctrl+T` and `Ctrl+Shift+O`
still work; `Alt+M` and `Alt+F` are second keys onto the same commands, and `Shift+Alt+S`
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
| `assist.roundTrip.textSearch` | `true` | While clangd's index is incomplete, add text guesses with a similarity percentage. |
| `assist.symbolSearch.fuzzy` | `true` | Start `Shift+Alt+S` with fuzzy matching on. |
| `assist.dotArrow.enabled` | `true` | Turn a `.` typed after a pointer into `->`, in C, C++ and CUDA. |

## Rebinding

Keyboard Shortcuts, search for `Assist`. Or in `keybindings.json`:

```json
{ "key": "alt+g", "command": "assist.roundTrip", "when": "editorTextFocus" }
```

To get back where you came from, VS Code's own `Go Back` (`Alt+Left`) covers it —
these jumps land in the same navigation history.

When the file a jump lands in is already showing in another split, the jump goes
to that split instead of opening the file again over the one you were in.

## Developing

No build step and no dependencies. Clone it, open it, press `F5`; a second
VS Code window opens with the extension loaded.

A feature that needs code is a file in `features/` exporting
`{ commands: { id: handler } }`, a line in the list at the top of
`extension.js`, and a `contributes` entry. A feature that only needs a key is
the `contributes` entry alone. A feature that answers something other than a
key press exports `activate(context)` instead and puts its listener there.

Everything on screen is written twice - English and Korean - in two different
places: command titles and setting descriptions in `package.nls.json` and
`package.nls.ko.json`, everything the code says in `l10n/bundle.l10n.ko.json`,
where the key is the English sentence itself.

```
npm run check-nls
```

checks that the two halves still match, in both directions, and that the `{0}`
slots survived the translation. It is worth a habit, because a missing
translation does not fail: VS Code shows the English and the extension keeps
working, so nothing tells you until someone reads the Korean.

Two more, for the dot-to-arrow conversion:

```
npm run check-dot-arrow      the two decisions it makes without a server
npm run check-fuzzy          the Hangul table and how paths score
npm run probe-clangd         what clangd actually answers, over LSP
```

The second one talks to a real clangd with no editor in the way, types a dot at
every position in `fixtures/dot-arrow/`, and prints what came back. It exists
because this feature was once built on a guess about what a language server
answers, and the guess was wrong in a way that would have corrupted people's
files. Measure before changing that rule.

## License

MIT
