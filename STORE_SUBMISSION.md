# Chrome Web Store Submission Checklist

## 已在代码中落实

- 最小化必需 `host_permissions`
- GitLab 域名改为运行时域名授权，不在必需 `host_permissions` 中写死特定 GitLab 域名
- 移除 `tabs` 常驻权限，仅保留 `activeTab`
- 增加首次审查前的数据传输披露确认
- 敏感凭证仅保存在当前浏览器会话
- 修正文案中不准确的“加密 / 永不触网 / 物理抹除”描述
- 移除调试残留

## 你仍需要手动准备

- Chrome Web Store 上架描述
- 隐私政策 URL
- 支持邮箱
- 至少 1 张 logo、1 张截图，最好 3~5 张
- 如有官网，补充官网 URL

## 商店页文案建议必须明确说明

- 扩展会读取用户指定仓库的 Diff
- Diff 会被发送到用户选择的 AI 服务商 API 生成审查结果
- GitHub / GitLab Token 与 AI API Key 由用户自行提供
- 敏感凭证仅保存在当前浏览器会话，不会上传到开发者自有服务器

## 隐私政策至少要覆盖

- 处理哪些数据
- 数据发送给哪些第三方服务商
- 敏感凭证如何存储
- 开发者是否自建服务器
- 用户如何清空本地数据

## 提审前自查

- `npm run build`
- 确认打包产物中没有 `debugger`
- 确认商店截图与实际 UI 一致
- 确认商店描述与扩展内披露一致
