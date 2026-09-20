/**
 * 特效层（M4-1）：中央速报（购买/拍卖成交/破产）与卡牌弹层（机会/命运翻转展示）
 * 纯展示组件——生命周期由 store 的事件播放队列驱动。
 */
import { useStore } from "../store.js";

export default function FxLayer() {
  const activeCard = useStore((s) => s.activeCard);
  const flash = useStore((s) => s.flash);

  return (
    <div className="fx-layer" aria-live="polite">
      {flash && (
        <div key={flash.key} className={`fx-flash fx-${flash.tone}`}>
          <div className="fx-flash-title">{flash.title}</div>
          {flash.sub && <div className="fx-flash-sub">{flash.sub}</div>}
        </div>
      )}
      {activeCard && (
        <div key={activeCard.key} className={`fx-card fx-card-${activeCard.deck}`}>
          <span className="fx-card-deck">{activeCard.deck === "chance" ? "机会" : "命运"}</span>
          <span className="fx-card-text">{activeCard.text}</span>
        </div>
      )}
    </div>
  );
}
