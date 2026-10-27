---
status: accepted
date: 2026-10-26
supersedes: 2026-10-25 OPFS proposal
---

# Origin-private IndexedDB persistence

Scene、原始二进制、预览与派生缓存存入当前 origin 的 IndexedDB。元数据与二进制可以在一个事务中提交，私有二进制统一使用 ArrayBuffer + mediaType，读取时构造 Blob。

不采用早期 IndexedDB + OPFS 混合方案：当前规模不需要跨存储提交协议。Web Locks 防止同源写入竞争，异步 hash 在事务外完成，Source 在读取时复核 SHA-256。缓存按 `sceneId + derivationKey` 隔离。

## Consequences

Source Archive 用于备份/迁移，清除站点数据或改变 origin 会使库不可见。Source 损坏要求重新导入，派生损坏则删除重建。恢复 Archive 创建新 Scene UUID，派生 manifest 随之重绑定，几何 hash 不变。
