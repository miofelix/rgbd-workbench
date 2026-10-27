# 第三方运行时依赖与许可证

本文件记录**直接运行时依赖**。传递依赖由 `package-lock.json` 固定；其完整许可证保留在 npm 包和构建工具链中。项目自身保持私有，不因使用这些依赖而自动声明开源许可证。

| 依赖              | 版本（调研时） | 用途                      | 许可证 / 来源                                        |
| ----------------- | -------------- | ------------------------- | ---------------------------------------------------- |
| canonicalize      | 5.1.0          | RFC 8785 JCS              | Apache-2.0 · https://github.com/erdtman/canonicalize |
| fast-png          | 8.0.0          | RGB/深度 PNG、帧序列      | MIT · https://github.com/image-js/fast-png           |
| fflate            | 0.8.3          | NPZ/ZIP/Archive           | MIT · https://github.com/101arrowz/fflate            |
| geotiff           | 3.0.5          | TIFF/BigTIFF 解码         | MIT · https://github.com/geotiffjs/geotiff.js        |
| idb               | 8.0.4          | IndexedDB                 | ISC · https://github.com/jakearchibald/idb           |
| lucide-react      | 0.468.0        | 工具图标                  | ISC · https://github.com/lucide-icons/lucide         |
| mediabunny        | 1.62.1         | WebCodecs MP4/WebM 封装   | MPL-2.0 · https://github.com/Vanilagy/mediabunny     |
| react / react-dom | 19.x           | UI                        | MIT · https://github.com/facebook/react              |
| three             | 0.180.0        | WebGL 预览                | MIT · https://github.com/mrdoob/three.js             |
| yaml              | 2.9.1          | 安全 YAML 解析            | ISC · https://github.com/eemeli/yaml                 |
| zod               | 4.6.7          | 运行时 Schema/JSON Schema | MIT · https://github.com/colinhacks/zod              |
| zustand           | 5.x            | UI 状态                   | MIT · https://github.com/pmndrs/zustand              |

Mediabunny 的源文件使用 MPL-2.0。当前项目通过未修改 npm 包使用它；若后续修改其源文件，需保留相应文件的许可证和修改说明，并履行 MPL-2.0 文件级义务。此说明不将项目自研代码重新许可为 MPL。

依赖更新需运行 `npm audit`、完整测试与许可证复核。不得将不知许可证或 UNLICENSED 的包加入运行时。
