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
- **两种传输**：WebDAV（服务器地址 + 文件目录）与 Git（仓库 + 分支，HTTPS 令牌或 SSH）。
- **两个视图**：「同步」页每个范围一张卡片，绿=成功、红=失败、黄=待处理；「连接」页管理传输与参数。
- **Agent 工具**：`dsh_plugin_sync` 与界面共用同一套校验。

## 快速开始

需要 DSH `0.2.2-rc.5` 以上（`<0.3.0`）和 Node.js 22+。在「插件 → 添加插件」中安装本仓库目录，然后打开「设置 → DSH-SYNC」。

1. **连接**：选 WebDAV 或 Git，保存并测试；Git 建议使用私有仓库。
2. **方向**：在「同步」页选择仅上传、仅下载或双向。
3. **同步**：先「显示差异」查看结果，再同步发布本机变更；勾选远端变更后应用。计划 10 分钟内有效。

## 计划

目前只做了同步插件。Skill 配置、DSH 设置、MCP 配置和模型配置在「同步」页已有预留卡片，但尚未开放同步，不会自动参与。

## 开发

```bash
npm test            # Host 核心、规划、Git 与 WebDAV 边界
npm run smoke       # 用 React stub 渲染设置页，抓会让面板变白的崩溃
npm pack --dry-run  # 检查发布内容
```

## 许可证

[Apache-2.0](LICENSE)
