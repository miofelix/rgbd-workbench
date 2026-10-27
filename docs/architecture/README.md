# Architecture Guide

本目录是纯浏览器产品的现行架构与格式规范。`docs/history/` 和早期调研只提供背景；如有冲突，以本目录和已接受 ADR 为准。

## Documents

- `system-design.md`：运行结构、模块接口、M1–M3 范围与验收。
- `data-formats.md`：领域对象、Worker、存储与导出合同。
- `../development.md`：环境、质量门禁和贡献规则。
- `../third-party-licenses.md`：运行时依赖、来源和许可证。
- `../adr/`：关键且难逆转的决策。

文档使用中文说明；字段、格式值和诊断代码保持英文。公共格式更新必须同时更新 Schema、示例、fixtures、测试和不兼容说明。不得重新引入 CLI、HTTP、Linked import 或旧工作区路径语义。
