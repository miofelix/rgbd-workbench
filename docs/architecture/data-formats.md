# RGB-D Workbench 数据与内容规范

- 规范版本：2.0
- 适用范围：纯浏览器领域对象、Worker、私有存储和导出
- 兼容性：不兼容旧 v1/CLI workspace；未知版本拒绝，不猜测迁移

## 1. 内容分层

| 类别           | 权威与规则                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Domain object  | TypeScript + Zod 严格 Schema；Scene、ProcessingSpec、Derivation、CameraPath、RenderSpec、Diagnostic。 |
| Worker message | `kind`、`operationId`、进度/结果/失败；不是 HTTP 或 Domain manifest。                                 |
| Storage record | IndexedDB 私有记录，ArrayBuffer + mediaType；不能直接当公共导出。                                     |
| Export file    | PLY、参数 JSON、PNG、视频/PNG 序列、Source Archive；自包含且可验证。                                  |

禁止用 `SceneSummary`、`ProbeResponse` 等 HTTP 遗留概念代替这些对象。

## 2. JSON 与身份

- UTF-8 JSON，无 NaN/Infinity/undefined；公共字段 lower camelCase。
- 公共对象含 `format: "rgbd-workbench/<kind>"` 与 `schemaVersion: 2`。
- `sceneId` 为 UUID，仅库内标识；`source.sha256` 是原始字节 SHA-256；`derivationKey` 为 Scene/ProcessingSpec/processor 的 SHA-256。
- 坐标固定 `[x,y,z]`，尺寸固定 `[height,width]`，ROI 为 `[xMin,yMin,xMax,yMax)`。
- 时间仅用于元数据，UTC RFC 3339；不进入几何 hash。
- RFC 8785 JCS 规范化后计算 SHA-256。Scene canonical 内容仅 Source、Geometry Contract、frame、坐标约定、normalizer/decoder 版本，不含 sceneId、名称、旧 sceneHash、诊断、UI 或缓存。
- `derivationKey = SHA256(JCS({format,schemaVersion,sceneHash,processing,processorVersion}))`。

## 3. 领域合同

### Scene / Geometry Contract

`SourceDescriptor` 记录 role、显示名、byteLength、sha256、尺寸、dataType、encoding，不含路径、句柄或 locator。

Geometry Contract 包含：深度表示/单位/尺度/无效值/范围、pinhole 内参/尺寸/校正、registered_to_rgb 或未知对齐、RAW descriptor。无 manifest 的估计内参必须显式确认，不能作为标定事实。

`z_depth` 使用 m/mm/scaleToMeter，`relative_z` 使用 unitless。能力至少包括 image_inspection、relative_pointcloud、metric_pointcloud、trajectory、video_export。尺寸、对齐、校正和有效内参不满足时禁止三维，不自动 resize。

### ProcessingSpec / Derivation

处理顺序：能力检查 → 有效性/单位 → ROI/stride → 深度过滤/反投影 → XYZ 裁剪 → 体素 → 点数预算 → KNN filter → KNN smooth → bounds/manifest。

点顺序为源像素行主序；positions 为 float32，colors 为 uint8，sourcePixelIndex 为 uint32。体素保留最小代表像素，KNN 按距离/索引稳定排序。ViewSpec 不影响 Derivation。

### CameraPath / RenderSpec

CameraPath 包含 samplerVersion、unit、frameId、targetSource、预设/自定义参数、duration、easing、projection、loopMode、keyframes。自定义首尾时间必须覆盖 duration 且严格递增；loop 校验姿态和切线连续性。

RenderSpec 包含 layout、宽高、fps、codec、质量、背景、pointSize、antiAlias、colorMode、colorMap、colorRange、maxPoints、overlays。视频宽高为偶数，资源预算由 Schema 约束。

### ExportJob / Diagnostic

任务状态：queued → running → succeeded/failed/cancelling → cancelled；页面/Worker 中断将 running/cancelling 视为 interrupted。导出冻结输入，取消不发布文件。

Diagnostic 包含稳定 code、severity、field、capability、messageKey 和安全 params；不向用户暴露绝对路径、源内容或堆栈。

## 4. Worker protocol

请求：`prepare | derive | video | cancel`。响应：`prepared | derived | video | progress | failure`。

`operationId` 关联请求/响应，主线程 revision 防止过期 UI 更新。大数组使用 Transferable ArrayBuffer/typed-array descriptor，不使用 base64。取消终止 Worker，后续操作惰性重建；成功结果到达后也需校验协议。

## 5. 私有存储

- `scenes`：key sceneId，Scene、预览和创建时间。
- `sources`：key `sceneId:role`，ArrayBuffer、mediaType、hash。
- `derivations`：key `sceneId:derivationKey`，Scene/hash 与 ArrayBuffer payload。

hash/编码在事务外完成，事务只同步读写。Source 完整性失败为硬错误；缓存协议/内容损坏删除并重建。Archive 恢复时重新分配 sceneId，派生 manifest 重绑定，Scene hash 不变。

## 6. 导出

### Point-cloud binary v2

```text
"RGBDPC2\0"        8 bytes
headerByteLength  uint32 LE, 4 bytes
header            canonical UTF-8 JSON
padding           zero to align 4
positions         float32 LE [N,3]
colors            uint8 [N,3], padded to 4-byte boundary
sourcePixelIndex  uint32 LE [N]
```

Descriptor 使用 dataType/shape/byteOffset/byteLength，offset 相对整个 buffer。检查范围、乘法、重叠、padding 和总长；key/Scene hash 不一致拒绝。

### PLY / 参数 JSON / PNG

PLY 为 binary little endian，属性 `x y z red green blue source_pixel_index`，记录 frame/unit/representation/sceneHash/derivationKey。unitless 不写成 meters。

参数 JSON 为完整 DerivationManifest。PNG 是交互画布截图，不是权威几何；权威几何在 PLY/JSON/CPU 帧中。

### 视频 / PNG 序列

视频支持取决于 WebCodecs probe：MP4/H.264 或 WebM/VP9。固定 N 帧、时长 N/fps，mediabunny 封装。视频与 ExportManifest sidecar 用时间戳 ZIP 发布，不覆盖历史输出。

PNG 序列使用六位帧名，ZIP 包含 `frames/000000.png…`、CameraPath、RenderSpec 和 ExportManifest。Manifest 的 artifact hash 针对有序 PNG 帧内容清单，不包含自指 ZIP hash。

### Source Archive

`.rgbd.zip` 至少包含：

```text
archive.json                  # format/version、sceneId、sceneSha256、条目 byteLength/hash
scene.json
sources/rgb
sources/depth
manifests/source              # 用户 manifest，可选
derivations/<key>.bin         # 可选派生
```

Archive 不包含浏览器私有路径、句柄、IndexedDB 事务或 Worker 状态。导入检查 ZIP 路径/预算、Schema、源 hash、Scene hash、派生身份；重分配 sceneId 并重绑定派生。

## 7. 输入格式

- RGB PNG/JPEG/WebP/TIFF → 连续 uint8 RGB；方向/alpha/ICC 不得被用于偷偷改变深度几何。
- Depth PNG：8/16-bit 单通道，保留 16-bit 数值；TIFF 按注册的 sample format/dtype。
- NPY：2D 数值、magic/version/dtype/endianness、C-order、禁止 object/pickle。
- NPZ：单选定数组，路径/成员/解压预算检查。
- PFM：单通道 Pf、scale/endian、float32 payload、上下翻转。
- RAW/BIN：显式 shape/dataType/endianness 与精确长度。
- JSON/YAML：安全解析、根 object、大小限制；YAML 不实例化对象。

扩展名只选择候选解码器，不决定单位、内参或对齐。格式兼容按 fixture 与真实浏览器验收，不以 accept 列表代替支持。

## 8. 变更检查

- [ ] 更新 GLOSSARY、本文和 ADR（如有必要）。
- [ ] 修改唯一 Zod Schema，运行 `npm run schemas`。
- [ ] 更新 fixtures、正/反例、版本/magic、golden vectors。
- [ ] 明确 sceneHash/derivationKey/processor/sampler/storage 版本影响。
- [ ] 验证损坏、溢出、未知版本、中断、缓存归属和取消。
- [ ] 更新 README、开发说明、E2E 和 Pages 验收。
