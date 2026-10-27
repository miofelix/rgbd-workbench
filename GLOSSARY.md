# RGB-D Workbench Glossary

RGB-D Workbench 是用于检查单帧 RGB-D 数据、生成确定性点云及导出分析结果的领域。本文只定义领域语言，不规定技术实现。

## Language

### Scene and source

**Source**:
由用户显式提供的一对 RGB 与深度输入，以及可选的几何声明文档。Source 的内容在导入后不可变。
_Avoid_: 上传、服务器文件、Linked source、任意路径

**Scene**:
一组不可变 Source 与经用户确认的深度、相机、对齐和坐标语义所形成的完整分析对象。它是点云派生、测量和导出的上下文。
_Avoid_: Project、Workspace、上传任务

**Geometry Contract**:
Scene 中决定二维检查、相对点云或米制点云是否有效的显式语义集合，包括深度表示、单位、有效值、相机模型、对齐和坐标约定。
_Avoid_: 自动推断、格式配置、设备配置

**Capability**:
由 Scene 的 Geometry Contract 与诊断共同决定的可执行分析能力；输入可读取不代表具备点云或米制测量能力。
_Avoid_: 文件支持、按钮权限

### Derivation and views

**ProcessingSpec**:
应用于 Scene 的点云处理参数，包括像素采样、深度和 XYZ 裁剪、体素、点数预算及邻域处理。其完整快照参与派生身份计算。
_Avoid_: 表单状态、视图参数

**Derivation**:
由确定的 Scene、ProcessingSpec 和处理器版本生成的不可变点云结果及其描述信息；是测量和导出的唯一几何来源。
_Avoid_: 预览点云、缓存文件、Applied Scene

**ViewSpec**:
只影响画布呈现的投影、着色、点大小和背景设置，不改变 Derivation 的身份或导出几何。
_Avoid_: ProcessingSpec、渲染合同

**Applied Derivation**:
用户当前确认用于查看、测量和导出的 Derivation；尚未应用的处理参数草稿不属于它。
_Avoid_: 当前 Scene、服务器派生

**Measurement**:
基于 Applied Derivation 中源相机坐标和代表像素进行的点坐标或两点距离结果；其单位继承 Derivation，不能由无单位数据推断米制尺度。
_Avoid_: 屏幕距离、估算深度

### Diagnostic and formats

**Diagnostic**:
具有稳定代码、严重级别和可选能力的用户可读结论；它描述输入、语义、资源或处理结果的可信度，而不是未分类异常。
_Avoid_: API error、日志、堆栈

**Source Archive**:
用于用户备份或迁移的自包含文件集合，包含原始输入、不可变 Scene 和确定性结果，不包含浏览器私有路径、句柄、缓存索引或运行时状态。
_Avoid_: 工作区目录、数据库导出、缓存包
