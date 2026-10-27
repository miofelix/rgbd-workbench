---
status: accepted
date: 2026-10-25
---

# Browser-only application

RGB-D Workbench 是部署到静态 Pages 的单用户浏览器应用。移除 CLI、FastAPI、本地工作区、Linked import、token/cookie 会话和 Python 服务部署，不维护双运行时或旧 workspace 兼容层。

用户数据由显式文件选择进入浏览器；持久化仅存在于当前 origin 的 IndexedDB。Pages 只提供应用及锁定运行时资源，不提供数据 API。源文件不上传，原始文件不被修改。

## Consequences

现有本地绝对路径、inode/mtime 链接校验、原子目录 rename 和多用户服务均不属于新合同。工作区备份改由自包含 Source Archive 提供；存储被清理或 origin 改变后，用户可能需要重新导入。
