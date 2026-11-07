# Nav-Cloudflare 个人导航站 (Cloudflare Pages + KV 专版)

本项目是基于 Vue 3 前端 + Cloudflare Pages Functions 后端 + Cloudflare KV 数据库构建的现代化个人导航站。

本目录已完成**生产环境编译打包与精简**，删除了所有庞大的本地开发环境与测试依赖（无 `node_modules`、无 `workerd.exe`），总大小仅约 **430KB**，包含 10 余个纯净文件，专为 **Cloudflare Pages** 生产部署设计。

---

## ✨ 新增功能特性

- 🎨 **后台页面与背景设置**：
  - 后台管理侧边栏新增【站点设置】模块。
  - **背景图片自定义**：支持直接上传本地图片（JPG/PNG/WEBP，自动存入 Cloudflare KV 并边缘加速），支持填入外部图片链接，提供一键重置为系统默认背景。
  - **底部版权与超链接自定义**：支持修改首页底部的“版权前缀文本”（如 `Copyright © 2025 ... | `）、“超链接显示文本”（如 `Powered by eooce`）以及“点击跳转的目标链接 URL”，并在后台提供即时样式预览，所有配置自动持久化至 Cloudflare KV。
- 🛡️ **严格的响应类型防御**：
  - 前端各组件均配备 `Array.isArray()` 类型校验与错误兜底，彻底杜绝数据异常时界面错乱。

---

## 📦 目录文件结构

```
nav-cloudflare/
├── assets/                     # 编译打包好的前端静态脚本与样式 (CSS / JS)
├── functions/                  # Cloudflare Pages Functions 边缘服务
│   ├── api/
│   │   └── [[route]].js        # API 路由引擎 (包含 /api/settings 等所有接口)
│   ├── uploads/
│   │   └── [[filename]].js    # 上传文件边缘服务 (直接读取 KV 图片并缓存)
│   └── seedData.js             # 默认数据种子 (含菜单、卡片及站点默认设置)
├── background.webp             # 默认高清壁纸
├── default-favicon.png         # 默认网站图标
├── index.html                  # 编译好的首页入口
├── robots.txt                  # 爬虫配置文件
└── README.md                   # 部署使用说明
```

> **提示**：根目录下已为您同步生成了最新版的 **`nav-cloudflare.zip`**（大小仅 431KB）。

---

## 🚀 部署指南 (让 Functions 与 KV 生效)

由于 Cloudflare 官方限制，网页控制台直接上传 ZIP 仅支持纯静态网页，不支持编译运行 Functions。推荐以下两种官方部署方案：

### 方案 A：通过 GitHub 关联部署（⭐ 最推荐、零命令、最省心）
1. 在 GitHub 上新建一个仓库（例如 `my-nav`）。
2. 将 **`nav-cloudflare`** 文件夹内的所有文件上传/推送到该仓库。
3. 进入 [Cloudflare 控制台](https://dash.cloudflare.com/) -> **Workers 和 Pages** -> **创建** -> **Pages** -> **Connect to Git**。
4. 选择你的 GitHub 仓库：
   - **Framework preset**：选择 `None`
   - **Build command**：留空
   - **Build output directory**：填 `.`（或留空）
5. 点击 **Save and Deploy** 完成部署。
6. 进入该项目的 **Settings** -> **Functions** -> **KV namespace bindings**：
   - 添加绑定，变量名必须为：`NAV_KV`，选择你的 KV 命名空间（如 `nav_kv`）。
7. 在 **Deployments** 选项卡点击最新部署右侧的 **Retry deployment**（重试部署）使 KV 绑定生效。

### 方案 B：使用命令行一键部署（无需 GitHub）
在当前电脑的终端运行：
```bash
npx wrangler pages deploy "c:\Users\Macho Meng\Documents\data\Gemini\nav\nav-cloudflare" --project-name=huiandmeng
```

---

## 🔑 后台登录与配置修改

- **访问地址**：`https://<你的Pages域名>/`
- **后台管理**：`https://<你的Pages域名>/admin`
- **默认用户名**：`admin`
- **默认密码**：`123456`
- **修改底部与背景**：登录后点击左侧菜单【站点设置】，即可上传背景图、修改底部文字与跳转超链接，点击【保存所有设置】即可实时同步至 Cloudflare KV。
