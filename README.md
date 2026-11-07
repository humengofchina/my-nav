# Nav-Cloudflare 个人导航站 (Cloudflare Pages + KV 专版)

本项目是基于 Vue 3 前端 + Cloudflare Pages Functions 后端 + Cloudflare KV 数据库构建的现代化个人导航站。

本目录已完成**生产环境编译打包与精简**，删除了所有庞大的本地开发环境与测试依赖（无 `node_modules`、无 `workerd.exe`），总大小仅约 **400KB**，包含 10 余个文件，专为 **Cloudflare Pages 直接上传部署（Direct Upload）** 设计。

---

## 📦 目录文件结构

```
nav-cloudflare/
├── assets/                     # 编译打包好的前端静态脚本与样式 (CSS / JS)
├── functions/                  # Cloudflare Pages Functions 边缘服务
│   ├── api/
│   │   └── [[route]].js        # API 路由引擎 (处理 /api/* 所有接口)
│   ├── uploads/
│   │   └── [[filename]].js    # 上传文件边缘服务 (直接读取 KV 图片返回)
│   └── seedData.js             # 默认数据种子 (首次启动自动导入 KV)
├── _routes.json                # Pages 路由优化 (静态资源直连 CDN，接口走 Functions)
├── background.webp             # 默认高清壁纸
├── default-favicon.png         # 默认网站图标
├── index.html                  # 编译好的首页入口
├── robots.txt                  # 爬虫配置文件
└── README.md                   # 部署使用说明
```

> **注意**：上层目录已为您打包好了 **`nav-cloudflare.zip`**（大小仅 419KB），可直接在 Cloudflare 控制台上传！

---

## 🚀 Cloudflare Pages 网页端极速部署教程 (只需 3 分钟)

### 步骤 1：创建 Cloudflare KV 命名空间
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 在左侧菜单点击 **Compute (Workers) -> KV**（部分界面为 **Workers 和 Pages -> KV**）。
3. 点击 **创建命名空间 (Create namespace)**。
4. 命名空间名称输入：`nav_kv`，点击 **添加 (Add)** 保存。

---

### 步骤 2：直接上传部署压缩包
1. 在 Cloudflare 控制台左侧菜单点击 **Workers 和 Pages**。
2. 点击右上角的 **创建 (Create)** 按钮。
3. 选择 **Pages** 标签页，点击 **直接上传 (Direct Upload)**。
4. 输入项目名称（例如 `my-nav`），点击 **创建项目 (Create project)**。
5. **上传文件**：
   - 将生成的 **`nav-cloudflare.zip`** 直接拖拽到上传区域，或者解压后拖拽整个 `nav-cloudflare` 文件夹上传。
   - 文件数量仅 10 余个，大小仅约 400KB，数秒内即可上传完成。
6. 点击 **部署站点 (Deploy site)**。

---

### 步骤 3：绑定 KV 数据库（至关重要）
部署完成后，还需要将 Pages 项目与步骤 1 创建的 KV 命名空间关联：
1. 点击进入刚才创建的 Pages 项目主页。
2. 切换到 **设置 (Settings)** -> **函数 (Functions)**。
3. 向下滚动找到 **KV 命名空间绑定 (KV namespace bindings)**，点击 **添加绑定 (Add binding)**：
   - **变量名称 (Variable name)**：必须填入 `NAV_KV`
   - **KV 命名空间 (KV namespace)**：选择步骤 1 中创建的 `nav_kv`
4. 点击 **保存 (Save)**。
5. *(可选安全配置)* 在 **设置 (Settings)** -> **环境变量 (Environment variables)** 中可配置管理员账号密码：
   - `ADMIN_USERNAME`: 自定义用户名（默认 `admin`）
   - `ADMIN_PASSWORD`: 自定义密码（默认 `123456`）
   - `JWT_SECRET`: 自定义 JWT 密钥
6. 绑定完成后，进入 **部署 (Deployments)** 选项卡，在最新部署右侧点击三点菜单选择 **重试部署 (Retry deployment)**，使 KV 绑定生效。

---

### 步骤 4：打开并使用导航站
1. 点击 Pages 分配的 `*.pages.dev` 域名即可直接访问。
2. **自动初始化**：系统检测到新绑定的空 KV，会自动导入 6 个主栏目、7 个子栏目、60+ 张常用卡片和默认管理员。
3. 访问 `https://<你的域名>/admin` 即可进入后台管理系统：
   - **默认账号**：`admin`
   - **默认密码**：`123456`
4. 登录后可进入 **用户管理** 修改管理员密码，并可在此随时一键导出全站 JSON 备份。
