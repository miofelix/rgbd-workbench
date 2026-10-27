# RGB-D Workbench

一个**完全在浏览器中运行**的单帧 RGB-D 分析工作台。无需 Python、CLI、账户或应用后端；可部署到 GitHub Pages 等静态托管。原始文件只经用户显式选择进入浏览器，不上传到项目服务器。

## 功能

- RGB/深度导入、格式探测、显式几何合同与能力门禁。
- RGB：PNG、JPEG、WebP、TIFF；深度：单通道 8/16-bit PNG、TIFF、NPY、NPZ、PFM、显式描述的 RAW/BIN。
- 米制 `z_depth` 与无单位 `relative_z`，不猜测单位、相机或对齐关系。
- 确定性点云：ROI、stride、深度/XYZ 裁剪、体素、点数预算、KNN 过滤与平滑。
- Three.js 预览、稳定 LOD、投影/着色/色图、点选、两点测量、二维↔三维联动与统计。
- PLY、参数 JSON、PNG 静态导出。
- CameraPath 预设与关键帧编辑、target 来源、once/loop、easing、轨迹预览与校验。
- 离线 CPU z-buffer 帧渲染、固定色标与七种 256 项 LUT、1x/2x 抗锯齿、纯三维及 RGB/深度/三维版式。
- 浏览器支持时导出 MP4/H.264 或 WebM/VP9；不支持时可用 PNG 帧序列。视频与 sidecar 打包发布。
- IndexedDB Scene/源/预览/派生存储、完整性校验、按 Scene 隔离缓存、刷新恢复、Source Archive 备份与恢复。

**不包含**多帧融合、SLAM、深度估计、账号协作、云数据库、任意本地路径访问或旧 CLI/workspace 兼容层。相机轨迹不是三维扫描重建。

## 运行

要求 Node.js 24+（见 `.nvmrc`）与支持 WebGL2 的现代浏览器。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址。生产构建与预览：

```bash
npm run build
npm run preview
```

## 使用约定

1. 选择 RGB、深度和可选 JSON/YAML manifest。
2. 明确深度表示与单位，确认 pinhole 内参、已注册到 RGB 与已校正状态。没有 manifest 时的初始内参只是编辑起点，**不是标定结果**。
3. 保存 Scene，设置 ProcessingSpec 并点击“应用处理”。草稿不会改变测量或导出。
4. 在轨迹模式编辑 CameraPath 与 RenderSpec，再创建导出任务。

Source Archive 是 `.rgbd.zip`，含 Scene、源文件、manifest（若提供）及可选派生 payload。导入 Archive 会验证 hash 和格式，并分配新的 Scene UUID，缓存不会跨 Scene 串用。

## 工程结构

```text
src/
  domain/        # Zod 合同、能力、hash、诊断、二进制协议
  application/   # Workbench 用例与 Library/Processor seam
  compute/       # 格式解码、点云、轨迹、CPU 渲染、Worker、视频
  persistence/   # 版本化 IndexedDB、Archive、测试内存实现
  viewer/        # Three.js 与选择状态
  features/      # 导入、检查、点云、轨迹 UI
schemas/         # 由 Zod 生成的 JSON Schema 2020-12
scripts/         # Schema 生成与漂移检查
tests/           # 单元/集成测试与三浏览器 E2E
docs/            # 当前架构、ADR、开发说明、许可证与历史资料
```

依赖方向：`features → application → domain`；基础设施实现 application 的接口。几何与导出绝不从 Three.js LOD 或可变 UI 重新推算。

## 质量检查

```bash
npm run check
npx playwright install chromium firefox webkit
npm run test:e2e
npm audit --audit-level=high
```

`check` 覆盖格式、lint、严格类型、Schema 漂移、单元/集成测试和生产构建；`npm run check:pages` 额外验证项目子路径下的生产资源与 Worker。E2E 覆盖 Chromium、Firefox、WebKit；视频编码能力按浏览器实际 probe 降级，不把不支持的 codec 记为通过。

## GitHub Pages

`.github/workflows/pages.yml` 构建并发布静态 `dist/`。项目页使用 `VITE_BASE=/rgbd-workbench/`，用户/组织主页或自定义域可设置为 `/`。

在仓库 Settings → Pages 将 Source 选为 **GitHub Actions**。发布的是应用资源，不是用户数据；不要在 `public/` 或构建产物中放 RGB-D 工作区、fixtures 或私人 Archive。

## 文档

- [系统架构](docs/architecture/system-design.md)
- [数据与内容规范](docs/architecture/data-formats.md)
- [开发与贡献](docs/development.md)
- [架构决策](docs/adr)
- [第三方许可证](docs/third-party-licenses.md)

项目当前保持私有，未声明开源许可证。第三方依赖保留各自许可证与来源。
