import ActionBar from "../components/ActionBar.js";
import AuctionPanel from "../components/AuctionPanel.js";
import Board from "../components/Board.js";
import ChatPanel from "../components/ChatPanel.js";
import FxLayer from "../components/FxLayer.js";
import LogPanel from "../components/LogPanel.js";
import PlayerPanel from "../components/PlayerPanel.js";
import PortfolioPanel from "../components/PortfolioPanel.js";
import TradePanel from "../components/TradePanel.js";

export default function GameView() {
  return (
    <div className="game">
      <FxLayer />
      <div className="game-main">
        <Board />
      </div>
      <aside className="game-side">
        <PlayerPanel />
        <AuctionPanel />
        <ActionBar />
        <PortfolioPanel />
        <TradePanel />
        <LogPanel />
        <ChatPanel />
      </aside>
    </div>
  );
}
