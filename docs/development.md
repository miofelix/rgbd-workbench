# 开发与贡献

## 环境

- Node.js 24+，npm lockfile 为依赖事实来源。
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`。
- 无 Python、FastAPI、CLI、本地 HTTP API 或 Pyodide 运行时。

## 日常命令

| 命令                                | 用途                                 |
| ----------------------------------- | ------------------------------------ |
| `npm run dev`                       | Vite 开发服务                        |
| `npm run check`                     | 格式、lint、类型、Schema、测试、构建 |
| `npm test` / `npm run test:watch`   | 单元与集成测试                       |
| `npm run test:e2e`                  | 三浏览器端到端验收                   |
| `npm run schemas`                   | 从 Zod 生成 JSON Schema              |
| `npm run schemas:check`             | 阻止 Schema 漂移                     |
| `npm run build` / `npm run preview` | 生产构建与预览                       |

## 修改规则

1. 先明确领域术语和不变量，再实现。`GLOSSARY.md` 是统一语言。
2. 公共格式变更同时更新 `src/domain`、生成 Schema、`docs/architecture/data-formats.md`、fixtures 和版本/测试。
3. 不在 UI、Worker、存储各自维护一份几何规则；不以 mock 替代真实浏览器验收。
4. 大数组用 typed arrays/Transferable，避免 base64 和无意复制。Worker 不能读写 DOM。
5. Source 完整性失败是硬门禁；派生缓存损坏可删除重建。缓存按 `sceneId + derivationKey` 隔离。
6. IndexedDB 事务只放同步读写；hash、编码等异步工作在事务外完成。私有存储使用 ArrayBuffer + mediaType，避免 Safari File/Blob 差异。
7. 视频导出冻结 Derivation/CameraPath/RenderSpec，使用 Worker；取消必须终止工作并阻止下载。
8. 外部依赖优先官方/第一方实现，锁定版本、核对许可证。Mediabunny 为 MPL-2.0，修改其源文件时遵守对应文件级义务。

## 测试分层

- Domain：Schema、JCS/hash、诊断、格式协议与资源限制。
- Compute：解码、点云、KNN、轨迹、色图、CPU 投影、版式与导出。
- Application：内存 Library/Processor，验证缓存、取消、快照和应用用例。
- Persistence：fake-indexeddb 验证事务、Source/Archive 完整性、Scene 缓存归属。
- E2E：真实浏览器 IndexedDB、Web Worker、WebGL、下载与刷新恢复。

不要仅以 jsdom 结果声称 Safari/真实浏览器兼容。测试错误消息使用唯一 role/test id，不依赖页面重复文案。长任务必须有取消且无下载断言。

## 目录和风格

React 组件使用 `PascalCase.tsx`，其他 TypeScript 使用 `kebab-case.ts`。公共 JSON 用 camelCase；诊断代码用稳定大写下划线。Prettier 和 ESLint 必须实际通过。历史 M1/M2 文档只作参考，不是当前实现依据。
