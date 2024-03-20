import fetch from "node-fetch";
import WebSocket from "ws";
import { DepthUpdateEvent, snapshot } from "./types";
import { Subscriber } from "./nord";

const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@depth";
const SNAPSHOT_URL =
  "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=1000";

const s = new Subscriber({
  streamURL: STREAM_URL,
  snapshotURL: SNAPSHOT_URL,
  maxBufferLen: 5,
});
s.subsribe();
// s.getSnapShot();
