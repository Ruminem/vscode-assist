# Changelog

## 0.5.3 — 2026-09-22

- `Alt+E` now shows its matches. In 0.5.2 the list went empty as soon as anything was typed.

**한국어**

- `Alt+E`가 찾은 파일을 보여 줌. 0.5.2에서는 한 글자만 쳐도 목록이 비었음.

## 0.5.2 — 2026-09-22

- `Alt+E` opens a file search of its own. It also finds files when the letters were typed with the
  Korean input method still on - `뮻ㅇ` finds `abcd`. `Shift+Alt+O` still opens VS Code's Quick Open.
- A dot after a call, a subscript or a cast now becomes `->` when the result is a pointer:
  `MakeRaw().` turns into `MakeRaw()->`, while `vec.begin().` and other values keep their dot.

**한국어**

- `Alt+E`가 자체 파일 검색 창을 엶. 한글 입력기를 켠 채 친 글자로도 찾음 — `뮻ㅇ`으로 `abcd`를
  찾음. `Shift+Alt+O`는 그대로 VS Code의 빠른 열기를 엶.
- 호출·첨자·캐스트 뒤에 찍은 점도 결과가 포인터면 `->`가 됨. `MakeRaw().`는 `MakeRaw()->`가 되고,
  `vec.begin().` 같은 값은 점이 그대로임.

## 0.5.1 — 2026-09-22

- The dot-to-arrow conversion is now on by default. Set `assist.dotArrow.enabled` to `false` to
  turn it off, globally or in a `[cpp]` block.

**한국어**

- 점을 화살표로 바꾸는 기능이 기본 켜짐이 됨. 끄려면 `assist.dotArrow.enabled`를 전역이나 `[cpp]` 블록에서
  `false`로 둠.

## 0.5.0 — 2026-09-22

- A dot typed after a raw pointer in C, C++ and CUDA becomes `->` as you type. Off by default:
  turn on `assist.dotArrow.enabled`, globally or in a `[cpp]` block. The language server decides,
  so `unique_ptr`, `shared_ptr` and iterators keep their dot.
- One `Backspace` right after that conversion takes the whole `->`; one `Ctrl+Z` brings the dot back.

**한국어**

- C·C++·CUDA에서 날 포인터 뒤에 찍은 점이 입력하는 순간 `->`가 됨. 기본 꺼짐 — `assist.dotArrow.enabled`를
  전역이나 `[cpp]` 블록에서 켬. 판단은 언어 서버가 하므로 `unique_ptr`·`shared_ptr`·반복자의 점은 그대로임.
- 변환 직후 `Backspace` 한 번이면 `->` 두 글자가 같이 지워지고, `Ctrl+Z` 한 번이면 점이 돌아옴.

## 0.4.6 — 2026-09-17

- Tracing is a debugging toggle that writes to a temporary file, asks where to save it when you stop,
  and cleans the temporary file up on stop, on window close and after a crash.

## 0.4.5 — 2026-09-17

- The round trip stops waiting for the name search once the providers already offer two places.
- Symbol search shows rows as they match instead of waiting for the server's full symbol list, and reuses answers already asked for.
- Every stage of Alt+G, symbol search and the function steps is timed into an Assist output channel.

## 0.4.4 — 2026-09-17

- With clangd absent or disabled, C/C++ answers from cpptools are waited for in full rather than cut off
  after two seconds and replaced by text guesses.

## 0.4.3 — 2026-09-16

- A jump goes to the file where it is already showing in another split, instead of opening it again in this one.

## 0.4.2 — 2026-09-16

- Override lines are read from disk, so a round trip no longer makes clangd parse every header it lands in.

## 0.4.1 — 2026-09-16

- clangd's index files are counted once per database change, not on every round trip.

## 0.4.0 — 2026-09-16

- While clangd's index is incomplete, definitions are guessed from text and ranked by similarity,
  and the menu says how far the index has got.

## 0.3.5 — 2026-09-16

- The Override label survives a definition answer arriving first.

## 0.3.4 — 2026-09-16

- Overrides and base virtuals are marked in the round trip menu for C++.

## 0.3.3 — 2026-09-16

- Same-named symbols from other namespaces are left out whenever a provider found the one asked about.

## 0.3.2 — 2026-09-16

- Name guesses stay out of the round trip menu when the providers already offer a choice.

## 0.3.1 — 2026-09-16

- A status bar spinner while the round trip waits, and each source timed in the explain list.

## 0.3.0 — 2026-09-16

- Attach the debugger to a running process with `Ctrl+Alt+P`, and reattach with `Shift+Alt+P`.

## 0.2.0 — 2026-09-15

- Step between functions with `Ctrl+Shift+Up` and `Down`.
- Search symbols with `Shift+Alt+S`, matching the letters in order with gaps allowed.
- Menus, messages, command titles and settings speak Korean when VS Code does.

## 0.1.0 — 2026-09-15

- First release. `Alt+G` on a declaration goes to the definition and back again, opening its choices
  at the cursor rather than at the top of the window.
- `Shift+Alt+O` opens Quick Open, and hands the keys back to Organize Imports where that applies.
