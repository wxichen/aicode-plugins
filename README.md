# aicode-plugins

AiCode 插件源码集合。每个插件一个子目录，通过本仓库的 GitHub Release 发布可直接安装的插件包。

| 插件 | 目录 | 插件 ID | 安装包资产名 |
| --- | --- | --- | --- |
| AiCode 桌宠 | `dsh-pet/` | `wxichen.dsh-pet` | `wxichen.dsh-pet_<version>.zip` |

## 构建

桌宠插件使用 AiCode 仓库的共享插件工具链（TypeScript + Vue）：

```bash
# 在 AiCode 仓库根目录执行
npm --prefix plugins install
npm --prefix plugins run build:plugins -- --plugin dsh-pet
```

构建产物 `dsh-pet/dist/main.js` 与 `dsh-pet/pages/` 由 Release 打包产生，不入库。

## 发布

1. 更新 `dsh-pet/plugin.json` 的 `version`；
2. 在 AiCode 仓库执行 `python3 scripts/package-plugins.py wxichen.dsh-pet`；
3. 把产物重命名为 `wxichen.dsh-pet_<version>.zip`，作为 Release 资产上传。

资产名必须是 `{插件ID}_{版本}.zip`，否则 AiCode 插件商店按索引查找时会报「未找到插件资产」。

## 许可

MIT。桌宠美术与动画素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。
