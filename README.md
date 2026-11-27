<p align="center"><img src="icon.png" alt="DSH-SYNC" width="128"></p>

<h1 align="center">DSH-SYNC</h1>

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%E2%89%A50.2.2--rc.5-6366F1" alt="DSH">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" alt="License">
</p>

DSH-SYNC 是 DeepSeek Harness 的插件同步插件：把本机第三方插件清单（安装来源、确切版本、启用状态）通过 WebDAV 或 Git 在多台机器间对齐，逐条比对、按需安装与升级，而不是整份 `package.json` 覆盖。

## 功能

- **逐条同步**：同步单位是一条插件记录（名称 + 精确版本 + 来源 + 启用态），两侧比对后归类为安装、升级、启用、停用或冲突。
- **三种方向**：仅上传、仅下载、双向备份（并集），每个连接目标独立保存。
- **按需安装**：缺失项默认勾选，升级与启停手动选择；自动安装默认关闭，只装缺失项。
- **两种传输**：WebDAV（服务器地址 + 文件目录，目录按输入原样保存）与 Git（仓库 + 分支，HTTPS 令牌或 SSH）。
- **两个视图**：「同步」页每个范围一张卡片，绿=成功、红=失败、黄=待处理；「连接」页管理传输与参数。
- **配置备份**：每次同步前把本机插件配置存成时间点快照，远端存到 `backup/plugins/<时间>/`，界面可浏览并整份还原。
- **Agent 工具**：`dsh_plugin_sync` 与界面共用同一套校验。

## 快速开始

需要 DSH `0.2.2-rc.5` 以上（`<0.3.0`）和 Node.js 22+。在「插件 → 添加插件」中安装本仓库目录，然后打开「设置 → DSH-SYNC」。

1. **连接**：选 WebDAV 或 Git，保存并测试；WebDAV 的文件目录按输入原样保存，`/tool/dsh-sync` 与 `tool/dsh-sync` 指向同一目录。Git 建议使用私有仓库。
2. **方向**：在「同步」页选择仅上传、仅下载或双向。
3. **同步**：先「显示差异」查看结果，再同步发布本机变更；勾选远端变更后应用。计划 10 分钟内有效。

## 备份与还原

同步的第一步是备份当前本机配置，不是先写远端：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 会连同导出的 `plugins.json`（插件名、精确版本、来源、启用态）一起打包。

- **远端布局**：`<连接目录>/backup/plugins/<YYYYMMDD-HHMMSS>/`，同目录的 `index.json` 记录每份快照的文件、字节数与 sha256。WebDAV 与 Git 是同一套路径，Git 模式下这些文件落在仓库分支上，和清单共用提交历史。
- **保留份数**：连接页的「远端备份保留数量」就是快照份数（0–50）。调小只裁掉多出来的旧快照；设为 0 时只留本机副本，不写远端。
- **本机副本**：`<DSH profile>/.dsh-sync/backups/` 保留最近 10 份，远端不可用时也能还原。
- **还原**：同步页的「备份」卡片列出远端与仅本机的快照，选一份确认后按快照里的插件清单一台一台装回、启用或停用；快照里没有的插件保持现状，不卸载。还原前会先给当前状态拍一份安全快照，所以还原本身也能撤回。
- **失败即停**：备份失败时同步直接中止，远端清单不会先被改写一半。

## 计划

目前只做了插件同步和插件配置备份。Skill 配置、DSH 设置、MCP 配置和模型配置在「同步」页已有预留卡片，但尚未开放同步，不会自动参与。

## 开发

```bash
npm test            # Host 核心、规划、Git 与 WebDAV 边界
npm run smoke       # 用 React stub 渲染设置页，抓会让面板变白的崩溃
npm pack --dry-run  # 检查发布内容
```

## 许可证

[Apache-2.0](LICENSE)
