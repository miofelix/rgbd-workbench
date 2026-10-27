# Contributing

先阅读 [开发与贡献](docs/development.md)、[架构](docs/architecture/system-design.md)、[格式规范](docs/architecture/data-formats.md) 与 [GLOSSARY](GLOSSARY.md)。

## 提交前

```bash
npm ci
npm run check
npx playwright install chromium firefox webkit
npm run test:e2e
npm audit --audit-level=high
```

公共合同、几何算法、持久化、视频/Archive 的变更必须带测试和对应文档。不得把不可用的 codec、未验证浏览器、未运行性能基准描述为已通过。

不提交 `workspace/`、真实用户数据、私有 Archive、构建产物、测试截图或凭证。历史输出不应覆盖，公共 Schema 不应存在第二份手写模型。
