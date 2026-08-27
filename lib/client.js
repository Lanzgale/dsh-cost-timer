/**
 * dsh-cost-lite 浏览器端 bundle(单文件,经 __ModuleLoader__ 加载)。
 * dsh-cost-meter 的精简 fork:预算、Go/Coding Plan/自定义余额额度、设置页
 * 「额度/显示」分节已裁剪。
 *
 * 提供三个界面:
 *  - conversation.composer.dock / conversation.session.header.actions:本会话费用;
 *  - sidebar.footer.action:左下角合并卡片(余额+今日 / 今日本会话 / 峰谷时间条),
 *    整卡点击打开费用浮层;
 *  - 费用浮层(CostOverlay):单页展示——汇总卡片、官方余额、用量热图、历史、会话排行
 *    (概览与用量合并,无页面标签;价格页已裁剪)。
 *
 * 数据通道:
 *  - costUsage 会话投影(useProjection)+ 客户端价格表 → 本会话费用;
 *  - remote.costMeter.*(Typert RPC)→ 账本快照、配置、官方价格同步。
 * 样式全部使用 --dsw-* 主题变量,跟随全局亮/暗主题。
 */

window.__ModuleLoader__.load({
  id: 'dsh-cost-lite',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    // Token 用量统计的显示位置切换(通用设置 / 独立分节)暂时隐藏:仅固定显示在「费用」设置分节内。
    // 恢复三位置切换时改回 true 即可(下拉框、通用设置注入与独立分节注册都会随之恢复)。
    const USAGE_POSITION_SWITCHABLE = false

    // ── 样式 ────────────────────────────────────────────────────────────────

    const css = [
      '/* dsh-cost-lite: 会话费用徽章与费用浮层 */',
      '.cm-root{display:block;text-align:center;max-width:var(--dsh-chat-content-width,720px);width:100%;margin:0 auto;box-sizing:border-box;padding:4px calc(var(--dsh-composer-side-clearance,0px) + 16px) 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-chip{display:inline-flex;align-items:center;gap:4px;max-width:180px;padding:0 8px;height:22px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:22px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-foot{display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}',
      '.cm-foot:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-foot-rail{width:100%;justify-content:center;padding:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-foot-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-num{font-variant-numeric:tabular-nums}',
      '.cm-go-rail{font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary)}',
      '.cm-go-list{display:flex;flex-direction:column;gap:10px}',
      '.cm-go-row{display:flex;align-items:center;gap:8px;font-size:12px}',
      '.cm-go-label{flex:none;width:88px;color:var(--dsw-alias-label-secondary)}',
      '.cm-go-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}',
      '.cm-go-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}',
      '.cm-go-num{flex:none;min-width:44px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}',
      '.cm-go-reset{flex:none;max-width:230px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-go-time{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-go-row.main .cm-go-label{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-corner{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;width:100%;max-width:var(--dsh-chat-content-width,720px);margin:2px auto 0;box-sizing:border-box;padding:0 calc(var(--dsh-composer-side-clearance,0px) + 16px)}',
      '.cm-corner-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.cm-corner-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-corner-chip.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-corner-chip.over{color:var(--dsw-alias-state-error-primary)}',
      // 输入框上方额度横条(issue #31 后续):横排 chips,每片 = 短标签 + 迷你进度条 + 百分比;
      // 可点击刷新(issue #52):action 态带手型/焦点环,厂商多窗口融合为段(.cm-qseg 竖线分隔)。
      '.cm-qstrip{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;width:100%;max-width:var(--dsh-chat-content-width,720px);margin:0 auto;box-sizing:border-box;padding:0 calc(var(--dsh-composer-side-clearance,0px) + 16px)}',
      '.cm-qchip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:22px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums;cursor:default}',
      '.cm-qchip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-qchip .cm-qlabel{color:var(--dsw-alias-label-primary);font-weight:600}',
      // display:block:qbar 不是 flex 容器,内部 qfill 默认 inline,行内盒宽高被忽略导致填充永远不可见(issue #52)。
      '.cm-qchip .cm-qbar{display:block;width:44px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;flex:none}',
      '.cm-qchip .cm-qfill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-ok-primary,#3ba272)}',
      '.cm-qchip .cm-qseg{display:inline-flex;align-items:center;gap:4px}',
      '.cm-qchip .cm-qsep{width:1px;height:12px;background:var(--dsw-alias-border-l1);flex:none}',
      '.cm-qchip .cm-qtext{color:var(--dsw-alias-label-secondary)}',
      '.cm-qchip.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-qchip.warn .cm-qfill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-qchip.over{color:var(--dsw-alias-state-error-primary)}',
      '.cm-qchip.over .cm-qfill{background:var(--dsw-alias-state-error-primary)}',
      '.cm-qchip.action{cursor:pointer;user-select:none;outline:none}',
      '.cm-qchip.action:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}',
      '.cm-qchip.action:active{transform:translateY(0.5px)}',
      // 首次更新引导:非模态小卡片,固定屏幕顶部居中,选择后消失。
      '.cm-qguide{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:9999;max-width:440px;width:calc(100% - 32px);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;font-size:13px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:8px}',
      '.cm-qguide h4{margin:0;font-size:13px;font-weight:600}',
      '.cm-qguide p{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.cm-qguide .cm-buttons{display:flex;gap:8px;justify-content:flex-end}',
      '.cm-section{display:flex;flex-direction:column;gap:20px;padding:4px 2px 24px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cm-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}',
      '.cm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);text-align:center}',
      '.cm-card-title{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0 0 8px}',
      '.cm-card-value{font-size:20px;line-height:28px;font-weight:600}',
      '.cm-card-sub{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:8px}',
      '.cm-card-line{font-size:11px;color:var(--dsw-alias-label-tertiary);margin:0;text-align:center;line-height:1.6}',
      '.cm-h{font-size:13px;font-weight:600;margin:0}',
      // 可折叠分节:常规三角展开按钮(caret 三角形,展开朝下/收起朝右)。
      '.cm-collapse-h{display:flex;align-items:center;gap:8px;background:none;border:none;padding:0;margin:0;cursor:pointer;color:inherit;font:inherit;text-align:left}',
      '.cm-collapse-h:hover .cm-h{color:var(--dsw-alias-interactive-text-hover,var(--dsw-alias-label-primary))}',
      '.cm-caret{flex:none;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--dsw-alias-label-secondary);transform:rotate(-90deg);transition:transform .15s ease}',
      '.cm-caret.open{transform:rotate(0)}',
      '.cm-collapse-body{display:flex;flex-direction:column;gap:12px;margin-top:12px}',
      // 顶栏:界面语言等即时可见项,右对齐。
      '.cm-toolbar{display:flex;justify-content:flex-end;align-items:center;gap:10px}',
      '.cm-toolbar .cm-field{flex-direction:row;align-items:center;gap:8px}',
      '.cm-toolbar .cm-field label{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-toolbar .cm-input{min-width:150px;padding:4px 10px}',
      // 设置页标签栏(issue #29):左侧分组标签,右侧常驻自动保存状态。
      '.cm-tabs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--dsh-alias-border-l1);padding-bottom:10px}',
      '.cm-tabs{display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
      '.cm-tab{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;white-space:nowrap}',
      '.cm-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-tab.active{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);font-weight:600}',
      '.cm-tabs-row .cm-msg{padding:2px 10px}',
      '.cm-note{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0}',
      '.cm-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.cm-table th,.cm-table td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.cm-table th{color:var(--dsw-alias-label-tertiary);font-weight:500}',
      '.cm-table td.num,.cm-table th.num{text-align:right;font-variant-numeric:tabular-nums}',
      '.cm-table tr:last-child td{border-bottom:none}',
      '.cm-table tr.cm-row-click{cursor:pointer}',
      '.cm-table tr.cm-row-click:hover td{background:var(--dsw-alias-bg-hover,rgba(127,127,127,.08))}',
      // 会话单元格:标题为主行(超出省略),会话 ID 为辅行(可选显示,等宽淡化)。
      '.cm-sess-title{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cm-sess-id{font-size:11px;font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary)}',
      '.cm-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:8px 0}',
      '.cm-scroll{max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}',
      '.cm-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:12px}',
      '.cm-field{display:flex;flex-direction:column;gap:6px}',
      '.cm-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.cm-input{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;outline:none}',
      '.cm-input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-input.narrow{max-width:120px}',
      '.cm-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.cm-price-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.cm-price-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-price-name{font-weight:600;font-size:13px}',
      '.cm-price-legacy{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px}',
      '.cm-price-row{display:grid;grid-template-columns:52px 1fr 1fr 1fr;gap:8px;align-items:center}',
      '.cm-price-row span{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-price-row input{width:100%}',
      '.cm-buttons{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
      '.cm-btn{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 14px;cursor:pointer}',
      '.cm-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-btn.primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}',
      '.cm-btn.primary:hover{opacity:0.88;background:var(--dsw-alias-state-business-primary)}',
      '.cm-btn.danger{color:var(--dsw-alias-state-error-primary)}',
      '.cm-btn.small{padding:3px 10px;font-size:12px}',
      '.cm-msg{font-size:12px;line-height:18px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1)}',
      '.cm-msg.ok{color:var(--dsw-alias-state-success-primary)}',
      '.cm-msg.err{color:var(--dsw-alias-state-error-primary)}',
      '.cm-msg.warn{color:var(--dsw-alias-state-warning-primary,#d97706)}',
      '.cm-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-budget{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}',
      '.cm-peak-alert{position:fixed;z-index:9999;width:340px;max-width:calc(100vw - 32px);padding:16px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 36px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:8px;font-size:12px;animation:cm-peak-alert-in .22s cubic-bezier(.2,.8,.2,1)}',
      '.cm-peak-alert.cm-peak-alert-corner{right:20px;bottom:20px}',
      '.cm-peak-alert.cm-peak-alert-center{top:50%;left:50%;transform:translate(-50%,-50%);animation-name:cm-peak-alert-in-center}',
      '.cm-peak-alert-peak{border-top:3px solid var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-alert-offpeak{border-top:3px solid var(--dsw-alias-state-info-primary,#3b82f6)}',
      '.cm-peak-alert-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase}',
      '.cm-peak-alert-badge::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 16%,transparent)}',
      '.cm-peak-alert-peak .cm-peak-alert-badge{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-alert-offpeak .cm-peak-alert-badge{color:var(--dsw-alias-state-info-primary,#3b82f6)}',
      '.cm-peak-alert-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-peak-alert-body{color:var(--dsw-alias-label-secondary);line-height:1.55}',
      '.cm-peak-alert-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}',
      '.cm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '@keyframes cm-peak-alert-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes cm-peak-alert-in-center{from{opacity:0;transform:translate(-50%,calc(-50% + 10px))}to{opacity:1;transform:translate(-50%,-50%)}}',
      '.cm-budget-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-budget-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.cm-budget-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}',
      '.cm-budget-fill.warn{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-budget-fill.over{background:var(--dsw-alias-state-error-primary)}',
      '.cm-ug{display:flex;flex-direction:column;gap:12px}',
      '.cm-ug-total{font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cm-ug-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,auto);gap:3px;width:100%}',
      '.cm-ug-cell{width:100%;aspect-ratio:1/1;border-radius:3px;box-sizing:border-box;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border:1px solid var(--dsw-alias-border-l1)}',
      '.cm-ug-cell.l1{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 25%,var(--dsw-alias-bg-layer-3));border-color:transparent}',
      '.cm-ug-cell.l2{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 50%,var(--dsw-alias-bg-layer-3));border-color:transparent}',
      '.cm-ug-cell.l3{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 75%,var(--dsw-alias-bg-layer-3));border-color:transparent}',
      '.cm-ug-cell.l4{background:var(--dsw-alias-state-business-primary);border-color:transparent}',
      '.cm-ug-cell.today{outline:1px solid var(--dsw-alias-label-secondary);outline-offset:1px}',
      '.cm-ug-months{display:grid;grid-auto-flow:column;gap:3px;width:100%;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
      '.cm-ug-monthc{white-space:nowrap}',
      '.cm-budget-line{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.cm-budget-line.over{color:var(--dsw-alias-state-error-primary)}',
      '.cm-peak-strip{display:flex;align-items:center;gap:6px;margin-top:4px;min-width:0}',
      '.cm-peak-track{position:relative;display:flex;flex:1;height:6px;min-width:0;border-radius:999px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-segment{position:absolute;top:0;bottom:0;height:100%}',
      '.cm-peak-high{background:#ff9800}',
      '.cm-peak-low{background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-marker{position:absolute;top:0;left:50%;width:2px;height:100%;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 1px var(--dsw-alias-label-tertiary);transform:translateX(-50%);transition:left .4s ease;z-index:2}',
      '.cm-peak-chip{font-size:11px;font-weight:600;line-height:1.2;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-peak-strip.peak .cm-peak-chip{color:#ff9800}',
      '.cm-peak-strip.off .cm-peak-chip{color:var(--dsw-alias-state-business-primary)}',
      // 周末全谷价(周六/周日全天按谷价):绿色系标识省钱档。
      '.cm-peak-strip.weekend .cm-peak-chip{color:#34a853}',
      '.cm-peak-classic{position:relative;display:flex;flex-direction:column;gap:5px;margin-top:6px;min-width:0}',
      '.cm-peak-classic .cm-peak-track{flex:none;height:8px}',
      '.cm-peak-classic-marker{position:absolute;top:0;left:50%;width:4px;height:12px;background:var(--dsw-alias-bg-base);border:1.5px solid #ff9800;box-shadow:0 0 0 1px var(--dsw-alias-bg-base),0 0 0 2px var(--dsw-alias-label-tertiary);transform:translateX(-50%);transition:left .4s ease;z-index:2;border-radius:2px}',
      '.cm-peak-classic-marker::after{content:"";position:absolute;top:-7px;left:50%;transform:translateX(-50%);border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #ff9800}',
      '.cm-peak-classic.off .cm-peak-classic-marker{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-classic.off .cm-peak-classic-marker::after{border-top-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-classic-chip{align-self:flex-start;font-size:11px;font-weight:600;line-height:1.4;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-peak-classic.peak .cm-peak-classic-chip{color:#ff9800}',
      '.cm-peak-classic.off .cm-peak-classic-chip{color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-classic.weekend .cm-peak-classic-chip{color:#34a853}',
      '.cm-peak-classic.weekend .cm-peak-classic-marker{border-color:#34a853}',
      '.cm-peak-classic.weekend .cm-peak-classic-marker::after{border-top-color:#34a853}',
      '.cm-peak-rail{display:flex;flex-direction:column;align-items:center;gap:3px;width:40px;box-sizing:border-box}',
      '.cm-peak-rail-track{position:relative;display:flex;flex-direction:column;width:6px;height:56px;border-radius:999px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail-segment{position:absolute;left:0;right:0;width:100%}',
      '.cm-peak-rail-high{background:#ff9800}',
      '.cm-peak-rail-low{background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail-marker{position:absolute;left:0;top:50%;width:100%;height:2px;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 1px var(--dsw-alias-label-tertiary);transform:translateY(-50%);transition:top .4s ease;z-index:2}',
      '.cm-peak-rail-label{font-size:10px;font-weight:600;line-height:1.2;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-peak-rail.peak .cm-peak-rail-label{color:#ff9800}',
      '.cm-peak-rail.off .cm-peak-rail-label{color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail.weekend .cm-peak-rail-label{color:#34a853}',
      '.cm-peak-rail-classic{display:flex;flex-direction:column;align-items:center;gap:3px;width:40px;box-sizing:border-box}',
      '.cm-peak-rail-classic-track{position:relative;display:flex;flex-direction:column;width:14px;height:56px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-state-business-primary);overflow:hidden}',
      '.cm-peak-rail-classic-segment{position:absolute;left:0;right:0;width:100%;overflow:hidden}',
      '.cm-peak-rail-classic-segment.peak{background:#ff9800;border-radius:999px}',
      '.cm-peak-rail-classic-segment.off{background:var(--dsw-alias-state-business-primary);border-radius:0 0 999px 999px}',
      '.cm-peak-rail-classic-marker{position:absolute;left:50%;top:50%;width:12px;height:4px;background:var(--dsw-alias-bg-base);border:1.5px solid #ff9800;box-shadow:0 0 0 1px var(--dsw-alias-bg-base),0 0 0 2px var(--dsw-alias-label-tertiary);transform:translate(-50%,-50%);transition:top .4s ease;z-index:2;border-radius:2px}',
      '.cm-peak-rail-classic.off .cm-peak-rail-classic-marker{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail-classic-label{font-size:10px;font-weight:600;line-height:1.2;white-space:nowrap}',
      '.cm-peak-rail-classic.peak .cm-peak-rail-classic-label{color:#ff9800}',
      '.cm-peak-rail-classic.off .cm-peak-rail-classic-label{color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail-classic.weekend .cm-peak-rail-classic-marker{border-color:#34a853}',
      '.cm-peak-rail-classic.weekend .cm-peak-rail-classic-label{color:#34a853}',
      '.cm-grid-group{grid-column:1 / -1;margin-top:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:4px}',
      '.cm-grid-group:first-child{margin-top:0}',
      '.cm-peak-preview{margin-top:8px}',
      '.cm-toggle-btn{background:none;border:none;padding:0;font-size:12px;font-weight:600;color:var(--dsw-alias-state-business-primary);cursor:pointer}',
      '.cm-toggle-btn:hover{text-decoration:underline}',
      '.cm-collapsed-note{margin-top:4px}',
      '.cm-catalog-vendor{margin-top:10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:2px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-vendor-toggle{cursor:pointer;user-select:none}',
      '.cm-vendor-toggle:hover{color:var(--dsw-alias-label-secondary)}',
      '.cm-vendor-display{display:inline-flex;align-items:center;gap:4px;font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.cm-catalog-family{margin:6px 0 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}',
      '.cm-catalog-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}',
      '.cm-catalog-mounted{display:flex;flex-direction:column;gap:4px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.cm-catalog-id{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cm-catalog-price{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-size:11px}',
      '.cm-catalog-tag{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);white-space:nowrap}',
      '.cm-mstats-tabs{display:flex;gap:8px;margin-bottom:8px}',
      '.cm-mstats-tab{background:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.cm-mstats-tab.active{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);font-weight:600}',
      '.cm-mstats-h{margin:10px 0 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.cm-mstats-row{display:grid;grid-template-columns:minmax(90px,170px) 1fr auto;gap:8px;align-items:center;font-size:11px;line-height:1.7}',
      '.cm-mstats-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-mstats-barbg{position:relative;height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;display:flex}',
      '.cm-mstats-bar{height:100%;min-width:0}',
      '.cm-mstats-bar.cost{background:#ff9800;border-radius:999px}',
      '.cm-mstats-bar.hit{background:#34a853;border-radius:999px}',
      '.cm-mstats-bar.value{background:#a142f4;border-radius:999px}',
      '.cm-mstats-seg{height:100%;min-width:0}',
      '.cm-mstats-seg.in{background:var(--dsw-alias-state-business-primary)}',
      '.cm-mstats-seg.cache{background:#ff9800}',
      '.cm-mstats-seg.out{background:#34a853}',
      '.cm-mstats-val{white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-mstats-legend{display:flex;gap:12px;font-size:10px;color:var(--dsw-alias-label-tertiary);margin:2px 0 4px}',
      '.cm-mstats-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px}',
      '.cm-mstats-note{margin-top:10px;font-size:10px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.cm-match-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;flex-wrap:wrap}',
      '.cm-match-row .cm-input{flex:1;min-width:160px}',
      '.cm-budget-controls{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:12px}',
      '.cm-bbox{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:148px;box-sizing:border-box}',
      '.cm-bbox.rail{padding:6px;min-width:0;width:40px;align-items:center;justify-content:center;border-radius:10px}',
      '.cm-bbox.warn{border-color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over{border-color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-bbox-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-bbox-pct{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-bbox.warn .cm-bbox-pct{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over .cm-bbox-pct{color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.cm-bbox-bar.segments{display:flex;height:8px}',
      '.cm-bbox-bar.segments .cm-bbox-fill{flex:none;border-radius:0;height:100%}',
      '.cm-bbox-bar.segments .cm-bbox-fill:first-child{border-radius:999px 0 0 999px}',
      '.cm-bbox-bar.segments .cm-bbox-seg-today{flex:none;height:100%;background:#ff9800}',
      '.cm-bbox-bar.segments .cm-bbox-seg-spent{flex:none;height:100%;background:var(--dsw-alias-interactive-bg-hover);border-radius:0 999px 999px 0}',
      '.cm-bbox-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}',
      '.cm-bbox-pct.cm-bal-amt{color:var(--dsw-alias-state-business-primary)}',
      '.cm-bbox.warn .cm-bbox-fill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over .cm-bbox-fill{background:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-line{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-bbox-rail{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-bbox.warn .cm-bbox-rail{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over .cm-bbox-rail{color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-pair{display:flex;flex-direction:column;gap:0;padding:2px 10px}',
      '.cm-bbox-pair .cm-bbox-section{display:flex;flex-direction:column;gap:4px;padding:4px 0}',
      '.cm-bbox-pair .cm-bbox-bar{height:4px}',
      '.cm-bbox-divider{height:1px;background:var(--dsw-alias-border-l1);margin:0}',
      '.cm-bbox-section.warn .cm-bbox-pct{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox-section.over .cm-bbox-pct{color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-section.warn .cm-bbox-fill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox-section.over .cm-bbox-fill{background:var(--dsw-alias-state-error-primary)}',
      // 点击立即刷新(issue #37):余额/额度图框可点击,刷新中呼吸闪烁。
      '.cm-bbox.clickable,.cm-foot.clickable{cursor:pointer}',
      '.cm-bbox.clickable:hover{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-bbox.clickable:focus-visible,.cm-foot.clickable:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '@keyframes cm-click-refresh-pulse{0%,100%{opacity:.55}50%{opacity:1}}',
      '.cm-bbox.clickable.busy,.cm-foot.clickable.busy{animation:cm-click-refresh-pulse 1.1s ease-in-out infinite}',
      '.cm-mm{padding:8px 10px;gap:4px}',
      '.cm-mm-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-mm-row{display:flex;align-items:center;gap:8px;padding:2px 0}',
      '.cm-mm-row .cm-bbox-label{flex:none;width:22px;font-weight:400;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.cm-mm-row .cm-bbox-bar{flex:1;min-width:0;height:6px}',
      '.cm-mm-row .cm-bbox-pct{flex:none;min-width:2.4em;text-align:right;font-variant-numeric:tabular-nums}',
      '.cm-mm-row.warn .cm-bbox-label,.cm-mm-row.warn .cm-bbox-pct{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-mm-row.over .cm-bbox-label,.cm-mm-row.over .cm-bbox-pct{color:var(--dsw-alias-state-error-primary)}',
      '.cm-mm-row.warn .cm-bbox-fill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-mm-row.over .cm-bbox-fill{background:var(--dsw-alias-state-error-primary)}',
      '.cm-mm-row.wide .cm-bbox-label{width:auto;max-width:64px;flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-mm-row.wide .cm-mm-text{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-bal-line{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.cm-bal-line.warn{color:var(--dsw-alias-state-warning-primary,#b45309)}',
      '.cm-bal-line.err,.cm-bal-err{color:var(--dsw-alias-state-error-primary)}',
      '.cm-footer-stack{display:flex;flex-direction:column;gap:6px;width:100%;align-items:stretch;box-sizing:border-box}',
      '.cm-footer-stack.rail{align-items:center}',
      '.cm-footer-stack .cm-bbox{width:100%;min-width:0}',
      '.cm-footer-stack .cm-foot{width:100%;box-sizing:border-box}',
      '.cm-foot.cm-click-overlay{cursor:pointer;border-radius:8px;padding:3px 6px;margin:-3px -6px;transition:background .12s ease}',
      '.cm-foot.cm-click-overlay:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      // 左下角合并卡片:余额+今日 / 今日本会话 / 峰谷时间条,整卡为点击入口。
      '.cm-foot-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;cursor:pointer;transition:border-color .12s ease,background .12s ease}',
      '.cm-foot-card:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-foot-card:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.cm-foot-card-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}',
      '.cm-foot-card-row .cm-foot-item{display:inline-flex;align-items:baseline;gap:4px;min-width:0}',
      '.cm-foot-card-row .cm-foot-label{color:var(--dsw-alias-label-tertiary);flex:none}',
      '.cm-foot-card-row .cm-num{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-foot-card.rail{width:46px;padding:6px 4px;align-items:center;border-radius:12px}',
      '.cm-foot-card.rail .cm-foot-card-row{flex-direction:column;align-items:center;gap:5px;justify-content:center}',
      // 起始余额条(行0):左→右 = 充值余额(浅灰)→ 赠送余额(DS 蓝)→ 今日已消费(深灰,右端);
      // 官方先扣赠送,故深灰段向左增长时先替换蓝色赠送段,再吃充值段。
      '.cm-foot-startbar{height:3px;border-radius:99px;background:rgba(232,232,237,.55);display:flex;overflow:hidden;flex:none;margin-top:1px}',
      '.cm-foot-startbar .cm-foot-startbar-paid{height:100%;background:transparent}',
      '.cm-foot-startbar .cm-foot-startbar-grant{height:100%;background:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.cm-foot-startbar .cm-foot-startbar-spent{height:100%;background:rgba(85,85,95,.8)}',
      // 手动刷新按钮(行2 右端;会话行隐藏时落在行1 右端)。
      '.cm-foot-refresh{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:auto;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;cursor:pointer;padding:0;transition:color .12s ease,border-color .12s ease}',
      '.cm-foot-refresh svg{width:12px;height:12px;fill:currentColor;display:block}',
      '.cm-foot-refresh:hover{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}',
      '.cm-foot-refresh:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.cm-foot-refresh.spin svg{animation:cm-foot-spin .6s linear infinite}',
      '@keyframes cm-foot-spin{to{transform:rotate(360deg)}}',
      // 浮窗底部数据操作区(居中)。
      '.cm-ops{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap}',
      // 时间条(展开态):轨道外包一层,marker 作兄弟元素,白色短线上下略微出头不被 overflow:hidden 裁掉。
      '.cm-peak-card{position:relative;height:8px;margin:1px 0;min-width:0}',
      '.cm-peak-card-track{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:6px;border-radius:999px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-card-marker{position:absolute;top:50%;left:50%;width:2px;height:12px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.28);transform:translate(-50%,-50%);border-radius:1px;transition:left .4s ease;z-index:2;pointer-events:none}',
      // 时间条(收起态):竖条同样外包,白色横线左右出头。
      '.cm-peak-card-rail{position:relative;width:8px;height:44px;margin:2px 0}',
      '.cm-peak-card-rail-track{position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);width:6px;border-radius:999px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-card-rail-marker{position:absolute;left:50%;top:50%;width:14px;height:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.28);transform:translate(-50%,-50%);border-radius:1px;transition:top .4s ease;z-index:2;pointer-events:none}',
      '.cm-overlay{z-index:1200;justify-content:center;align-items:flex-start;display:flex;position:fixed;inset:0;padding:48px 24px;box-sizing:border-box}',
      '.cm-overlay-mask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}',
      '.cm-overlay-panel{z-index:1;background:var(--dsw-alias-bg-layer-2);width:820px;max-width:calc(100vw - 48px);height:min(820px,100vh - 96px);border-radius:24px;box-shadow:var(--dsw-shadow-lv3);display:flex;flex-direction:column;overflow:hidden}',
      '.cm-overlay-header{flex:none;display:flex;justify-content:space-between;align-items:center;height:54px;padding:0 20px;border-bottom:1px solid var(--dsh-alias-border-l1);box-sizing:border-box}',
      '.cm-overlay-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-overlay-close{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center}',
      '.cm-overlay-close:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-overlay-body{flex:1;min-height:0;padding:20px 24px 28px;overflow-y:auto}',
      '@media (max-width:640px){.cm-cards{grid-template-columns:1fr}.cm-grid{grid-template-columns:1fr}.cm-budget-controls{grid-template-columns:1fr}}',
    ].join('\n')
    const cssTagId = 'dsh-cost-lite/client.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(cssTagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-cost-lite'
      tag.dataset.pluginCss = cssTagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ── 多语言(中/英) ──────────────────────────────────────────────────────

    /** 全部界面文案:zh / en。{var} 为插值占位。 */
    const MESSAGES = {
      zh: {
        // 会话徽章
        sessionCostTitle: '本会话费用(按每次调用实际时刻精确计费)',
        sessionToday: '今日当前会话',
        sessionDockNote: '当前会话的累计费用,随调用实时更新',
        sessionDetailTokens: '输入 {input} · 缓存 {cache} · 输出 {output}',
        sessionDetailCache: '缓存:读 {read} · 写 {write}(写入按命中价计费)',
        cost: '费用 {amount}',
        sessionLine: '本会话 {amount} · 输入 {input} · 缓存 {cache} · 输出 {output}',
        // 余额行
        balanceQueryFailed: '余额查询失败:{message}',
        unknownError: '未知错误',
        balance: '余额',
        queryFailed: '查询失败',
        balanceTitle: 'DeepSeek 开放平台账户余额',
        totalBalance: '总余额 {amount}',
        grantedToppedUp: '赠送 {granted} · 充值 {toppedUp}',
        updatedAt: '更新时间 {time}',
        // 预算图框
        usedOf: '已用 {used} / {amount}',
        budget: '预算',
        todayCostTitle: '今日费用(按官方价格精确计费)',
        cardInput: '输入 {input}',
        cardCache: '缓存 {cache}',
        cardOutput: '输出 {output}',
        cardCalls: '调用 {calls} 次',
        periodToday: '以北京时间（UTC+8）为准',
        periodMonth: '以最近30天计算',
        periodTotal: '自账本建立以来计算',
        monthCost: '本月 {amount}',
        totalCost: '累计 {amount}',
        today: '今日',
        // 周期
        periodDay: '今日',
        periodMonthly: '本月',
        periodAll: '累计',
        periodCustom: '自定义',
        periodCustomRange: '自定义区间',
        // 表格
        noHistory: '暂无数据。开始对话后,费用将按天汇总在这里。',
        colDate: '日期',
        colCalls: '调用',
        colInTok: '输入 tok',
        colCacheTok: '缓存 tok',
        colOutTok: '输出 tok',
        colCost: '费用',
        noSessionsToday: '今日暂无会话记录。',
        colSession: '会话',
        // 预算面板
        enableBudget: '启用预算',
        startDate: '开始日期',
        endDate: '结束日期(留空 = 今日)',
        rangeText: '统计区间:{range}',
        overLimit: '(已超出)',
        nearLimit: '(接近上限)',
        // 价格卡
        legacyModel: '旧模型',
        defaultFallback: '默认回退',
        remove: '移除',
        tierBase: '基础',
        tierOffPeak: '谷时',
        tierPeak: '峰时',
        close: '关闭',
        balanceBarRemaining: '余额 {amount}',
        balanceBarToday: '当日已用 {amount}',
        balanceBarSpent: '已用 {amount}',
        refreshCustomBalance: '刷新自定义余额',
        refreshGoQuota: '刷新额度',
        enableGoQuota: '启用 OpenCode Go 额度',
        codingPlansTitle: 'Coding Plan 额度',
        codingPlansNote: '按厂商查询 coding plan 订阅额度(各家独立开关与凭据)。凭据只发送到对应厂商的官方端点;Key 留空时按环境变量与 CLI 登录态自动发现。',
        codingPlansOpen: '展开 Coding Plan 额度配置',
        codingPlansCollapse: '折叠 Coding Plan 额度',
        codingPlansCollapsedHint: '默认收起;展开后可为各家启用、填 Key 并查询额度,展开/收起状态会被记住。',
        codingPlanAnthropic: 'Anthropic(Claude Pro/Max)',
        codingPlanZai: 'Z.ai / 智谱 GLM Coding Plan',
        codingPlanMinimax: 'MiniMax Token Plan',
        codingPlanMinimaxTitle: 'MiniMax Plan',
        codingPlanRemain5h: '5h',
        codingPlanRemain7d: '7d',
        enableCodingPlan: '启用额度查询',
        codingPlanDisplayLabel: '显示位置',
        codingPlanDisplayNote: '选「主页面侧边栏 / 两者」后,该厂商额度以图框卡片常驻侧边栏(与 Go 额度/余额同款,收起窄栏显示百分比)。',
        codingPlanKeyLabel: 'API Key(可选,留空自动发现)',
        codingPlanRefreshIntervalLabel: '刷新间隔(分钟)',
        refreshCodingPlan: '刷新',
        codingPlanDisabledNote: '未启用。开启后将按刷新间隔查询该厂商的 coding plan 额度并显示在这里。',
        goQuotaDisabledNote: '未启用额度。开启后将读取 OpenCode Go 订阅额度(滚动 5 小时 / 本周 / 本月)并显示在侧边栏图框、设置页与右下角;没有 Go 订阅时会在这里提示原因。',
        // 设置页
        ledgerReadFailed: '账本读取失败:{message}',
        readingLedger: '正在读取账本…',
        ledgerUnavailable: '账本不可用',
        syncFailed: '同步失败:{message}',
        historyCleared: '统计已归零。',
        clearFailed: '清除失败:{message}',
        peakOff: '峰谷计价已关闭,按基础价格计费',
        peakNotEffective: '尚未生效(生效时间:{time}),当前按基础价格计费',
        peakActive: '当前处于峰时段,按峰时价计费',
        peakNotice: '当前为 DeepSeek 峰时高价时段,按峰时价计费',
        offPeakActive: '当前处于谷时段,按谷时价计费',
        weekendAllOffPeak: '周末时段——全谷价(周六及周日全天按谷时价计费)',
        weekendChip: '周末时段——全谷价',
        weekendShort: '周末全谷',
        weekendRuleNote: '2026-08-23(周日)00:00 起,周末(周六及周日,北京时间)全天不再区分峰谷,统一按谷时价格计费;生效前的费用仍按原规则结算。',
        peakShort: '峰时',
        offPeakShort: '平价',
        peakStyleLabel: '峰谷时段条样式',
        peakStyleCompact: '简洁(单行紧凑)',
        peakStyleClassic: '经典(分段与胶囊芯片)',
        peakAlertLabel: '峰/谷切换前弹窗提醒',
        peakAlertAheadLabel: '提前提醒(分钟,1-30)',
        peakAlertTargetLabel: '提醒类型',
        peakAlertTargetPeak: '进入峰时',
        peakAlertTargetOffPeak: '进入谷时',
        peakAlertTargetBoth: '峰和谷',
        peakAlertTitlePeak: '即将进入峰时',
        peakAlertTitleOffPeak: '即将进入谷时',
        peakAlertBody: '约 {time} 后计费档位切换为{phase}价,请注意本时段调用成本。',
        peakAlertPhasePeak: '峰时',
        peakAlertPhaseOffPeak: '谷时',
        peakAlertBtn: '知道了',
        peakAlertBadgePeak: '峰价提醒',
        peakAlertBadgeOffPeak: '谷价提醒',
        peakAlertPositionLabel: '弹窗位置',
        peakAlertPositionCorner: '右下角',
        peakAlertPositionCenter: '屏幕中心',
        peakAlertWebNotifyLabel: '同步发送系统通知',
        peakAlertWebNotifyHint: '开关后请在浏览器地址栏允许通知权限,才能在页面最小化/切走时收到提醒。',
        peakAlertPreviewLabel: '预览弹窗',
        peakAlertPreviewPeak: '预览 进入峰',
        peakAlertPreviewOffPeak: '预览 进入谷',
        peakAlertPreviewTag: '(预览)',
        peakPanelTitle: '峰谷计价与提示',
        peakNoticeHiddenHint: '提示已隐藏:需启用峰谷计价并开启「峰时高价时段显著提示」。',
        catalogTitle: '拓展价格表',
        catalogNote: '内置各厂商、按模型家族分类的参考价格目录(只读)。挂载 = 把条目复制进上方可编辑价格表并参与计费;DeepSeek 模型可取消挂载(回退默认价,目录中仍可重新挂载)。',
        catalogOpen: '展开拓展价格表',
        catalogCollapse: '收起拓展价格表',
        mountBtn: '挂载',
        unmountBtn: '取消挂载',
        mountedTag: '已挂载',
        catalogUnpriced: '未核价',
        catalogDeepseekNote: 'DeepSeek 模型支持峰谷两档;取消挂载后按默认价计费且不再被自动匹配命中。',
        modelStatsTitle: '按模型统计(token 与费用)',
        modelStatsToday: '今日',
        modelStatsHistory: '近 90 天',
        modelStatsCostH: '费用排行',
        modelStatsTokensH: 'Token 消耗',
        modelStatsHitH: '缓存命中率',
        modelStatsValueH: '性价比 · 每美元 token 数',
        modelStatsInput: '输入',
        modelStatsCache: '缓存',
        modelStatsOutput: '输出',
        modelStatsEmpty: '该时段暂无用量数据。',
        modelStatsBlended: '综合单价 {price}/M',
        modelStatsNote: '口径:缓存命中率 = 缓存读 ÷ (缓存读 + 非缓存输入);综合单价 = 费用 ÷ 总 token × 1M(USD/M tokens);性价比 = 总 token ÷ 费用,越高越好;费用为账本按每次调用实际时刻计费的美元值。',
        modelStatsLegacy: '未分模型(早期数据 · 按当时记录计费)',
        catalogDisplayLabel: '在费用设置直接显示',
        catalogDisplayHint: '只决定该模型价格卡是否在费用设置「价格表」区直接显示,不影响挂载状态与计费;不直接显示时已挂载模型在拓展价格表内展开厂商后可编辑。',
        priceTableDisplayHint: '各模型是否在「价格表」区直接显示,可在下方拓展价格表中逐模型用「在费用设置直接显示」开关切换;DeepSeek 模型默认直接显示,第三方模型挂载后默认收入拓展表。',
        catalogCustomModels: '手动新增模型',
        priceMatchLabel: '未知模型名自动匹配',
        priceMatchAuto: '自动(去后缀 / 前缀 / 家族相似)',
        priceMatchExact: '仅精确匹配',
        priceMatchNote: '自动匹配顺序:精确 → 手动指定 → 去日期/版本后缀 → 前缀 → 家族相似;未命中时 DeepSeek 回退默认价,其他 provider 不计价。',
        unmatchedTitle: '最近出现但未命中价格的模型',
        unmatchedHint: '按当前匹配模式未命中价格条目(含跨厂商兑底后仍按默认价兜底的);为其指定条目写入手动匹配覆盖,选择「默认价」即回退 DeepSeek 默认价。',
        overrideTargetDefault: 'DeepSeek 默认价',
        overrideRemove: '移除',
        overrideNone: '暂无手动匹配覆盖。',
        mountedSuffix: '已挂载(参与计费)',
        flatInput: '输入',
        flatCached: '缓存',
        flatOutput: '输出',
        deepseekMountedHeader: 'DeepSeek 价格表(已挂载)',
        codingPlanKimi: 'Kimi / Moonshot',
        codingPlanOpenrouter: 'OpenRouter',
        codingPlanSiliconflow: 'SiliconFlow 硅基流动',
        codingPlanCommandcode: 'CommandCode',
        codingPlanScnet: 'SCNet 超算互联网 Token Plan',
        scnetPlanCreditsLabel: '月度 Credits 额度(基础 60,000 / 标准 240,000 / 高级 600,000)',
        scnetPlanStartLabel: '订阅起始日(可选,格式 YYYY-MM-DD;留空按自然月)',
        scnetLocalNote: 'SCNet 无 API 额度查询端点:按官方 Credits 抵扣表(2026-08-11 生效)由本地账本估算当前计费周期用量,实际消耗以控制台账单为准;抵扣表覆盖的模型自动折算,其余模型不计入。',
        countdownHoursOnly: '{h}小时',
        countdownHourMinute: '{h}小时{m}分',
        countdownMinute: '{m}分钟',
        nextOffPeakIn: '{time}后进入平价',
        nextPeakIn: '{time}后进入高峰',
        peakSummary: '峰时段(UTC):{windows};生效时间:{time}。{status}',
        noPeakWindows: '未配置峰谷时段。{status}',
        unknown: '未知',
        cardToday: '今日费用',
        cardMonth: '月度费用',
        cardTotal: '累计费用',
        sinceLedger: '自账本建立以来',
        todaySessions: '今日会话',
        historyExpandHint: '点击日期行可展开当日会话明细',
        historySessionsLoading: '会话明细加载中…',
        historyNoSessions: '该日无会话明细(早期数据或会话日志已清理)',
        historySessionsError: '会话明细加载失败',
        sessionRankTitle: '按会话统计',
        sessionRankHint: '不按日期分组，排序与显示条数可切换',
        sessionRankEmpty: '暂无会话数据',
        sessionRankLoading: '会话排行加载中…',
        sessionRankError: '会话排行加载失败',
        sessionRankLimit: '显示条数',
        sessionRankSort: '排序',
        sessionSortCostDesc: '费用 高→低',
        sessionSortCostAsc: '费用 低→高',
        sessionSortTimeDesc: '时间 新→旧',
        sessionSortTimeAsc: '时间 旧→新',
        sessionSortRecent: '实时顺序',
        history: '按日期统计',
        usageTitle: 'Token 用量统计',
        usageTotal: '自账本建立以来 · 累计 {tokens} tokens',
        usageDay: '{date}：共 {tokens} tokens（输入 {input} · 缓存 {cache} · 输出 {output}）· {calls} 次调用 · {cost}',
        usageEmpty: '暂无数据,开始对话后每日用量会汇总在这里',
        usageSectionLabel: '用量',
        // 设置页标签(issue #29)
        tabOverview: '概览',
        tabUsage: '用量',
        tabPricing: '价格',
        positionLabel: '会话费用显示位置',
        off: '关闭',
        quotaStripGuideTitle: '新增:输入框上方额度横条',
        quotaStripGuideBody: '可以在输入框上方用一条横条实时查看预算与多家订阅额度(OpenCode Go / Coding Plan)的用量百分比。要现在开启吗?可随时在「设置 → 显示设置」中更改。',
        quotaStripGuideOn: '开启横条',
        quotaStripGuideOff: '暂不开启',
        clickToRefresh: '点击立即刷新',
        balanceClickGuideTitle: '新增:余额图框点击刷新',
        balanceClickGuideBody: '现在点击侧边栏的官方余额 / 自定义余额 / Coding Plan 图框,即可立即刷新最新数据,无需等待自动刷新间隔或进入设置页;刷新中会有呼吸闪烁,失败时保持原值并在悬停提示中说明原因。',
        balanceClickGuideOk: '知道了',
        currencyLabel: '货币单位',
        peakEnabledLabel: '启用 DeepSeek 峰谷时段价格',
        peakNoticeLabel: '峰时高价时段显著提示(侧边栏预算框/今日费用;设置页峰谷面板内预览)',
        priceTableTitle: '价格表(美元 / 1M tokens)',
        priceTableTitleCny: '价格表(人民币 / 1M tokens)',
        priceTableCnyNote: '当前为官方人民币单价(issue #47):费用按展示汇率折算为美元入账,展示人民币时汇率往返抵消,与官方人民币账单一致;第三方模型价格仍为美元。',
        pricingCurrencyLabel: '官方价格币种',
        pricingCurrencyUsd: '美元(英文官方页)',
        pricingCurrencyCny: '人民币(中文官方页)',
        pricingCurrencyNote: '决定「从官方文档同步价格」抓取哪个语言的官方页。切换后请重新同步;历史账目按当时口径,切换后的费用展示人民币时与官方账单一致。',
        priceTableNote: '「谷时/峰时」为峰谷计价生效后的价格;分界 2026-08-16 16:00 UTC 之前的调用按当时基础价(legacyBase)计费;缓存写入按缓存命中价格计费(与官方规则一致)。无缓存折扣的模型(如 Anthropic/Gemini 等)可只填输入与输出价,命中价自动取未命中价。所有设置修改后自动保存。',
        defaultModelId: 'default(未匹配模型时回退)',
        newModelPlaceholder: '新模型 ID(如 deepseek-v4-pro)',
        addModel: '添加模型',
        dataSync: '数据与同步',
        syncPrices: '同步官方价格',
        syncingPrices: '同步中…',
        syncPricesHint: '官方调价后尽早点此按钮更新本地价格表,否则影响本地记账。',
        confirmFetch: '确认用官方文档价格覆盖价格表?',
        apply: '应用',
        cancel: '取消',
        syncFromDocs: '从官方文档同步价格',
        confirmReset: '确认将所有本地统计归零?此操作不影响官方余额。',
        confirmClear: '确认重置',
        resetLocalStats: '重置本地统计',
        clearAllHistoryHint: '仅清除本地账本的按天/按会话统计,不影响官方余额。',
        lastSync: '最近同步:{time}',
        neverSynced: '从未(使用内置价格)',
        source: ';来源:{source}',
        sourceOfficial: '官方文档',
        sourceBundled: '内置默认',
        // 语言
        sectionLabel: '费用',
        overlayTitle: '费用统计',
        openCostOverlay: '打开费用面板',
        // RPC 错误
        rpcFailed: '{method} 调用失败',
        rpcSyncFailed: '同步调用失败',
        rpcBalanceFailed: '余额刷新调用失败',
      },
      en: {
        sessionCostTitle: 'Cost of this session (billed exactly at each call time)',
        sessionToday: 'This session today',
        sessionDockNote: 'Cumulative cost of the current session, updating live with each call',
        sessionDetailTokens: 'Input {input} · Cache {cache} · Output {output}',
        sessionDetailCache: 'Cache: read {read} · write {write} (writes billed at the hit price)',
        cost: 'Cost {amount}',
        sessionLine: 'This session {amount} · Input {input} · Cache {cache} · Output {output}',
        balanceQueryFailed: 'Balance query failed: {message}',
        unknownError: 'Unknown error',
        balance: 'Balance',
        queryFailed: 'Query failed',
        balanceTitle: 'DeepSeek open-platform account balance',
        totalBalance: 'Total {amount}',
        grantedToppedUp: 'Granted {granted} · Topped-up {toppedUp}',
        updatedAt: 'Updated {time}',
        usedOf: 'Used {used} / {amount}',
        budget: 'Budget',
        todayCostTitle: "Today's cost (billed exactly at official prices)",
        cardInput: 'Input {input}',
        cardCache: 'Cache {cache}',
        cardOutput: 'Output {output}',
        cardCalls: 'Calls {calls}',
        periodToday: 'Based on Beijing time (UTC+8)',
        periodMonth: 'Based on the last 30 days',
        periodTotal: 'Calculated since the ledger was created',
        monthCost: 'This month {amount}',
        totalCost: 'All time {amount}',
        today: 'Today',
        periodDay: 'Today',
        periodMonth: 'This month',
        periodAll: 'All time',
        periodCustom: 'Custom',
        periodCustomRange: 'Custom range',
        noHistory: 'No data yet. Once you start chatting, costs are aggregated here per day.',
        colDate: 'Date',
        colCalls: 'Calls',
        colInTok: 'In tok',
        colCacheTok: 'Cache tok',
        colOutTok: 'Out tok',
        colCost: 'Cost',
        noSessionsToday: 'No sessions recorded today.',
        colSession: 'Session',
        enableBudget: 'Enable budget',
        startDate: 'Start date',
        endDate: 'End date (empty = today)',
        rangeText: 'Range: {range}',
        overLimit: ' (over limit)',
        nearLimit: ' (near limit)',
        legacyModel: 'Legacy',
        defaultFallback: 'Default fallback',
        remove: 'Remove',
        tierBase: 'Base',
        tierOffPeak: 'Off-peak',
        tierPeak: 'Peak',
        close: 'Close',
        balanceBarRemaining: 'Balance {amount}',
        balanceBarToday: 'Today {amount}',
        balanceBarSpent: 'Spent {amount}',
        refreshCustomBalance: 'Refresh custom balance',
        refreshGoQuota: 'Refresh quota',
        enableGoQuota: 'Enable OpenCode Go quota',
        codingPlansTitle: 'Coding plan quotas',
        codingPlansNote: 'Query coding plan subscription quotas per vendor (independent enable switch and credentials per vendor). Credentials are only sent to the vendor\'s official endpoint; leave the key empty to auto-detect from environment variables and CLI logins.',
        codingPlansOpen: 'Expand Coding Plan quotas',
        codingPlansCollapse: 'Collapse Coding Plan quotas',
        codingPlansCollapsedHint: 'Collapsed by default; expand to enable providers, enter keys and query quotas. The open/closed state is remembered.',
        codingPlanAnthropic: 'Anthropic (Claude Pro/Max)',
        codingPlanZai: 'Z.ai / Zhipu GLM Coding Plan',
        codingPlanMinimax: 'MiniMax Token Plan',
        codingPlanMinimaxTitle: 'MiniMax Plan',
        codingPlanRemain5h: '5h',
        codingPlanRemain7d: '7d',
        enableCodingPlan: 'Enable quota queries',
        codingPlanDisplayLabel: 'Display position',
        codingPlanDisplayNote: 'With "Main sidebar / Both" selected, this vendor\'s quota shows as a card in the sidebar (same box style as the Go quota / balance; the collapsed rail shows percentages).',
        codingPlanKeyLabel: 'API key (optional; empty = auto-detect)',
        codingPlanRefreshIntervalLabel: 'Refresh interval (minutes)',
        refreshCodingPlan: 'Refresh',
        codingPlanDisabledNote: 'Disabled. Enable it to query this vendor\'s coding plan quota on the refresh interval and show it here.',
        goQuotaDisabledNote: 'Quota disabled. Enable it to read the OpenCode Go subscription quota (rolling 5h / weekly / monthly) and show it in the sidebar box, Settings page and bottom-right corner; if you have no Go subscription, the reason will be shown here.',
        ledgerReadFailed: 'Ledger read failed: {message}',
        readingLedger: 'Reading ledger…',
        ledgerUnavailable: 'Ledger unavailable',
        syncFailed: 'Sync failed: {message}',
        historyCleared: 'Statistics reset.',
        clearFailed: 'Clear failed: {message}',
        peakOff: 'Peak/off-peak pricing is off; base prices are used',
        peakNotEffective: 'Not yet effective (effective at {time}); base prices are currently used',
        peakActive: 'Peak hour now; peak prices apply',
        peakNotice: 'DeepSeek peak-hour pricing is active; current calls are billed at peak prices',
        offPeakActive: 'Off-peak now; off-peak prices apply',
        weekendAllOffPeak: 'Weekend — all off-peak (Sat & Sun billed at off-peak prices all day)',
        weekendChip: 'Weekend — all off-peak',
        weekendShort: 'Weekend',
        weekendRuleNote: 'From Aug 23, 2026 00:00 (Beijing time), weekends (Saturday & Sunday) are billed entirely at off-peak prices; charges before that still follow the previous rules.',
        peakShort: 'Peak',
        offPeakShort: 'Off-peak',
        peakStyleLabel: 'Peak period strip style',
        peakStyleCompact: 'Compact (one-line)',
        peakStyleClassic: 'Classic (segments & chip)',
        peakAlertLabel: 'Popup alert before peak/off-peak switch',
        peakAlertAheadLabel: 'Lead time (minutes, 1-30)',
        peakAlertTargetLabel: 'Alert type',
        peakAlertTargetPeak: 'Entering peak',
        peakAlertTargetOffPeak: 'Entering off-peak',
        peakAlertTargetBoth: 'Both',
        peakAlertTitlePeak: 'Entering peak hours soon',
        peakAlertTitleOffPeak: 'Entering off-peak hours soon',
        peakAlertBody: 'Billing switches to {phase} pricing in about {time}; mind your call costs in this window.',
        peakAlertPhasePeak: 'peak',
        peakAlertPhaseOffPeak: 'off-peak',
        peakAlertBtn: 'Got it',
        peakAlertBadgePeak: 'Peak alert',
        peakAlertBadgeOffPeak: 'Off-peak alert',
        peakAlertPositionLabel: 'Popup position',
        peakAlertPositionCorner: 'Bottom-right',
        peakAlertPositionCenter: 'Screen center',
        peakAlertWebNotifyLabel: 'Also send a system notification',
        peakAlertWebNotifyHint: 'When enabled, allow notification permission in the browser address bar so you get alerted even when the page is minimized or backgrounded.',
        peakAlertPreviewLabel: 'Preview the popup',
        peakAlertPreviewPeak: 'Preview entering peak',
        peakAlertPreviewOffPeak: 'Preview entering off-peak',
        peakAlertPreviewTag: ' (preview)',
        peakPanelTitle: 'Peak/off-peak pricing & notice',
        peakNoticeHiddenHint: 'Notice hidden: enable peak/off-peak pricing and the “prominent notice” toggle.',
        catalogTitle: 'Extended price catalog',
        catalogNote: 'A built-in, read-only reference catalog grouped by vendor and model family. Mounting copies an entry into the editable price table above so it is used for billing; DeepSeek models can be unmounted (they fall back to the default price and can be re-mounted here).',
        catalogOpen: 'Expand extended price catalog',
        catalogCollapse: 'Collapse extended price catalog',
        mountBtn: 'Mount',
        unmountBtn: 'Unmount',
        mountedTag: 'Mounted',
        catalogUnpriced: 'Unpriced',
        catalogDeepseekNote: 'DeepSeek models support peak/off-peak tiers; once unmounted they bill at the default price and are no longer hit by auto-matching.',
        modelStatsTitle: 'Per-model statistics (tokens & cost)',
        modelStatsToday: 'Today',
        modelStatsHistory: 'Last 90 days',
        modelStatsCostH: 'Cost ranking',
        modelStatsTokensH: 'Token usage',
        modelStatsHitH: 'Cache hit rate',
        modelStatsValueH: 'Value · tokens per USD',
        modelStatsInput: 'Input',
        modelStatsCache: 'Cache',
        modelStatsOutput: 'Output',
        modelStatsEmpty: 'No usage data for this period.',
        modelStatsBlended: 'blended {price}/M',
        modelStatsNote: 'Methodology: cache hit rate = cache reads ÷ (cache reads + non-cached input); blended price = cost ÷ total tokens × 1M (USD per 1M tokens); value = total tokens ÷ cost (higher is better). Costs are USD exactly as billed per call by the ledger.',
        modelStatsLegacy: 'Unattributed (early data · billed as recorded)',
        catalogDisplayLabel: 'Show directly in Cost settings',
        catalogDisplayHint: 'Only decides whether this model\'s price card appears directly in the Cost settings price table; mounting and billing are unaffected. When hidden, the mounted model stays editable inside the expanded vendor section of this catalog.',
        priceTableDisplayHint: 'Use the per-model “Show directly in Cost settings” toggle in the extended price catalog below to choose which models appear here; DeepSeek models default to direct display, third-party models default to the catalog once mounted.',
        catalogCustomModels: 'Custom models',
        priceMatchLabel: 'Auto-match unknown model names',
        priceMatchAuto: 'Auto (strip suffix / prefix / family similarity)',
        priceMatchExact: 'Exact match only',
        priceMatchNote: 'Match order: exact → manual override → strip date/version suffix → prefix → family similarity. Unmatched DeepSeek ids fall back to the default price; other providers stay unpriced.',
        unmatchedTitle: 'Recently seen models without a price hit',
        unmatchedHint: 'These found no price entry under the current match mode (including cross-vendor fallback), or fell back to the DeepSeek default. Pick which entry each one should bill against (saved as a manual override); “Default price” falls back to the DeepSeek default.',
        overrideTargetDefault: 'DeepSeek default price',
        overrideRemove: 'Remove',
        overrideNone: 'No manual match overrides.',
        mountedSuffix: 'Mounted (billed)',
        flatInput: 'Input',
        flatCached: 'Cached',
        flatOutput: 'Output',
        deepseekMountedHeader: 'DeepSeek price table (mounted)',
        codingPlanKimi: 'Kimi / Moonshot',
        codingPlanOpenrouter: 'OpenRouter',
        codingPlanSiliconflow: 'SiliconFlow',
        codingPlanCommandcode: 'CommandCode',
        codingPlanScnet: 'SCNet Token Plan',
        scnetPlanCreditsLabel: 'Monthly credits quota (Basic 60,000 / Standard 240,000 / Pro 600,000)',
        scnetPlanStartLabel: 'Plan start date (optional, YYYY-MM-DD; empty = calendar month)',
        scnetLocalNote: 'SCNet exposes no API quota endpoint: usage for the current billing period is estimated from the local ledger using the official credits deduction table (effective 2026-08-11); actual consumption is subject to the SCNet console. Only models covered by the table are counted.',
        countdownHoursOnly: '{h}h',
        countdownHourMinute: '{h}h {m}m',
        countdownMinute: '{m}m',
        nextOffPeakIn: 'Off-peak in {time}',
        nextPeakIn: 'Peak in {time}',
        peakSummary: 'Peak hours (UTC): {windows}; effective: {time}. {status}',
        noPeakWindows: 'No peak windows configured. {status}',
        unknown: 'unknown',
        cardToday: 'Today',
        cardMonth: 'Monthly',
        cardTotal: 'All time',
        sinceLedger: 'Since the ledger was created',
        todaySessions: "Today's sessions",
        historyExpandHint: 'Click a date row to expand its session details',
        historySessionsLoading: 'Loading session details…',
        historyNoSessions: 'No session details for this day (early data or session logs cleaned)',
        historySessionsError: 'Failed to load session details',
        sessionRankTitle: 'By session',
        sessionRankHint: 'Not grouped by date; sort and row count are switchable',
        sessionRankEmpty: 'No session data yet',
        sessionRankLoading: 'Loading session ranking…',
        sessionRankError: 'Failed to load session ranking',
        sessionRankLimit: 'Rows',
        sessionRankSort: 'Sort',
        sessionSortCostDesc: 'Cost high→low',
        sessionSortCostAsc: 'Cost low→high',
        sessionSortTimeDesc: 'Time new→old',
        sessionSortTimeAsc: 'Time old→new',
        sessionSortRecent: 'Recent order',
        history: 'By day',
        usageTitle: 'Token usage stats',
        usageTotal: 'Since the ledger was created · Total {tokens} tokens',
        usageDay: '{date}: {tokens} tokens (input {input} · cache {cache} · output {output}) · {calls} calls · {cost}',
        usageEmpty: 'No data yet — daily usage will accumulate here',
        usageSectionLabel: 'Usage',
        // Settings tabs (issue #29)
        tabOverview: 'Overview',
        tabUsage: 'Usage',
        tabPricing: 'Pricing',
        positionLabel: 'Session cost display position',
        off: 'Off',
        quotaStripGuideTitle: 'New: quota strip above the input',
        quotaStripGuideBody: 'Show budget and subscription quotas (OpenCode Go / coding plans) as one compact strip above the input box. Enable it now? You can change this anytime in Settings → Display.',
        quotaStripGuideOn: 'Enable the strip',
        quotaStripGuideOff: 'Not now',
        clickToRefresh: 'Click to refresh now',
        balanceClickGuideTitle: 'New: click the balance box to refresh',
        balanceClickGuideBody: 'Click the official balance / custom balance / coding-plan box in the sidebar to fetch the latest data immediately — no need to wait for the auto-refresh interval or open Settings. While refreshing the box pulses; on failure the previous value is kept and the reason appears in the hover tooltip.',
        balanceClickGuideOk: 'Got it',
        currencyLabel: 'Currency',
        peakEnabledLabel: 'Use DeepSeek peak-hour prices',
        peakNoticeLabel: 'Prominent notice during peak hours (sidebar budget box, today\'s cost; previewed in the Settings peak panel)',
        priceTableTitle: 'Price table (USD / 1M tokens)',
        priceTableTitleCny: 'Price table (CNY / 1M tokens)',
        priceTableCnyNote: 'Prices are official CNY rates (issue #47): costs are converted to USD at the display exchange rate when booked; rendering back in CNY cancels the conversion round-trip, matching the official CNY bill. Third-party model prices remain in USD.',
        pricingCurrencyLabel: 'Official price currency',
        pricingCurrencyUsd: 'USD (English official page)',
        pricingCurrencyCny: 'CNY (Chinese official page)',
        pricingCurrencyNote: 'Chooses which language of the official pricing page "Sync from the official docs" fetches. Re-sync after switching; past entries keep the basis used at their time, and entries booked after the switch match the official bill when displayed in CNY.',
        priceTableNote: '"Off-peak / Peak" are the prices used once peak/off-peak pricing takes effect; calls before the 2026-08-16 16:00 UTC boundary are billed at the base prices of that time (legacyBase); cache writes are billed at the cache-hit price (matching the official rule). Models without a cache discount (e.g. Anthropic/Gemini) can be entered with just input and output prices — the hit price is then derived from the miss price. All settings changes are auto-saved.',
        defaultModelId: 'default (fallback for unmatched models)',
        newModelPlaceholder: 'New model ID (e.g. deepseek-v4-pro)',
        addModel: 'Add model',
        dataSync: 'Data & sync',
        syncPrices: 'Sync official prices',
        syncingPrices: 'Syncing…',
        syncPricesHint: 'Click this promptly after official prices change to refresh the local price table; otherwise local billing will be off.',
        confirmFetch: 'Overwrite the price table with prices from the official docs?',
        apply: 'Apply',
        cancel: 'Cancel',
        syncFromDocs: 'Sync prices from official docs',
        confirmReset: 'Reset all local statistics? Official balance is unaffected.',
        confirmClear: 'Confirm reset',
        resetLocalStats: 'Reset local statistics',
        clearAllHistoryHint: 'Only clears local per-day/per-session statistics; official balance is unaffected.',
        lastSync: 'Last sync: {time}',
        neverSynced: 'Never (bundled prices)',
        source: '; Source: {source}',
        sourceOfficial: 'Official docs',
        sourceBundled: 'Bundled',
        sectionLabel: 'Cost',
        overlayTitle: 'Cost statistics',
        openCostOverlay: 'Open cost panel',
        rpcFailed: '{method} call failed',
        rpcSyncFailed: 'Sync call failed',
        rpcBalanceFailed: 'Balance refresh call failed',
      },
    }

    /** 探测浏览器语言:zh* → zh,其余 → en。 */
    function detectBrowserLocale() {
      const lang = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : ''
      return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    /** 解析生效语言:显式 zh/en 直接采用;auto/缺失 → 浏览器探测。 */
    function resolveLocale(configLocale) {
      if (configLocale === 'zh' || configLocale === 'en') return configLocale
      return detectBrowserLocale()
    }

    /** 构造按当前语言取文案的函数 t(key, vars)。 */
    function makeT(locale) {
      const dict = locale === 'zh' ? MESSAGES.zh : MESSAGES.en
      return (key, vars) => {
        let text = dict[key] ?? MESSAGES.en[key] ?? key
        if (vars) for (const name of Object.keys(vars)) text = text.split('{' + name + '}').join(String(vars[name]))
        return text
      }
    }

    const PERIOD_KEYS = { day: 'periodDay', month: 'periodMonth', all: 'periodAll', custom: 'periodCustom' }

    // ── 线路校验器(与服务端 zod 清单对应,宽松校验必要字段) ─────────────────

    function fail(path, expect) {
      throw new Error('dsh-cost-lite: 服务端数据非法 (' + path + ': ' + expect + ')')
    }
    function needNum(v, path) {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'number')
      return v
    }
    function needStr(v, path) {
      if (typeof v !== 'string') fail(path, 'string')
      return v
    }
    function needBool(v, path) {
      if (typeof v !== 'boolean') fail(path, 'boolean')
      return v
    }
    function aggregateModelMap(v, path) {
      // 宽容解析模型聚合 map(旧账本条目可能缺字段/带 null/非对象):数值归一为有限非负数。
      const out = {}
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const key of Object.keys(v)) {
          const raw = v[key]
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
          const num = x => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
          out[key] = {
            input: num(raw.input), output: num(raw.output),
            cacheRead: num(raw.cacheRead), cacheWrite: num(raw.cacheWrite),
            reasoning: num(raw.reasoning), cost: num(raw.cost),
          }
        }
      }
      return out
    }
    function parseSession(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        id: needStr(v.id, path + '.id'),
        provider: typeof v.provider === 'string' ? v.provider : '',
        model: typeof v.model === 'string' ? v.model : '',
        input: needNum(v.input, path + '.input'),
        output: needNum(v.output, path + '.output'),
        cacheRead: needNum(v.cacheRead, path + '.cacheRead'),
        cacheWrite: needNum(v.cacheWrite, path + '.cacheWrite'),
        reasoning: v.reasoning === undefined ? 0 : needNum(v.reasoning, path + '.reasoning'),
        calls: needNum(v.calls, path + '.calls'),
        cost: needNum(v.cost, path + '.cost'),
        byModel: aggregateModelMap(v.byModel, path + '.byModel'),
        byProviderModel: aggregateModelMap(v.byProviderModel, path + '.byProviderModel'),
      }
    }
    function parseDay(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const out = {
        date: needStr(v.date, path + '.date'),
        input: needNum(v.input, path + '.input'),
        output: needNum(v.output, path + '.output'),
        cacheRead: needNum(v.cacheRead, path + '.cacheRead'),
        cacheWrite: needNum(v.cacheWrite, path + '.cacheWrite'),
        reasoning: v.reasoning === undefined ? 0 : needNum(v.reasoning, path + '.reasoning'),
        calls: needNum(v.calls, path + '.calls'),
        cost: needNum(v.cost, path + '.cost'),
        byModel: aggregateModelMap(v.byModel, path + '.byModel'),
        byProviderModel: aggregateModelMap(v.byProviderModel, path + '.byProviderModel'),
        sessions: [],
      }
      if (v.sessions !== undefined) {
        if (!Array.isArray(v.sessions)) fail(path + '.sessions', 'array')
        out.sessions = v.sessions.map((s, i) => parseSession(s, path + '.sessions[' + i + ']'))
      }
      return out
    }
    function parsePrice(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const out = {
        cacheHit: needNum(v.cacheHit, path + '.cacheHit'),
        cacheMiss: needNum(v.cacheMiss, path + '.cacheMiss'),
        output: needNum(v.output, path + '.output'),
      }
      if (v.offPeak !== undefined) {
        out.offPeak = {
          cacheHit: needNum(v.offPeak.cacheHit, path + '.offPeak.cacheHit'),
          cacheMiss: needNum(v.offPeak.cacheMiss, path + '.offPeak.cacheMiss'),
          output: needNum(v.offPeak.output, path + '.offPeak.output'),
        }
      }
      if (v.peak !== undefined) {
        out.peak = {
          cacheHit: needNum(v.peak.cacheHit, path + '.peak.cacheHit'),
          cacheMiss: needNum(v.peak.cacheMiss, path + '.peak.cacheMiss'),
          output: needNum(v.peak.output, path + '.peak.output'),
        }
      }
      if (v.legacyBase !== undefined) {
        out.legacyBase = {
          cacheHit: needNum(v.legacyBase.cacheHit, path + '.legacyBase.cacheHit'),
          cacheMiss: needNum(v.legacyBase.cacheMiss, path + '.legacyBase.cacheMiss'),
          output: needNum(v.legacyBase.output, path + '.legacyBase.output'),
        }
      }
      if (v.legacy !== undefined) out.legacy = needBool(v.legacy, path + '.legacy')
      return out
    }
    function parseConfig(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const models = {}
      if (v.prices !== null && typeof v.prices === 'object' && v.prices.models !== null && typeof v.prices.models === 'object') {
        for (const id of Object.keys(v.prices.models)) models[id] = parsePrice(v.prices.models[id], path + '.prices.models.' + id)
      }
      return {
        locale: v.locale === 'zh' || v.locale === 'en' || v.locale === 'auto' ? v.locale : 'auto',
        position: v.position === 'header' || v.position === 'off' ? v.position : 'dock',
        sidebar: v.sidebar !== false,
        // showSessionId 曾遗漏于本白名单:checkbox 能保存但读侧恒 undefined,
        // 会话列表附显 ID 自上线以来实际从未生效(v1.5.38 起一并修复)。
        hideOfficialBalance: v.hideOfficialBalance === true,
        hideTodayCost: v.hideTodayCost === true,
        // 官方价格币种(issue #47):读侧白名单缺失会导致下拉选择保存后读不回。
        pricingCurrency: v.pricingCurrency === 'CNY' ? 'CNY' : 'USD',
        currency: typeof v.currency === 'string' ? v.currency : 'CNY',
        symbol: typeof v.symbol === 'string' ? v.symbol : '¥',
        decimals: needNum(v.decimals, path + '.decimals'),
        exchangeRate: needNum(v.exchangeRate, path + '.exchangeRate'),
        peakEnabled: v.peakEnabled === true,
        peakEffectiveAt: typeof v.peakEffectiveAt === 'string' ? v.peakEffectiveAt : '',
        peakWindows: Array.isArray(v.peakWindows)
          ? v.peakWindows.map((w, i) => ({ start: needNum(w.start, path + '.peakWindows[' + i + '].start'), end: needNum(w.end, path + '.peakWindows[' + i + '].end') }))
          : [],
        peakNotice: v.peakNotice !== false,
        peakAlertEnabled: v.peakAlertEnabled !== false,
        peakAlertAhead: Number.isFinite(v.peakAlertAhead) && v.peakAlertAhead >= 1 && v.peakAlertAhead <= 30 ? v.peakAlertAhead : 2,
        peakAlertTarget: v.peakAlertTarget === 'peak' || v.peakAlertTarget === 'offpeak' ? v.peakAlertTarget : 'both',
        peakAlertPosition: v.peakAlertPosition === 'center' ? 'center' : 'corner',
        peakAlertWebNotify: v.peakAlertWebNotify === true,
        peakStyle: v.peakStyle === 'classic' ? 'classic' : 'compact',
        priceMatch: v.priceMatch === 'exact' ? 'exact' : 'auto',
        priceOverrides: (() => {
          const out = {}
          if (v.priceOverrides !== null && typeof v.priceOverrides === 'object' && !Array.isArray(v.priceOverrides)) {
            for (const [k, val] of Object.entries(v.priceOverrides)) if (typeof k === 'string' && typeof val === 'string') out[k] = val
          }
          return out
        })(),
        priceTableDisplay: (() => {
          // 键 'provider:modelId',缺省 = DeepSeek 模型直接显示、第三方收入拓展表。
          const out = {}
          if (v.priceTableDisplay !== null && typeof v.priceTableDisplay === 'object' && !Array.isArray(v.priceTableDisplay)) {
            for (const [k, val] of Object.entries(v.priceTableDisplay)) if (typeof k === 'string') out[k] = val === true
          }
          return out
        })(),
        codingPlans: (() => {
          const out = {}
          if (v.codingPlans !== null && typeof v.codingPlans === 'object' && !Array.isArray(v.codingPlans)) {
            for (const id of Object.keys(v.codingPlans)) {
              const e = v.codingPlans[id]
              if (e === null || typeof e !== 'object' || Array.isArray(e)) continue
              out[id] = {
                enabled: e.enabled === true,
                display: e.display === 'sidebar' || e.display === 'both' || e.display === 'off' ? e.display : 'settings',
                refreshMinutes: typeof e.refreshMinutes === 'number' && Number.isFinite(e.refreshMinutes) ? e.refreshMinutes : 15,
                apiKey: typeof e.apiKey === 'string' ? e.apiKey : '',
                // SCNet 本地计量字段(issue #26):其余厂商无此二键,缺省剔除。
                ...(typeof e.planCredits === 'number' && Number.isFinite(e.planCredits) && e.planCredits > 0 ? { planCredits: e.planCredits } : {}),
                ...(typeof e.planStart === 'string' ? { planStart: e.planStart } : {}),
              }
            }
          }
          return out
        })(),
        prices: {
          models,
          default: parsePrice(v.prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, path + '.prices.default'),
          providers: v.prices?.providers && typeof v.prices.providers === 'object' ? v.prices.providers : {},
        },
        historyDays: needNum(v.historyDays, path + '.historyDays'),
        fetchedAt: v.fetchedAt === null || v.fetchedAt === undefined ? null : needStr(v.fetchedAt, path + '.fetchedAt'),
        priceSource: typeof v.priceSource === 'string' ? v.priceSource : 'bundled',
        budget: {
          enabled: v.budget?.enabled === true,
          amount: typeof v.budget?.amount === 'number' && Number.isFinite(v.budget.amount) ? v.budget.amount : 100,
          period: v.budget?.period === 'day' || v.budget?.period === 'all' || v.budget?.period === 'custom' ? v.budget.period : 'month',
          customStart: typeof v.budget?.customStart === 'string' ? v.budget.customStart : null,
          customEnd: typeof v.budget?.customEnd === 'string' ? v.budget.customEnd : null,
          detail: v.budget?.detail !== false,
        },
        balance: {
          display: v.balance?.display === 'sidebar' || v.balance?.display === 'settings' || v.balance?.display === 'off' ? v.balance.display : 'both',
          refreshMinutes: typeof v.balance?.refreshMinutes === 'number' && Number.isFinite(v.balance.refreshMinutes) ? v.balance.refreshMinutes : 5,
          showProgressBar: v.balance?.showProgressBar === true,
          budgetCap: typeof v.balance?.budgetCap === 'number' && Number.isFinite(v.balance.budgetCap) && v.balance.budgetCap > 0 ? v.balance.budgetCap : null,
          clickHintSeen: v.balance?.clickHintSeen === true,
        },
        goQuota: {
          enabled: v.goQuota?.enabled !== false,
          display: v.goQuota?.display === 'sidebar' || v.goQuota?.display === 'settings' || v.goQuota?.display === 'off' ? v.goQuota.display : 'both',
          refreshMinutes: typeof v.goQuota?.refreshMinutes === 'number' && Number.isFinite(v.goQuota.refreshMinutes) ? v.goQuota.refreshMinutes : 15,
          apiKey: typeof v.goQuota?.apiKey === 'string' ? v.goQuota.apiKey : '',
          main: v.goQuota?.main === 'weekly' || v.goQuota?.main === 'monthly' ? v.goQuota.main : 'rolling',
          detail: v.goQuota?.detail !== false,
        },
        customBalance: v.customBalance === undefined || v.customBalance === null ? undefined : {
          enabled: v.customBalance.enabled === true,
          label: typeof v.customBalance.label === 'string' ? v.customBalance.label : '',
          labelEn: typeof v.customBalance.labelEn === 'string' ? v.customBalance.labelEn : '',
          display: v.customBalance.display === 'sidebar' || v.customBalance.display === 'settings' || v.customBalance.display === 'off' ? v.customBalance.display : 'both',
          unit: v.customBalance.unit === 'CNY' || v.customBalance.unit === 'EUR' ? v.customBalance.unit : 'USD',
          refreshMinutes: typeof v.customBalance.refreshMinutes === 'number' && Number.isFinite(v.customBalance.refreshMinutes) ? v.customBalance.refreshMinutes : 15,
          request: v.customBalance.request && typeof v.customBalance.request === 'object' ? v.customBalance.request : { url: '' },
          extract: v.customBalance.extract && typeof v.customBalance.extract === 'object' ? v.customBalance.extract : {},
        },
        corner: {
          enabled: v.corner?.enabled === true,
          goRolling: v.corner?.goRolling !== false,
          goWeekly: v.corner?.goWeekly !== false,
          goMonthly: v.corner?.goMonthly !== false,
          budget: v.corner?.budget !== false,
        },
        quotaStrip: {
          enabled: v.quotaStrip?.enabled === true,
          budget: v.quotaStrip?.budget !== false,
          go: v.quotaStrip?.go !== false,
          plans: v.quotaStrip?.plans !== false,
          promptSeen: v.quotaStrip?.promptSeen === true,
        },
        usage: {
          position: v.usage?.position === 'general' || v.usage?.position === 'section' ? v.usage.position : 'cost',
        },
      }
    }
    function parseBalance(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        currency: typeof v.currency === 'string' ? v.currency : '',
        totalBalance: typeof v.totalBalance === 'number' && Number.isFinite(v.totalBalance) ? v.totalBalance : 0,
        grantedBalance: typeof v.grantedBalance === 'number' && Number.isFinite(v.grantedBalance) ? v.grantedBalance : 0,
        toppedUpBalance: typeof v.toppedUpBalance === 'number' && Number.isFinite(v.toppedUpBalance) ? v.toppedUpBalance : 0,
      }
    }
    function parseGoWindow(v, path) {
      if (v === null || v === undefined) return null
      if (typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        percent: typeof v.percent === 'number' && Number.isFinite(v.percent) ? v.percent : 0,
        resetsAt: typeof v.resetsAt === 'string' ? v.resetsAt : '',
      }
    }
    function parseGoQuota(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        rolling: v.rolling === undefined || v.rolling === null ? null : parseGoWindow(v.rolling, path + '.rolling'),
        weekly: v.weekly === undefined || v.weekly === null ? null : parseGoWindow(v.weekly, path + '.weekly'),
        monthly: v.monthly === undefined || v.monthly === null ? null : parseGoWindow(v.monthly, path + '.monthly'),
      }
    }
    function parseCustomBalance(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        label: typeof v.label === 'string' ? v.label : '',
        unit: typeof v.unit === 'string' ? v.unit : 'USD',
        remaining: typeof v.remaining === 'number' && Number.isFinite(v.remaining) ? v.remaining : 0,
        maxBudget: typeof v.maxBudget === 'number' && Number.isFinite(v.maxBudget) ? v.maxBudget : null,
        spend: typeof v.spend === 'number' && Number.isFinite(v.spend) ? v.spend : null,
      }
    }
    function parseState(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        today: parseDay(v.today, path + '.today'),
        month: parseDay(v.month, path + '.month'),
        total: parseDay(v.total, path + '.total'),
        budgetUsed: typeof v.budgetUsed === 'number' && Number.isFinite(v.budgetUsed) ? v.budgetUsed : undefined,
        balance: v.balance === undefined || v.balance === null ? { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 } : parseBalance(v.balance, path + '.balance'),
        goQuota: v.goQuota === undefined || v.goQuota === null ? { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null } : parseGoQuota(v.goQuota, path + '.goQuota'),
        codingPlans: v.codingPlans !== null && typeof v.codingPlans === 'object' && !Array.isArray(v.codingPlans) ? v.codingPlans : {},
        history: Array.isArray(v.history) ? v.history.map((d, i) => parseDay(d, path + '.history[' + i + ']')) : [],
        config: parseConfig(v.config, path + '.config'),
        // 扩展价格表目录(宿主只读下发;缺失时 UI 自动隐藏目录面板)。
        priceCatalog: v.priceCatalog !== null && typeof v.priceCatalog === 'object' && !Array.isArray(v.priceCatalog) ? v.priceCatalog : null,
        meta: {
          now: typeof v.meta?.now === 'number' ? v.meta.now : Date.now(),
          timezoneOffsetMinutes: typeof v.meta?.timezoneOffsetMinutes === 'number' ? v.meta.timezoneOffsetMinutes : 0,
          dayKey: typeof v.meta?.dayKey === 'string' ? v.meta.dayKey : '',
          monthKey: typeof v.meta?.monthKey === 'string' ? v.meta.monthKey : '',
        },
        // 当日余额基准(零点首次拉取/充值后重置;卡片起始余额条用);宿主未下发时 null。
        balanceRef: v.balanceRef === undefined || v.balanceRef === null || typeof v.balanceRef !== 'object' || Array.isArray(v.balanceRef)
          ? null
          : {
            date: typeof v.balanceRef.date === 'string' ? v.balanceRef.date : '',
            total: typeof v.balanceRef.total === 'number' && Number.isFinite(v.balanceRef.total) ? v.balanceRef.total : 0,
            granted: typeof v.balanceRef.granted === 'number' && Number.isFinite(v.balanceRef.granted) ? v.balanceRef.granted : 0,
            topped: typeof v.balanceRef.topped === 'number' && Number.isFinite(v.balanceRef.topped) ? v.balanceRef.topped : 0,
            currency: typeof v.balanceRef.currency === 'string' ? v.balanceRef.currency : '',
            at: typeof v.balanceRef.at === 'number' ? v.balanceRef.at : 0,
          },
        // 交叉对账状态(issue #18):旧快照缺失时按「无警示」处理,保证对账默认开启不报错。
        reconcile: v.reconcile === undefined || v.reconcile === null || typeof v.reconcile !== 'object' || Array.isArray(v.reconcile)
          ? { ok: true, message: '' }
          : { ok: v.reconcile.ok === true, message: typeof v.reconcile.message === 'string' ? v.reconcile.message : '' },
      }
    }
    function parseFetchResult(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const out = {
        ok: v.ok === true,
        message: typeof v.message === 'string' ? v.message : '',
      }
      if (v.state !== undefined && v.state !== null) out.state = parseState(v.state, path + '.state')
      return out
    }
    function codecOf(parse) {
      return { parse }
    }
    const stateCodec = codecOf(parseState)
    const patchCodec = codecOf(v => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('patch', 'object')
      return v
    })
    const fetchCodec = codecOf(parseFetchResult)
    const dateCodec = codecOf(v => {
      if (typeof v !== 'string') fail('date', 'string')
      return v
    })
    const dayCodec = codecOf(v => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('day', 'object')
      return v
    })
    const limitCodec = codecOf(v => {
      if (!Number.isFinite(Number(v))) fail('limit', 'number')
      return Number(v)
    })
    const sortCodec = codecOf(v => {
      if (typeof v !== 'string') fail('sort', 'string')
      return v
    })
    const topSessionsCodec = codecOf(v => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('topSessions', 'object')
      return v
    })

    // ── RPC 贡献(与服务端 ./typert 清单一一对应) ───────────────────────────

    const CONTRIBUTION = {
      package: 'dsh-cost-lite',
      descriptors: [
        {
          id: 'dsh-cost-lite#costMeter/getState', service: 'costMeter', namespace: 'costMeter', method: 'getState',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-lite#CostState', schema: stateCodec },
        },
        {
          id: 'dsh-cost-lite#costMeter/updateConfig', service: 'costMeter', namespace: 'costMeter', method: 'updateConfig',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'patch', wire: 'patch', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-lite#ConfigPatch', schema: patchCodec } }],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-lite#CostState', schema: stateCodec },
        },
        {
          id: 'dsh-cost-lite#costMeter/fetchPrices', service: 'costMeter', namespace: 'costMeter', method: 'fetchPrices',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-lite#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-lite#costMeter/refreshBalance', service: 'costMeter', namespace: 'costMeter', method: 'refreshBalance',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-lite#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-lite#costMeter/resetHistory', service: 'costMeter', namespace: 'costMeter', method: 'resetHistory',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-lite#CostState', schema: stateCodec },
        },
        {
          id: 'dsh-cost-lite#costMeter/getDaySessions', service: 'costMeter', namespace: 'costMeter', method: 'getDaySessions',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'date', wire: 'date', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-lite#DayKey', schema: dateCodec } }],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-lite#DayRecord', schema: dayCodec },
        },
        {
          id: 'dsh-cost-lite#costMeter/getTopSessions', service: 'costMeter', namespace: 'costMeter', method: 'getTopSessions',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'limit', wire: 'limit', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-lite#SessionLimit', schema: limitCodec } },
            { name: 'sort', wire: 'sort', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-lite#SessionSort', schema: sortCodec }, acceptsUndefined: true },
            { name: 'dir', wire: 'dir', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-lite#SessionSortDir', schema: sortCodec }, acceptsUndefined: true },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-lite#TopSessions', schema: topSessionsCodec },
        },
      ],
    }

    // ── 计费与显示助手(与服务端 pricing.js 一致) ───────────────────────────

    function priceEntryFor(modelId, table) {
      const models = table?.models ?? {}
      if (typeof modelId === 'string' && modelId.length > 0 && models[modelId] !== undefined) return models[modelId]
      return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
    }
    function normalizeClientPrice(raw) {
      if (!raw || typeof raw !== 'object') return null
      const miss = Number.isFinite(Number(raw.cacheMiss)) ? Number(raw.cacheMiss) : Number(raw.input) || 0
      const hit = Number.isFinite(Number(raw.cacheHit)) ? Number(raw.cacheHit) : Number(raw.cachedInput ?? raw.cacheRead ?? miss)
      return { cacheHit: hit, cacheMiss: miss, output: Number(raw.output) || 0, reasoning: Number(raw.reasoning) || 0 }
    }
    /** 周末全谷价生效时刻(UTC):2026-08-23(周日)00:00 北京时间(与 lib/pricing.js 同步)。 */
    const WEEKEND_OFFPEAK_EFFECTIVE_MS = Date.parse('2026-08-22T16:00:00Z')
    /** 某时刻所处的周末全谷价区间(北京日历周六/周日,生效后);非周末/生效前返回 null。 */
    function weekendZoneAt(atMs) {
      if (!Number.isFinite(atMs) || atMs < WEEKEND_OFFPEAK_EFFECTIVE_MS) return null
      const day = Math.floor((atMs + 8 * 3600000) / 86400000)
      const weekday = (day + 4) % 7
      if (weekday !== 6 && weekday !== 0) return null
      const satDay = weekday === 6 ? day : day - 1
      const start = Math.max(satDay * 86400000 - 8 * 3600000, WEEKEND_OFFPEAK_EFFECTIVE_MS)
      return { start, end: (satDay + 2) * 86400000 - 8 * 3600000 }
    }
    function isPeakHour(atMs, effectiveAtMs, windows) {
      if (!Array.isArray(windows) || windows.length === 0) return false
      if (weekendZoneAt(atMs) !== null) return false
      if (Number.isFinite(effectiveAtMs) && atMs < effectiveAtMs) return false
      const hour = new Date(atMs).getUTCHours()
      return windows.some(w => {
        const start = Number(w.start)
        const end = Number(w.end)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false
        return start < end ? hour >= start && hour < end : hour >= start || hour < end
      })
    }
    function tierFor(entry, atMs, peak) {
      const base = entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
      const asTier = price => ({ cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output, reasoning: price.reasoning ?? 0 })
      if (peak?.enabled !== true) return asTier(base)
      const effectiveAtMs = typeof peak.effectiveAtMs === 'number' ? peak.effectiveAtMs : undefined
      if (isPeakHour(atMs, effectiveAtMs, peak.windows)) {
        const p = base.peak
        return p === undefined ? asTier(base) : asTier(p)
      }
      if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
        const off = base.offPeak
        return off === undefined ? asTier(base) : asTier(off)
      }
      return asTier(base)
    }
    function costOfBuckets(buckets, tier) {
      const input = Math.max(0, Number(buckets.input) || 0)
      const output = Math.max(0, Number(buckets.output) || 0)
      const cacheRead = Math.max(0, Number(buckets.cacheRead) || 0)
      const cacheWrite = Math.max(0, Number(buckets.cacheWrite) || 0)
      const reasoning = Math.max(0, Number(buckets.reasoning) || 0)
      return (input * tier.cacheMiss + output * tier.output + (cacheRead + cacheWrite) * tier.cacheHit + reasoning * (tier.reasoning ?? 0)) / 1_000_000
    }
    /** 已换算币种金额 → 显示字符串(符号 + 固定小数位,不去尾零)。位数由 config.decimals 控制。 */
    function formatMoneyValue(value, config) {
      const symbol = typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : '$'
      const decimals = Math.max(0, Math.min(10, Math.floor(Number(config?.decimals) || 2)))
      return symbol + value.toFixed(decimals)
    }
    function formatMoneyUsd(usd, config) {
      const rate = Number(config?.exchangeRate)
      const value = usd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      return formatMoneyValue(value, config)
    }
    function formatTokens(n) {
      const v = Math.max(0, Number(n) || 0)
      const scaled = x => x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10)
      if (v < 1000) return String(Math.round(v))
      if (v < 1000000) return scaled(v / 1000) + 'K'
      return scaled(v / 1000000) + 'M'
    }
    /**
     * 模型名归一化(与 lib/pricing.js 的 canonModelId 同逻辑;bundle 无法导入,修改时两处同步):
     * 小写,去括号附注(如 (go)),只保留字母数字——大小写/空格/横杠/点号等差异全部忽略。
     */
    function canonModelIdLocal(id) {
      return String(id ?? '').toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/（[^）]*）/g, ' ')
        .replace(/[^a-z0-9]+/g, '')
    }
    /**
     * 模型名自动匹配(与 lib/pricing.js 的 matchModelId 同逻辑;bundle 无法导入,修改时两处同步)。
     * 精确 → 归一化等价 → 宽泛包含(取最长候选) → 去后缀 → 前缀 → 家族 token 相似。
     */
    function matchModelIdLocal(modelId, candidates) {
      if (typeof modelId !== 'string' || modelId.length === 0) return null
      const list = Array.isArray(candidates) ? candidates.filter(c => typeof c === 'string' && c.length > 0) : []
      if (list.length === 0) return null
      const strip = id => String(id).toLowerCase().replace(/[-@]\d{4}-?\d{2}-?\d{2}$/, '').replace(/[-@]v\d+(\.\d+)*$/, '')
      const exact = list.find(c => c === modelId)
      if (exact !== undefined) return exact
      const canon = canonModelIdLocal(modelId)
      if (canon.length === 0) return null
      const byCanon = list.find(c => canonModelIdLocal(c) === canon)
      if (byCanon !== undefined) return byCanon
      let containHit = null
      let containLen = 0
      for (const c of list) {
        const cc = canonModelIdLocal(c)
        if (cc.length < 4 || cc === canon) continue
        if (canon.includes(cc) && cc.length > containLen) { containHit = c; containLen = cc.length }
      }
      if (containHit !== null) return containHit
      const stripped = strip(modelId)
      const byStripped = list.find(c => strip(c) === stripped)
      if (byStripped !== undefined) return byStripped
      let prefixHit = null
      for (const c of list) {
        const cs = strip(c)
        if (cs.length === 0 || cs === stripped) continue
        if (stripped.startsWith(cs) && /^[-_./:]/.test(stripped.slice(cs.length))) {
          if (prefixHit === null || strip(prefixHit).length < cs.length) prefixHit = c
        }
      }
      if (prefixHit !== null) return prefixHit
      const tokensOf = id => strip(id).split(/[-_./:]+/).filter(Boolean)
      const mt = tokensOf(modelId)
      if (mt.length < 2) return null
      let best = null
      let bestLen = 0
      for (const c of list) {
        const ct = tokensOf(c)
        let n = 0
        while (n < mt.length && n < ct.length && mt[n] === ct[n]) n += 1
        // 防跨版本误配(issue #18,与 pricing.js 同步):分歧位置两侧都是数字/版本号 token 时拒绝匹配。
        if (n < mt.length && n < ct.length && /^\d+$/.test(mt[n]) && /^\d+$/.test(ct[n])) continue
        if (n >= 2 && (n > bestLen || (n === bestLen && best !== null && c.length < best.length))) { best = c; bestLen = n }
      }
      return best
    }
    /**
     * 客户端价格解析(与 pricing.js providerPriceEntryFor 同口径):手动覆盖 → 精确 → 自动匹配。
     * @returns { entry, priced, billingMode, matched }。
     *   matched: 是否命中显式价格条目(含跨厂商兑底);false = DeepSeek 默认价兜底或完全未命中,
     *   未命中列表据此判定(与计费口径一致,路由 provider 前缀不再误报)。
     */
    /**
     * 客户端价格解析(与 pricing.js providerPriceEntryFor 同口径):手动覆盖 → 精确 → 自动匹配。
     * @returns { entry, priced, billingMode, matched }。
     *   matched: 是否命中显式价格条目(含跨厂商兑底);false = DeepSeek 默认价兜底或完全未命中,
     *   未命中列表据此判定(与计费口径一致,路由 provider 前缀不再误报)。
     */
    function resolveClientPrice(providerRaw, modelId, config) {
      const prices = config?.prices ?? {}
      const mode = config?.priceMatch === 'exact' ? 'exact' : 'auto'
      const overrides = config?.priceOverrides && typeof config.priceOverrides === 'object' ? config.priceOverrides : {}
      let provider = String(providerRaw ?? '').trim().toLowerCase()
      if (provider.startsWith('llm-')) provider = provider.slice(4)
      if (provider === '') provider = 'deepseek'
      let targetProvider = provider
      let targetModel = modelId
      const override = overrides[provider + ':' + modelId]
      if (typeof override === 'string' && override.length > 0) {
        const sep = override.indexOf(':')
        if (sep > 0 && override.slice(sep + 1).length > 0) {
          targetProvider = override.slice(0, sep).trim().toLowerCase()
          targetModel = override.slice(sep + 1)
        } else {
          targetModel = override
        }
        if (targetProvider === 'deepseek' && targetModel === '__default__') {
          return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: true, billingMode: 'deepseek-peak', matched: false }
        }
      }
      if (targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
        const models = prices.models ?? {}
        const hit = models[targetModel] !== undefined ? targetModel
          : (mode === 'auto' ? matchModelIdLocal(targetModel, Object.keys(models)) : null)
        if (hit !== null) return { entry: models[hit], priced: true, billingMode: 'deepseek-peak', matched: true }
        return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: true, billingMode: 'deepseek-peak', matched: false }
      }
      const catalog = prices.providers?.[targetProvider]?.models ?? {}
      const hit = catalog[targetModel] !== undefined ? targetModel
        : (mode === 'auto' ? matchModelIdLocal(targetModel, Object.keys(catalog)) : null)
      if (hit !== null) return { entry: catalog[hit], priced: catalog[hit]?.unpriced !== true, billingMode: 'flat', matched: true }
      // 跨厂商兑底(与 pricing.js 同口径):provider 未在价格表登记时按模型名全库查找。
      if (mode === 'auto') {
        const dsModels = prices.models ?? {}
        const dsHit = matchModelIdLocal(targetModel, Object.keys(dsModels))
        if (dsHit !== null) return { entry: dsModels[dsHit], priced: true, billingMode: 'deepseek-peak', matched: true }
        let bestEntry = null
        let bestLen = 0
        for (const [prov, table] of Object.entries(prices.providers ?? {})) {
          if (prov === targetProvider) continue
          const models = table?.models ?? {}
          const h = matchModelIdLocal(targetModel, Object.keys(models))
          if (h === null || models[h]?.unpriced === true) continue
          const score = canonModelIdLocal(h).length
          if (score > bestLen) { bestEntry = models[h]; bestLen = score }
        }
        if (bestEntry !== null) return { entry: bestEntry, priced: true, billingMode: 'flat', matched: true }
      }
      // issue #56 镜像:v1.5.42 及之前设置页下拉框把 DeepSeek 目标存成裸名,被按
      // 「同渠道换名」解析后查无此价。此处对「裸值覆盖 + 非 DeepSeek 渠道解析失败」
      // 回退 DeepSeek 主表再查一次(仅显式条目/归一化匹配,不吃默认兜底价),
      // 与宿主计费口径保持一致,存量裸名配置自愈且不进未命中列表。
      if (provider !== 'deepseek' && !provider.includes('deepseek')
        && typeof override === 'string' && override.length > 0 && !override.includes(':')) {
        const dsModels = prices.models ?? {}
        const retryHit = dsModels[override] !== undefined ? override
          : (mode === 'auto' ? matchModelIdLocal(override, Object.keys(dsModels)) : null)
        if (retryHit !== null) return { entry: dsModels[retryHit], priced: true, billingMode: 'deepseek-peak', matched: true }
      }
      return { entry: null, priced: false, billingMode: 'flat', matched: false }
    }
    /** 投影 token 桶 → 按当前时刻档位计价的美元成本。 */
    function usageCost(usage, config) {
      if (!usage || !config) return 0
      // 宿主按事件时刻逐次计费的成本(历史正确,含峰谷时代前的旧基础价);
      // 旧宿主/旧状态缺失 cost 时回退客户端估算。
      if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) return usage.cost
      const peak = {
        enabled: config.peakEnabled === true,
        effectiveAtMs: Date.parse(config.peakEffectiveAt || ''),
        windows: config.peakWindows,
      }
      const now = Date.now()
      const byModel = usage.byProviderModel ?? usage.byModel ?? {}
      let total = 0
      for (const providerKey of Object.keys(byModel)) {
        const separator = providerKey.indexOf(':')
        const provider = separator > 0 ? providerKey.slice(0, separator) : 'deepseek'
        const modelId = separator > 0 ? providerKey.slice(separator + 1) : providerKey
        const resolved = resolveClientPrice(provider, modelId, config)
        if (resolved.priced) total += costOfBuckets(byModel[providerKey], tierFor(normalizeClientPrice(resolved.entry), now, { ...peak, enabled: resolved.billingMode === 'deepseek-peak' && peak.enabled }))
      }
      const modeled = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
      for (const modelId of Object.keys(byModel)) {
        modeled.input += byModel[modelId].input ?? 0
        modeled.output += byModel[modelId].output ?? 0
        modeled.cacheRead += byModel[modelId].cacheRead ?? 0
        modeled.cacheWrite += byModel[modelId].cacheWrite ?? 0
        modeled.reasoning += byModel[modelId].reasoning ?? 0
      }
      const leftover = {
        input: Math.max(0, (usage.input ?? 0) - modeled.input),
        output: Math.max(0, (usage.output ?? 0) - modeled.output),
        cacheRead: Math.max(0, (usage.cacheRead ?? 0) - modeled.cacheRead),
        cacheWrite: Math.max(0, (usage.cacheWrite ?? 0) - modeled.cacheWrite),
        reasoning: Math.max(0, (usage.reasoning ?? 0) - modeled.reasoning),
      }
      total += costOfBuckets(leftover, tierFor(priceEntryFor('default', config.prices), now, peak))
      return total
    }
    function billedInput(usage) {
      return (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)
    }

    // ── 客户端状态存储 ──────────────────────────────────────────────────────

    function makeStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: fn => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        set: next => {
          if (next === snapshot) return
          snapshot = next
          for (const fn of [...listeners]) fn()
        },
      }
    }

    const { createElement: el, Fragment, useState, useEffect, useMemo, useCallback, useRef } = React

    // ── 钱包图标:官方填充式单色 SVG(16×16),与 @deepseek-ai/dsh-client-ui-primitives 同构 ──

    function WalletIcon({ size = 16, className }) {
      return el('svg', { width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        el('path', {
          d: 'M4 4H12A2 2 0 0 1 14 6V11.5A2 2 0 0 1 12 13.5H4A2 2 0 0 1 2 11.5V6A2 2 0 0 1 4 4ZM4 5.3H12A0.7 0.7 0 0 1 12.7 6V11.5A0.7 0.7 0 0 1 12 12.2H4A0.7 0.7 0 0 1 3.3 11.5V6A0.7 0.7 0 0 1 4 5.3Z',
          fill: 'currentColor',
          fillRule: 'evenodd',
        }),
        el('path', { d: 'M3.3 5.3H12.7V7.1H3.3Z', fill: 'currentColor' }),
        el('path', { d: 'M8 2.8A1.3 1.3 0 1 0 8 5.4A1.3 1.3 0 1 0 8 2.8Z', fill: 'currentColor' }))
    }

    // ── 会话费用徽章(dock / header) ────────────────────────────────────────

    function SessionCost(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      const cost = usageCost(usage, config)
      const input = billedInput(usage)
      if (!usage || !config || (input + (usage?.output ?? 0)) === 0) return null
      const t = makeT(resolveLocale(config.locale))
      const detail = [
        t('sessionCostTitle'),
        t('sessionDetailTokens', {
          input: formatTokens(usage?.input ?? 0),
          cache: formatTokens((usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)),
          output: formatTokens(usage?.output ?? 0),
        }),
        t('sessionDetailCache', {
          read: formatTokens(usage?.cacheRead ?? 0),
          write: formatTokens(usage?.cacheWrite ?? 0),
        }),
        t('cost', { amount: formatMoneyUsd(cost, config) }),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'top', delayMs: 500 },
        el('div', { className: 'cm-chip' }, t('cost', { amount: formatMoneyUsd(cost, config) })))
    }

    function DockLine(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      if (!usage || !config) return null
      const input = usage.input ?? 0
      const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
      const output = usage.output ?? 0
      if (input + cache + output === 0) return null
      const cost = usageCost(usage, config)
      const t = makeT(resolveLocale(config.locale))
      return el('div', { className: 'cm-root' },
        t('sessionLine', {
          amount: formatMoneyUsd(cost, config),
          input: formatTokens(input),
          cache: formatTokens(cache),
          output: formatTokens(output),
        }))
    }

    // ── 侧边栏:余额行 + 预算图框/今日徽章(纵向堆叠,位于设置按钮上方) ──────

    function formatBalanceMoney(value, config) {
      // 余额是官方接口返回的记账币种金额(如 CNY),不经过汇率换算。
      return formatMoneyValue(value, { symbol: config.symbol, decimals: Math.max(2, Math.min(10, Math.floor(Number(config.decimals) || 2))) })
    }


    /**
     * 峰谷相位与相邻切换点(与 lib/pricing.js 的 peakPhaseAt 同逻辑;bundle 无法导入,
     * 修改时两处需同步)。窗口半开区间 [start, end),兼容跨午夜窗口。
     * 周末全谷价:处于周末区间时返回 weekend: true(当前谷),下一切换点为下一工作日
     * 首个峰窗口起点;工作日侧扫描 ±4 天并剔除落在周末区间内的切换点。
     */
    function peakPhaseAt(atMs, windows) {
      if (!Array.isArray(windows) || windows.length === 0 || !Number.isFinite(atMs)) return null
      const hourAt = (dayOffset, hour) => {
        const date = new Date(atMs)
        date.setUTCDate(date.getUTCDate() + dayOffset)
        date.setUTCHours(hour, 0, 0, 0)
        return date.getTime()
      }
      const points = []
      for (let day = -4; day <= 4; day += 1) {
        for (const w of windows) {
          const start = Number(w?.start)
          const end = Number(w?.end)
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue
          const pStart = { at: hourAt(day, start), intoPeak: true }
          const pEnd = { at: hourAt(end <= start ? day + 1 : day, end), intoPeak: false }
          if (weekendZoneAt(pStart.at) === null) points.push(pStart)
          if (weekendZoneAt(pEnd.at) === null) points.push(pEnd)
        }
      }
      let prev = null
      let next = null
      for (const p of points) {
        if (p.at <= atMs && (prev === null || p.at > prev.at)) prev = p
        if (p.at > atMs && (next === null || p.at < next.at)) next = p
      }
      const wk = weekendZoneAt(atMs)
      if (wk !== null) {
        if (next === null) return null
        return { inPeak: false, weekend: true, prevAtMs: wk.start, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
      }
      if (prev === null || next === null) return null
      const inPeak = isPeakHour(atMs, undefined, windows)
      return { inPeak, weekend: false, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
    }
    /** 峰谷显示门控:peakEnabled + peakEffectiveAt + 非空窗口;不满足返回 null。peakNotice 只控制峰时文字强调,不隐藏整条。 */
    function peakView(config, now) {
      if (!config || config.peakEnabled !== true) return null
      const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
      if (Number.isFinite(effectiveAtMs) && now < effectiveAtMs) return null
      const windows = Array.isArray(config.peakWindows) ? config.peakWindows : []
      return peakPhaseAt(now, windows)
    }

    /** 倒计时文本(距下次相位切换,向上取整到分钟)。 */
    function countdownText(view, now, t) {
      const duration = Math.max(0, view.nextAtMs - now)
      const minutes = Math.max(1, Math.ceil(duration / 60000))
      const hours = Math.floor(minutes / 60)
      const mins = minutes % 60
      return hours > 0
        ? (mins > 0 ? t('countdownHourMinute', { h: hours, m: mins }) : t('countdownHoursOnly', { h: hours }))
        : t('countdownMinute', { m: minutes })
    }

    /**
     * 峰谷轨道几何:24h 一天(0%–100%)按北京时间绘制峰(橙)段,其余为谷(蓝)段,
     * marker 落在当前北京时间时刻。config.peakWindows 为 UTC 小时半开区间,先 +8h
     * 折算为北京小时;跨午夜窗口拆两段。周末全谷时无峰段(整条蓝)。
     * @returns { peakSegments: [{start,end}], markerPct, weekend } 百分比坐标(0–100)。
     */
    function peakTrackGeometry(config, atMs) {
      const windows = Array.isArray(config?.peakWindows) ? config.peakWindows : []
      const weekend = weekendZoneAt(atMs) !== null
      const beijingHour = (Math.floor(atMs / 3600000) % 24 + 8) % 24
      const markerPct = ((beijingHour + (atMs % 3600000) / 3600000) / 24) * 100
      const peakSegments = []
      if (!weekend) {
        for (const w of windows) {
          let start = Number(w?.start)
          let end = Number(w?.end)
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue
          start = (Math.floor(start) + 8) % 24
          end = (Math.floor(end) + 8) % 24
          if (start === end) continue
          if (end <= start) {
            // 跨午夜窗口:拆两段(如 22:00–02:00 北京)。
            peakSegments.push({ start: 0, end: end })
            peakSegments.push({ start: start, end: 24 })
          } else {
            peakSegments.push({ start, end })
          }
        }
      }
      return { peakSegments, markerPct, weekend }
    }

    // 预览通道事件名:设置页按钮/控制台经 window.cmPeakAlertPreview(kind) 触发真实组件。
    const PEAK_ALERT_PREVIEW_EVENT = 'cm-peak-alert-preview'

    // 峰谷 Web 通知去重:记录最近一次已通知的切换点时刻(nextAtMs)。
    // 必须放模块级——配置变化会重挂 PeakAlert(内部 ref 归零),若用组件内状态,
    // 重挂后同一切换点会再发一条;切换点时刻单调递增,存单值即可。
    let lastPeakNotifyAtMs = 0

    /**
     * 峰/谷切换前弹窗提醒:距下次相位切换不足配置提前量(默认 2 分钟)时弹浮层,
     * 位置可选屏幕右下角 / 屏幕中心;提醒类型按配置过滤(进入峰/进入谷/峰和谷);
     * 同一切换点只弹一次(手动关闭即记点),切换完成后浮层自然消失。
     * 若开启 Web 通知且有授权,还会在同一切换点向系统发送一次浏览器通知。
     * 预览:window.cmPeakAlertPreview('peak'|'offpeak') 用真实组件/文案/位置/通知
     * 渲染一次弹窗(峰谷计价启用时常驻监听,提醒开关关闭也可预览)。
     */
    function PeakAlert(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      const [now, setNow] = useState(Date.now())
      const [dismissedAt, setDismissedAt] = useState(null)
      const [preview, setPreview] = useState(null)
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 10000)
        return () => window.clearInterval(timer)
      }, [])
      // 预览通道:监听自定义事件(事件由 activate 顶层的 window.cmPeakAlertPreview 派发),
      // 组件挂载期间置在线标志,供 API 判断弹窗宿主是否可用。
      useEffect(() => {
        const onPreview = event => {
          const kind = event.detail?.kind === 'offpeak' ? 'offpeak' : 'peak'
          setPreview(kind)
          // 预览系统通知:遵循 Web 通知开关与授权,标题加预览标记。
          const cfg = costStore?.state?.config
          if (cfg?.peakAlertWebNotify === true && window.Notification && Notification.permission === 'granted') {
            const pt = makeT(resolveLocale(cfg.locale))
            try {
              new Notification(pt(kind === 'peak' ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak') + pt('peakAlertPreviewTag'),
                { body: pt('peakAlertBody', { time: pt('countdownMinute', { m: 2 }), phase: pt(kind === 'peak' ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak') }) })
            } catch (_) { /* 通知被系统拒绝时静默 */ }
          }
        }
        window.addEventListener(PEAK_ALERT_PREVIEW_EVENT, onPreview)
        window.__cmPeakAlertLive = true
        return () => {
          window.removeEventListener(PEAK_ALERT_PREVIEW_EVENT, onPreview)
          window.__cmPeakAlertLive = false
        }
      }, []) // eslint-disable-line react-hooks/exhaustive-deps
      useEffect(() => {
        // Web 通知:每次 tick 自包含重算切换点,按切换点(nextAtMs)在模块级去重,
        // 同一切换点只发一次(旧实现比较 tick 时间戳,每 10 秒都"未通知过",会连发)。
        if (!config || config.peakAlertEnabled !== true || config.peakEnabled !== true) return
        if (config.peakAlertWebNotify !== true || !window.Notification || Notification.permission !== 'granted') return
        const wv = peakPhaseAt(now, Array.isArray(config.peakWindows) ? config.peakWindows : [])
        if (wv === null) return
        const tgt = config.peakAlertTarget === 'peak' || config.peakAlertTarget === 'offpeak' ? config.peakAlertTarget : 'both'
        const intoPeak = wv.nextIntoPeak === true
        if (tgt !== 'both' && tgt !== (intoPeak ? 'peak' : 'offpeak')) return
        const mins = Number(config.peakAlertAhead)
        const aheadMs = (Number.isFinite(mins) && mins >= 1 ? mins : 2) * 60000
        if (now < wv.nextAtMs - aheadMs || now >= wv.nextAtMs) return
        if (lastPeakNotifyAtMs === wv.nextAtMs) return
        const t = makeT(resolveLocale(config.locale))
        lastPeakNotifyAtMs = wv.nextAtMs
        try {
          new Notification(
            t(intoPeak ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak'),
            { body: t('peakAlertBody', { time: countdownText(wv, now, t), phase: t(intoPeak ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak') }) })
        } catch (_) { /* 通知被系统拒绝时静默 */ }
      }, [now]) // eslint-disable-line react-hooks/exhaustive-deps
      if (!config || config.peakEnabled !== true) return null
      // 真实弹窗判定:提醒开关开启 + 已生效 + 相位/类型/提前量窗口内 + 未手动关闭。
      let real = null
      if (config.peakAlertEnabled === true) {
        const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
        if (!(Number.isFinite(effectiveAtMs) && now < effectiveAtMs)) {
          const view = peakPhaseAt(now, Array.isArray(config.peakWindows) ? config.peakWindows : [])
          if (view !== null) {
            const target = config.peakAlertTarget === 'peak' || config.peakAlertTarget === 'offpeak' ? config.peakAlertTarget : 'both'
            const aheadMinutes = Number(config.peakAlertAhead)
            const aheadMs = (Number.isFinite(aheadMinutes) && aheadMinutes >= 1 ? aheadMinutes : 2) * 60000
            if ((target === 'both' || target === (view.nextIntoPeak ? 'peak' : 'offpeak'))
              && now >= view.nextAtMs - aheadMs && now < view.nextAtMs && dismissedAt !== view.nextAtMs) real = view
          }
        }
      }
      // 渲染:真实窗口激活用真实切换点;否则若有预览请求,用虚拟切换点(2 分钟后)。
      let view = null, intoPeak = false, dismiss = null
      if (real !== null) {
        view = real
        intoPeak = real.nextIntoPeak === true
        dismiss = () => setDismissedAt(real.nextAtMs)
      } else if (preview !== null) {
        view = { nextAtMs: now + 2 * 60000, nextIntoPeak: preview === 'peak' }
        intoPeak = preview === 'peak'
        dismiss = () => setPreview(null)
      } else return null
      const t = makeT(resolveLocale(config.locale))
      const position = config.peakAlertPosition === 'center' ? 'cm-peak-alert-center' : 'cm-peak-alert-corner'
      return el('div', { className: 'cm-peak-alert ' + position + ' ' + (intoPeak ? 'cm-peak-alert-peak' : 'cm-peak-alert-offpeak'), role: 'alert' },
        el('div', { className: 'cm-peak-alert-badge' }, t(intoPeak ? 'peakAlertBadgePeak' : 'peakAlertBadgeOffPeak')),
        el('div', { className: 'cm-peak-alert-title' }, t(intoPeak ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak')),
        el('div', { className: 'cm-peak-alert-body' }, t('peakAlertBody', {
          time: countdownText(view, now, t),
          phase: t(intoPeak ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak'),
        })),
        el('div', { className: 'cm-peak-alert-actions' },
          el('button', { className: 'cm-btn', onClick: dismiss }, t('peakAlertBtn'))))
    }

    /** 预算图框内容(不含外框),供单独显示与「Go+预算」合并卡片复用;详细信息按 budget.detail 开关。 */
    // 注:预算功能已裁剪,此注释仅保留上下文。

    /** 展开态卡片时间条:仅轨道(橙=峰,蓝=谷)+ 白色短线标记当前时刻(上下略微出头),
     *  无任何文字。peakEnabled 未启用时返回 null。
     *  注意:必须是独立组件(经 el() 渲染)——内部有 useState/useEffect,
     *  若作为普通函数在 SidebarFooter 渲染体内直接调用,这些 hooks 会计入父组件,
     *  与 SidebarFooter 的「state 未就绪时提前 return」组合会触发 React #310
     *  (rendered more hooks than during the previous render)。 */
    function PeakCardTrack(props) {
      const { config } = props
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [])
      const view = peakView(config, now)
      if (view === null) return null
      const geom = peakTrackGeometry(config, now)
      // marker 放在轨道外的兄弟层:轨道 overflow:hidden 负责圆角裁剪,marker 上下出头不受影响。
      return el('div', { className: 'cm-peak-card' },
        el('div', { className: 'cm-peak-card-track' },
          geom.peakSegments.map((seg, i) => el('div', {
            key: 'p' + String(i),
            className: 'cm-peak-segment cm-peak-high',
            style: { left: seg.start / 24 * 100 + '%', width: (seg.end - seg.start) / 24 * 100 + '%' },
          }))),
        el('div', { className: 'cm-peak-card-marker', style: { left: geom.markerPct + '%' } }))
    }

    /** 收起态卡片竖时间条:竖轨道 + 白色横线标记当前时刻,无文字。 */
    function PeakCardRail(props) {
      const { config } = props
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [])
      const view = peakView(config, now)
      if (view === null) return null
      const geom = peakTrackGeometry(config, now)
      return el('div', { className: 'cm-peak-card-rail' },
        el('div', { className: 'cm-peak-card-rail-track' },
          geom.peakSegments.map((seg, i) => el('div', {
            key: 'p' + String(i),
            className: 'cm-peak-rail-segment cm-peak-rail-high',
            style: { top: seg.start / 24 * 100 + '%', height: (seg.end - seg.start) / 24 * 100 + '%' },
          }))),
        el('div', { className: 'cm-peak-card-rail-marker', style: { top: geom.markerPct + '%' } }))
    }

    // 材料图标 mdiSync(双箭头循环,语义=刷新/同步);路径来自 @mdi/js@7.4.47。
    const MDI_SYNC_PATH = 'M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z'

    function SidebarFooter(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = costStore?.state
      const wide = !!props.wide
      const rootRef = useRef(null)
      // 费用浮层开关(SidebarFooter 本地状态;浮层作为本组件子树渲染,fixed 定位)。
      const [overlayOpen, setOverlayOpen] = useState(false)
      const closeOverlay = () => setOverlayOpen(false)
      // 本会话费用订阅:SessionCostBridge 更新时触发重渲染。
      const [, forceRender] = useState(0)
      useEffect(() => subscribeSessionCost(() => forceRender(n => n + 1)), [])
      // 手动刷新进行中(刷新按钮旋转反馈)。
      const [refreshing, setRefreshing] = useState(false)
      // 兼容外壳 footerActions 与其它插件(如 dsh-remote-web-ui 的「更新/远程控制」行)的图标布局:
      // - 展开(wide):本插件堆叠保持在最左侧;
      // - 窄栏(rail):把外壳容器改为纵向排布,本插件置底,同一行的其它插件图标上移。
      useEffect(() => {
        const root = rootRef.current
        const parent = root?.parentElement
        if (!root || !parent) return
        const apply = () => {
          if (wide) {
            if (parent.firstElementChild !== root) parent.insertBefore(root, parent.firstElementChild)
          } else {
            if (parent.lastElementChild !== root) parent.appendChild(root)
          }
        }
        apply()
        const observer = new MutationObserver(() => { if (root.isConnected) apply() })
        observer.observe(parent, { childList: true })
        if (wide) {
          parent.style.flexDirection = ''
          parent.style.flexWrap = ''
          parent.style.alignItems = ''
          parent.style.gap = ''
        } else {
          parent.style.flexDirection = 'column'
          parent.style.flexWrap = 'nowrap'
          parent.style.alignItems = 'center'
          parent.style.gap = '6px'
        }
        return () => {
          observer.disconnect()
          if (!wide) {
            parent.style.flexDirection = ''
            parent.style.flexWrap = ''
            parent.style.alignItems = ''
            parent.style.gap = ''
          }
        }
      }, [wide, state])
      if (!state) return null
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      const showBalance = (config.balance?.display === 'sidebar' || config.balance?.display === 'both')
        && config.hideOfficialBalance !== true
      const showToday = config.sidebar !== false && config.hideTodayCost !== true
      const showSession = typeof currentSessionCost === 'number' && Number.isFinite(currentSessionCost)
      if (!showBalance && !showToday && !showSession) return null
      const openOverlay = () => setOverlayOpen(true)
      const keyOpen = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOverlay() }
      }
      // 合并卡片(四元素一体,整卡为点击入口):行0 当日起始余额条,行1 余额+今日,行2 今日当前会话+刷新,行3 时间条。
      const balanceItem = showBalance ? el('span', { className: 'cm-foot-item' },
        el('span', { className: 'cm-foot-label' }, t('balance')),
        el('span', { className: 'cm-num' }, formatBalanceMoney(state.balance?.totalBalance ?? 0, config))) : null
      const todayItem = showToday ? el('span', { className: 'cm-foot-item' },
        el('span', { className: 'cm-foot-label' }, t('today')),
        el('span', { className: 'cm-num' }, formatMoneyUsd(state.today.cost, config))) : null
      const sessionItem = showSession ? el('span', { className: 'cm-foot-item' },
        el('span', { className: 'cm-foot-label' }, t('sessionToday')),
        el('span', { className: 'cm-num' }, formatMoneyUsd(currentSessionCost, config))) : null
      // 手动刷新:强制拉官方余额(行1 立即更新)+ 立即重拉本会话费用(行2,不等 30s 轮询)。
      // 余额显示关闭时 refreshBalance 返回 ok:false,静默忽略即可(行1 本就不显示)。
      const doRefresh = async () => {
        if (refreshing) return
        setRefreshing(true)
        try {
          if (props.api !== undefined) { try { await props.api.refreshBalance() } catch (_) { /* 网络失败静默:行1 下次轮询自动恢复 */ } }
          if (requestSessionCostRefresh !== null) requestSessionCostRefresh()
        } finally {
          setRefreshing(false)
        }
      }
      const refreshBtn = el('button', {
        type: 'button',
        className: 'cm-foot-refresh' + (refreshing ? ' spin' : ''),
        'aria-label': t('clickToRefresh'),
        title: t('clickToRefresh'),
        onClick: event => { event.stopPropagation(); void doRefresh() },
        onKeyDown: event => {
          if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); void doRefresh() }
        },
      }, el('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, el('path', { d: MDI_SYNC_PATH })))
      // 当日起始余额条(行0):记录零点余额或当日充值后的余额;仅当基准为今天且余额为正时显示。
      // 分段(左→右):充值余额(浅灰)→ 赠送余额(DS 蓝,中间)→ 今日已消费(深灰,右端)。
      // 官方扣费顺序 = 先赠送后充值,故「今日消耗」优先替换蓝色赠送段,再吃充值段。
      const startBar = (() => {
        if (!wide) return null
        const ref = state.balanceRef
        if (ref === null || typeof ref !== 'object' || ref.date !== state.meta?.dayKey) return null
        const total = Number(ref.total)
        if (!Number.isFinite(total) || total <= 0) return null
        const rate = Number(config?.exchangeRate)
        const effRate = (ref.currency === 'CNY' || ref.currency === 'cny') && Number.isFinite(rate) && rate > 0 ? rate : 1
        // 消费金额折算为基准币种;余额可能被消费超过起始基准(充值重置前),按起始余额封顶。
        const spent = Math.min(total, Math.max(0, state.today.cost * effRate))
        const granted = Math.min(total, Math.max(0, Number.isFinite(Number(ref.granted)) ? Number(ref.granted) : 0))
        // 先扣赠送:赠送剩余 = granted - spent;充值剩余 = total - granted - max(0, spent - granted)。
        const grantRemain = Math.max(0, granted - spent)
        const paidRemain = Math.max(0, total - granted - Math.max(0, spent - granted))
        const pct = value => (value / total * 100).toFixed(2) + '%'
        return el('div', { className: 'cm-foot-startbar' },
          el('div', { className: 'cm-foot-startbar-paid', style: { width: pct(paidRemain) } }),
          grantRemain > 0.0001 ? el('div', { className: 'cm-foot-startbar-grant', style: { width: pct(grantRemain) } }) : null,
          spent > 0.0001 ? el('div', { className: 'cm-foot-startbar-spent', style: { width: pct(spent) } }) : null)
      })()
      // 行1(余额+今日);会话行隐藏时刷新按钮挪到行1 右端。
      const firstRow = (balanceItem !== null || todayItem !== null)
        ? el('div', { className: 'cm-foot-card-row' }, balanceItem, todayItem, sessionItem === null ? refreshBtn : null)
        : null
      const sessionRow = sessionItem !== null
        ? el('div', { className: 'cm-foot-card-row' }, sessionItem, refreshBtn)
        : null
      return el(Fragment, null,
        el('div', { ref: rootRef, className: 'cm-footer-stack' + (wide ? '' : ' rail') },
          el('div', {
            className: 'cm-foot-card' + (wide ? '' : ' rail'),
            role: 'button', tabIndex: 0,
            'aria-label': t('openCostOverlay'),
            onClick: openOverlay,
            onKeyDown: keyOpen,
          },
            wide
              ? el(Fragment, null,
                startBar,
                firstRow,
                sessionRow,
                el(PeakCardTrack, { config }))
              : el(Fragment, null,
                el('div', { className: 'cm-foot-card-row' },
                  balanceItem !== null ? el(WalletIcon, { size: 14 }) : null,
                  todayItem !== null ? el(WalletIcon, { size: 14 }) : null,
                  sessionItem !== null ? el(WalletIcon, { size: 14 }) : null),
                el(PeakCardRail, { config })))),
        overlayOpen ? el(CostOverlay, { ...props, onClose: closeOverlay, useCost: props.useCost }) : null)
    }

    // ── 设置页「费用」 ──────────────────────────────────────────────────────

    function Card(props) {
      // 数据项逐行居中显示(lines);悬浮说明(title)为计费时间口径说明(tip)。
      return el('div', { className: 'cm-card', title: props.tip },
        el('p', { className: 'cm-card-title' }, props.title),
        el('div', { className: 'cm-card-value cm-num' }, props.value),
        Array.isArray(props.lines) && props.lines.length > 0
          ? el('div', { className: 'cm-card-sub' }, props.lines.map((ln, i) => el('p', { key: i, className: 'cm-card-line' }, ln)))
          : null)
    }

    // 历史记录折叠面板(issue #22):三角展开/收起,内部为按天表格(日期行再展开会话明细)。
    function HistoryPanel(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const [open, setOpen] = useState(false)
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), onClick: () => setOpen(!open) },
            el('span', { className: 'cm-caret' + (open ? ' open' : '') }),
            el('h3', { className: 'cm-h' }, t('history')))),
        open ? el('div', { className: 'cm-collapse-body' }, el(HistoryTable, { state, api })) : null)
    }

    function HistoryTable(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      // 点击日期行展开当日会话明细(issue #22):按需经 getDaySessions 拉取并缓存。
      const [openDate, setOpenDate] = useState(null)
      const [cache, setCache] = useState({})
      const [busyDate, setBusyDate] = useState(null)
      const rows = state.history ?? []
      if (rows.length === 0) return el('p', { className: 'cm-empty' }, t('noHistory'))
      const toggle = date => {
        if (openDate === date) { setOpenDate(null); return }
        setOpenDate(date)
        if (cache[date] !== undefined || busyDate !== null) return
        setBusyDate(date)
        api.getDaySessions(date)
          .then(day => setCache(c => ({ ...c, [date]: Array.isArray(day?.sessions) ? day.sessions : [] })))
          .catch(() => setCache(c => ({ ...c, [date]: 'error' })))
          .finally(() => setBusyDate(null))
      }
      const sessionRows = sessions => sessions.map(session => el('tr', { key: session.id },
        sessionCell(session, state.config?.showSessionId === true),
        el('td', { className: 'num' }, String(session.calls)),
        el('td', { className: 'num' }, formatTokens(session.input)),
        el('td', { className: 'num' }, formatTokens(session.cacheRead + session.cacheWrite)),
        el('td', { className: 'num' }, formatTokens(session.output)),
        el('td', { className: 'num' }, formatMoneyUsd(session.cost, state.config))))
      return el('div', { className: 'cm-scroll' },
        el('p', { className: 'cm-hint', style: { padding: '6px 10px 0' } }, t('historyExpandHint')),
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, t('colDate')), el('th', { className: 'num' }, t('colCalls')),
            el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
            el('th', { className: 'num' }, t('colCost')))),
          el('tbody', null, rows.flatMap(day => {
            const base = el('tr', { key: day.date, className: 'cm-row-click', onClick: () => toggle(day.date) },
              el('td', null, (openDate === day.date ? '▾ ' : '▸ ') + day.date),
              el('td', { className: 'num' }, String(day.calls)),
              el('td', { className: 'num' }, formatTokens(day.input)),
              el('td', { className: 'num' }, formatTokens(day.cacheRead + day.cacheWrite)),
              el('td', { className: 'num' }, formatTokens(day.output)),
              el('td', { className: 'num' }, formatMoneyUsd(day.cost, state.config)))
            if (openDate !== day.date) return [base]
            const cached = cache[day.date]
            const detail = busyDate === day.date && cached === undefined
              ? el('p', { className: 'cm-empty' }, t('historySessionsLoading'))
              : cached === 'error'
                ? el('p', { className: 'cm-empty' }, t('historySessionsError'))
                : !Array.isArray(cached) || cached.length === 0
                  ? el('p', { className: 'cm-empty' }, t('historyNoSessions'))
                  : el('table', { className: 'cm-table' },
                    el('thead', null, el('tr', null,
                      el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
                      el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
                      el('th', { className: 'num' }, t('colCost')))),
                    el('tbody', null, sessionRows(cached)))
            return [base, el('tr', { key: day.date + '-sessions' }, el('td', { colSpan: 6 }, detail))]
          }))))
    }

    // 历史表格中的单会话首格(会话 id/标题,showId 开启时展示 id)。
    function sessionCell(session, showId) {
      const rawTitle = typeof session.title === 'string' ? session.title.trim() : ''
      const shortId = String(session.id).slice(0, 14) + '…'
      const main = rawTitle.length > 0 ? rawTitle : shortId
      const tooltip = rawTitle.length > 0 ? rawTitle + ' · ' + session.id : session.id
      return el('td', { title: tooltip },
        el('div', { className: 'cm-sess-title' + (rawTitle.length === 0 ? ' cm-sess-id' : '') }, main),
        showId && rawTitle.length > 0 ? el('div', { className: 'cm-sess-id' }, shortId) : null)
    }

    // 按会话统计(issue #22 不分日期视角):全部历史会话排行,默认收起、展开时按需拉取;排序可切换。
    function SessionRankPanel(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const [open, setOpen] = useState(false)
      const [limit, setLimit] = useState(100)
      // 排序模式:cost-desc / cost-asc / time-desc / time-asc / recent(实时顺序)。
      const [sortMode, setSortMode] = useState('cost-desc')
      const [rows, setRows] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(false)
      const load = (n, mode) => {
        const [sort, dir] = mode === 'recent' ? ['recent', 'desc'] : mode.split('-')
        setBusy(true)
        setErr(false)
        api.getTopSessions(n, sort, dir)
          .then(res => setRows(Array.isArray(res?.sessions) ? res.sessions : []))
          .catch(() => setErr(true))
          .finally(() => setBusy(false))
      }
      const toggle = () => {
        setOpen(o => {
          const next = !o
          if (next && rows === null && !busy) load(limit, sortMode)
          return next
        })
      }
      const changeLimit = n => {
        setLimit(n)
        if (open || rows !== null) load(n, sortMode)
      }
      const changeSort = mode => {
        setSortMode(mode)
        if (open || rows !== null) load(limit, mode)
      }
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), onClick: toggle },
            el('span', { className: 'cm-caret' + (open ? ' open' : '') }),
            el('h3', { className: 'cm-h' }, t('sessionRankTitle')))),
        open ? el('div', { className: 'cm-collapse-body' },
          el('p', { className: 'cm-hint' }, t('sessionRankHint')),
          el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '6px 0' } },
            el('div', { className: 'cm-field' },
              el('label', null, t('sessionRankSort')),
              el('select', { className: 'cm-input', value: sortMode, onChange: event => changeSort(event.target.value) },
                el('option', { value: 'cost-desc' }, t('sessionSortCostDesc')),
                el('option', { value: 'cost-asc' }, t('sessionSortCostAsc')),
                el('option', { value: 'time-desc' }, t('sessionSortTimeDesc')),
                el('option', { value: 'time-asc' }, t('sessionSortTimeAsc')),
                el('option', { value: 'recent' }, t('sessionSortRecent')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('sessionRankLimit')),
              el('select', { className: 'cm-input', value: String(limit), onChange: event => changeLimit(Number(event.target.value)) },
                el('option', { value: '50' }, '50'),
                el('option', { value: '100' }, '100'),
                el('option', { value: '200' }, '200')))),
          busy ? el('p', { className: 'cm-empty' }, t('sessionRankLoading'))
            : err ? el('p', { className: 'cm-empty' }, t('sessionRankError'))
              : rows === null || rows.length === 0 ? el('p', { className: 'cm-empty' }, t('sessionRankEmpty'))
                : el('div', { className: 'cm-scroll' },
                  el('table', { className: 'cm-table' },
                    el('thead', null, el('tr', null,
                      el('th', null, t('colDate')), el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
                      el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
                      el('th', { className: 'num' }, t('colCost')))),
                    el('tbody', null, rows.map(session => el('tr', { key: session.date + ':' + session.id },
                      el('td', null, session.date),
                      sessionCell(session, state.config?.showSessionId === true),
                      el('td', { className: 'num' }, String(session.calls)),
                      el('td', { className: 'num' }, formatTokens(session.input)),
                      el('td', { className: 'num' }, formatTokens((session.cacheRead ?? 0) + (session.cacheWrite ?? 0))),
                      el('td', { className: 'num' }, formatTokens(session.output)),
                      el('td', { className: 'num' }, formatMoneyUsd(session.cost, state.config))))))))
          : null)
    }


    const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    /** 单日 token 总量(输入 + 缓存读写 + 输出)。 */
    const dayTokensOf = day => (day.input ?? 0) + (day.output ?? 0) + (day.cacheRead ?? 0) + (day.cacheWrite ?? 0)

    function UsagePanel(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = props.state ?? costStore?.state
      if (!state) return null
      const config = state.config
      const locale = resolveLocale(config?.locale)
      const t = props.t ?? makeT(locale)
      const history = Array.isArray(state.history) ? state.history : []
      // 与下方「按日期统计 / 按会话统计」同款折叠卡片(默认折叠)。
      const [open, setOpen] = useState(false)
      const head = el('div', { className: 'cm-budget-head' },
        el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), onClick: () => setOpen(!open) },
          el('span', { className: 'cm-caret' + (open ? ' open' : '') }),
          el('h3', { className: 'cm-h' }, t('usageTitle'))))
      if (history.length === 0) {
        return el('div', { className: 'cm-budget' }, head,
          open ? el('div', { className: 'cm-collapse-body' }, el('p', { className: 'cm-empty' }, t('usageEmpty'))) : null)
      }
      const todayKey = state.meta?.dayKey ?? ''
      // Codex 用量图风格:最近 26 周的方格热图(列 = 周、行 = 周一至周日),
      // 格子 aspect-ratio 自适应,横向铺满整个设置页宽度;未来日与零消耗日同款格子,矩形完整;
      // 月份标签在网格下方,标在月份变化的列;无星期标签(与参考样式一致)。
      const byDate = new Map(history.map(day => [day.date, day]))
      const dayKeyOf = d => {
        const pad = n => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      }
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const end = new Date(today)
      end.setDate(end.getDate() + (6 - (today.getDay() + 6) % 7)) // 对齐到本周周日
      const WEEKS = 26
      const columns = []
      const monthLabels = []
      let lastMonth = -1
      for (let w = WEEKS - 1; w >= 0; w -= 1) {
        for (let i = 0; i < 7; i += 1) {
          const d = new Date(end)
          d.setDate(d.getDate() - (w * 7 + (6 - i)))
          const day = byDate.get(dayKeyOf(d))
          columns.push(day !== undefined ? { day, tokens: dayTokensOf(day) } : { day: { date: dayKeyOf(d) }, tokens: 0 })
        }
        const m = new Date(end)
        m.setDate(m.getDate() - (w * 7 + 6))
        monthLabels.push(m.getMonth() !== lastMonth ? (locale === 'en' ? EN_MONTHS[m.getMonth()] : String(m.getMonth() + 1) + '月') : '')
        lastMonth = m.getMonth()
      }
      const maxDay = Math.max(...columns.map(x => x.tokens), 1)
      const levelOf = tokens => {
        const ratio = tokens / maxDay
        return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4
      }
      const cell = entry => {
        const { day, tokens } = entry
        const cls = 'cm-ug-cell' + (tokens > 0 ? ' l' + levelOf(tokens) : '') + (day.date === todayKey ? ' today' : '')
        const tip = t('usageDay', {
          date: day.date,
          tokens: formatTokens(tokens),
          input: formatTokens(day.input ?? 0),
          cache: formatTokens((day.cacheRead ?? 0) + (day.cacheWrite ?? 0)),
          output: formatTokens(day.output ?? 0),
          calls: day.calls ?? 0,
          cost: formatMoneyUsd(day.cost ?? 0, config),
        })
        return el(Tooltip, { key: day.date, label: tip, side: 'top', delayMs: 200 },
          el('div', { className: cls }))
      }
      const total = state.total
      // 标题下只保留总计 token 数(输入/缓存/输出/调用已并入累计费用卡片);热力图保留。
      return el('div', { className: 'cm-budget' }, head,
        open ? el('div', { className: 'cm-collapse-body' },
          el('div', { className: 'cm-ug-total' }, t('usageTotal', {
            tokens: formatTokens(dayTokensOf(total)),
          })),
          el('div', { className: 'cm-ug-grid', style: { gridTemplateColumns: 'repeat(' + WEEKS + ',1fr)' } },
            columns.map(cell)),
          el('div', { className: 'cm-ug-months', style: { gridTemplateColumns: 'repeat(' + WEEKS + ',1fr)' } },
            monthLabels.map((m, i) => el('span', { key: 'm' + String(i), className: 'cm-ug-monthc' }, m)))) : null)
    }

    function CostSection(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const api = props.api
      const state = costStore?.state ?? null
      const [message, setMessage] = useState(null)
      const [confirmReset, setConfirmReset] = useState(false)
      const [busy, setBusy] = useState(false)
      // 同步官方价格进行中(按钮禁用反馈)。
      const [syncing, setSyncing] = useState(false)

      useEffect(() => {
        if (costStore?.status === 'error' && costStore.error) setMessage({ kind: 'err', text: t('ledgerReadFailed', { message: costStore.error }) })
      }, [costStore?.status, costStore?.error])

      // 语言跟随已保存配置(合并页已无配置编辑控件)。
      const locale = resolveLocale(state?.config?.locale)
      const t = makeT(locale)

      if (costStore === undefined || state === null) {
        return el('div', { className: 'cm-section' },
          el('p', { className: 'cm-empty' }, costStore?.status === 'loading' ? t('readingLedger') : t('ledgerUnavailable')))
      }
      const config = state.config

      const doReset = async () => {
        if (busy) return
        setBusy(true)
        try {
          await api.resetHistory()
          setMessage({ kind: 'ok', text: t('historyCleared') })
        } catch (error) {
          setMessage({ kind: 'err', text: t('clearFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
          setConfirmReset(false)
        }
      }
      // 交叉对账警示:官方余额当日变动与本地账本今日费用偏差超阈时由宿主产生(对账默认开启,
      // 无 UI 开关;此处为合并页内唯一展示位)。
      const driftWarn = state.reconcile !== null && typeof state.reconcile === 'object' && state.reconcile.ok === false
        ? el('div', { className: 'cm-msg warn' }, '⚠ ' + state.reconcile.message)
        : null
      const doSyncPrices = async () => {
        if (syncing || api === undefined) return
        setSyncing(true)
        try {
          const result = await api.fetchPrices()
          setMessage({ kind: result.ok ? 'ok' : 'err', text: result.message })
        } catch (error) {
          setMessage({ kind: 'err', text: error?.message ?? String(error) })
        } finally {
          setSyncing(false)
        }
      }
      // 数据操作区(居中):同步官方价格 + 重置本地统计(两步确认)。
      const opsRow = confirmReset
        ? el(Fragment, null,
          el('span', { className: 'cm-hint' }, t('confirmReset')),
          el('button', { className: 'cm-btn danger', onClick: doReset, disabled: busy }, t('confirmClear')),
          el('button', { className: 'cm-btn', onClick: () => setConfirmReset(false) }, t('cancel')))
        : el(Fragment, null,
          el('button', { className: 'cm-btn', onClick: () => void doSyncPrices(), disabled: syncing, title: t('syncPricesHint') }, syncing ? t('syncingPrices') : t('syncPrices')),
          el('button', { className: 'cm-btn danger', onClick: () => setConfirmReset(true), disabled: busy, title: t('clearAllHistoryHint') }, t('resetLocalStats')))
      // 单页展示(概览 + 用量合并,无标签;价格页与官方余额面板已裁剪)。
      return el('div', { className: 'cm-section' },
        // 操作结果提示(同步价格 / 重置统计):全局展示。
        message !== null ? el('div', { className: 'cm-msg ' + message.kind }, message.text) : null,
        // 交叉对账警示(官方余额与本地账本偏差)。
        driftWarn,
        // 汇总卡片(今日卡片受 hideTodayCost 门控,issue #46)
        el('div', { className: 'cm-cards' },
          config.hideTodayCost === true ? null : el(Card, {
            title: t('cardToday'),
            value: formatMoneyUsd(state.today.cost, config),
            tip: t('periodToday'),
            lines: [
              t('cardInput', { input: formatTokens(state.today.input) }),
              t('cardCache', { cache: formatTokens(state.today.cacheRead + state.today.cacheWrite) }),
              t('cardOutput', { output: formatTokens(state.today.output) }),
              t('cardCalls', { calls: state.today.calls }),
            ],
          }),
          el(Card, {
            title: t('cardMonth'),
            value: formatMoneyUsd(state.month.cost, config),
            tip: t('periodMonth'),
            lines: [
              t('cardInput', { input: formatTokens(state.month.input) }),
              t('cardCache', { cache: formatTokens(state.month.cacheRead + state.month.cacheWrite) }),
              t('cardOutput', { output: formatTokens(state.month.output) }),
              t('cardCalls', { calls: state.month.calls }),
            ],
          }),
          el(Card, {
            title: t('cardTotal'),
            value: formatMoneyUsd(state.total.cost, config),
            tip: t('periodTotal'),
            lines: [
              t('cardInput', { input: formatTokens(state.total.input) }),
              t('cardCache', { cache: formatTokens(state.total.cacheRead + state.total.cacheWrite) }),
              t('cardOutput', { output: formatTokens(state.total.output) }),
              t('cardCalls', { calls: state.total.calls }),
            ],
          })),
        // Token 用量统计
        el(UsagePanel, { state, t, locale }),
        // 历史(三角折叠面板;日期行可再展开会话明细)
        el(HistoryPanel, { state, api }),
        // 按会话统计(全部历史,不分日期;issue #22)
        el(SessionRankPanel, { state, api }),
        // 数据操作(同步官方价格 / 重置本地统计)
        el('div', { className: 'cm-ops' }, opsRow))
    }

    // ── 费用浮层(替代宿主设置面板:余额卡片点击打开) ──────────────────────────

    // 本会话今日费用(美元):由 composer.dock 的 SessionCostBridge 广播;SidebarFooter 读取。
    let currentSessionCost = null
    const sessionCostListeners = new Set()
    function setCurrentSessionCost(value) {
      if (currentSessionCost === value) return
      currentSessionCost = value
      for (const fn of sessionCostListeners) fn(value)
    }
    function subscribeSessionCost(fn) {
      sessionCostListeners.add(fn)
      return () => { sessionCostListeners.delete(fn) }
    }
    /** 由左下角卡片的刷新按钮触发:立即重拉「今日当前会话」费用(SessionCostBridge 注册)。 */
    let requestSessionCostRefresh = null

    /** 本地日期键(YYYY-MM-DD),与宿主 store.js localDayKey 同口径(浏览器本地时区)。 */
    function localDayKeyClient(ms) {
      const d = new Date(ms)
      const pad = n => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    }

    /**
     * 常驻会话费用桥:在会话页取「本会话今日费用」并广播到模块级变量。
     * 注意不能用 costUsage 投影的累计值——那是全会话费用,跨天会话会把前几天也计入
     * (用户实测:显示成了会话总费用)。正确口径 = 账本今日(dayKey)记录里按 sessionId
     * 匹配的那一行的 cost(账本按天增量记账,即今天发生在该会话上的费用)。
     * 无活跃会话 / 匹配不到(今日无调用)时按 0 显示;30s 轮询跟随调用实时增长。
     */
    function SessionCostBridge(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      // 会话级插槽注入的 sessions 状态(current = 当前会话 id,与账本 sessionId 同源)。
      const sessionState = props.useSessions ? props.useSessions(st => st) : undefined
      const sessionId = sessionState?.current ?? null
      const api = props.api
      const fetchTodaySessionCost = async () => {
        // 拿不到会话 id(理论不会,防御):退回全会话累计,保证行不消失。
        if (api === undefined || typeof sessionId !== 'string' || sessionId.length === 0) {
          setCurrentSessionCost(!usage || !config ? null : usageCost(usage, config))
          return
        }
        try {
          const day = await api.getDaySessions(localDayKeyClient(Date.now()))
          const rows = Array.isArray(day?.sessions) ? day.sessions : []
          const row = rows.find(s => s !== null && typeof s === 'object' && String(s.id) === sessionId)
          setCurrentSessionCost(row !== undefined && typeof row.cost === 'number' && Number.isFinite(row.cost) ? row.cost : 0)
        } catch (_) {
          setCurrentSessionCost(null)
        }
      }
      useEffect(() => {
        void fetchTodaySessionCost()
        // 注册手动刷新钩子:卡片刷新按钮点按后立即重拉,不等 30s 轮询。
        requestSessionCostRefresh = () => void fetchTodaySessionCost()
        const timer = window.setInterval(() => void fetchTodaySessionCost(), 30000)
        return () => {
          window.clearInterval(timer)
          if (requestSessionCostRefresh !== null) requestSessionCostRefresh = null
        }
      }, [api, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
      return null
    }

    function CostOverlay(props) {
      const { onClose } = props
      useEffect(() => {
        if (!onClose) return
        const onKeyDown = event => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKeyDown)
        return () => { document.removeEventListener('keydown', onKeyDown) }
      }, [onClose])
      const t = makeT(resolveLocale(props.useCost ? props.useCost(s => s).state?.config?.locale : undefined))
      return el('div', { className: 'cm-overlay', role: 'presentation' },
        el('div', { className: 'cm-overlay-mask', onClick: onClose }),
        el('div', { className: 'cm-overlay-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('overlayTitle') },
          el('div', { className: 'cm-overlay-header' },
            el('span', { className: 'cm-overlay-title' }, t('overlayTitle')),
            el('button', { type: 'button', className: 'cm-overlay-close', onClick: onClose, 'aria-label': t('close') }, '✕')),
          el('div', { className: 'cm-overlay-body' },
            el(CostSection, props))))
    }

    // ── 插件主体 ────────────────────────────────────────────────────────────

    const inject = ['remote']

    async function apply(ctx) {
      const remote = ctx.remote
      if (remote === undefined || typeof remote.$mount !== 'function') return
      const unmount = await remote.$mount(CONTRIBUTION)
      ctx.effect(() => () => { unmount() }, 'cost-meter: remote contribution')
      const costMeter = ctx.get('remote.costMeter')
      if (costMeter === undefined) return
      const store = makeStore({ status: 'loading', error: null, state: null })

      // RPC 层错误兜底文案(按当前配置语言)。
      const rpcT = () => makeT(resolveLocale(store.getSnapshot().state?.config?.locale))

      const call = async (method, args) => {
        const result = await costMeter[method](...(args ?? []))
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          throw new Error(result?.error?.message ?? rpcT()('rpcFailed', { method }))
        }
        return result.value
      }
      let reloading = false
      const reload = async () => {
        if (reloading) return // 并发防抖:轮询/手动刷新/重连不叠加 getState,避免乱序覆盖
        reloading = true
        const prev = store.getSnapshot()
        try {
          const state = await call('getState')
          store.set({ status: 'ready', error: null, state })
          // locale=auto 始终动态跟随当前浏览器语言,不要把探测结果持久化成 en/zh。
          // 否则用户切换浏览器语言后,旧的固定配置会继续覆盖浏览器语言。
        } catch (error) {
          store.set({ status: 'error', error: error?.message ?? String(error), state: prev.state })
        } finally {
          reloading = false
        }
      }
      ctx.effect(() => ctx.on('connection/reset', () => { void reload() }), 'cost-meter: reconnect reload')
      // 侧边栏「今日费用/余额」与设置页看板依赖 getState 快照渲染,没有推送通道:
      // 60s 周期轮询(页面隐藏时跳过) + visibilitychange 重新可见时立即刷新,避免冻结在加载时刻(#3)。
      const pollTimer = setInterval(() => { if (!document.hidden) void reload() }, 60_000)
      ctx.effect(() => () => { clearInterval(pollTimer) }, 'cost-meter: poll timer')
      const onVisible = () => { if (document.visibilityState === 'visible') void reload() }
      document.addEventListener('visibilitychange', onVisible)
      ctx.effect(() => () => { document.removeEventListener('visibilitychange', onVisible) }, 'cost-meter: visibility reload')

      const api = {
        reload,
        updateConfig: async patch => {
          const state = await call('updateConfig', [patch])
          store.set({ status: 'ready', error: null, state })
          return state
        },
        fetchPrices: async () => {
          const result = await costMeter.fetchPrices()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? rpcT()('rpcSyncFailed'))
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
        resetHistory: async () => {
          const state = await call('resetHistory')
          store.set({ status: 'ready', error: null, state })
          return state
        },
        // 按需拉取某天会话明细(issue #22),返回当日完整记录。
        getDaySessions: async date => call('getDaySessions', [date]),
        // 跨全部日期的会话排行(issue #22 不分日期视角):支持费用/时间升降序与实时顺序。
        getTopSessions: async (limit, sort, dir) => call('getTopSessions', [limit, sort, dir]),
        refreshBalance: async () => {
          const result = await costMeter.refreshBalance()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? rpcT()('rpcBalanceFailed'))
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
      }

      void reload()

      const slots = ctx.get('slots')
      if (slots === undefined) return

      const injected = () => ({ hooks: { cost: store }, api })

      // 会话徽章按配置位置注册;配置变化时先撤销旧注册再重建。
      const sessionActive = { gen: 0, dispose: null }
      const registerSession = position => {
        if (sessionActive.dispose !== null) { sessionActive.dispose(); sessionActive.dispose = null }
        sessionActive.gen += 1
        const gen = sessionActive.gen
        if (position === 'off') return
        const slotName = position === 'header' ? 'conversation.session.header.actions' : 'conversation.composer.dock'
        const options = position === 'header'
          ? { name: slotName, id: 'cost-lite', order: -5, inject: injected }
          : { name: slotName, id: 'cost-lite', order: 5, inject: injected }
        slots.inject(slotName, () => {
          if (sessionActive.gen !== gen) return
          const dispose = slots.register(options, position === 'header' ? SessionCost : DockLine)
          if (sessionActive.gen !== gen) { dispose(); return }
          sessionActive.dispose = dispose
          return () => {
            if (sessionActive.dispose === dispose) sessionActive.dispose = null
            dispose()
          }
        })
      }
      const footerActive = { gen: 0, dispose: null }
      const registerFooter = enabled => {
        if (footerActive.dispose !== null) { footerActive.dispose(); footerActive.dispose = null }
        footerActive.gen += 1
        const gen = footerActive.gen
        if (!enabled) return
        slots.inject('sidebar.footer.action', () => {
          if (footerActive.gen !== gen) return
          const dispose = slots.register({ name: 'sidebar.footer.action', id: 'cost-lite', order: 0, inject: injected }, SidebarFooter)
          if (footerActive.gen !== gen) { dispose(); return }
          footerActive.dispose = dispose
          return () => {
            if (footerActive.dispose === dispose) footerActive.dispose = null
            dispose()
          }
        })
      }

      // 余额卡片点击打开的「费用」浮层:直接在 SidebarFooter 内部渲染(见组件),
      // 不再通过插槽常驻,避免 slot 渲染时序与 fixed 定位受侧边栏动画影响。

      // 峰/谷切换前弹窗提醒:全局 fixed 浮层(fixed 定位与宿主位置无关),挂在常驻的
      // sidebar.footer.action 插槽——conversation.composer.dock 仅在有活跃会话的页面渲染,
      // 挂那里会导致 hero/设置页不弹提醒、预览按钮失效(issue:预览点了没反应)。
      // 组件内部再按配置门控(peakAlertEnabled + peakEnabled);开关变化时重挂/卸载。
      const peakAlertActive = { gen: 0, dispose: null }
      const registerPeakAlert = enabled => {
        if (peakAlertActive.dispose !== null) { peakAlertActive.dispose(); peakAlertActive.dispose = null }
        peakAlertActive.gen += 1
        const gen = peakAlertActive.gen
        if (!enabled) return
        slots.inject('sidebar.footer.action', () => {
          if (peakAlertActive.gen !== gen) return
          const dispose = slots.register({ name: 'sidebar.footer.action', id: 'cost-lite-peak-alert', order: 0, inject: injected }, PeakAlert)
          if (peakAlertActive.gen !== gen) { dispose(); return }
          peakAlertActive.dispose = dispose
          return () => {
            if (peakAlertActive.dispose === dispose) peakAlertActive.dispose = null
            dispose()
          }
        })
      }

      // 预览 API 在 activate 顶层注册(不依赖任何插槽挂载):浮层按钮与控制台均经
      // 此入口派发事件;弹窗宿主组件挂载时置 __cmPeakAlertLive,未挂载时给出可诊断提示。
      window.cmPeakAlertPreview = kind => {
        if (window.__cmPeakAlertLive !== true) {
          // eslint-disable-next-line no-console
          console.warn('[dsh-cost-lite] 弹窗组件未挂载:需启用峰谷计价并重启 dsh web 后再预览。')
          return
        }
        window.dispatchEvent(new CustomEvent(PEAK_ALERT_PREVIEW_EVENT, { detail: { kind: kind === 'offpeak' ? 'offpeak' : 'peak' } }))
      }

      // 会话费用桥:常驻 composer.dock(会话页,有 useProjection),把本会话费用
      // 广播到模块级 currentSessionCost,供左下角 SidebarFooter 显示「今日本会话」。
      slots.inject('conversation.composer.dock', () => {
        const dispose = slots.register(
          { name: 'conversation.composer.dock', id: 'cost-lite-session-bridge', order: 99, inject: injected },
          SessionCostBridge,
        )
        return dispose
      })

      let lastPosition = null
      let lastFooter = null
      let lastPeakAlert = null
      const sync = () => {
        const state = store.getSnapshot().state
        const position = state?.config?.position ?? 'dock'
        const showToday = state?.config?.sidebar !== false && state?.config?.hideTodayCost !== true
        const balanceDisplay = state?.config?.balance?.display ?? 'both'
        const showBalance = (balanceDisplay === 'sidebar' || balanceDisplay === 'both') && state?.config?.hideOfficialBalance !== true
        const footer = showToday || showBalance
        if (position !== lastPosition) {
          registerSession(position)
          lastPosition = position
        }
        if (footer !== lastFooter) {
          registerFooter(footer)
          lastFooter = footer
        }
        // 峰谷计价启用即常驻挂载(提醒开关关闭时也保留组件,供浮层预览弹窗)。
        const peakAlertOn = state?.config?.peakEnabled === true
        if (peakAlertOn !== lastPeakAlert) {
          registerPeakAlert(peakAlertOn)
          lastPeakAlert = peakAlertOn
        }
      }
      sync()
      const stopSync = store.subscribe(sync)

      return () => { stopSync() }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
