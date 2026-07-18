// 教程正文渲染器（EDITOR_OVERHAUL §1.1 共享渲染器）：从 RulesPanel 抽出的 .tut-content 容器
// + 章节标题 + 全部段落渲染，游戏教程面板与教程编辑器 2.0 预览共用——所见即所得靠同一份组件，
// 不靠手抄镜像。段落形态（与 tutorial.json 一致）：
//   字符串（**…** 金字、"- " 开头渲染为缩进列表项；空串 = 排版空行）、
//   {text, size}（带字号的文字段，size ∈ s/l/xl，档位像素值在 pixel.css 的 .rules-p.fs-*）、
//   {img, alt, width}（图片段落；img 为空时游戏渲染 null，编辑器经 renderEmptyImg 给占位框；
//     width=显示宽度 px，缺省=原图尺寸——无 width 时不落 style，存量图片段 DOM 逐字节不变；
//     .tut-img 的 max-width:100% 保证窄屏不溢出。上下限与 store 的 IMG_W 双写，改需同步）、
//   {bar, width, fill, color, fade}（属性条；旧段式 {value,max} 自动折算为 fill）、
//   {row: [左, 右], valign}（双栏并排排版：两栏各是一个上述段落，flex 两列 align-items:flex-start
//     互不干扰（不是 float 环绕）；图片栏有 width 时按宽固定、文字栏占余下；valign='center' 垂直居中）。
// 段落渲染统一走 renderBlock(item, key, {aRef, aProps, top})——顶层段落带编辑器锚点(aRef/aProps)、
// 双栏子项不带；row 只在 top 层展开（不嵌套 row）。现有类型的顶层输出逐字节不变（保 S14 渲染基线）。
// 纯净性硬约束：只准 import game/richtext(parseRuns) 与 PixelText——禁止 import text/*、gameStore，
// 否则编辑器模块图会触达 tutorial.json（text/zh.js import 它），每次保存都自我 full-reload。
// 可选 props（游戏一律不传 → DOM 零变化，RulesPanel 渲染结果逐字节不变）：
//   chapter        {title, body[]}；null 时渲染 fallback
//   fallback       无章节时的占位内容（RulesPanel 传空态提示——文案留在游戏侧，本组件不碰 text/*）
//   scrollRef      挂到 .tut-content 容器上（RulesPanel 的换章滚动落点需要）
//   renderEmptyImg (item, i) => 节点——img 为空串时的占位（编辑器传占位框；不传 = null，与游戏一致）
//   blockRef       (i) => ref——每个段落块的 DOM ref（编辑器滚动锚点用）
//   blockProps     (i) => props——附加到每个段落块上（编辑器 data-* 锚点用）
import { Fragment } from 'react';
import PixelText from '../assets/pixelfont/PixelText';
import { parseRuns } from '../game/richtext';

// 富文本 runs → span 序列（**金字** = .hi）
const runs = (str) => parseRuns(String(str)).map((r, j) => <span key={j} className={r.hi ? 'hi' : ''}>{r.t}</span>);

export default function TutorialContent({ chapter, fallback = null, scrollRef, renderEmptyImg, blockRef, blockProps }) {
  // 单个段落 → JSX。aRef/aProps 只在顶层透传（编辑器锚点）；top=false 时不展开 row（防嵌套）。
  const renderBlock = (item, key, { aRef, aProps, top } = {}) => {
    const obj = item && typeof item === 'object';
    if (obj && 'img' in item) {
      if (!item.img) {
        // 空图片：游戏不传 renderEmptyImg → 渲染 null（与抽取前行为一致）；编辑器给占位框
        return renderEmptyImg ? <Fragment key={key}>{renderEmptyImg(item, key)}</Fragment> : null;
      }
      const iw = Math.round(Number(item.width));
      const iStyle = Number.isFinite(iw) && iw > 0 ? { width: Math.max(24, Math.min(1200, iw)) } : undefined;
      return <img key={key} ref={aRef} {...aProps} className="tut-img" style={iStyle} src={item.img} alt={item.alt ?? ''} draggable={false} />;
    }
    if (top && obj && 'row' in item && Array.isArray(item.row)) {
      // 双栏并排：两列各渲一个子段落，flex 互不干扰（见 pixel.css .rules-row）
      const v = item.valign === 'center' ? ' v-center' : '';
      return (
        <div key={key} ref={aRef} {...aProps} className={`rules-row${v}`}>
          {item.row.slice(0, 2).map((col, c) => {
            const imgCol = col && typeof col === 'object' && 'img' in col;
            const fixed = imgCol && col.img && Number(col.width) > 0 ? ' fixed' : ''; // 图有固定宽 → 该列按宽，另一列占余
            return <div key={c} className={`rules-col${fixed}`}>{renderBlock(col, c, {})}</div>;
          })}
        </div>
      );
    }
    if (obj && 'bar' in item) {
      const w0 = Math.round(Number(item.width));
      const width = Number.isFinite(w0) && w0 > 0 ? Math.max(24, Math.min(400, w0)) : 144;
      let fill = item.fill != null ? Number(item.fill)
        : Number(item.max) > 0 ? (Number(item.value) || 0) / Number(item.max) * 100 : 0; // 旧段式折算
      fill = Math.max(0, Math.min(100, Math.round(Number.isFinite(fill) ? fill : 0)));
      const color = ['gold', 'green', 'red', 'blue'].includes(item.color) ? item.color : 'gold';
      const fade = ['both', 'left', 'right', 'none'].includes(item.fade) ? item.fade : 'both';
      return (
        <div key={key} ref={aRef} {...aProps} className={`rules-bar c-${color} fade-${fade}`}>
          {item.bar ? <span className="rb-label">{runs(item.bar)}</span> : null}
          <span className="rb-track" style={{ width }}>
            <span className="rb-fill" style={{ width: `${fill}%` }} />
          </span>
        </div>
      );
    }
    const raw = String(obj ? item.text ?? '' : item);
    const fs = obj && ['s', 'l', 'xl'].includes(item.size) ? ` fs-${item.size}` : '';
    // 一行 → 一段（空=排版空行；"- " 开头=列表项）。
    const line = (s, k, ref, props) => {
      if (!s.trim()) return <div key={k} ref={ref} {...props} className="rules-gap" />;
      const li = s.startsWith('- ');
      return (
        <p key={k} ref={ref} {...props} className={`rules-p ${li ? 'li' : ''}${fs}`}>
          {li && <span className="rules-dash">-</span>}
          {runs(li ? s.slice(2) : s)}
        </p>
      );
    };
    // 顶层：每个字符串=一段（\n 视觉为空格，S14 基线依赖此不变）。
    // 双栏文字栏（!top）：按 \n 拆多行，每行独立成段——右栏能放多行带列表的文字。
    if (top) return line(raw, key, aRef, aProps);
    return <Fragment key={key}>{raw.split('\n').map((ln, k) => line(ln, k))}</Fragment>;
  };

  return (
    <div className="tut-content" ref={scrollRef}>
      {chapter ? (
        <>
          <div className="tut-content-title">
            <PixelText size={2} color="var(--px-gold)">{chapter.title}</PixelText>
          </div>
          {(chapter.body ?? []).map((item, i) => renderBlock(item, i, {
            aRef: blockRef ? blockRef(i) : undefined,
            aProps: blockProps ? blockProps(i) : undefined,
            top: true,
          }))}
        </>
      ) : fallback}
    </div>
  );
}
