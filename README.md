# aicode-plugins

AiCode 插件源码集合。每个插件一个子目录，通过本仓库的 GitHub Release 发布可直接安装的插件包。

| 插件 | 目录 | 插件 ID | 安装包资产名 |
| --- | --- | --- | --- |
| AiCode 桌宠 | `dsh-pet/` | `wxichen.dsh-pet` | `wxichen.dsh-pet_<version>.zip` |

## 构建

每个插件都是独立的 TypeScript + Vue 项目，在插件目录内构建：

```bash
cd dsh-pet
npm install
npm run typecheck
npm run build       # 产出 dist/main.js 与 pages/
npm test            # 端到端测试
```

构建产物 `dist/` 与 `pages/` 不入库，由打包步骤生成。

## 发布

1. 更新插件目录下 `plugin.json` 与 `package.json` 的 `version`；
2. 构建并跑测试；
3. 只把 `plugin.json dist pages schemas assets` 打进 zip（zip 根目录直接是 `plugin.json`）；
4. 把产物重命名为 `{插件ID}_{版本}.zip`，作为 Release 资产上传；
5. 在 `AiCode-Plugins-Store` 的 `index.json` 更新该插件条目，`name` 与 `description` 需与 `plugin.json` 逐字一致。

资产名必须是 `{插件ID}_{版本}.zip`，否则 AiCode 插件商店按索引查找时会报「未找到插件资产」。
只推送代码而不发 Release，商店不会提示更新。

## 许可

MIT。

- 桌宠美术与动画素材来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。
- 桌宠插件内的音乐搜索与账号登录，接口约定参考自 [umr-xiaomai/kgka_Music_hl](https://github.com/umr-xiaomai/kgka_Music_hl)，
  为独立实现（未复制其源码）；默认接口地址是该项目的公开服务 `https://music.api.hoilai.cn`，可在插件设置里改为自建地址。
  使用前请自行确认该服务的可用性与使用条款。
