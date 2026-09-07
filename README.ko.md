# Assist

VS Code에 없는 이동 단축키를, VS Code가 쓰지 않는 키에 붙인다.

| 키 | 동작 |
| --- | --- |
| `Alt+G` | 정의부로 간다. 정의부에서 누르면 선언부로 돌아온다. |
| `Shift+Alt+S` | 워크스페이스 전체에서 심볼 찾기. |
| `Alt+M` | 이 파일의 심볼 목록. |

뒤의 둘은 VS Code의 `Ctrl+T`, `Ctrl+Shift+O`에 키를 하나 더 단 것이다.
코드가 필요했던 건 `Alt+G` 하나뿐이다.

## 왕복(round trip)

VS Code에는 `Go to Definition`, `Go to Declaration`, `Go to Implementation`이
서로 다른 키에 편도로 걸려 있다. 그런데 커서가 놓인 자리마다 셋 중 쓸모 있는 답을
내는 건 하나뿐이다. `Alt+G`는 이 셋을 순서대로 물어보고 **지금 서 있는 자리가 아닌
첫 번째 답**을 택한다.

| 커서 위치 | 답하는 provider | 도착지 |
| --- | --- | --- |
| 호출부 | `definition` | 정의부 |
| `.cpp`의 정의부 | `declaration` | 헤더의 선언부 |
| 헤더의 선언부 | `definition` | `.cpp`의 정의부 |
| 가상 함수의 기반 선언 | `implementation` | 오버라이드들 |

분석은 전부 언어 서버 몫이다 — clangd, cpptools, rust-analyzer, tsserver.
이 확장은 파서도 인덱스도 갖지 않는다. 서버가 있는 언어면 다 되고, 정확도는 그
서버의 정확도와 정확히 같다.

## 키보드를 다루는 방식

키맵 확장은 남의 키보드를 어지럽히기 쉽다. 그래서 네 가지 원칙 위에 세웠다.

**키를 더하지, 뺏지 않는다.** 충돌은 *이미 뭔가 하던 키가 다른 일을 하기 시작할 때*
생긴다. `Ctrl+T`와 `Ctrl+Shift+O`는 그대로 살아 있고, `Shift+Alt+S`와 `Alt+M`은
같은 명령에 붙은 두 번째 키다. 밀려나는 게 없다.

**모든 키는 기본 키맵과 먼저 대조한다.** `tools/check-keys.js`가 Windows·macOS·
Linux의 기본 키맵을 읽어서 그 키가 이미 임자가 있는지 알려준다. "파일 열기"라면
`Shift+Alt+O`가 당연한 후보인데, `editor.action.organizeImports`가 이미 쓰고 있어서
여기서는 붙이지 않았다. 바인딩을 추가하기 전에, 그리고 고민 중인 키에 대해 돌린다.

```bash
node tools/check-keys.js alt+o
```

**`when` 절을 가능한 한 좁게 건다.** `Alt+G`에는 `editorHasDefinitionProvider`가
붙어 있다. 그래서 Markdown 파일이나 설정 탭에서는 **애초에 이 키를 주장하지 않고**,
그 키를 원하는 다른 것이 그대로 가져간다.

**스위치 하나로 전부 돌려준다.** `assist.keymap.enabled`를 끄면 이 확장이 잡은 키가
한 번에 풀린다. 모든 `when` 절이 이 설정을 달고 있기 때문이다. 명령 자체는 명령
팔레트와 사용자 `keybindings.json`에 그대로 남는다.

마지막 항목이 필요한 이유는 비대칭 때문이다. 사용자의 `keybindings.json` 규칙은
기본 규칙과 모든 확장 규칙 **아래에** 덧붙는다 — 즉 **사용자는 항상 이긴다.** 게다가
명령 앞에 `-`를 붙이면 규칙을 지울 수도 있다. 확장에는 이에 해당하는 수단이 없다.
한번 키를 잡으면, 그걸 돌려줄 수 있는 건 `when` 절뿐이다.

## 설정

| 설정 | 기본값 | |
| --- | --- | --- |
| `assist.keymap.enabled` | `true` | 이 확장이 잡는 모든 키의 마스터 스위치. |
| `assist.roundTrip.chain` | `["definition", "declaration", "implementation"]` | `Alt+G`가 물어볼 provider와 순서. |
| `assist.roundTrip.pickWhenAmbiguous` | `true` | 여러 곳이 답하면 목록을 띄운다. |

## 키 바꾸기

키보드 단축키에서 `Assist`를 찾거나, `keybindings.json`에 직접 적는다.

```json
{ "key": "alt+g", "command": "assist.roundTrip", "when": "editorTextFocus" }
```

되돌아오는 건 VS Code의 `Go Back`(`Alt+Left`)이 그대로 해준다 — 이 점프들도 같은
탐색 기록에 남는다.

## 개발

빌드 단계도 의존성도 없다. 클론하고 열어서 `F5`를 누르면 확장이 올라간 VS Code 창이
하나 더 뜬다.

코드가 필요한 기능은 `features/`에 `{ commands: { id: handler } }`를 내보내는 파일
하나 + `extension.js` 맨 위 목록에 한 줄 + `contributes` 항목. 키만 필요한 기능은
`contributes` 항목 하나로 끝난다.

## 라이선스

MIT
