# RGB-D Workbench 设计规格

## 1. 背景与定位

`rgbd-workbench` 是一个独立于 `asdepth-grasp` 的本地 RGB-D 分析与可视化项目，界面品牌为
`RGB-D Lab`。它面向需要检查单帧 RGB-D 数据、交互查看点云并生成虚拟相机轨迹视频的研究和
工程用户。

项目不运行深度估计或抓取检测，不连接相机或机器人，也不读取 `asdepth-grasp` 的 profile、
`.env`、实验目录或机器配置。现有仓库只作为交互与安全边界的只读参考；新项目没有运行时
import、submodule、符号链接或路径依赖。

首版运行形态是 macOS 和 Linux 上的本地 Python 服务加浏览器工作台。用户通过网页导入一对
静态 RGB 与深度图，也可以通过 CLI 引用大文件。系统明确校验深度语义、单位、内参和对齐，
再按当前能力开放二维分析、点云、测量、轨迹预览和视频导出。

## 2. 设计原则

### 2.1 数据可信优先

数据流固定分为三层：

```text
Source -> Normalized Scene -> Derived Artifacts
```

- `Source` 保存原始文件、格式探测结果和摘要，不改变原始像素或数组。
- `Normalized Scene` 保存经过用户确认的深度表示、单位、无效值、内参、对齐和坐标约定。
- `Derived Artifacts` 包括深度预览、统计、点云、截图、PLY 和视频，可以删除并重建。

文件扩展名只决定如何解码，不能决定深度单位或几何语义。系统不得根据数值范围猜测毫米、米、
逆深度、视差、相机型号或内参。

### 2.2 能力分级

导入成功不等于所有能力都可用。能力引擎至少输出：

- `image_inspection`：RGB、深度、无效掩码和统计可查看；
- `relative_pointcloud`：可生成明确标为 `UNITLESS` 的相对点云；
- `metric_pointcloud`：可生成相机坐标系、米制点云和距离测量；
- `video_export`：当前 Scene、派生结果、轨迹和编码器均满足导出条件。

缺少尺度时不得显示米制标签。缺少合法相机模型时不得生成点云。尺寸不同或未确认对齐的数据可
保留二维检查能力，但不得通过 resize、裁剪或插值伪造彩色点云。

### 2.3 可复现而非像素伪一致

每个导出记录 Scene hash、处理参数、视图参数、轨迹、渲染参数和实现版本。相同输入与参数必须
得到相同帧数、相机姿态、几何投影、颜色范围和版式。浏览器使用 Three.js 实时预览，服务端使用
CPU 权威渲染器生成成片；两者共享轨迹合同和一致性向量，但不承诺不同 GPU 与浏览器之间逐像素
哈希相同。

### 2.4 原始数据只读

系统不覆盖输入文件、已发布导出或历史 sidecar。所有文件写入先使用同文件系统临时文件，再原子
发布。取消、失败或服务重启不能留下看似完整的 Scene 或视频。

## 3. 首版范围

### 3.1 包含功能

- Managed 和 Linked 两种单帧 RGB-D 导入模式；
- manifest 优先、向导补全的数据确认流程；
- RGB、深度色彩图、无效掩码、直方图、色标、ROI 和联动点选；
- 米制 `z_depth` 和 `relative_z` 点云；
- 透视/正交、标准视角、轨道旋转、平移、缩放和视野适配；
- RGB、深度色图、单色和有效性点云着色；
- 深度/XYZ 裁剪、步长、最大点数、体素、KNN 离群过滤和 KNN 平滑；
- 点选坐标与两点距离测量；
- 参数化轨迹预设和单条自定义关键帧轨道；
- 纯三维和 RGB/深度/三维分屏视频；
- PNG、binary PLY、参数 JSON、MP4/H.264、WebM/VP9 和 PNG 帧序列导出；
- 多 Scene 工作区、缓存清理、源文件重新定位和自包含工作区打包。

### 3.2 明确不包含

- RGB-D 序列或视频输入；
- SLAM、多帧配准、融合或重建；
- 网格、纹理或 NeRF 生成；
- AI 深度推理、分割、检测或标注；
- 抓取姿态、机械臂、机器人 frame、IK、碰撞或执行；
- 任意 PLY/PCD/XYZ 点云导入；
- 世界坐标或用户自定义 frame 变换；
- 远程监听、账号、多人协作或云存储；
- 多轨、多片段、音频和字幕视频剪辑；
- 首版第三方插件 SDK。格式适配器采用内部注册表和官方可选 extra。

## 4. 项目标识、平台与发行

- 仓库路径：`/Users/felix/Projects/rgbd-workbench`；
- Python 包：`rgbd_workbench`；
- CLI：`rgbd-workbench`；
- UI 品牌：`RGB-D Lab`；
- Python：3.11 及以上；
- 首版平台：macOS、Linux；
- 前端开发运行时：Node.js 24 LTS；
- 浏览器：支持 WebGL2 的当前 Chromium、Firefox 和 Safari；
- 仓库初始按私有项目管理，不添加开源许可证。

Python 使用 Hatchling 和标准 `pyproject.toml`，推荐 `uv`，同时保持普通 PEP 517/pip 安装
可用。CLI 使用 Typer。Python 代码使用 Ruff、mypy 和 pytest；前端使用 TypeScript strict、
ESLint、Prettier、Vitest 和 Playwright。前端使用 `package-lock.json` 锁定依赖。发布 wheel 内
包含已构建的前端静态资源，最终用户不需要 Node。
应用、Scene schema、API 和导出 manifest 分别版本化；应用版本变化不得隐式改变旧 sidecar
的解释方式。

CLI 提供：

```text
rgbd-workbench serve [--workspace-root DIR] [--port PORT] [--no-open]
rgbd-workbench open --rgb FILE --depth FILE [--manifest FILE] [--link]
                     [--workspace-root DIR] [--no-open]
rgbd-workbench doctor [--json]
rgbd-workbench workspace pack --workspace-root DIR --output FILE [--include-linked]
rgbd-workbench workspace unpack FILE --output DIR
```

`serve` 默认绑定 `127.0.0.1` 并打开浏览器。`open` 创建或更新当前工作区中的 staged import，
默认复制源文件，`--link` 使用 Linked 模式，然后启动本地服务并直接打开该 staged import；它是
导入加 `serve` 的快捷入口。`doctor` 检查工作区写权限、浏览器启动能力、FFmpeg 路径与编码器、
可选格式 extra 和资源配置，不读取用户图像内容。`workspace pack/unpack` 使用后文定义的可移植
归档格式。

## 5. 技术架构

### 5.1 前端

前端使用 React、TypeScript、Vite 和 Three.js：

- React 负责页面结构、导入向导、状态面板、表单、任务进度和错误呈现；
- Three.js 由独立的 viewport service 直接管理，不通过 React Three Fiber；
- TanStack Query 管理服务端资源，Zustand 管理 UI、draft 和 viewer 状态；
- 服务端状态与 UI 状态分离；
- 几何参数区分 `draft` 和 `applied`；
- Three.js 资源的创建、替换和 dispose 有独立生命周期；
- 前端 API 类型从服务端 OpenAPI/schema 生成，禁止复制一套手写 wire type。

共享状态至少包括当前 workspace、Scene、Scene revision、applied derivation、draft processing、
ViewSpec、选中像素/点、工作模式、CameraPath 草稿和导出任务。Scene 或 revision 切换时，所有异步
响应必须用 revision/request ID 防止旧结果覆盖新状态。

### 5.2 后端

后端使用 FastAPI、Pydantic、NumPy：

- Pillow 读取普通 RGB 容器；
- tifffile 读取整数或浮点 TIFF；
- `numpy.load(..., allow_pickle=False)` 读取 NPY/NPZ；
- SciPy `cKDTree` 实现 KNN 操作；
- `imageio-ffmpeg` 提供默认 FFmpeg 可执行文件，并允许
  `RGBD_WORKBENCH_FFMPEG` 环境变量覆盖；
- CPU 点云渲染器生成权威视频帧；
- 进程内有界队列串行执行视频任务。

后端不导入模型、CUDA、设备 SDK、Open3D、机器人库或 `asdepth-grasp` 模块。首版不使用
Celery、Redis、数据库或外部任务服务。

### 5.3 模块边界

代码边界固定如下；后续可以在这些目录内继续拆分，但不得跨越职责：

```text
src/rgbd_workbench/
├── api/          # HTTP、鉴权令牌、响应与 SSE
├── cli/          # serve、open、doctor
├── domain/       # 版本化合同、能力与诊断
├── adapters/     # RGB、深度、manifest 和 optional extras
├── workspace/    # 事务写入、hash、缓存与打包
├── processing/   # 规范化、点云、统计与过滤
├── trajectories/ # CameraPath 采样与校验
├── rendering/    # CPU 帧渲染、版式与 FFmpeg
└── jobs/         # 队列、状态、取消与恢复

web/src/
├── api/
├── app/
├── features/import/
├── features/inspect/
├── features/compare/
├── features/trajectory/
├── features/export/
├── state/
└── viewer/
```

格式适配器只能返回 staged candidate 与诊断，不得直接写工作区。轨迹模块不依赖 React 或视频
编码。渲染模块只消费已验证合同，不读取“当前界面状态”。

## 6. 工作区与文件生命周期

### 6.1 目录结构

```text
workspace/
├── workspace.json
├── scenes/
│   └── <scene-id>/
│       ├── scene.json
│       ├── sources/                 # Managed 模式
│       ├── cache/<scene-hash>/
│       └── exports/
└── jobs/
```

默认 workspace root 由 `platformdirs` 选择，用户可以用 `--workspace-root` 覆盖。路径不能来自
运行仓库的硬编码机器值。用户配置固定读取
`platformdirs.user_config_dir("rgbd-workbench")/config.toml`；CLI 参数覆盖 TOML，环境变量只
用于密钥或明确记录的进程级覆盖，不把工作区绝对路径编译进代码。

### 6.2 Managed 模式

网页拖放和文件选择始终使用 Managed 模式。服务端流式写入 staging，完成大小、格式和 hash
校验后才提交到 `sources/`。原始文件名只作为显示信息，落盘名称经过清理并避免冲突。提交后使用
工作区副本，外部原文件移动不会影响 Scene。

### 6.3 Linked 模式

Linked 模式只能通过 CLI 显式注册。工作区保存 canonical path、文件身份和 SHA-256，不复制
源数据。网页 API 不接受任意本机路径。每次打开 Scene 时重新检查存在性、大小、mtime 和摘要；
文件缺失时标为 `missing`，内容变化时标为 `stale`，现有缓存不得继续冒充当前结果。

绝对路径属于私有 workspace locator，不写入普通 API、日志、sidecar 或可移植 manifest。打包
Linked Scene 时，用户必须显式选择包含源文件；包含后转换为 Managed 布局。

### 6.4 Hash 与缓存

`scene_hash` 由源文件 SHA-256、规范化 SceneManifest 和规范化器版本共同计算。
`derivation_key` 由 `scene_hash + ProcessingSpec + processor_version` 计算。JSON 在 hash 前使用
RFC 8785 JSON Canonicalization Scheme 生成规范字节；合同中的非有限数字在 hash 前即被校验拒绝。

缓存可以手工或按容量策略清理。删除缓存不改变 Scene 或导出。修改尺度、内参、深度语义、无效值
或对齐声明会产生新的 `scene_hash`；旧导出保留自己的快照，但不显示为当前结果。

### 6.5 可移植归档

工作区归档扩展名为 `.rgbdw`，内容是 ZIP64，根目录必须包含 `workspace.json` 和
`archive_manifest.json`。manifest 记录 schema、每个成员的相对路径、大小和 SHA-256。归档成员
禁止绝对路径、`..`、符号链接和重复规范化路径；解包前检查成员数量、总解压大小和压缩比，解包到
临时目录并验证全部 hash 后才原子发布。

Managed source 默认进入归档。Linked source 默认只保留脱敏 locator 状态，使用
`--include-linked` 或网页中的等价显式确认后才复制进归档，并在归档内转换为 Managed source。
归档恢复由 `workspace unpack` 完成，首版网页只负责生成和下载归档，不在浏览器内直接解包。

## 7. 输入格式与规范化

### 7.1 核心格式

RGB 核心适配器支持：

- PNG；
- JPEG；
- WebP；
- 单页或显式选择页的 TIFF。

深度核心适配器支持：

- 单通道 8/16-bit PNG；
- 单通道整数或浮点 TIFF；
- 二维数值 NPY；
- NPZ 中唯一或用户显式选择的二维数值数组；
- PFM；
- manifest 明确给出 shape、dtype 和 endianness 的 `.raw`/`.bin`。

原生 manifest 支持 JSON 和 YAML；YAML 使用 safe loader，禁止自定义 tag，并受与 JSON 相同的
文档大小和嵌套深度限制。EXR 通过官方 `formats-exr` extra 提供。MAT、HDF5、CSV、
ROS bag、RealSense 容器和数据集目录不属于核心格式。

JPEG 和多通道彩色图不得作为深度静默接收。多页 TIFF、多个 NPZ 数组或多个 EXR 通道必须在
staging 中显式选择。NPY/NPZ object dtype、pickle 和数组头部/载荷不一致直接拒绝。

### 7.2 图像方向与颜色

RGB 解码保留像素数组的实际方向。非标准 EXIF orientation 必须显示诊断；只有用户选择对 RGB
与深度应用同一可验证旋转/翻转后，才可恢复几何能力。不得只自动旋转 RGB。RGB 颜色转换到 sRGB
用于显示和点颜色，ICC/alpha 处理记录在 provenance 中，不改变深度有效性。

### 7.3 深度表示

输入 representation 支持声明：

- `z_depth`；
- `relative_z`；
- `euclidean_range`；
- `inverse_depth`；
- `disparity`。

首版三维核心只消费 `z_depth` 和 `relative_z`。其他表示可做二维检查；官方或可选适配器只有在
转换参数完整时才把它们规范化为 `z_depth`，并记录原表示和转换参数。

米制 `z_depth` 必须声明 `m`、`mm` 或显式 `scale_to_meter`。规范化输出为有限的
`numpy.float32`、二维 C-contiguous 数组，正有效值单位为米。`relative_z` 输出同样是有限的正
`float32`，但单位固定为 `unitless`，禁止 `scale_to_meter` 和米制距离功能。

invalid sentinel 在尺度转换前匹配；NaN、Inf 和转换后的非正值始终无效。可选有效范围在规范化
单位中表达，并与显示色标范围分开。

### 7.4 相机与对齐合同

首版三维要求：

- `camera.model = pinhole`；
- `fx > 0`、`fy > 0`，且 `fx/fy/cx/cy` 均有限；
- 相机记录的 width/height 与深度数组一致；
- RGB 与深度尺寸一致；
- `alignment.state = registered_to_rgb`；
- `distortion.model = none`，表示输入已经校正；
- 坐标约定为 `x right, y down, z forward`。

点云按下式生成：

```text
X = (u - cx) * Z / fx
Y = (v - cy) * Z / fy
Z = normalized depth
```

Scene 和导出数据始终保留这个源相机坐标。Three.js 内部可以使用明确的显示矩阵
`diag(1, -1, -1)` 映射到 WebGL 视图，但不得覆盖或改写源点坐标。

## 8. 版本化公共合同

后端 Pydantic 模型是运行时真相，并生成已跟踪 JSON Schema 与 OpenAPI。TypeScript 类型从这些
产物生成；CI 检查生成结果没有漂移。

### 8.1 SceneManifestV1

至少包含：

- `schema_version`、`scene_id`、显示名称；
- RGB/深度 source identity 和 SHA-256；
- 深度 representation、单位/scale、invalid 和有效范围；
- 原始表示与转换 provenance；
- pinhole 内参、尺寸、校正和对齐声明；
- frame ID、坐标约定；
- capability 列表与结构化 diagnostics；
- normalizer 和 adapter 版本。

### 8.2 ProcessingSpecV1

只包含改变派生数据的参数：

- 像素 ROI；
- 深度几何裁剪范围；
- XYZ 范围；
- 像素步长和分析点数上限；
- 体素大小；
- KNN 离群参数；
- KNN 平滑参数。

用户过滤默认关闭，避免默认修改数据。初始 ProcessingSpec 使用全图、pixel stride 1、无额外
深度/XYZ clip、无 voxel、无 KNN，并记录 2M 点的分析安全上限。有限正深度和分析上限属于显式
记录的基础有效性与资源规则。用户必须应用几何参数后才产生新的 derivation。

### 8.3 ViewSpecV1

包含不改变点数据的参数：

- 透视或正交投影；
- 相机 position、target、up、FOV 或 orthographic scale；
- RGB/深度/单色/有效性着色；
- 色图、百分位或固定色标；
- 点大小、透明度、背景；
- 坐标轴、网格、轨迹线、视锥和选点标记可见性。

### 8.4 CameraPathV1

包含：

- frame 与单位；
- 轨迹类型和参数，或按时间排序的关键帧；
- target 来源和解析后的 XYZ；
- duration、easing、projection 参数和 loop mode；
- trajectory sampler 版本。

首版预设为：环绕、椭圆环绕、推近/拉远、横移、升降、俯仰/摇摄、螺旋、飞越和 Dolly Zoom。
目标可来自场景稳健中心、ROI 中心、选中点或手工 XYZ。

首版 `loop_mode` 只有 `once` 和 `loop`，easing 只有 `linear`、`smoothstep` 和
`ease_in_out_cubic`。场景稳健中心定义为当前 applied point cloud 的逐轴中位数；ROI 中心定义为
ROI 内有效 applied points 的逐轴中位数。目标集合为空时轨迹无效，不回退到原点。

自定义轨道关键帧保存 `time, position, target, up, projection, fov/ortho_scale, easing`。位置和
target 使用 centripetal Catmull-Rom（alpha 0.5）插值；两个关键帧时退化为线性插值。标量参数
按 segment easing 后线性插值。up 向量归一化插值，视线与 up 接近共线时校验失败。默认 up 在源
相机 frame 中为 `[0, -1, 0]`。

关键帧时间必须从 0 开始、严格递增并以 duration 结束。`loop` 自定义轨道要求首尾 position、
target、up 和投影参数在合同容差内相同，并通过首尾切线连续性校验；否则只能使用 `once`。重复的
相邻控制点使用线性退化路径，不能产生除零或 NaN。

循环轨迹使用 `N = round(duration * fps)` 帧和 `phase_i = i / N`，不重复端点。一次性轨迹同样
使用 N 帧，但归一化时间为 `i / (N - 1)`，包含首尾姿态。N 至少为 2，sidecar 记录实际帧数和
编码时长。

### 8.5 RenderSpecV1

包含：

- `pointcloud` 或 `rgb_depth_pointcloud` 版式；
- width、height、FPS、codec、质量和背景；
- point budget、点大小、抗锯齿级别；
- 深度色图与固定范围；
- 可选坐标轴、网格、标题、单位、时间和 provenance 摘要层；
- Scene revision、derivation、ViewSpec 与 CameraPath 快照引用。

默认 RenderSpec 为 1280x720、30 FPS、5 秒、H.264、150K 点、1x 抗锯齿和纯三维版式。
抗锯齿仅允许 1x 或 2x；2x 使用两倍线性尺寸渲染，再以 Lanczos 降采样到目标尺寸。export job
在创建时嵌入所引用合同的完整快照，ID 只用于追溯，不能在任务运行时重新读取可变 UI 状态。

### 8.6 ExportManifestV1

每次导出旁车包含全部输入 hash、上述合同快照、实现版本、创建时间、输出 hash、帧数、实际时长、
codec、错误/警告和平台信息。平台信息只记录操作系统、架构和版本化 renderer/encoder，不记录
用户名、主机名或绝对路径。

## 9. 点云处理

处理顺序固定为：

1. 加载规范化深度、RGB 和有效掩码；
2. 应用像素 ROI、pixel stride、invalid 和深度 clip；
3. 使用 pinhole 内参反投影；
4. 应用 XYZ 范围；
5. 按用户设置执行体素聚合；
6. 超过分析预算时按源像素索引执行确定性分层采样；
7. 可选 KNN 离群过滤；
8. 可选 KNN 平滑；
9. 为交互预览构建确定性 LOD。

体素聚合使用同一 voxel 内 XYZ 和 RGB 的均值，并保留最小源像素索引作为联动代表。任何平滑都
只改变派生 XYZ，不改变源深度。导出 PLY 必须基于当前 applied derivation，而不是浏览器再次
采样后的 LOD。

内部点云预览响应使用 `application/vnd.rgbd-workbench.pointcloud-v1`：八字节 ASCII magic
`RGBDPC1\0`、四字节 little-endian JSON header 长度、UTF-8 header，再按四字节对齐的绝对 byte
offset 放置 `float32[N,3] positions`、`uint8[N,3] colors` 和
`uint32[N] pixel_index`。header 记录 point count、shape、dtype、byte offset、frame、unit、
bounds、scene hash 和 derivation key。magic、长度、offset、shape 或总字节数不一致时前端拒绝
载入。

用户 PLY 为 binary little-endian，保存 XYZ、RGB 和 `source_pixel_index`，并以 comment 记录
frame、unit、scene hash 和 derivation key。unitless 点云不得写入 `meters` 注释。

## 10. 前端信息架构

### 10.1 总体布局

采用已确认的“分析主导”布局：

- 顶栏：产品、当前 Scene、能力、保存/导出；
- 左栏：Scene 列表、能力状态和三种工作模式；
- 中央：RGB/深度摘要、主画布和按需展开的时间轴；
- 右栏：当前模式检查器；
- 底栏：hash、dirty/applied、任务和源文件只读状态。

三种模式为：

1. `检查与测量`：默认，大点云画布、选点、测量和几何参数；
2. `四视图对照`：RGB、深度、点云和统计同步显示；
3. `轨迹与导出`：显示轨迹线、相机视锥、时间轴、版式和编码参数。

三种模式共享 Scene、applied derivation、ROI、选中点和 ViewSpec。切换模式不重新导入或随机
采样点云。

### 10.2 Draft 与 Applied

颜色、背景、点大小、投影和普通视角等低成本 ViewSpec 修改即时生效。ROI、范围、体素、采样、
KNN 等 ProcessingSpec 修改进入 draft，并显示 dirty 状态。用户点击“应用”后才请求 derivation。

导出只能引用 applied derivation。有未应用处理修改时，导出入口必须明确提示“应用后导出”或
“忽略草稿并导出当前已应用版本”，不得静默选择。

### 10.3 视觉与可访问性

界面使用安静、工具化的中性色，深色顶栏、青绿色主操作、琥珀色警告和红色错误；深度色图是数据
表达，不作为装饰。页面不使用营销 hero、装饰性渐变、嵌套卡片或大圆角。按钮使用 Lucide 图标和
可见 tooltip，数值控件使用输入框、slider、toggle 或 segmented control。

窄屏将左右栏折叠为抽屉并纵向排列预览，不隐藏核心功能。所有状态不能只依赖颜色；canvas 有文本
替代状态和键盘可达的视图控制。桌面与移动视口不得出现文本、面板或浮层重叠。

## 11. 轨迹与渲染

### 11.1 浏览器预览

Three.js 使用 CameraPathV1 sampler 的 TypeScript 实现逐帧更新 camera。轨迹模式显示路径线、
关键帧、当前视锥和 target。用户可以将当前视角添加为关键帧、拖动时间、选择预设、编辑参数并
实时预览。

前端默认使用 250,000 点的稳定 LOD，切换视角或播放轨迹时不得随机换点。轨迹警告包括穿过
target、near plane 裁切、视线/up 退化、场景完全离开画幅和非连续 loop。

### 11.2 CPU 权威渲染器

服务端对每一帧：

1. 使用 Python CameraPath sampler 计算相机与投影；
2. 将 applied point cloud 变换到虚拟相机空间；
3. 执行 near/far clip 和透视/正交投影；
4. 使用稳定 z-buffer 和 point splat 绘制点；
5. 应用与前端共享的 256 项色图 LUT；
6. 绘制可选辅助层；
7. 合成版式并把连续 RGB 帧写入 FFmpeg stdin。

共享 LUT 至少包含 Turbo、Viridis、Inferno、Magma、Plasma、Cividis 和 Gray，前后端读取同一组
版本化资产。整个视频固定颜色范围和画幅，不逐帧自动缩放。

### 11.3 视频版式

`pointcloud` 使用完整输出画布显示三维场景。

`rgb_depth_pointcloud` 使用固定布局：上半部左右分别为保持宽高比的 RGB 和深度图，下半部为
完整宽度的三维点云。图像使用 letterbox，不裁剪、不拉伸。ROI 已应用时，三个面板使用同一个
裁剪范围。无效深度默认黑色。

### 11.4 编码与发布

默认导出 MP4/H.264，另支持 WebM/VP9 和 PNG 帧序列。PNG 帧序列发布为包含连续六位帧名和
ExportManifest 的 ZIP64。启动时通过 FFmpeg encoder probe 生成 capability；某个 codec 不可用
时只禁用该格式。width/height 对要求 yuv420p 的 codec 必须为正偶数。

视频先写入 `exports/.tmp/` 中唯一临时文件，writer/FFmpeg 成功退出、帧数验证和输出 hash 完成
后再原子发布。历史输出永不覆盖，名称包含 UTC 时间戳、Scene 短 ID、轨迹类型、版式和短参数
摘要。旁车 JSON 与视频一起发布。

## 12. API 与任务状态

### 12.1 HTTP API

首版 `/api/v1` 提供以下业务路由：

```text
GET    /health
GET    /capabilities
GET    /workspace
POST   /imports
GET    /imports/{import_id}
PUT    /imports/{import_id}/metadata
POST   /imports/{import_id}/commit
DELETE /imports/{import_id}
GET    /scenes
GET    /scenes/{scene_id}
POST   /scenes/{scene_id}/revisions
POST   /scenes/{scene_id}/derivations
GET    /scenes/{scene_id}/exports
GET    /derivations/{derivation_id}
GET    /derivations/{derivation_id}/pointcloud
GET    /derivations/{derivation_id}/images/{kind}
POST   /exports
GET    /exports/{export_id}
GET    /jobs/{job_id}
GET    /jobs/{job_id}/events
POST   /jobs/{job_id}/cancel
GET    /exports/{export_id}/files/{file_id}
POST   /workspace/package
POST   /workspace/cache/clear
```

multipart upload 流式落盘并受 staging quota 限制。下载和媒体响应只通过白名单 ID，不把文件路径
作为 URL 参数。`/events` 使用 SSE，支持 reconnect 和 Last-Event-ID。workspace package 也创建
普通 job；cache clear 只接受服务端解析出的 scene/hash ID 列表，不接受路径。

### 12.2 Job 状态机

状态固定为：

```text
queued -> running -> succeeded
                 -> failed
                 -> cancelling -> cancelled
queued -> cancelled
running -> interrupted   # 服务异常退出或重启恢复
```

创建 export job 时完整快照 Scene revision、derivation、ViewSpec、CameraPath 和 RenderSpec。
后续 UI 修改不能改变已排队任务。首版每个工作区一个视频 worker。取消向 renderer 和 FFmpeg
传播，清理临时文件并保留 job 摘要。`interrupted` 任务不能从中间帧续跑，但可以从同一快照创建
retry job。

## 13. 诊断、错误与安全

### 13.1 结构化诊断

所有可呈现错误使用稳定结构：

```text
code, severity, field, message, hint, capability
```

`severity` 为 `info`、`warning` 或 `fatal`。前端根据 code/capability 决定门禁，不解析自然语言。
失败消息说明原因、受影响能力和修复动作，但不返回整个 manifest、绝对路径或原始异常堆栈。

### 13.2 本机服务安全

- 首版只监听 loopback，不提供远程绑定开关；
- 启动时生成随机 session token；
- 首次带 token URL 换成 HttpOnly、SameSite=Strict cookie 后重定向到无 token URL；
- `/api/v1/health` 只返回版本与就绪状态，可以不带 session cookie；其余 `/api/v1`、下载和 SSE
  都要求有效 session；
- 校验 Host、Origin 和请求大小；
- 设置 CSP、`nosniff`、同源资源策略和敏感 API 的 `no-store`；
- 静态资源和下载均使用显式路由，不做任意目录服务；
- canonical path 与 symlink 校验确保所有写入位于 workspace root；
- Linked path 只能由当前 CLI 会话预注册；
- 日志记录资源 ID、尺寸、dtype、hash 前缀、耗时和错误码，不记录像素、完整路径、用户名或主机名。

### 13.3 资源预算

默认安全配置：

- 单文件上传上限 2 GiB；
- 解码后单数组最多 64M 像素，单边不超过 32,768；
- 浏览器预览默认 250K 点，上限 2M 点；
- 视频宽高上限 3840x2160；
- FPS 上限 60；
- duration 上限 120 秒；
- 单帧渲染点数上限 1M；
- pixel-frame 组合预算 1.5B；
- point-frame 组合预算 150M。

其中 `pixel_frames = width * height * frame_count`，`point_frames = render_points * frame_count`。
所有独立上限和组合预算必须同时满足。排队前显示帧数、像素帧、点帧和临时空间估算。配置可以
通过 `config.toml` 或对应 CLI 选项显式调高；调整记录在 ExportManifest，不依赖机器型号硬编码。

## 14. 测试与验收

### 14.1 后端与格式

- 每个核心格式使用小型合成 fixture 覆盖 dtype、endianness、NaN/Inf、invalid sentinel、
  NPZ key、多页/多通道选择和损坏载荷；
- 验证 NPY/NPZ 禁止 object/pickle、压缩炸弹与声明/载荷不一致；
- 验证 Managed/Linked、hash、stale/missing、事务提交和源文件不变性；
- 验证路径穿越、symlink、任意输出路径、Host/Origin、token 和上传配额；
- 验证 job 状态、取消、FFmpeg 失败和重启后的 interrupted 恢复。

### 14.2 几何黄金测试

使用解析解平面、斜面和彩色规则图验证：

- pinhole unprojection 和相机轴方向；
- m/mm/scale 与 unitless 门禁；
- ROI、invalid、深度/XYZ clip；
- 体素、确定性采样、KNN 和像素索引；
- PLY round-trip、frame 与 unit comment；
- RGB/深度/点云联动选点与两点距离。

### 14.3 跨语言一致性

Python 和 TypeScript 对同一组版本化 conformance vectors 计算：

- 所有预设的关键采样点；
- keyframe Catmull-Rom 与 easing；
- position、target、up、FOV/scale；
- once/loop 的帧时间与端点；
- perspective/orthographic 投影基准点。

结果在明确浮点容差内一致。schema/OpenAPI 生成产物在 CI 中必须无漂移。

### 14.4 前端与浏览器

- Vitest/Testing Library 覆盖导入向导、capability、draft/applied、模式共享状态、过期响应和导出
  快照；
- Three.js viewer 的矩阵、picking、LOD 和 resource disposal 独立测试；
- Playwright 在桌面和移动视口验证无重叠、三种模式切换、canvas 非空、旋转/缩放/点选和错误状态；
- 关键页面保存截图回归，canvas 另做像素非空与构图边界检查。

### 14.5 视频验收

合成 Scene 生成短 MP4 和 WebM，并使用 FFprobe/解码器验证 codec、尺寸、FPS、帧数和可播放性。
抽取首、中、末帧验证：

- 点云非空且构图稳定；
- 色标在全视频固定；
- 轨迹方向和范围正确；
- loop 没有重复端点和明显跳变；
- 分屏布局、letterbox 与 ROI 一致；
- sidecar 完整且 output hash 匹配。

CI 在 Ubuntu 和 macOS 运行 Python、TypeScript、API、浏览器和小视频闭环。性能结果作为基准报告，
不把某台机器的时间声明为通用保证。

### 14.6 用户验收数据

最终使用三组合成或可公开测试数据：

1. 16-bit PNG 米制深度；
2. float32 NPY 米制深度；
3. PFM unitless relative depth。

每组完成导入诊断、二维/三维联动、参数应用和 PNG/PLY/JSON 导出。米制与 unitless 的单位标签、
测量能力和 sidecar 必须正确。至少两种轨迹和两种版式成功生成并回放视频。

## 15. 实施里程碑

### M1：导入、Scene 与二维诊断

- 建立独立仓库、工具链、CLI、本机服务和安全外壳；
- 实现 workspace、Managed/Linked、hash 与事务提交；
- 实现核心格式适配器、manifest、向导与能力引擎；
- 实现 RGB/深度/invalid/统计/ROI/色标；
- 完成格式、安全和工作区测试。

M1 结束时，应用可以可靠导入、重开和诊断 Scene，但不承诺三维或视频。

### M2：点云分析与静态导出

- 实现 ProcessingSpec、点云流水线和缓存；
- 实现二进制预览协议、Three.js viewer 和三种工作模式骨架；
- 实现过滤、LOD、联动点选和距离测量；
- 实现 PNG、binary PLY 和参数 JSON；
- 完成几何黄金测试和浏览器交互测试。

M2 结束时，单帧 RGB-D 分析形成完整闭环。

### M3：轨迹、视频与工作区打包

- 实现 CameraPath/RenderSpec、预设和关键帧编辑器；
- 实现跨语言 conformance vectors；
- 实现 CPU renderer、两种版式、FFmpeg 和 job/SSE；
- 实现 MP4、WebM、PNG 帧序列、sidecar 和工作区打包；
- 完成取消/恢复、视频、跨平台和最终用户验收。

M3 结束时发布首个完整 v1。每个里程碑都必须保持主分支可运行，不在 M3 才补齐 M1/M2 的错误
处理或测试。

## 16. 成功标准

首版成功必须同时满足：

- 用户不依赖 `asdepth-grasp` 或任何现场 profile 即可启动；
- 常见 RGB-D 文件和数组可通过同一向导进入清晰的 Scene 合同；
- 系统从不静默猜测深度单位、表示、内参或对齐；
- 米制和 unitless 结果在 UI、API、PLY 和视频 sidecar 中始终可区分；
- 点云查看、过滤、选点、测量和导出消费同一 applied derivation；
- 浏览器预览与服务端视频在轨迹、投影、色标、帧数和版式上符合共享合同；
- 源文件与历史导出不被覆盖，失败任务不发布部分结果；
- macOS 与 Linux 的自动化测试覆盖导入到视频的完整离线链路；
- 当前 `asdepth-grasp` 仓库内容保持不变。
