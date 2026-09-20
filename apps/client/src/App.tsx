import { useEffect } from "react";
import { useStore } from "./store.js";
import Home from "./views/Home.js";
import RoomView from "./views/RoomView.js";

export default function App() {
  const connected = useStore((s) => s.connected);
  const room = useStore((s) => s.room);
  const error = useStore((s) => s.error);
  const notice = useStore((s) => s.notice);
  const dismissError = useStore((s) => s.dismissError);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app">
      {!connected && <div className="conn-banner">连接中…（网络恢复后将自动回到座位）</div>}
      {room ? <RoomView /> : <Home />}
      {error && (
        <div className="toast toast-error" role="alert" onClick={dismissError}>
          {error}
          <span className="toast-close">×</span>
        </div>
      )}
      {notice && <div className="toast toast-notice">{notice}</div>}
    </div>
  );
}
