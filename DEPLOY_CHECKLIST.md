# 上线检查清单

## Supabase

- [ ] 已创建 Supabase 项目
- [ ] 已执行 `supabase/migrations/202607110001_initial_schema.sql`
- [ ] Authentication 中已启用 Email 登录
- [ ] Site URL 已改成正式 Vercel 地址
- [ ] Redirect URLs 已加入本地和正式地址
- [ ] Table Editor 中能看到 9 张业务表
- [ ] Realtime publication 中包含 daily_notes、daily_entries、tasks、responses、wishes、memories

## Vercel

- [ ] 已连接 GitHub 仓库
- [ ] 已添加 `VITE_SUPABASE_URL`
- [ ] 已添加 `VITE_SUPABASE_PUBLISHABLE_KEY`
- [ ] 添加环境变量后已重新部署
- [ ] `npm run build` 成功

## 双人测试

- [ ] 使用两个不同邮箱注册
- [ ] 第一个账号创建小窝并复制邀请码
- [ ] 第二个账号成功加入且选择另一个角色
- [ ] 两边都能看到同一个事项
- [ ] 狗狗只能修改狗狗的完成状态
- [ ] 咪咪只能修改咪咪的完成状态
- [ ] 双方完成后回忆自动出现
- [ ] 一边写留言，另一边无需刷新即可看到
- [ ] 私密日记不会显示给对方
