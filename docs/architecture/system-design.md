# RGB-D Workbench：纯浏览器系统设计

- 状态：M1–M3 浏览器实现，2026-10-26
- 运行环境：静态 Pages + 当前 Chromium、Firefox、Safari/WebKit
- 不包含：多帧融合、SLAM、深度估计、账号协作、云存储、CLI、服务端 API、旧 workspace 兼容层

## 1. 产品边界

用户选择 RGB/深度及可选 manifest，确认深度语义、相机与对齐，生成确定性点云并测量，编辑 CameraPath 后导出静态结果、视频或 PNG 帧序列。用户文件不上传项目服务器；Pages 只承载应用资源。

M3 已包含预设与自定义关键帧、target 来源、once/loop/easing、CPU z-buffer、固定色标、七种 LUT、两种版式、WebCodecs 视频、PNG 序列、ExportManifest、取消和 Source Archive。视频编码能力以浏览器 probe 为准，不把不支持的 codec 计为通过。

## 2. 运行结构与依赖方向

```text
React features / Zustand UI state
              │
              ▼
       Workbench application
       │                  │
       ▼                  ▼
Library interface      Processor interface
       │                  │
       ▼                  ▼
IndexedDB records     Versioned Worker protocol
(ArrayBuffer + metadata)  │
                           ▼
               TypeScript compute adapters
               point cloud / trajectory /
               CPU render / media encoding

Domain schemas and pure identity functions are shared.
Three.js consumes validated buffers only.
```

依赖：`app/features → application → domain`。Infrastructure 实现 application 接口，domain 不依赖 React、Three.js、Worker、存储或媒体库。两个真实 seam：Library（浏览器实现与内存测试实现）和 Processor（Worker 与测试适配器）。不增加通用 repository、插件管理器或本地伪 HTTP。

## 3. 模块

### `src/domain`

Zod 严格 Schema、能力门禁、JCS/SHA-256 身份、诊断、公共点云二进制协议。无 I/O、无 UI、无随机或时间依赖（ID/时间由应用层产生）。

- Scene：不可变 Source 与 Geometry Contract。
- ProcessingSpec：几何参数，draft 与 Applied 分离。
- Derivation：测量与导出的唯一几何来源。
- CameraPath/RenderSpec：M3 采样与渲染合同。
- ExportManifest：输出 hash、完整快照、帧数、时长、编码器和实现版本。

### `src/application`

`Workbench` 编排导入、Scene 提交、派生、缓存、Archive、视频与任务状态。它不把 REST endpoint 逐个映射成函数，也不让 UI 直接访问 Worker/IndexedDB。

- `prepareScene`：File 探测和 Geometry Contract 建议。
- `commitScene`：用户确认后提交不可变 Scene。
- `derive`：先查 Scene 内缓存，再调用 Processor。
- `renderVideo`：冻结 Derivation/CameraPath/RenderSpec，跟踪 ExportJob。
- `archive`：自包含 Source Archive；可选派生。

### `src/compute`

- `codecs/`：fast-png、GeoTIFF、NPY/NPZ/PFM/RAW，显式 dtype/endianness 与预算。
- `pointcloud.ts`：有效性/单位、ROI/stride、反投影、裁剪、体素、预算、精确 KNN。
- `kd-tree.ts`：稳定 `(distance, originalIndex)` 顺序，不使用近似最近邻。
- `trajectory/`：预设、centripetal Catmull–Rom、采样、退化/循环连续性校验。
- `render/`：共享 LUT、固定色标、CPU z-buffer、分屏、Lanczos-2、WebCodecs/PNG。
- `worker/`：版本化消息、Transferable、进度与终止重建。

### `src/persistence`

IndexedDB `scenes`、`sources`、`derivations`。原始 Blob 和派生 payload 以 ArrayBuffer + mediaType 保存，避免 Safari File/Blob 差异；hash 在事务外计算，事务只包含同步读写。

Source 读取重新计算 SHA-256，失败禁止派生。缓存 key 为 `sceneId + derivationKey`，损坏缓存可删除重建。恢复 Archive 创建新 UUID，派生 manifest 重绑定，Scene hash 不变。Web Locks 保护同源写入。

### `src/viewer` 与 `src/features`

Three.js 负责稳定 LOD、视角、投影、着色/色图、拾取、关键帧/视锥与截图。二维点击通过代表像素选择点，点云选择反向标记二维。Three.js 不做权威反投影、滤波或导出几何。

UI 保存当前 Scene、ProcessingSpec draft、Applied Derivation、ViewSpec、选点和 ExportJob；大 Blob/typed arrays 不进入 JSON 或 Zustand 持久化。刷新从 Library 恢复 Scene 和 Applied Derivation。

## 4. M3 确定性规则

- `N = round(duration * fps)`，至少 2 帧。
- loop：`phase = i / N`，不重复端点；once：`phase = i / (N - 1)`。
- 自定义位置/target 用 alpha=0.5 centripetal Catmull–Rom；两点退化为线性。重复点不可产生 NaN。
- 自定义 loop 校验首尾姿态和切线连续性，视线/up 接近共线拒绝导出。
- target 可为场景或 ROI 内 applied points 的逐轴中位数、选中点、手工 XYZ；空集合不回退原点。
- 预览和导出共享 sampler 与 LUT。导出从冻结快照读取，不从当前相机/LOD 重新采样。
- CPU 渲染固定投影、近裁剪、z-buffer、点 splat、色标与版式；2x 使用 Lanczos-2 降采样。

## 5. 质量与验收

```text
npm run check
npm run test:e2e
npm audit --audit-level=high
```

- Domain/compute：Schema、JCS、格式、点云、KNN、轨迹、LUT、投影与导出。
- Application/persistence：缓存命中、Source/Archive 完整性、Scene 隔离、取消、任务状态。
- E2E：真实浏览器导入、点云、测量、静态导出、刷新恢复、Archive、关键帧、分屏、视频/PNG 和取消无下载。
- Chromium、Firefox、WebKit 运行同一套件；codec 不支持时明确跳过对应格式，而不是宣称通过。
- 大文件/移动设备峰值内存和帧率不是由单元测试保证，需单独基准测试。

## 6. Pages 与安全

GitHub Actions 构建 `dist/`，项目页 base 为 `/rgbd-workbench/`，可配置为 `/`。保持单入口，不依赖服务器 history rewrite。Worker 是 ES module，无 SharedArrayBuffer/COOP/COEP 硬依赖。

无项目后端、token、cookie session 或用户数据 API。第三方依赖从 npm lockfile 安装并打包，不把源文件发送到 CDN。`public/` 与构建产物不得包含真实工作区或私人 Archive。

## 7. 后续增强（不属于当前完成声明）

- 更完整的 TIFF/EXIF/ICC 方向与颜色诊断、NPZ 多数组成员选择 UI。
- 更丰富的 overlay 版式、轨迹编辑器拖点、真实大点云/长视频分块与性能基准。
- 可选 Source Archive 多 Scene 打包、任务历史持久化和失败任务一键重试。
- 真实设备大文件内存预算、流式 hash/存储与更全面的可访问性审查。
