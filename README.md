# 狗狗与咪咪的爱心日程表 V4 Cloud

-- V4.4：新增“毛孩子小屋”
-- 这是增量迁移。请在 Supabase SQL Editor 中完整执行一次。
-- 不会删除已有的日程、日记、愿望、承诺或回忆。

-- V4.3：新增“相互的承诺”与承诺回顾
-- 这是增量迁移。已经上线的项目只需要在 Supabase SQL Editor 中执行一次本文件。
-- 不要删除或重建原有表；现有日程、日记、愿望和回忆不会受影响。

这是正式的双人云端版本。它保留之前确定的五个模块，并把本地 `localStorage` 改成了 Supabase 云数据库。

## 已实现

- 两个人分别注册、登录和退出
- 一人创建“双人空间”，另一人通过 8 位邀请码加入
- 狗狗 / 咪咪角色绑定
- 今日小窝、爱心日程、每日日记、愿望清单、我们的回忆五个真正独立的桌面端页面
- 点击左侧导航后立即切换页面，同时更新 URL，例如 `?page=schedule`
- 按日期查看内容；每一天的数据完全独立
- 日程、共享留言、心情日记、回应、愿望和回忆写入云端
- 狗狗和咪咪只能修改自己的任务完成状态
- 两个人完成同一事项后，数据库自动生成共同回忆
- 愿望达到“已经完成”后，数据库自动生成共同回忆
- Supabase Realtime 实时监听：一方修改后，另一方页面自动更新
- Row Level Security：只有属于同一个双人空间的两位成员可以读取共享数据
- 日记支持“共享”或“仅自己可见”
- Vercel 部署配置

## 技术结构

- 前端：Vite + 原生 JavaScript
- 登录与数据库：Supabase Auth + PostgreSQL
- 权限：Supabase Row Level Security
- 实时同步：Supabase Realtime / Postgres Changes
- 部署：Vercel

## 第一步：创建 Supabase 项目

1. 登录 Supabase，新建一个项目。
2. 打开 **SQL Editor**。
3. 打开本项目中的：

   `supabase/migrations/202607110001_initial_schema.sql`

4. 复制全部 SQL，在 SQL Editor 中运行一次。

这个脚本会创建：

- `profiles`
- `couples`
- `couple_members`
- `daily_notes`
- `daily_entries`
- `tasks`
- `responses`
- `wishes`
- `memories`

同时会创建情侣邀请码函数、自动回忆触发器、RLS 权限策略和 Realtime publication。

## 第二步：获取前端连接信息

在 Supabase 项目设置中找到：

- Project URL
- Publishable Key

不要把 `service_role`、Secret Key 或数据库密码写入前端。

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

填写：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

`.env` 已被 `.gitignore` 排除，不会被提交到 GitHub。

## 第三步：本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

Vite 会显示本地地址，通常是：

```text
http://localhost:5173
```

## 第四步：配置 Supabase 登录回调

在 Supabase Dashboard 中打开：

**Authentication → URL Configuration**

开发阶段加入：

```text
http://localhost:5173
```

部署后，把正式 Vercel 地址设为 Site URL，并加入 Redirect URLs，例如：

```text
https://your-project.vercel.app
```

否则注册确认邮件可能跳回错误地址。

## 第五步：部署到 Vercel

推荐先把这个文件夹推送到一个 GitHub 仓库，然后：

1. 在 Vercel 中选择 **New Project**。
2. 导入该 GitHub 仓库。
3. Vercel 会自动识别 Vite。
4. 在项目的 **Settings → Environment Variables** 添加：

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

5. 两个变量都应用到 Production 和 Preview。
6. 点击部署或重新部署。

`vercel.json` 已配置单页应用回退，因此刷新 `?page=schedule` 等页面仍能打开。

## 两个人如何开始使用

1. 第一个人注册并登录。
2. 点击“创建新的线上小窝”，选择狗狗或咪咪。
3. 左侧会显示 8 位邀请码。
4. 把邀请码发给另一人。
5. 另一人用自己的邮箱注册并登录。
6. 点击“加入对方创建的空间”，输入邀请码并选择另一个角色。
7. 从此以后，两边读取和修改的是同一个云端空间。

## 安全说明

- Publishable Key 本来就是给浏览器使用的；安全边界由 RLS 控制。
- 不要在前端放入 `service_role`、Secret Key 或数据库密码。
- 所有共享表都启用了 RLS。
- 日记标记为 `private` 时，只有作者自己的账号能够读取。
- 邀请码只用于首次绑定；加入后读取数据仍需要登录和成员身份。

## 当前未包含

- 照片上传与相册
- 浏览器推送通知
- 忘记密码页面
- 解除绑定 / 更换情侣空间
- 管理员后台

这些功能适合在下一阶段继续加入。照片建议使用 Supabase Storage，并单独配置私有 bucket 与访问策略。

## 构建检查

```bash
npm run build
```

正式部署时必须设置两个 `VITE_` 环境变量。没有设置时，网页会显示配置说明页，而不会错误地连接到未知数据库。
