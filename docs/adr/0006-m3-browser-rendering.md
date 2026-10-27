---
status: accepted
date: 2026-10-26
---

# M3 browser rendering and export

M3 使用同一 TypeScript CameraPath sampler 驱动 Three.js 预览和离线 CPU z-buffer 帧渲染。视频经 WebCodecs + Mediabunny 输出 MP4/H.264 或 WebM/VP9，PNG 序列由 fast-png 编码；编码能力由浏览器 probe 决定，不支持时提供 PNG 路径。

导出任务冻结 Derivation、CameraPath、RenderSpec，具有显式 queued/running/terminal 状态。导出包含参数 sidecar，视频与 sidecar 以时间戳 ZIP 发布；不覆盖历史输出。

## Consequences

不录制可变 UI，不承诺不同浏览器视频字节一致。CPU 几何与 Three.js LOD 分离；M3 在浏览器完成，无 FFmpeg 服务、SSE 或 Python renderer。实时性能预算需在大数据与目标设备上另行测量。
