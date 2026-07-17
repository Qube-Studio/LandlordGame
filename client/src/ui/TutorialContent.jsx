// 教程正文渲染器（EDITOR_OVERHAUL §1.1 共享渲染器）：从 RulesPanel 抽出的 .tut-content 容器
// + 章节标题 + 全部段落渲染，游戏教程面板与教程编辑器 2.0 预览共用——所见即所得靠同一份组件，
// 不靠手抄镜像。段落形态（与 tutorial.json 一致）：
//   字符串（**…** 金字、"- " 开头渲染为缩进列表项；空串 = 排版空行）、
//   {text, size}（带字号的文字段，size ∈ s/l/xl，档位像素值在 pixel.css 的 .rules-p.fs-*）、
//   {img, alt, width}（图片段落；img 为空时游戏渲染 null，编辑器经 renderEmptyImg 给占位框；
//     width=显示宽度 px，缺省=原图尺寸——无 width 时不落 style，存量图片段 DOM 逐字节不变；
//     .tut-img 的 max-width:100% 保证窄屏不溢出。上下限与 store 的 IMG_W 双写，改需同步）、
//   {bar, width, fill, color, fade}（属性条；旧段式 {value,max} 自动折算为 fill）。
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

export default function TutorialContent({ chapter, fallback = null, scrollRef, renderEmptyImg, blockRef, blockProps }) {
  return (
    <div className="tut-content" ref={scrollRef}>
      {chapter ? (
        <>
          <div className="tut-content-title">
            <PixelText size={2} color="var(--px-gold)">{chapter.title}</PixelText>
          </div>
          {(chapter.body ?? []).map((item, i) => {
            const aRef = blockRef ? blockRef(i) : undefined;
            const aProps = blockProps ? blockProps(i) : undefined;
            const obj = item && typeof item === 'object';
            if (obj && 'img' in item) {
              if (!item.img) {
                // 空图片：游戏不传 renderEmptyImg → 渲染 null（与抽取前行为一致）；编辑器给占位框
                return renderEmptyImg ? <Fragment key={i}>{renderEmptyImg(item, i)}</Fragment> : null;
              }
              const iw = Math.round(Number(item.width));
              const iStyle = Number.isFinite(iw) && iw > 0 ? { width: Math.max(24, Math.min(1200, iw)) } : undefined;
              return <img key={i} ref={aRef} {...aProps} className="tut-img" style={iStyle} src={item.img} alt={item.alt ?? ''} draggable={false} />;
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
                <div key={i} ref={aRef} {...aProps} className={`rules-bar c-${color} fade-${fade}`}>
                  {item.bar ? (
                    <span className="rb-label">
                      {parseRuns(String(item.bar)).map((r, j) => (
                        <span key={j} className={r.hi ? 'hi' : ''}>{r.t}</span>
                      ))}
                    </span>
                  ) : null}
                  <span className="rb-track" style={{ width }}>
                    <span className="rb-fill" style={{ width: `${fill}%` }} />
                  </span>
                </div>
              );
            }
            const raw = String(obj ? item.text ?? '' : item);
            if (!raw.trim()) return <div key={i} ref={aRef} {...aProps} className="rules-gap" />;
            const li = raw.startsWith('- ');
            const text = li ? raw.slice(2) : raw;
            const fs = obj && ['s', 'l', 'xl'].includes(item.size) ? ` fs-${item.size}` : '';
            return (
              <p key={i} ref={aRef} {...aProps} className={`rules-p ${li ? 'li' : ''}${fs}`}>
                {li && <span className="rules-dash">-</span>}
                {parseRuns(text).map((r, j) => (
                  <span key={j} className={r.hi ? 'hi' : ''}>{r.t}</span>
                ))}
              </p>
            );
          })}
        </>
      ) : fallback}
    </div>
  );
}
