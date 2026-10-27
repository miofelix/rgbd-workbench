---
status: accepted
date: 2026-10-25
---

# Versioned, single-source data formats

破坏性重构启用 v2 公共格式，不保留 CLI/HTTP 遗留字段。JSON 使用 camelCase 和显式 `format`/`schemaVersion`；点云 magic 升级为 `RGBDPC2\0`。身份继续使用 RFC 8785 JCS + SHA-256，领域 schema、处理器和私有存储版本分别管理。

所有公共 JSON Schema 由 TypeScript 权威 Schema 生成，禁止同时手写 Pydantic 合同。几何输出和静态导出不依赖 Three.js LOD；缓存、诊断和 UI state 不进入确定性 hash。

## Consequences

旧 SceneManifestV1、DerivationManifestV1 和 workspace 没有自动迁移承诺。新实现需携带版本化 fixtures 和 JCS/二进制黄金向量，不能仅验证 TypeScript 编译通过。
