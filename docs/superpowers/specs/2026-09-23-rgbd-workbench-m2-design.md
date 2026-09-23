# RGB-D Workbench M2 点云分析设计

## 1. 目标与边界

M2 将 M1 的“可信 Scene”推进为可复现的单帧点云分析闭环：用户对一个已经提交的
`SceneManifestV1` 选择处理参数，服务端生成并缓存确定性的点云派生，浏览器加载同一派生进行三维
查看、选点和距离测量，并提供 PNG、binary PLY 和参数 JSON 导出。

本阶段不实现 CameraPath、视频、SSE/job worker、工作区打包、世界坐标变换、网格或多帧融合。M1
的导入、Managed/Linked、源文件只读和能力门禁语义保持不变。

## 2. 核心决策

### 2.1 后端是几何唯一真相

Python 处理器负责加载源文件、深度规范化、反投影、过滤、确定性采样、颜色绑定和导出数据。
浏览器不重新计算几何；Three.js 只消费版本化二进制点云并管理视角、选择和渲染状态。这样相同
Scene 与 `ProcessingSpecV1` 在 API、PLY、测量和浏览器之间共享同一坐标结果。

M2 的 derivation 请求是同步的。单个请求只在资源预算内运行，缓存命中立即返回；M3 可以把相同
处理函数放入现有 job 状态机，不改变处理合同。

### 2.2 Applied 与 draft 分离

ProcessingSpec 的表单修改只更新前端 draft。点击“应用处理”才创建或读取 derivation；导出和测量
始终引用 applied derivation。视角、点大小、投影和着色属于低成本 ViewSpec，直接影响浏览器画布，
不改变 derivation key。

### 2.3 稳定顺序优先于最大吞吐

所有点按源像素的行主序进入流水线。步长、体素、预算采样和 KNN 操作都使用稳定排序和固定规则，
禁止随机数。浏览器 LOD 只从服务端顺序数组做确定性抽样，不改变导出 PLY 或测量源。

## 3. 合同与标识

### 3.1 Scene hash 与 derivation key

复用 M1 已存在的 `scene_hash()` 与 `derivation_key()`：

```text
scene_hash = SHA256(canonical(source hashes + SceneManifestV1 + normalizer version))
derivation_key = SHA256(canonical(scene_hash + ProcessingSpecV1 + processor version))
```

M2 的 `PROCESSOR_VERSION` 固定为 `1`。Scene hash 在 API 中只暴露完整十六进制值，不暴露路径；
派生 ID 使用 `derivation-<derivation_key>`，服务端只接受完整小写 SHA-256 key，避免路径穿越。

### 3.2 DerivationManifestV1

新增严格 Pydantic 合同 `DerivationManifestV1`，字段如下：

- `schema_version: 1`、`derivation_id`、`scene_id`；
- `scene_hash`、`derivation_key`、`processor_version`；
- `processing: ProcessingSpecV1` 的完整快照；
- `point_count`、`source_shape: [height, width]`、`frame`、`unit`；
- `representation: z_depth | relative_z`；
- `bounds: {min: [x, y, z], max: [x, y, z]}`；
- `arrays`：`positions`、`colors`、`pixel_index` 的 dtype、shape、byte offset、byte length；
- `diagnostics`：只包含稳定 code 和不泄露路径的提示；
- `created_at` 不参与 key，只用于缓存元数据展示。

`unit` 为 `m` 或 `unitless`。相对深度的点云保留源坐标的数值尺度，但 UI、PLY 注释和测量标签必须
明确写 `unitless`，不能显示米或厘米。

### 3.3 点云二进制协议

响应媒体类型为 `application/vnd.rgbd-workbench.pointcloud-v1`，布局固定：

```text
8 bytes   ASCII magic: RGBDPC1\\0
4 bytes   little-endian unsigned header length
N bytes   UTF-8 JSON header (DerivationManifestV1 + arrays)
padding   zero bytes until the next 4-byte boundary
payload   positions: float32[N,3], C-order
payload   colors: uint8[N,3], C-order
payload   pixel_index: uint32[N], C-order
```

每个数组的绝对 offset 和 byte length 必须位于 header 中。服务端发布前验证 header、文件大小和
SHA-256；浏览器拒绝 magic、长度、offset、shape、dtype 或总大小不一致的响应。

## 4. 点云处理流水线

`processing/pointcloud.py` 暴露一个无副作用入口：

```python
build_derivation(
    scene: SceneManifestV1,
    rgb: np.ndarray,
    depth: NormalizedDepth,
    processing: ProcessingSpecV1,
) -> PointCloudResult
```

处理顺序固定为：

1. 检查 `metric_pointcloud` 或 `relative_pointcloud` 能力；缺失相机、对齐、尺寸或深度语义时返回
    结构化 fatal diagnostic，不尝试猜测或补齐。
2. 用 `DepthSpec` 将源数组转为 M1 的有限 `float32` 和有效掩码；invalid、非有限、非正值先剔除。
3. 应用像素 ROI（半开区间 `x_min, y_min, x_max, y_max`）和 `pixel_stride`，顺序按 `y, x`。
4. 应用深度范围，再按 pinhole 合同反投影：
   `X=(u-cx)*Z/fx`, `Y=(v-cy)*Z/fy`, `Z=normalized depth`。
5. 应用 XYZ min/max 裁剪。
6. 若设置 `voxel_size`，以 `floor(position / voxel_size)` 分组；每组 XYZ 与 RGB 求均值，保留最小
   源 pixel index 作为代表，组输出按代表 index 排序。
7. 若有效点超过 `max_points`，按源像素索引执行确定性分层抽样，首尾和分层边界规则写入处理器版本；
   不使用随机数。
8. 若启用 `knn_filter`，用 SciPy `cKDTree` 查询固定 `k` 个邻居，按邻居距离均值和标准差移除离群点；
   结果按原顺序保留。
9. 若启用 `knn_smooth`，只对 XYZ 应用邻居均值，颜色和 pixel index 不变；输入顺序和查询 tie-break
   固定，不能产生 NaN。
10. 生成 bounds、统计和二进制数组。点数为零时返回 `POINTCLOUD_EMPTY`，不发布半成品缓存。

单次处理受 M1 资源预算约束：源像素不超过 64M、派生点不超过 2M、点处理预算不超过
`pixel_count * neighbor_work` 的明确上限。ROI 越界会被裁剪到源尺寸并发出 warning；空 ROI 是 fatal。

## 5. 缓存与文件生命周期

派生缓存放在 Scene 目录内，便于随 Scene 清理且不混淆不同来源：

```text
scenes/<scene-id>/cache/<derivation-key>/
├── manifest.json
├── pointcloud.bin
├── pointcloud.ply
└── parameters.json
```

缓存发布使用现有 `WorkspaceStore` 的同文件系统临时目录和 `os.replace`。发布前重新检查源文件
身份；Managed 源被外部修改或 Linked 源 stale/missing 时，API 返回 `SCENE_SOURCE_STALE`，旧缓存不
作为当前结果使用。已有缓存若 header、文件大小或 key 不匹配，则删除该缓存目录并重新生成。

`pointcloud.png` 不作为服务端几何缓存：浏览器使用当前 Three.js 画布生成 PNG 截图，截图元数据
通过同一个 `parameters.json` 记录，避免 M2 提前实现 M3 的 CPU renderer。PLY 与 JSON 由服务端从
同一数组生成，绝不读取浏览器 LOD。

## 6. API

新增受 session 保护的路由：

```text
POST /api/v1/scenes/{scene_id}/derivations
GET  /api/v1/derivations/{derivation_id}
GET  /api/v1/derivations/{derivation_id}/pointcloud
GET  /api/v1/derivations/{derivation_id}/export/{format}  # ply | json
```

POST body 是 `ProcessingSpecV1`。响应包含 `derivation` 摘要、`pointcloud_url`、`ply_url`、`json_url`、
能力和诊断。相同 scene hash、处理合同和处理器版本重复 POST 必须幂等，返回已有缓存并标记
`cached: true`。请求 scene stale、能力不满足或参数越界时返回结构化 `422`，不返回绝对路径或原始
异常。二进制下载使用 `Content-Length`、`Cache-Control: no-store` 和明确的媒体类型。

导出 JSON 是完整 `DerivationManifestV1` 加 `ProcessingSpecV1` 快照；PLY 使用 binary little-endian，
属性为 `x y z red green blue source_pixel_index`，comment 记录 frame、unit、scene hash 和
derivation key。unitless PLY 不写 `meters` 字样。

## 7. 前端结构

新增目录和职责：

```text
web/src/features/pointcloud/
├── PointCloudViewer.tsx       # Three.js 生命周期、视图和拾取
├── pointcloud-protocol.ts     # ArrayBuffer 校验与 typed-array 视图
├── ProcessingPanel.tsx        # draft ProcessingSpec 控件
├── MeasurementPanel.tsx       # 选点和单位正确的距离摘要
└── ExportActions.tsx          # PLY/JSON/PNG 下载按钮
web/src/viewer/
└── pointcloud-scene.ts        # 可测试的 Three.js 场景/资源服务
```

Zustand 状态新增：

- `draftProcessing`、`appliedProcessing`；
- `appliedDerivation`（manifest 摘要和下载 URL）；
- `viewSpec`（projection、color mode、point size、background）；
- `selectedPoints`（最多两个，带 pixel index、XYZ、unit）；
- `derivationRequestRevision` 和 `derivationBusy`。

请求响应必须带 revision；切换 Scene、重置或新请求时，旧响应不能覆盖当前 applied derivation。

### 7.1 检查模式

保留 M1 的 RGB/深度检查，把“应用处理”面板放在中央内容下方。已有 metric 或 relative capability
时显示默认 ProcessingSpec 和应用按钮；没有能力时显示具体门禁原因。应用成功后出现主点云画布、
视图控制、测量摘要和导出操作。

### 7.2 四视图模式

启用后显示固定四区布局：RGB、深度色图、点云和统计/测量。四个区域共享 selected pixel/point；
从 RGB/深度点击可高亮对应 `pixel_index`，点云拾取可反向标记二维像素。当前 M2 不做独立第二套
几何计算，所有联动只使用 derivation 的代表像素索引。

### 7.3 Three.js 生命周期与交互

`PointCloudViewer` 使用原生 Three.js `Scene`、`PerspectiveCamera`/`OrthographicCamera`、
`WebGLRenderer` 和 `OrbitControls`。renderer 开启 `preserveDrawingBuffer` 以支持 PNG 截图；组件
卸载或 derivation 替换时 dispose geometry、attributes、material、renderer 和 controls。

视图控制包括透视/正交 segmented control、标准视角/适配视图、点大小、颜色模式（RGB、深度色图、
单色、有效性）和 reset。默认将源坐标通过 `diag(1,-1,-1)` 映射到 WebGL 显示空间，但选点和导出
继续使用源相机 frame。

### 7.4 选点与测量

Raycaster 返回服务端 `pixel_index`；同一像素重复点击只更新已有选点。两点都存在时，显示 XYZ 和
欧氏距离，单位跟随 derivation：米制显示 `m`，unitless 显示 `unitless` 并禁用“转换为米”。
清除选点不触发 derivation 请求。

## 8. 测试与验收

后端新增：

- 2x2 pinhole 几何黄金测试，逐点验证 X/Y/Z、坐标方向和代表 pixel index；
- ROI、stride、depth/XYZ clip、voxel、max_points 的确定性测试；
- KNN filter/smooth 的空集、重复点和 NaN 防护测试；
- 二进制协议 offset/长度/endianness 和损坏 payload 拒绝测试；
- 缓存 key 幂等、源 stale 不复用旧缓存、PLY/JSON 单位注释测试；
- API 的 capability gate、幂等 POST、下载媒体类型和无路径泄露测试。

前端新增：

- protocol parser 的 magic/header/offset/shape 校验与 stable LOD 测试；
- Zustand 的 revision guard、draft/applied 分离和 unitless measurement 测试；
- Three.js viewer 的 mount/unmount 与 reset view 测试（使用最小 WebGL mock）；
- Playwright M2 流程：导入 fixture、确认 metric metadata、应用默认处理、显示点云、选择两点、
  验证 `m` 标签并下载 PLY/JSON/PNG；relative fixture 验证 `unitless` 且没有米制操作。

## 9. 实施顺序

1. 扩展 domain contract、schema 和 hash/缓存接口；
2. 先写点云处理与协议的失败测试，再实现纯 Python 处理器；
3. 接入 WorkspaceStore 与 derivation API，完成 API 集成测试；
4. 加入 Three.js 依赖、二进制 parser、状态和 viewer；
5. 加入处理面板、四视图、测量与导出操作；
6. 更新文档、fixture、端到端测试，运行完整 Python/TypeScript/Playwright 检查。

每一步都保持 M1 的 API 和导入测试通过；任何未应用的 draft 不得改变缓存 key 或导出内容。
