# 의존성 선택

확인 날짜: 2026-10-12. 신규 프로젝트의 구현 범위를 기준으로 Rust 표준 라이브러리, 브라우저 기본 API, 외부 라이브러리를 비교했다. 버전은 npm registry와 crates.io의 안정 릴리스를 직접 조회했으며, 설치 버전의 기준은 루트 `package-lock.json`과 `engine/Cargo.lock`이다.

## Build vs. Adopt

| 해결할 문제 | 검토한 대안 | 선택과 이유 | 비용·위험과 검증 |
| --- | --- | --- | --- |
| 가상 시각에 따른 이벤트 처리 | Rust `BinaryHeap`, 별도 작업 스케줄러 | 표준 `BinaryHeap`과 `(시각, 순번)` 정렬. 단일 스레드의 결정론적 이벤트 처리에는 비동기 작업·분산 스케줄러의 기능이 필요하지 않다. | 큐 순서를 바꾸는 값을 삽입 후 수정하지 않는다. 같은 시각의 순서와 Tick 분할 일관성을 Rust 테스트로 확인한다. |
| Rust 자료를 UI에 전달 | `serde_json` 문자열, `serde-wasm-bindgen` 0.6.5 | JSON 문자열. 조회 결과는 숫자·문자열·배열·레코드로 제한되어 있으며 네이티브 Rust 테스트와 동일한 직렬화 경로를 사용할 수 있다. | 문자열 복사와 파싱 비용이 있다. 전체 저장소 대신 페이지·선택 Trace·제한된 진단 스냅샷만 반환한다. 두 방식의 직접 성능 비교는 수행하지 않았다. |
| 시계열·Waterfall·슬롯 그림 | SVG·Canvas 2D, 차트 라이브러리 | 브라우저 기본 SVG·Canvas 2D. 작은 시계열과 시각·기간으로 계산한 막대, 제한된 슬롯 화면에 필요한 동작만 구현한다. | 축·라벨·선택·반응형 처리를 제품 코드가 맡는다. 실제 브라우저에서 위치, 선택, 화면 크기를 검증한다. |
| 객체 수명과 오래된 참조 검사 | 직접 구현한 Arena, 외부 generational arena crate | 직접 구현. Index·Generation·Free List·Retired 정책을 코드와 진단 도구에서 관찰하는 것이 명시적인 제품 요구다. | 중복 해제, 잘못된 인덱스, Generation 초과, 재사용 후 오래된 Handle을 개별 테스트한다. |
| UI와 빌드 | React·TypeScript·Vite, 대형 앱 프레임워크 | 필수 스택인 React·TypeScript·Vite. 클라이언트 전용 정적 앱에 맞추고 서버 렌더링·라우터·전역 상태 라이브러리는 추가하지 않는다. | Vite와 플러그인 peer 버전, Node 버전을 맞추고 프로덕션 빌드와 GitHub Pages 경로에서 WASM 로드를 검증한다. |

현재 저장소는 신규 프로젝트이므로 재사용할 내부 공통 모듈이 없다. 기존 사용자 프로젝트의 소스는 가져오지 않는다. 제품 로직은 시나리오, Trace/Span, 수명 정책에 두고, 우선순위 큐·직렬화·UI 렌더링은 표준 기능과 선택한 라이브러리에 맡긴다.

## 버전과 라이선스

아래는 조회 시점의 직접 의존성·도구 후보 정보다. 전이 의존성 전체의 라이선스 감사는 별도 수행하지 않았다.

| 항목 | 조회한 안정 버전 | 공개 라이선스 | 호환 조건·용도 |
| --- | --- | --- | --- |
| Rust | 1.99.0 | MIT OR Apache-2.0 | `rust-toolchain.toml`로 고정, `wasm32-unknown-unknown` |
| wasm-bindgen | 0.2.129 | MIT OR Apache-2.0 | MSRV 1.81, Rust 클래스와 JS 바인딩 |
| serde | 1.0.229 | MIT OR Apache-2.0 | MSRV 1.56, 직렬화 derive |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | MSRV 1.71, 제한된 JSON 스냅샷 |
| wasm-pack | 0.15.0 | MIT OR Apache-2.0 | npm 도구 Node ≥16, `--target web` |
| React / React DOM | 19.3.0 | MIT | 화면 구성과 UI 선택 상태 |
| Vite | 8.3.4 | MIT | Node `^20.19.0 || >=22.12.0` |
| @vitejs/plugin-react | 6.1.2 | MIT | Vite `^8.0.0`, Node 조건은 Vite와 동일 |
| TypeScript | 7.0.2 | Apache-2.0 | Node ≥16.20, 정적 타입 검사 |
| Playwright Test | 1.64.0 | Apache-2.0 | Node ≥20, 실제 Chromium E2E |
| serde-wasm-bindgen | 0.6.5 | MIT | 비교 후보, 현재 의존성에 추가하지 않음 |

CI는 Node 24를 사용한다. 최신 버전과 라이선스 정보는 [npm registry](https://registry.npmjs.org/), [crates.io API](https://crates.io/data-access), [Rust 표준 라이브러리](https://doc.rust-lang.org/std/)에서 확인했다. 2026-10-12 현재 lockfile에서 실행한 `npm audit --json`은 알려진 취약점 0건을 반환했다. Rust 의존성의 보안 권고 검사는 아직 수행하지 않았다.

## 공식 문서 조사

Context7의 `resolve_library_id` → `query_docs`를 실제 호출해 wasm-bindgen과 Vite 문서를 확인했다. Context7에서 받은 Vite v8.0.10 문서의 base path·정적 asset 동작을 현재 공식 문서와 대조했고, 설치 버전은 registry의 8.3.4를 사용했다.

- [Rust `BinaryHeap`](https://doc.rust-lang.org/std/collections/struct.BinaryHeap.html): 우선순위 큐와 작은 값 우선 정렬 방식.
- [wasm-bindgen의 Serde 경계](https://wasm-bindgen.github.io/wasm-bindgen/reference/arbitrary-data-with-serde.html): JS 값 직접 변환과 JSON 변환의 표현 범위·비용.
- [serde-wasm-bindgen 저장소](https://github.com/RReverser/serde-wasm-bindgen): 대안의 API와 지원 타입.
- [wasm-pack build](https://wasm-bindgen.github.io/wasm-pack/book/commands/build.html): 브라우저 ES module용 `web` target.
- [Vite 시작 안내](https://vite.dev/guide/)와 [정적 배포](https://vite.dev/guide/static-deploy.html): Node 조건과 저장소 하위 경로 배포.
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)와 [SVG](https://developer.mozilla.org/en-US/docs/Web/SVG): 브라우저 기본 그리기 API.
- [WebAssembly.Memory의 buffer](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/buffer)와 [grow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow): 실제 Linear Memory 바이트 측정과 확장 뒤 buffer 재조회.

## 배포 도구

2026-10-12 GitHub API의 각 공식 저장소 `releases/latest`에서 `checkout 7.0.1`, `setup-node 7.1.0`, `configure-pages 6.0.0`, `upload-pages-artifact 5.0.0`, `deploy-pages 5.0.1`을 확인했다. [.github/workflows/ci.yml](../.github/workflows/ci.yml)은 구체적인 릴리스 태그를 사용한다. 실제 CI·배포 결과는 [검증 기록](validation.md)에 남긴다.
