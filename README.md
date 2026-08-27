# dsh-cost-lite

DeepSeek Harness 会话费用统计插件——**dsh-cost-meter 的精简 fork**。

原版功能"贪全"(预算、Go 额度、7 家 Coding Plan、自定义 Provider 余额、11 个设置面板、双语大文案),本 fork 只保留你真正用到的三块:

- **官方账户余额** —— 左下角余额卡片,点击打开费用浮层
- **当日费用** —— 左下角当日消耗 + 概览卡片(今日/本月/累计)
- **会话费用** —— 用量页:Token 用量热图、按天历史、会话费用排行
- **峰谷计价时段** —— 橙蓝条按真实峰谷窗口(北京时间)绘制,标记线跟随当前时刻;峰/谷切换前弹窗提醒

## 裁剪说明(相对 dsh-cost-meter v1.5.44)

| 项 | 状态 |
|---|---|
| 设置面板「费用」分节 | 移除 → 改为左下角余额卡片点击打开的**自绘浮层**(概览/用量/价格三页) |
| 预算功能 | 移除 |
| OpenCode Go 额度 | 移除 |
| Coding Plan 额度(7 家) | 移除 |
| 自定义 Provider 余额 | 移除 |
| 设置页「额度」「显示」分节 | 移除 |
| 安装前历史导入 | 移除(历史回填/清洗逻辑一并移除) |
| 会话费用徽章(输入区/标题栏) | 保留(position 配置:输入区下方 / 标题栏 / 关闭) |
| 价格表(人民币/美元)+ 官方同步 | 保留 |
| 中英双语 | 保留 |

host 侧 `backfill.js` / `coding-plans.js` / `custom-balance.js` 已删除,`costMeter` 服务只保留
`getState / updateConfig / fetchPrices / refreshBalance / resetHistory / getDaySessions / getTopSessions`。

## 配置

费用浮层内可配:

- **官方余额查询**:读取「设置 → 模型」中配置的 DeepSeek API Key(与模型请求同一把 Key),
  或 `DEEPSEEK_API_KEY` 环境变量;仅发往官方端点 `api.deepseek.com`。余额刷新按钮在浮层「概览」页。
- **价格币种**:价格页选人民币(¥)/ 美元($);「同步官方价格」抓取对应官方定价页(中文页为人民币价)。
- **峰谷**:价格页峰谷面板启用/关闭、样式(简洁/经典)、切换前弹窗提醒(位置/提前量/类型)。
- **会话费用位置**:浮层内不提供,直接编辑账本配置或保留默认(输入区下方);如需要可手动改 `ledger.json` 的 `position` 字段(`dock` / `header` / `off`)。

## 安装

```bash
dsh plugin --profile web add ~/file/dsh/plugin/dsh-cost-lite
```

替换原 dsh-cost-meter(两者都记账会重复计费):

```bash
dsh plugin --profile web remove dsh-cost-meter
```

然后重启 DSH。客户端改动按 Ctrl+Shift+R 刷新页面。

## 数据

账本仍写 `$DSH_HOME/storages/cost-meter/ledger.json`(与原版共用,历史记录无缝保留)。
卸载插件不会删除账本。

## 许可

MIT。上游 dsh-cost-meter © 2026 dsh-cost-meter contributors。
