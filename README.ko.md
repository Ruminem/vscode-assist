# Assist

VS Code에 없는 이동 단축키를, VS Code가 쓰지 않는 키에 붙임.

| 키 | 동작 |
| --- | --- |
| `Alt+G` / `Alt+D` | 정의부로 감. 정의부에서 누르면 선언부로 돌아옴 |
| `Ctrl+Shift+↓` / `Ctrl+Shift+↑` | 이 파일의 다음 / 이전 함수로 이동 |
| `Shift+Alt+O` | 워크스페이스 전체에서 파일 열기 |
| `Shift+Alt+S` | 워크스페이스 전체에서 심볼 찾기 |
| `Alt+M` | 이 파일의 심볼 목록 |

뒤의 셋은 VS Code의 `Ctrl+P`, `Ctrl+T`, `Ctrl+Shift+O`에 키를 하나 더 단 것임. 코드가
필요했던 건 앞의 두 줄뿐임.

Windows에서만 검증됨. macOS·Linux 키는 매니페스트에 있지만 아무도 돌려보지 않았음.

## 왕복(round trip)

VS Code에는 `Go to Definition`, `Go to Declaration`, `Go to Implementation`이 서로
다른 키에 편도로 걸려 있음. `Alt+G`는 셋을 한꺼번에 물어보고, 워크스페이스 심볼
인덱스에서 같은 이름을 가진 것도 더한 뒤, **커서가 이미 있는 자리를 가리키는 답은 버림.**
남은 곳이 하나면 바로 점프하고, 여럿이면 커서 자리에 작은 메뉴를 띄움. 메뉴에서는
헤더가 아닌 파일에 있는 쪽이 맨 위임.

| 커서 위치 | 도착지 |
| --- | --- |
| 호출부 | 메뉴 — `.cpp`의 정의부가 먼저, 헤더의 선언부가 다음 |
| 헤더의 선언부 | `.cpp`의 정의부 |
| `.cpp`의 정의부 | 헤더의 선언부 |
| 멤버 함수 본체 안 | 메뉴 — 같은 이름을 가진 선언들 |
| 가상 함수의 기반 선언 | 오버라이드 |

이 표는 Microsoft C/C++ 확장으로 잰 것임. 이 서버는 대부분의 자리에서 답을 정확히 하나만
주기 때문에, 호출부 메뉴의 두 번째 줄은 이름 검색이 채움. 점프가 예상과 다른 곳으로 가면
명령 팔레트에서 **Assist: Explain what the round trip sees here**를 실행하면 각 출처가
뭘 답했고 뭐가 버려졌는지 보여줌.

분석은 전부 언어 서버 몫임 — clangd, cpptools, rust-analyzer, tsserver. 이 확장은
파서도 인덱스도 갖지 않음. 서버가 있는 언어면 다 되고, 정확도는 그 서버의 정확도와
정확히 같음.

## 함수 사이 이동

`Ctrl+Shift+↓`와 `Ctrl+Shift+↑`는 이 파일의 다음·이전 함수, 메서드, 생성자의 이름으로
커서를 옮김. 목록은 `Alt+G`에 답하는 것과 같은 언어 서버가 줌. 그래서 문서 심볼을 알려주는
서버가 있는 언어면 어디서든 되고, 없는 곳에서는 키를 주장하지 않음. 함수 본체 안에서
`Ctrl+Shift+↑`를 누르면 지금 들어가 있는 함수로 감.

Windows에서 이 키는 한 줄씩 선택을 넓히는 두 번째 키인데, `Shift+↑`·`Shift+↓`가 같은 일을
하므로 편집기에서 잃는 기능이 없음. Linux에서는 같은 키가 위·아래에 커서를 추가하는
기능이라 거기서는 붙이지 않음. 기준은 VS Code 창이 떠 있는 컴퓨터임 — Windows 창에서
SSH로 Linux에 붙어 있으면 Windows 키가 적용됨.

## 키보드를 다루는 방식

키맵 확장은 남의 키보드를 어지럽히기 쉬움. 그래서 네 가지 원칙 위에 세웠음.

**키를 더하지, 뺏지 않음.** 충돌은 *이미 뭔가 하던 키가 다른 일을 하기 시작할 때*
생김. `Ctrl+T`와 `Ctrl+Shift+O`는 그대로 살아 있고, `Shift+Alt+S`와 `Alt+M`은 같은
명령에 붙은 두 번째 키임. 밀려나는 게 없음.

**모든 키는 기본 키맵과 먼저 대조함.** `tools/check-keys.js`가 Windows·macOS·Linux의
기본 키맵을 읽어서 그 키에 이미 임자가 있는지 알려줌. 바인딩을 추가하기 전에, 그리고
고민 중인 키에 대해 돌림.

```bash
node tools/check-keys.js alt+o
```

임자가 있어도, 그 규칙이 조건부면 나눠 쓸 수 있음. `Shift+Alt+O`가 그렇게 들어왔음.
기본값에서 이 키는 `Organize Imports`인데, **import 정리를 지원하는 언어 서버가 있는
파일에서만** 동작함. cpptools는 지원하지 않으니 C++에서는 아무 일도 안 함. 그래서 이
확장은 이 키를 Quick Open에 붙이고, 그 **뒤에** 한 번 더 `Organize Imports`에 기본값과
똑같은 `when` 절로 붙임. 둘 다 해당하면 뒤의 규칙이 이김 — TypeScript 파일에서는 여전히
import가 정리되고, C++ 파일에서는 Quick Open이 열림. `check-keys`는 이 한 쌍을 임자
있음이 아니라 `yields`로 보고함.

**`when` 절을 가능한 한 좁게 검.** `Alt+G`에는 `editorHasDefinitionProvider`가 붙어
있음. 그래서 Markdown 파일이나 설정 탭에서는 **애초에 이 키를 주장하지 않고**, 그 키를
원하는 다른 것이 그대로 가져감.

**스위치 하나로 전부 돌려줌.** `assist.keymap.enabled`를 끄면 이 확장이 잡은 키가 한
번에 풀림. 모든 `when` 절이 이 설정을 달고 있기 때문임. 명령 자체는 명령 팔레트와
사용자 `keybindings.json`에 그대로 남음.

마지막 항목이 필요한 이유는 비대칭 때문임. 사용자의 `keybindings.json` 규칙은 기본
규칙과 모든 확장 규칙 **아래에** 덧붙음 — 즉 **사용자는 항상 이김.** 게다가 명령 앞에
`-`를 붙이면 규칙을 지울 수도 있음. 확장에는 이에 해당하는 수단이 없음. 한번 키를
잡으면, 그걸 돌려줄 수 있는 건 `when` 절뿐임.

## 설정

| 설정 | 기본값 | |
| --- | --- | --- |
| `assist.keymap.enabled` | `true` | 이 확장이 잡는 모든 키의 마스터 스위치 |
| `assist.roundTrip.providers` | `["definition", "implementation", "declaration"]` | `Alt+G`가 물어볼 provider. 순서는 동점일 때만 씀 |
| `assist.roundTrip.searchByName` | `true` | 워크스페이스 심볼 인덱스에서 이름으로도 찾음 |
| `assist.roundTrip.pickWhenAmbiguous` | `true` | 여러 곳이 답하면 메뉴를 띄움 |

## 키 바꾸기

키보드 단축키에서 `Assist`를 찾거나, `keybindings.json`에 직접 적음.

```json
{ "key": "alt+g", "command": "assist.roundTrip", "when": "editorTextFocus" }
```

되돌아오는 건 VS Code의 `Go Back`(`Alt+Left`)이 그대로 해줌 — 이 점프들도 같은 탐색
기록에 남음.

## 개발

빌드 단계도 의존성도 없음. 클론하고 열어서 `F5`를 누르면 확장이 올라간 VS Code 창이
하나 더 뜸.

코드가 필요한 기능은 `features/`에 `{ commands: { id: handler } }`를 내보내는 파일
하나 + `extension.js` 맨 위 목록에 한 줄 + `contributes` 항목. 키만 필요한 기능은
`contributes` 항목 하나로 끝남.

## 라이선스

MIT
