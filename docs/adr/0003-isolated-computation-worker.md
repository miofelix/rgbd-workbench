---
status: accepted
date: 2026-10-26
supersedes: 2026-10-25 Pyodide candidate
---

# Isolated TypeScript computation worker

解码、规范化、点云、CPU 帧渲染与视频/PNG 编码运行在独立 Worker，采用 TypeScript typed arrays。主线程只负责 React、Three.js、下载与状态，不模拟本地 HTTP API。

早期 Pyodide 方案经评估未采用：它增加运行时、内存拷贝和双语言合同成本。GeoTIFF、fast-png、fflate、Mediabunny 等第一方/成熟开源实现承担通用格式能力，项目自有模块负责确定性几何、排序、轨迹与导出合同。

## Consequences

没有 Python 运行时或双语言 Schema。Worker 输出经过公共协议验证；视频和 PNG 任务共用可取消 Worker 接口，取消终止 Worker 并阻止发布。Processor seam 允许确定性测试适配器，不形成第二个生产后端。
