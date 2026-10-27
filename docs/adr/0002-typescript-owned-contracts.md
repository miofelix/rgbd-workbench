---
status: accepted
date: 2026-10-26
---

# TypeScript owns public contracts

领域对象、Worker 消息、存储记录和导出 manifest 的唯一权威是 TypeScript + Zod 严格 Schema。公共 JSON 使用 camelCase；格式、处理器、采样器和私有存储版本独立管理。

没有 Pydantic、Pyodide 或 Python 适配器。Worker 间使用版本化消息和明确 typed-array buffer；跨持久化/导出边界执行运行时验证。

## Consequences

JSON Schema 2020-12 由 Zod 原生生成并在 CI 检查。格式更新必须同时修改规范、Schema、fixtures 和测试。处理器实现可替换，但 Scene、ProcessingSpec、Derivation 的含义不能随运行时改变。
