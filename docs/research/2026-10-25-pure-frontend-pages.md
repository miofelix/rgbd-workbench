# RGB-D Workbench 纯浏览器前端与 GitHub Pages 可行性

- 调研日期：2026-10-25
- 范围：当前 M1/M2 的导入、检查、点云派生、缓存与导出；不包含尚未实现的 M3 视频渲染。
- 方法：只读检查当前仓库，核对官方文档、标准和第一方项目文档。没有上传本地文件，没有修改或运行应用，没有执行浏览器内 PoC。

## 结论

**M1/M2 改为纯浏览器前端并部署到 GitHub Pages，在架构上可行，但不是仅修改 Vite 配置的部署工作，而是迁移后端执行层和工作区语义。** React、Three.js 和静态协议解析可以保留；FastAPI、Python 文件路径、NumPy/SciPy/Pillow/tifffile 的处理与本地缓存必须替换或在浏览器中重新承载。

建议首选 **Pyodide + Web Worker 的受控 PoC**，尽量复用 Python 数值处理和 `scipy.spatial.cKDTree`，以降低格式及数值结果分叉的风险。**Pyodide 只是候选方案，不是已验证方案**：本次没有验证其运行时及 NumPy、SciPy、Pillow、tifffile、Pydantic、PyYAML 等依赖能否在目标版本和目标浏览器共同工作，也没有验证大文件内存、性能或缓存容量。不得据此宣称兼容性已经解决。

建议保留现有本地 Python 服务作为完整功能/基准实现。纯前端版先定位为显式受支持输入上的本地分析工具，而不是承诺原工作区、Linked import、CLI 和未来 M3 的完全等价替代。

## 当前代码决定的迁移面

| 当前实现                                                                  | 本地证据                                                             | 纯前端处理建议                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vite/React/Three.js UI，无前端路由库                                      | `package.json`、`vite.config.ts`、`web/src/main.tsx`                 | 大部分可保留；构建和静态资源必须适配 Pages 子路径。                                             |
| 导入、Scene、预览、派生、PLY/JSON 下载均为 `/api/v1/...`                  | `web/src/api/client.ts`、`src/rgbd_workbench/api/app.py`             | 用浏览器内 repository/processor 接口替换，不能继续依赖同源 API。Blob URL 可替代预览和导出 URL。 |
| Pillow RGB 解码；NPY/NPZ/PFM/RAW 深度；单通道 PNG/TIFF 和浮点 TIFF        | `adapters/image.py`、`adapters/depth.py`                             | 保持解码合同；按格式逐项建立黄金样本和浏览器解码测试。                                          |
| NumPy 数组处理与 SciPy `cKDTree` KNN                                      | `processing/pointcloud.py`                                           | PoC 优先在 Worker 内复用 Python；备选是独立 TS/WASM 实现并验证同序/同距离结果。                 |
| Managed/Linked 导入、SHA-256、私有 locator、原子 Scene 提交和派生缓存     | `workspace/store.py`、`workspace/paths.py`、`api/app.py`             | 用 IndexedDB/OPFS 重建可恢复状态；不能照搬原生路径、symlink、原子目录 rename 等语义。           |
| 上传/文件上限 2 GiB，数组上限 256 MiB、64M pixels；KNN 分批及 work budget | `adapters/image.py`、`adapters/depth.py`、`processing/pointcloud.py` | 原上限不是浏览器可运行保证；按总峰值内存重新制定输入和派生限额。                                |

GitHub Pages 官方定义其服务为直接发布仓库中的 HTML、CSS、JavaScript，可选执行构建后发布的**静态托管**。[1] 因此它不运行 FastAPI/Uvicorn，也不能靠 Pages 上的 Python 文件提供动态 API。`127.0.0.1` 本地服务及 token/cookie 会话在 Pages 部署中没有等价后端；纯前端版应保持“用户选中的数据不离开浏览器”的架构，并另行设置静态站点 CSP。

## GitHub Pages、Vite base 与 SPA

1. **部署方式**：GitHub Actions 构建并发布 `dist/web`，发布源选择 GitHub Actions。Vite 官方 Pages 指南明确要求在构建前设置正确的 `base`。[1][4]
2. **子路径**：项目站默认 URL 是 `https://<owner>.github.io/<repository>/`，不是站点根目录。[1] 对本仓库即通常需要 `base: "/rgbd-workbench/"`；用户/组织站或自定义域使用 `/`。更稳妥的做法是由部署环境注入 base，并使 JS、CSS、manifest、Worker、WASM 和 Python wheel 的 URL 都经过 Vite base 解析，而不是硬编码 `/assets` 或 `/api`。
3. **当前 URL 入口**：目前只读取 `?import=...`，没有 `react-router` 或 History API 路由。保留单页加查询参数/hash 状态可避免刷新 404。新增内部链接应基于 `import.meta.env.BASE_URL`。[6]
4. **History SPA 限制**：Pages 没有应用服务器的 catch-all rewrite。它支持自定义 `404.html`，但官方只说明这是自定义 Not Found 页面，并未保证 SPA 路由重写。[3] 若采用 history 路由，应把 `404.html` 作为显式、测试过的回退工程，不能把它当成已验证的官方 SPA fallback。当前项目优先选择单入口或 hash 路由。
5. **静态产物限额**：官方限额包括发布站点最大 1 GB、部署 10 分钟超时、每月 100 GB 软带宽限制、每小时 10 次构建软限制；自定义 Actions workflow 不适用最后一项。[2] 不应把用户 RGB-D 数据、fixtures 或浏览器缓存放进 Pages 产物。

## 文件访问、持久化与安全限制

### 导入与原文件

- 标准 File API 支持 `<input type="file">` 让用户逐个选择文件，返回 `FileList`；`Blob.slice()` 支持读取字节范围，`FileReader`/Blob 读取可交给 Worker。[7] 这适合跨浏览器的基础导入，且无需上传文件。
- 用户选择文件不等于网页获得任意路径或目录的读取权。File API 的安全章节要求防止恶意文件选择、保护系统敏感文件，并考虑文件选择后被修改的情况。[7] 浏览器版不能读取 CLI 提供的任意绝对路径，也不能假定 `File` 会永久有效。
- File System Access API 的 picker 需要安全上下文、用户激活和权限；保存的 handle 可用于再次请求访问，但权限可能被重新请求。[8][9] `showOpenFilePicker()` 被 MDN 标为 Limited availability 和 Experimental。[10] 它应是 Chromium 等支持环境中的增强项，基础流程必须保留 `<input type="file">` 和重新选择文件的降级路径。本报告不提供未经核对的版本号支持矩阵。
- 原始文件仍应保持只读；导出优先使用生成的 Blob 下载。直接写回原目录不是 M1/M2 的必要能力，还会增加权限及安全风险。

### IndexedDB / OPFS

- OPFS 是按 origin 隔离、用户不可见的存储，受浏览器 quota 管理；清除站点数据会删除 OPFS，不能假定它与普通用户文件一样可靠或易备份。[11]
- `FileSystemSyncAccessHandle` 适用于 OPFS 内的高性能同步读写，但只在 Dedicated Web Worker 中提供；Worker 负责计算时也避免同步 I/O 阻塞 UI。[12] 主线程可用异步 File System API，元数据/事务索引可放 IndexedDB，大 Blob/派生文件可放 OPFS。
- `navigator.storage.persist()` 只是请求持久存储，浏览器可以拒绝，返回 `false`；仍需 quota 检查、空间不足错误和“重新导入/重建缓存”路径。[13] 不应将 OPFS 宣称为永久的原始数据仓库。
- **语义降级必须明示**：Managed import 可近似为“用户授权后复制到 origin 私有空间”，但 Linked import 的路径保密、长期原路径引用、文件身份复核、跨刷新自动重读不再普遍成立。后端基于临时目录加原子 rename 的 Scene/缓存提交也不能直接映射为 OPFS 多文件写入；需 IndexedDB 事务中的版本化 manifest/提交标记、写入完成校验和崩溃恢复。多标签页并发及 quota eviction 需专门设计。
- 修改 GitHub Pages 路径或 origin 会改变存储边界，旧工作区可能不可见。部署方案应固定 origin/base，并提供工作区导出/迁移设计；本次未验证任何迁移实现。

## Worker、WASM、格式与数值计算

### 推荐架构（待 PoC）

UI 主线程只管理交互和 Three.js；Worker 持有解码器、数组、点云与 KNN。使用 Transferable `ArrayBuffer` 或流式读取传递数据，避免结构化克隆产生额外大副本。Worker 官方模型是独立线程，不能直接操作 DOM，主线程与 Worker 通过消息通信。[14][15]

Pyodide 官方文档支持在 Web Worker 中运行，且默认 MEMFS 是内存文件系统，刷新即丢失；持久化须另选文件系统。[15][16] 因而不能把现有 `pathlib.Path`/`np.memmap` 的本地文件行为当成浏览器中的零成本等价能力。PoC 应比较 File/Blob 分片读入、WorkerFS/自定义读取、MEMFS 和 OPFS 的实际副本数量及峰值内存。

### 格式结论

| 格式/能力      | 判断与边界                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PNG/JPEG/WebP  | 浏览器原生图片解码可作为常规路径；仍需验证 dtype、ICC、EXIF orientation、alpha 和当前诊断的一致性。                                                                                                                                                                                              |
| TIFF / BigTIFF | **不能承诺原生浏览器支持**。当前 RGB 经 Pillow，浮点/多通道深度还经 tifffile；浏览器 TIFF 解码器或 Pillow/tifffile WASM 必须逐项验证 classic TIFF 与 BigTIFF、endian、tile/strip、压缩、integer/float、多页/多通道。压缩或超深 TIFF 可能在解码后远超原文件大小。BigTIFF 的浏览器实现本次未验证。 |
| NPY            | NumPy 官方 NPY 格式是持久化任意 shape/dtype 数组的二进制格式；应验证 magic/version、header、fortran order、dtype/endian，并继续禁止 object dtype。[17][18] 浏览器端直接解析可避免 wheel，但需独立实现合同。                                                                                      |
| NPZ            | NumPy 将其定义为 ZIP 内多个 `.npy`，`allow_pickle=False` 是当前安全边界。[18] 浏览器方案须限制成员数、声明/实际解压大小、路径与压缩炸弹；大压缩成员不能先无界展开到内存。                                                                                                                        |
| PFM            | 当前项目已自行解析 magic、尺寸、scale/endian、float32 payload 并上下翻转；可用 DataView/TypedArray 在 Worker 移植，执行现有黄金测试。无需引入完整图片框架。                                                                                                                                      |
| RAW/BIN        | 已有显式 shape、dtype、endianness 和长度校验，可用 TypedArray/DataView 读取；Python `np.dtype` 的完整别名/字节序集合是否被新实现覆盖仍需测试。                                                                                                                                                   |
| KNN / KD-tree  | SciPy `cKDTree.query` 是现有权威行为。[19] Pyodide PoC 可优先复用以减少差异；独立 TS/WASM KD-tree 是备选而非现成等价替代，必须验证 k=1、重复点、自身排除、等距 tie、NaN/Inf、稳定排序及浮点距离。不能只比较“近似最近邻”结果。                                                                    |

依赖说明：Pyodide 官方文档区分 `micropip.install()`（纯 Python wheel 以及 Pyodide/Emscripten wasm32 wheel）和 `pyodide.loadPackage()`。[17] 因此普通 PyPI 上有 wheel 不等于其原生扩展可在浏览器运行。

本次额外从 Pyodide 官方包列表和 CDN 锁文件核验了候选依赖：稳定文档列出 NumPy、SciPy、Pillow、Pydantic 和 PyYAML；固定版本 `v0.29.3` 的锁文件列出 NumPy 2.2.5、SciPy 1.14.1、Pillow 11.3.0、Pydantic 2.12.5、PyYAML 6.0.2，但未列出 `tifffile` 与 `rfc8785`。[21][22] PyPI 官方元数据则确认 `rfc8785 0.1.4` 提供 `py3-none-any` wheel，可作为 micropip 候选。[23] `tifffile` 是另一个待核验的格式依赖，不能把可导入等同于 BigTIFF 等全部格式已兼容。

固定版本的资源长度（`pyodide.asm.wasm`、`python_stdlib.zip`、NumPy、SciPy/OpenBLAS、Pillow、Pydantic/core 和 PyYAML）合计约 **32 MB**，尚不含运行时 JS、其他小依赖、`rfc8785` 和 `tifffile`；这是下载体量估算，不是压缩后网络流量、峰值内存或完整首屏成本的实测。[22][24] 应懒加载计算 Worker，不阻塞基础页面。所有 Python 包和 Pyodide 版本必须锁定并一起测试。

长期可选方案是逐步将热路径迁移到 TypeScript/Rust/C++ WASM，以减少 Python 运行时下载和内存开销；这会引入格式、排序、浮点和导出字节一致性维护成本，不是短期低风险替换。

## 建议的最小 PoC 验收门槛

以下均是**待验证项**，不是已完成结果：

1. 锁定 Pyodide 与全部 wheel，证明 NumPy/SciPy/Pillow/tifffile 及 schema/canonical JSON 所需依赖在 Worker 可加载；失败时记录需替换的模块，不把 Pyodide 作为整体否决或整体通过。
2. 在 Chromium、Firefox、Safari 当前目标版本跑普通导入与重新选择文件降级；File System Access、OPFS 持久化和同步句柄按实际能力启用。
3. 用现有 fixtures 和新增经典 TIFF/BigTIFF、压缩 NPZ、非 little-endian、fortran-order NPY 等样本，与 Python 后端比较 shape/dtype/诊断、Scene hash、PLY/JSON 和点云结果。
4. 在受支持的桌面和移动设备测量冷启动下载、初始化、解码、KNN、UI 响应、峰值内存和崩溃点。特别避免“File -> ArrayBuffer -> MEMFS -> NumPy copy -> JS copy”叠加；2 GiB 文件上限绝不作为首版 Pages 承诺。
5. 测试 quota 不足、清除站点数据、刷新/崩溃中断、多标签页、重复点/等距 KNN 和无效输入；证明缓存损坏只会导致重建，不会误用派生结果。
6. 在真实项目 Pages URL 验证 base、直接刷新、Worker/WASM/wheel 加载、CSP、MIME、缓存更新和离线/失败提示。Pyodide 包若从 CDN 加载，还要记录第三方网络依赖；自托管则计入 Pages 构建体积和更新流程。

建议 PoC 通过后再确定默认实现。若格式/KNN 兼容性通过但大文件内存不达标，应缩小纯前端支持范围，而不是隐性降低检查或返回部分结果；若完整本地能力必须保留，则保留桌面/CLI 后端版本。

## 来源（均访问于 2026-10-25）

1. GitHub Docs, _What is GitHub Pages?_（静态托管、项目站 URL）：https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
2. GitHub Docs, _GitHub Pages limits_（发布大小、部署、带宽、构建及使用限制）：https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
3. GitHub Docs, _Creating a custom 404 page for your GitHub Pages site_（仅证明自定义 404，不等同 SPA rewrite）：https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site
4. Vite, _Deploying a Static Site_（GitHub Pages 和 base 设置）：https://vite.dev/guide/static-deploy.html
5. Vite, _Shared Options: base_：https://vite.dev/config/shared-options.html#base
6. Vite, _Env Variables and Modes_（`import.meta.env.BASE_URL`）：https://vite.dev/guide/env-and-mode.html
7. W3C, _File API_（用户选择、Blob 分片、读取及安全考虑）：https://w3c.github.io/FileAPI/
8. WICG, _File System Access_（picker、handle、权限和用户激活）：https://wicg.github.io/file-system-access/
9. MDN, _File System API_（安全上下文、设备文件系统与 OPFS）：https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
10. MDN, _Window.showOpenFilePicker()_（Limited availability、安全上下文、用户激活）：https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker
11. MDN, _Origin private file system_（origin 私有、quota、站点数据删除、Worker）：https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
12. MDN, _FileSystemSyncAccessHandle_（Dedicated Worker、OPFS）：https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle
13. MDN, _StorageManager.persist()_（浏览器可拒绝持久化请求）：https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
14. MDN, _Worker_（Worker 消息模型）：https://developer.mozilla.org/en-US/docs/Web/API/Worker
15. Pyodide, _Using Pyodide in a web worker_（独立线程、不能直接操作 DOM）：https://pyodide.org/en/stable/usage/webworker.html
16. Pyodide, _Dealing with the file system_（MEMFS、IDBFS、原生文件系统挂载限制）：https://pyodide.org/en/stable/usage/file-system.html
17. Pyodide, _Loading packages_（micropip、纯 Python 与 wasm32 wheel）：https://pyodide.org/en/stable/usage/loading-packages.html
18. NumPy, _`numpy.lib.format` / NPY format_：https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html
19. NumPy, _`numpy.load`_（NPY/NPZ、`allow_pickle=False`）：https://numpy.org/doc/stable/reference/generated/numpy.load.html
20. SciPy, _`scipy.spatial.cKDTree`_：https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.cKDTree.html
21. Pyodide, _Packages built in Pyodide_：https://pyodide.org/en/stable/usage/packages-in-pyodide.html
22. Pyodide `v0.29.3` 官方锁文件与版本化 CDN 包（版本及 wheel/zip 资源长度）：https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide-lock.json
23. PyPI 官方 `rfc8785` JSON 元数据（0.1.4 的纯 Python wheel）：https://pypi.org/pypi/rfc8785/json
24. Pyodide `v0.29.3` 核心 WASM 与标准库：https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.asm.wasm 、https://cdn.jsdelivr.net/pyodide/v0.29.3/full/python_stdlib.zip

MDN 用于 Web API 的兼容性与安全说明，不作为特定浏览器版本覆盖的保证。兼容矩阵和 Pyodide 实际行为仍须由 PoC 验证。
